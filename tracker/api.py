"""HTTP client for the tracker endpoints in docs/contract.md section 4 (stdlib only)."""

import json
import urllib.error
import urllib.request
from typing import Optional
from urllib.parse import urlparse

TIMEOUT_SEC = 5  # reports go out every second; don't let one slow request stall sampling long


class ApiError(Exception):
    """Any failed call. `status` is None for network errors (no response at all)."""

    def __init__(self, status: Optional[int], code: str, message: str):
        super().__init__(f"{code}: {message}" + (f" (HTTP {status})" if status else ""))
        self.status, self.code, self.message = status, code, message

    @property
    def transient(self) -> bool:
        """Worth retrying later: network down, timeout, rate limit, or server error."""
        return self.status is None or self.status in (408, 429) or self.status >= 500

    @property
    def auth(self) -> bool:
        return self.status in (401, 403)


def is_insecure_remote(url: str) -> bool:
    """True for plain http to anything other than this machine (the token would travel unencrypted)."""
    u = urlparse(url)
    return u.scheme == "http" and u.hostname not in ("localhost", "127.0.0.1", "::1")


class ApiClient:
    def __init__(self, base_url: str, token: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def _call(self, method: str, path: str, body=None, auth=True) -> dict:
        headers = {"Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if auth:
            headers["Authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(self.base_url + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            raise _from_http_error(e) from None
        except (urllib.error.URLError, OSError) as e:  # refused, DNS, timeout, reset
            raise ApiError(None, "NETWORK", str(getattr(e, "reason", e))) from None
        try:
            return json.loads(raw) if raw else {}
        except ValueError:
            raise ApiError(502, "BAD_RESPONSE", "response was not JSON") from None

    def pair_complete(self, code: str, device_name: str) -> dict:
        """-> {trackerToken, wallet, groupId, displayName}"""
        return self._call("POST", "/pair/complete", {"code": code, "deviceName": device_name}, auth=False)

    def get_config(self) -> dict:
        """-> {groupId, blocklist, periodStart, periodEnd, sampleIntervalSec, reportIntervalSec, idleThresholdSec}"""
        return self._call("GET", "/tracker/config")

    def post_usage(self, batch: dict) -> dict:
        """-> {accepted, duplicate}"""
        return self._call("POST", "/usage", batch)


def _from_http_error(e: urllib.error.HTTPError) -> ApiError:
    code, message = "HTTP_ERROR", e.reason or ""
    try:
        err = json.loads(e.read())["error"]  # contract: {"error": {"code", "message"}}
        code, message = err.get("code", code), err.get("message", message)
    except (ValueError, KeyError, TypeError, OSError):
        pass
    return ApiError(e.code, code, str(message))
