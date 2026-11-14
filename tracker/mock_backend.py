"""Stand-in for the backend's tracker endpoints (docs/contract.md section 4), for development
and tests until the real backend is up. Stdlib only. Not for production.

    python mock_backend.py                  # http://localhost:4000, pairing code 482913
    python tracker.py --api-url http://localhost:4000 --pair 482913

It validates every /usage body against the contract, ignores repeated batchIds like the real
backend will, and can inject failures to exercise the tracker's retry queue.
"""

import argparse
import json
import re
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

DEFAULT_CONFIG = {
    "groupId": "6734f0c2a1b2c3d4e5f60718",
    "blocklist": {
        "processes": [
            {"match": "VALORANT-Win64-Shipping.exe", "label": "Valorant"},
            {"match": "League of Legends.exe", "label": "League of Legends"},
            {"match": "Discord.exe", "label": "Discord"},
        ],
        "steamGames": True,  # Steam-launched games count; the Steam client itself does not
        "titles": [{"match": t, "label": t} for t in ("TikTok", "YouTube", "Reddit", "Instagram", "Twitch")],
    },
    "periodStart": 1794729000000,
    "periodEnd": 1794729900000,
    "sampleIntervalSec": 2,
    "reportIntervalSec": 30,
    "idleThresholdSec": 120,
}


def validate_usage(body) -> str:
    """Return '' if body matches the contract's POST /usage request, else what's wrong."""
    if not isinstance(body, dict):
        return "body must be an object"
    if not isinstance(body.get("batchId"), str) or not UUID_RE.match(body["batchId"]):
        return "batchId must be a UUID string"
    if not isinstance(body.get("sentAt"), int) or isinstance(body["sentAt"], bool):
        return "sentAt must be integer ms"
    if not isinstance(body.get("idle"), bool):
        return "idle must be a boolean"
    cur = body.get("current", "missing")
    if cur is not None and (not isinstance(cur, dict) or not isinstance(cur.get("app"), str)
                            or cur.get("matchType") not in ("process", "title")):
        return "current must be null or {app, matchType}"
    if not isinstance(body.get("events"), list):
        return "events must be a list"
    for ev in body["events"]:
        if not (isinstance(ev, dict) and isinstance(ev.get("app"), str)
                and ev.get("matchType") in ("process", "title")
                and isinstance(ev.get("startedAt"), int) and isinstance(ev.get("seconds"), int)
                and ev["seconds"] >= 0):
            return f"bad event {ev!r}"
    return ""


class DualStackServer(ThreadingHTTPServer):
    """Listens on IPv6 and IPv4, so http://localhost works (Windows tries ::1 first)."""
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


class MockBackend:
    def __init__(self, port=0, code="482913", config=None, verbose=False, dual_stack=False):
        self.config, self.verbose = config or json.loads(json.dumps(DEFAULT_CONFIG)), verbose
        self.codes = {code: {"wallet": "H9RjeMockWallet111", "displayName": "Alice"}}  # code -> member
        self.tokens = {}  # token -> wallet
        self.batches = {}  # batchId -> body (what the real backend would store)
        self.batch_wallet = {}  # batchId -> wallet whose token sent it
        self.requests = []  # (method, path, headers, body) for every request
        self.fail_next = 0  # respond 503 to this many /usage calls without storing
        self.lose_next = 0  # store this many /usage batches, then respond 503 (lost response)
        self.lock = threading.Lock()
        if dual_stack:
            self.server = DualStackServer(("::", port), self._handler())
        else:
            self.server = ThreadingHTTPServer(("127.0.0.1", port), self._handler())
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    @property
    def seconds_by_app(self):
        out = {}
        for b in self.batches.values():
            for ev in b["events"]:
                out[ev["app"]] = out.get(ev["app"], 0) + ev["seconds"]
        return out

    @property
    def seconds_by_wallet(self):
        out = {}
        for bid, b in self.batches.items():
            w = self.batch_wallet[bid]
            out[w] = out.get(w, 0) + sum(ev["seconds"] for ev in b["events"])
        return out

    def start(self):
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self

    def stop(self):
        self.server.shutdown()
        self.server.server_close()

    def _handler(self):
        mock = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, status, body):
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _error(self, status, code, message):
                self._send(status, {"error": {"code": code, "message": message}})

            def _authed(self):
                auth = self.headers.get("Authorization", "")
                if auth.startswith("Bearer ") and auth[7:] in mock.tokens:
                    return mock.tokens[auth[7:]]
                self._error(401, "UNAUTHORIZED", "missing or unknown tracker token")
                return False

            def _body(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                return json.loads(raw) if raw else None

            def do_GET(self):
                with mock.lock:
                    mock.requests.append(("GET", self.path, dict(self.headers), None))
                    if self.path == "/health":
                        return self._send(200, {"ok": True})
                    if self.path == "/tracker/config":
                        return self._authed() and self._send(200, mock.config)
                    self._error(404, "NOT_FOUND", self.path)

            def do_POST(self):
                try:
                    body = self._body()
                except ValueError:
                    return self._error(400, "BAD_JSON", "body is not JSON")
                with mock.lock:
                    mock.requests.append(("POST", self.path, dict(self.headers), body))
                    if self.path == "/pair/complete":
                        member = mock.codes.get(body.get("code")) if isinstance(body, dict) else None
                        if member is None:
                            return self._error(400, "PAIR_CODE_INVALID", "unknown pairing code")
                        token = "trk_" + secrets.token_hex(16)
                        mock.tokens[token] = member["wallet"]
                        return self._send(200, {"trackerToken": token, "wallet": member["wallet"],
                                                "groupId": mock.config["groupId"],
                                                "displayName": member["displayName"]})
                    if self.path == "/usage":
                        wallet = self._authed()
                        if not wallet:
                            return None
                        problem = validate_usage(body)
                        if problem:
                            return self._error(400, "BAD_USAGE", problem)
                        if mock.fail_next:
                            mock.fail_next -= 1
                            return self._error(503, "UNAVAILABLE", "injected failure")
                        duplicate = body["batchId"] in mock.batches
                        mock.batches.setdefault(body["batchId"], body)
                        mock.batch_wallet.setdefault(body["batchId"], wallet)
                        if mock.verbose:
                            print(f"{time.strftime('%H:%M:%S')} /usage {'DUP ' if duplicate else ''}"
                                  f"current={body['current']} idle={body['idle']} events={body['events']}",
                                  flush=True)
                        if mock.lose_next:
                            mock.lose_next -= 1
                            return self._error(503, "UNAVAILABLE", "injected lost response")
                        return self._send(200, {"accepted": True, "duplicate": duplicate})
                    self._error(404, "NOT_FOUND", self.path)

        return Handler


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=4000)
    ap.add_argument("--code", default="482913", help="pairing code to accept")
    a = ap.parse_args()
    m = MockBackend(port=a.port, code=a.code, verbose=True, dual_stack=True)
    print(f"Mock backend on http://localhost:{a.port}  (pairing code {a.code}). Ctrl+C to stop.", flush=True)
    try:
        m.server.serve_forever()
    except KeyboardInterrupt:
        print(f"\nstored {len(m.batches)} batches; seconds by app: {m.seconds_by_app}")
