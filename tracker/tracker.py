"""Screen Time Tariff desktop tracker (Checkpoint 1: local output only).

Polls the foreground window, checks it against the blocklist, and prints
usage batches in the shape the backend's POST /usage will receive.
"""

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from blocklist import Blocklist
from foreground import get_foreground
from usage import UsageAggregator

DEFAULT_BLOCKLIST = Path(__file__).with_name("blocklist.json")


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Track time spent on blocked apps and sites.")
    p.add_argument("--blocklist", default=str(DEFAULT_BLOCKLIST), help="path to blocklist JSON")
    p.add_argument("--interval", type=float, default=2.0, help="seconds between foreground checks")
    p.add_argument("--report-every", type=float, default=30.0, help="seconds between usage batches")
    p.add_argument("--verbose", action="store_true", help="print every sample, not only changes")
    p.add_argument("--once", action="store_true", help="print the current foreground window and exit")
    args = p.parse_args(argv)
    if args.interval <= 0 or args.report_every < args.interval:
        p.error("need 0 < --interval <= --report-every")
    return args


def describe(sample, app):
    if sample is None:
        return "(no foreground window)"
    tag = f"BLOCKED [{app}]" if app else "ok"
    return f"{tag:<24} {sample.process} | {sample.title!r}"


def run(args):
    blocklist = Blocklist.load(args.blocklist)
    if args.once:
        sample = get_foreground()
        print(describe(sample, blocklist.match(sample)))
        return

    print(f"Tracking {len(blocklist.processes)} processes, {len(blocklist.titles)} title keywords. "
          f"Ctrl+C to stop.", flush=True)
    agg = UsageAggregator(max_gap=args.interval * 3)
    start = next_tick = next_report = time.monotonic()
    next_report += args.report_every
    last_line = None
    try:
        while True:
            now = time.monotonic()
            sample = get_foreground()
            app = blocklist.match(sample)
            agg.record(now, app)
            line = describe(sample, app)
            if args.verbose or line != last_line:
                print(f"{datetime.now():%H:%M:%S}  {line}", flush=True)
                last_line = line
            if now >= next_report:
                report(agg, now - start)
                next_report += args.report_every
            # Sleep to a fixed schedule so slow polls don't make the loop drift
            next_tick += args.interval
            time.sleep(max(0.0, next_tick - time.monotonic()))
    except KeyboardInterrupt:
        agg.record(time.monotonic(), None)  # credit the final partial interval
        report(agg, time.monotonic() - start)


def report(agg, uptime):
    batch = agg.drain()
    totals = {app: round(s, 1) for app, s in sorted(agg.totals.items())}
    print(f"--- usage batch {json.dumps(batch)}  totals {json.dumps(totals)}  "
          f"uptime {uptime:.0f}s", flush=True)


def main(argv=None):
    # Window titles contain emoji and non-Latin text; don't crash on a cp1252 console
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = parse_args(argv)
    try:
        run(args)
    except (OSError, ValueError) as e:
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
