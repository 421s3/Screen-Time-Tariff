"""Screen Time Tariff desktop tracker.

Polls the foreground window, checks it against the group's blocklist, and reports
usage batches to the backend (POST /usage, docs/contract.md section 4).
`--local` keeps the Checkpoint 1 behaviour: no backend, batches printed only.
"""

import argparse
import hashlib
import json
import socket
import sys
import time
from datetime import datetime
from pathlib import Path

from api import ApiClient, ApiError, is_insecure_remote
from blocklist import Blocklist
import winsys
from foreground import Sample, get_foreground, idle_seconds, visible_windows
from outbox import AuthFailed, Outbox, Reporter, make_batch
from state import HERE, RESOURCES, PairingState, resolve_api_url
from usage import UsageAggregator

DEFAULT_BLOCKLIST = RESOURCES / "blocklist.json"
DEFAULTS = {"sampleIntervalSec": 1.0, "reportIntervalSec": 1.0, "idleThresholdSec": 120.0}
MAX_RETRY_SEC = 30  # offline: network retries back off up to this; usage is still queued every report
CONFIG_REFRESH_SEC = 300


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Track foreground time on listed apps, games and sites (tracking only; nothing is blocked).")
    p.add_argument("--local", action="store_true", help="Checkpoint 1 mode: no backend, print batches only")
    p.add_argument("--api-url", help="backend base URL (default: API_URL env var, then tracker/.env, "
                                     "then http://localhost:4000)")
    p.add_argument("--pair", metavar="CODE", help="pair with the 6-digit code from the dashboard")
    p.add_argument("--unpair", action="store_true", help="forget the saved token and exit")
    p.add_argument("--games-only", action="store_true",
                   help="ignore browser title rules; count only games/apps (processes and Steam games)")
    p.add_argument("--fake", action="store_true",
                   help="SYNTHETIC usage (demo fallback): cycles Valorant/Steam game/unblocked, ignores real windows")
    p.add_argument("--data-dir", default=str(HERE), help="where the token file and queue/ live")
    p.add_argument("--blocklist", default=str(DEFAULT_BLOCKLIST),
                   help="blocklist JSON for --local, or fallback when the backend config is unreachable")
    p.add_argument("--interval", type=float, help="seconds between foreground checks (overrides backend)")
    p.add_argument("--report-every", type=float, help="seconds between usage batches (overrides backend)")
    p.add_argument("--verbose", action="store_true", help="print every sample, not only changes")
    p.add_argument("--once", action="store_true", help="print the current foreground window and exit")
    p.add_argument("--scan", action="store_true", help="classify every open window (demo laptop check) and exit")
    p.add_argument("--install-startup", action="store_true",
                   help="start this tracker automatically at Windows sign-in (current user) and exit")
    p.add_argument("--uninstall-startup", action="store_true", help="remove the sign-in entry and exit")
    args = p.parse_args(argv)
    if (args.interval is not None and args.interval <= 0) or (args.report_every is not None and args.report_every <= 0):
        p.error("--interval and --report-every must be > 0")
    if args.interval is not None and args.report_every is not None and args.report_every < args.interval:
        p.error("need --interval <= --report-every")
    return args


def describe(sample, match):
    if sample is None:
        return "(no foreground window)"
    tag = f"TRACKED [{match.label}/{match.match_type}]" if match else "ok"
    return f"{tag:<30} {sample.process} | {sample.title!r}"


def fake_samples():
    """--fake: 30 s of Valorant, 30 s of a Steam game, 30 s of something unblocked, repeat."""
    cycle = [Sample("VALORANT-Win64-Shipping.exe", "VALORANT"),
             Sample("tf_win64.exe", "Team Fortress 2",
                    r"C:\Program Files (x86)\Steam\steamapps\common\Team Fortress 2\tf_win64.exe"),
             Sample("Code.exe", "tracker.py - Visual Studio Code")]
    return lambda: cycle[int(time.monotonic() // 30) % len(cycle)]


# ---------------------------------------------------------------- backend setup

class PairingError(Exception):
    """Pairing didn't work; `code` is the backend's error code (or BAD_RESPONSE)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def pair_with_code(client, pairing, api_url, code) -> dict:
    """Exchange a dashboard code for a token and save it (DPAPI). Raises ApiError or PairingError."""
    resp = client.pair_complete(code, socket.gethostname())
    if not all(isinstance(resp.get(k), str) and resp[k] for k in ("trackerToken", "wallet", "groupId")):
        raise PairingError("BAD_RESPONSE", "backend response needs trackerToken, wallet and groupId")
    pairing.save_pairing(api_url, resp)
    client.token = resp["trackerToken"]
    return resp


def pair(client, pairing, api_url, code):
    if not code:
        try:
            code = input("Pairing code from the dashboard: ").strip()
        except EOFError:  # no console to type into (e.g. started at sign-in before pairing)
            sys.exit("Not paired yet. Run once with --pair CODE (code from the dashboard).")
    try:
        resp = pair_with_code(client, pairing, api_url, code)
    except ApiError as e:
        sys.exit(f"pairing failed: {e.message} ({e.code})")
    except PairingError as e:
        sys.exit(f"pairing failed: {e.message}")
    print(f"Paired as {resp.get('displayName')} ({resp.get('wallet')}) in group {resp.get('groupId')}.")


def fetch_config(client, pairing, fallback_path):
    """Backend config, else the last one we got, else the local blocklist file."""
    try:
        config = client.get_config()
        Blocklist.from_dict(config.get("blocklist", {}))  # validate before caching
        pairing.save_config(config)
        return config, "backend"
    except ApiError as e:
        if e.auth:
            pairing.clear()
            raise AuthFailed(str(e))
        why = str(e)
    except ValueError as e:
        why = f"bad blocklist from backend: {e}"
    if pairing.config:
        return pairing.config, f"cached ({why})"
    return {"blocklist": json.loads(Path(fallback_path).read_text(encoding="utf-8"))}, f"local file ({why})"


def connect(args):
    """Pair if needed and return (client, pairing)."""
    api_url = resolve_api_url(args.api_url)
    if is_insecure_remote(api_url):
        print(f"WARNING: {api_url} is plain http to another machine; the tracker token is sent "
              f"unencrypted. Use https (e.g. the ngrok URL).", file=sys.stderr)
    pairing = PairingState(Path(args.data_dir) / ".tracker_token.json")
    client = ApiClient(api_url, pairing.load(api_url))
    if args.pair or not client.token:
        print(f"Backend: {api_url}")
        pair(client, pairing, api_url, args.pair)
    return client, pairing


def queue_for(args, pairing, say=print):
    """Each pairing identity gets its own queue folder, so batches recorded while paired as one
    wallet are only ever sent with that wallet's token, never with a later pairing's."""
    root = Path(args.data_dir) / "queue"
    mine = root / pairing.identity
    if root.is_dir():
        for other in sorted(p for p in root.iterdir() if p.is_dir() and p != mine and p.name != "rejected"):
            n = len(Outbox(other))
            if n:
                say(f"Note: {n} batch(es) queued under a different pairing are kept in {other} "
                    f"and will be sent if that wallet pairs here again.")
    return Outbox(mine)


# ---------------------------------------------------------------- main loop

def startup_command(args) -> str:
    """Command line the sign-in entry runs: this .exe (or python + tracker.py) with the same data dir."""
    target = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, str(Path(__file__).resolve())]
    return " ".join(f'"{a}"' for a in [*target, "--data-dir", str(Path(args.data_dir).resolve())])


def instance_lock_name(data_dir) -> str:
    """One tracker (CLI or GUI) per data dir."""
    data_key = str(Path(data_dir).resolve()).lower().encode()
    return "ScreenTimeTariffTracker-" + hashlib.sha256(data_key).hexdigest()[:16]


def run(args):
    if args.unpair:
        PairingState(Path(args.data_dir) / ".tracker_token.json").clear()
        print("Token removed. Queued batches (if any) are kept in queue/.")
        return
    if args.install_startup:
        winsys.set_startup(startup_command(args))
        print(f"Will start at sign-in: {startup_command(args)}")
        return
    if args.uninstall_startup:
        print("Removed sign-in entry." if winsys.set_startup(None) else "No sign-in entry was set.")
        return
    read_window = fake_samples() if args.fake else get_foreground
    if args.scan or args.once:
        blocklist = Blocklist.load(args.blocklist)
        blocklist = blocklist.without_titles() if args.games_only else blocklist
        for sample in visible_windows() if args.scan else [read_window()]:
            print(describe(sample, blocklist.match(sample)))
        return

    # Two trackers on one data dir would report the same time twice (e.g. sign-in entry + manual start)
    with winsys.single_instance(instance_lock_name(args.data_dir)) as ok:
        if not ok:
            sys.exit("Another tracker is already running with this data dir. Close it first.")
        track(args, read_window)


class Stopped(Exception):
    """Raised inside the loop when `stop` is set (GUI quit / disconnect)."""


class ConsoleUI:
    """What `track` reports, printed like the CLI always has. The GUI passes its own object."""

    def log(self, text: str) -> None:
        print(text, flush=True)

    def on_sample(self, sample, match, idle: bool) -> None:
        pass

    def on_report(self, events: list, totals: dict, status: str, queued: int) -> None:
        pass


def track(args, read_window, ui=None, stop=None, connection=None):
    """The tracking loop. `ui` gets log lines and events (default: print). `stop` (threading.Event)
    ends it cleanly with a final batch. `connection` = an already-paired (client, pairing)."""
    ui = ui or ConsoleUI()

    def pause(seconds):
        if stop is None:
            time.sleep(seconds)
        elif stop.wait(seconds):
            raise Stopped()

    if args.fake:
        ui.log("*** SYNTHETIC MODE (--fake): usage below is generated, not read from real windows ***")

    reporter = client = pairing = None
    if args.local:
        config, source = {"blocklist": json.loads(Path(args.blocklist).read_text(encoding="utf-8"))}, "local file"
    else:
        client, pairing = connection or connect(args)
        reporter = Reporter(client, queue_for(args, pairing, ui.log), log=ui.log)
        config, source = fetch_config(client, pairing, args.blocklist)

    def apply(config):
        cfg = {**DEFAULTS, **{k: config[k] for k in DEFAULTS if config.get(k)}}
        blocklist = Blocklist.from_dict(config["blocklist"])
        interval = float(args.interval or cfg["sampleIntervalSec"])
        # A report never comes more often than a sample (e.g. --interval 2 with the 1 s default report)
        report_every = max(interval, float(args.report_every or cfg["reportIntervalSec"]))
        return (blocklist.without_titles() if args.games_only else blocklist,
                interval, report_every, float(cfg["idleThresholdSec"]))

    blocklist, interval, report_every, idle_after = apply(config)
    ui.log(f"Blocklist from {source}: {len(blocklist.processes)} processes, "
           f"Steam games {'on' if blocklist.steam_games else 'off'}, "
           f"{len(blocklist.titles)} browser titles{' (off: --games-only)' if args.games_only else ''}. "
           f"Sampling every {interval:g}s, reporting every {report_every:g}s. Ctrl+C to stop.")

    agg = UsageAggregator(max_gap=interval * 3)
    resync_after = interval * 3  # a longer gap means sleep/hibernate or a stall, not a slow tick
    start = next_tick = time.monotonic()
    next_report, next_config = start + report_every, start + CONFIG_REFRESH_SEC
    last_line = None
    # Offline backoff: while sends fail, usage is still written to the queue every report, but the
    # network is only retried after 1, 2, 4 ... MAX_RETRY_SEC seconds (no stall every second)
    retry = {"at": 0.0, "delay": report_every}

    def report(final=False):
        events = agg.drain()
        idle = (not args.fake) and idle_seconds() >= idle_after
        batch = make_batch(events, None if final else agg.current, idle)
        totals = {k: round(v, 1) for k, v in sorted(agg.totals.items())}
        now_m = time.monotonic()
        if not reporter:
            status = "local only"
        elif not final and now_m < retry["at"]:
            if events:
                reporter.outbox.put(batch)  # on disk now, sent with the next successful flush
            status = (f"offline (retrying in {retry['at'] - now_m:.0f}s); "
                      f"{len(reporter.outbox)} batch(es) queued")
        else:
            status = reporter.submit(batch)
            if status.startswith("offline"):
                retry["delay"] = min(MAX_RETRY_SEC, retry["delay"] * 2) if retry["at"] else report_every
                retry["at"] = time.monotonic() + retry["delay"]
            else:
                retry["at"], retry["delay"] = 0.0, report_every
        ui.log(f"--- batch {json.dumps(events)}  totals {json.dumps(totals)}  "
               f"uptime {time.monotonic() - start:.0f}s  [{status}]"
               + ("  (SYNTHETIC)" if args.fake else ""))
        ui.on_report(events, totals, status, len(reporter.outbox) if reporter else 0)

    def save_on_exit():
        """Console closed / sign-out / shutdown: ~5 s to live, so queue to disk, no network."""
        agg.record(time.monotonic(), None, int(time.time() * 1000))
        events = agg.drain()
        if events and reporter:
            reporter.outbox.put(make_batch(events, None, False))

    winsys.on_console_close(save_on_exit)

    try:
        while True:
            now = time.monotonic()
            if now - next_tick > resync_after:
                # Woke from sleep (monotonic time includes it) or the loop stalled: restart the
                # schedule from now instead of replaying every missed tick and report
                next_tick = now
                next_report = max(next_report, now)
                next_config = max(next_config, now)
            sample = read_window()
            match = blocklist.match(sample)
            idle = not args.fake and idle_seconds() >= idle_after
            if idle and match and match.match_type == "process":
                match = None  # AFK in a game/app isn't charged; a video in a browser tab still is
            agg.record(now, match, int(time.time() * 1000))
            ui.on_sample(sample, match, idle)
            line = describe(sample, match) + ("  (idle)" if idle else "")
            if args.verbose or line != last_line:
                ui.log(f"{datetime.now():%H:%M:%S}  {line}")
                last_line = line
            if now >= next_report:
                report()
                next_report += report_every
                # A slow/timed-out request stalls sampling; credit that time instead of capping it
                agg.record(time.monotonic(), match, int(time.time() * 1000), cap=False)
            if client and now >= next_config:
                config, source = fetch_config(client, pairing, args.blocklist)
                blocklist, _, _, idle_after = apply(config)  # interval changes need a restart
                next_config += CONFIG_REFRESH_SEC
                agg.record(time.monotonic(), match, int(time.time() * 1000), cap=False)
            # Sleep to a fixed schedule so slow polls don't make the loop drift
            next_tick += interval
            pause(max(0.0, next_tick - time.monotonic()))
    except (KeyboardInterrupt, Stopped):
        agg.record(time.monotonic(), None, int(time.time() * 1000))  # credit the final partial interval
        report(final=True)
    except AuthFailed:
        pairing.clear()
        raise


def main(argv=None):
    # Window titles contain emoji and non-Latin text; don't crash on a cp1252 console
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = parse_args(argv)
    try:
        run(args)
    except AuthFailed as e:
        sys.exit(f"Backend rejected the tracker token ({e}). Pair again: python tracker.py --pair CODE "
                 f"(queued usage is kept and sent after pairing).")
    except KeyboardInterrupt:
        sys.exit(1)
    except (OSError, ValueError) as e:
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
