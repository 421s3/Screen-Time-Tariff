import pytest

import tracker
from foreground import Sample


def test_args_defaults():
    args = tracker.parse_args([])
    assert args.interval is None and args.report_every is None and not args.local


def test_args_reject_bad_interval():
    with pytest.raises(SystemExit):
        tracker.parse_args(["--interval", "0"])
    with pytest.raises(SystemExit):
        tracker.parse_args(["--report-every", "-1"])
    with pytest.raises(SystemExit):
        tracker.parse_args(["--interval", "5", "--report-every", "2"])  # both given: report can't be faster
    tracker.parse_args(["--interval", "40"])  # alone: the report interval follows it (see apply())


def test_once_prints_match(monkeypatch, capsys):
    monkeypatch.setattr(tracker, "get_foreground", lambda: Sample("chrome.exe", "TikTok - Google Chrome"))
    tracker.run(tracker.parse_args(["--once"]))
    assert "TRACKED [TikTok/title]" in capsys.readouterr().out


def fake_clock(monkeypatch, samples):
    """Drive the loop with a fake clock; Ctrl+C after the samples run out."""
    clock = {"t": 0.0}
    it = iter(samples)

    def fake_fg():
        try:
            return next(it)
        except StopIteration:
            raise KeyboardInterrupt

    monkeypatch.setattr(tracker.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(tracker.time, "time", lambda: 1_794_729_000 + clock["t"])
    monkeypatch.setattr(tracker.time, "sleep", lambda s: clock.__setitem__("t", clock["t"] + s))
    monkeypatch.setattr(tracker, "get_foreground", fake_fg)
    monkeypatch.setattr(tracker, "idle_seconds", lambda: 0.0)


def test_local_loop_reports_batches(monkeypatch, capsys):
    fake_clock(monkeypatch, [Sample("chrome.exe", "YouTube - Google Chrome")] * 3 + [Sample("explorer.exe", "")])
    tracker.run(tracker.parse_args(["--local", "--interval", "2", "--report-every", "4"]))
    out = capsys.readouterr().out
    assert '"app": "YouTube", "matchType": "title", "startedAt": 1794729000000, "seconds": 4' in out
    assert '{"YouTube": 6.0}' in out  # final totals at t=6
    assert "local only" in out
