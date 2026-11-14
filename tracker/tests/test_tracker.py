import pytest

import tracker
from foreground import Sample


def test_args_defaults():
    args = tracker.parse_args([])
    assert args.interval == 2.0 and args.report_every == 30.0


def test_args_reject_bad_interval():
    with pytest.raises(SystemExit):
        tracker.parse_args(["--interval", "0"])


def test_once_prints_match(monkeypatch, capsys):
    monkeypatch.setattr(tracker, "get_foreground", lambda: Sample("chrome.exe", "TikTok - Google Chrome"))
    tracker.run(tracker.parse_args(["--once"]))
    assert "BLOCKED [TikTok]" in capsys.readouterr().out


def test_loop_reports_batches(monkeypatch, capsys):
    clock = {"t": 0.0}
    samples = iter([Sample("chrome.exe", "YouTube - Google Chrome")] * 3 + [Sample("explorer.exe", "")])

    def fake_sleep(s):
        clock["t"] += s

    def fake_fg():
        try:
            return next(samples)
        except StopIteration:
            raise KeyboardInterrupt

    monkeypatch.setattr(tracker.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(tracker.time, "sleep", fake_sleep)
    monkeypatch.setattr(tracker, "get_foreground", fake_fg)
    tracker.run(tracker.parse_args(["--interval", "2", "--report-every", "4"]))
    out = capsys.readouterr().out
    assert '[{"app": "YouTube", "seconds": 4}]' in out  # batch at t=4
    assert '{"YouTube": 6.0}' in out                    # final totals at t=6
