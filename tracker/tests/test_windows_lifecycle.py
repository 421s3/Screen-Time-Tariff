"""Checkpoint 3: lock screen, idle, sleep/resume, restarts, single instance, packaging paths."""

import importlib
import json
import sys

import pytest

import foreground
import state
import tracker
import winsys
from foreground import Sample
from tests.test_backend import backend, queued_files  # noqa: F401  (fixture)
from tests.test_tracker import fake_clock

TIKTOK = Sample("chrome.exe", "TikTok - Google Chrome")
VALORANT = Sample("VALORANT-Win64-Shipping.exe", "VALORANT")


def batch_lines(out):
    return [line for line in out.splitlines() if line.startswith("--- batch")]


# ---------------------------------------------------------------- sleep / resume

def test_resume_from_sleep_does_not_replay_missed_reports(monkeypatch, capsys):
    """Regression: after sleep the fixed schedule used to run every missed tick back to back,
    i.e. one report (and heartbeat POST) per missed tick: ~900 for an hour asleep."""
    samples = iter([TIKTOK] * 3 + [TIKTOK] * 3)
    fake_clock(monkeypatch, [])
    clock = {"t": 0.0, "sleeps": 0}

    def fake_sleep(s):
        clock["sleeps"] += 1
        clock["t"] += s + (3600 if clock["sleeps"] == 3 else 0)  # laptop sleeps for an hour here

    def fake_fg():
        try:
            return next(samples)
        except StopIteration:
            raise KeyboardInterrupt

    monkeypatch.setattr(tracker.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(tracker.time, "time", lambda: 1_794_729_000 + clock["t"])
    monkeypatch.setattr(tracker.time, "sleep", fake_sleep)
    monkeypatch.setattr(tracker, "get_foreground", fake_fg)
    tracker.run(tracker.parse_args(["--local", "--interval", "2", "--report-every", "4"]))
    out = capsys.readouterr().out
    assert len(batch_lines(out)) <= 4
    totals = json.loads(batch_lines(out)[-1].split("totals ")[1].split("  uptime")[0])
    assert totals["TikTok"] <= 6 * 2 + 6  # 6 samples of 2 s + at most one capped gap, never the hour


# ---------------------------------------------------------------- idle rule

def test_idle_stops_process_matches_but_not_browser_video(monkeypatch, capsys):
    fake_clock(monkeypatch, [VALORANT] * 3 + [TIKTOK] * 3)
    monkeypatch.setattr(tracker, "idle_seconds", lambda: 500.0)  # no input for > 120 s
    tracker.run(tracker.parse_args(["--local", "--interval", "2", "--report-every", "60"]))
    out = capsys.readouterr().out
    assert '"TikTok": 6.0' in out and "Valorant" not in out.split("--- batch")[-1]
    assert "(idle)" in out


def test_active_user_is_charged_for_games(monkeypatch, capsys):
    fake_clock(monkeypatch, [VALORANT] * 3)
    tracker.run(tracker.parse_args(["--local", "--interval", "2", "--report-every", "60"]))
    assert '"Valorant": 6.0' in capsys.readouterr().out


def test_fake_mode_is_labelled_synthetic(monkeypatch, capsys):
    fake_clock(monkeypatch, [])
    monkeypatch.setattr(tracker, "fake_samples", lambda: (lambda: (_ for _ in ()).throw(KeyboardInterrupt)))
    tracker.run(tracker.parse_args(["--local", "--fake"]))
    out = capsys.readouterr().out
    assert "SYNTHETIC MODE" in out and "(SYNTHETIC)" in out


# ---------------------------------------------------------------- lock screen

def test_locked_session_is_not_in_front(monkeypatch):
    monkeypatch.setattr(foreground, "session_locked", lambda: True)
    assert foreground.get_foreground() is None


def test_lock_app_window_is_not_in_front(monkeypatch):
    monkeypatch.setattr(foreground, "session_locked", lambda: False)
    monkeypatch.setattr(foreground.win32gui, "GetForegroundWindow", lambda: 123)
    monkeypatch.setattr(foreground, "_sample", lambda h: Sample("LockApp.exe", "Windows Default Lock Screen"))
    assert foreground.get_foreground() is None
    monkeypatch.setattr(foreground, "_sample", lambda h: TIKTOK)
    assert foreground.get_foreground() == TIKTOK


def test_session_lock_check_runs_on_this_machine():
    assert foreground.session_locked() is False  # tests run on an unlocked desktop


# ---------------------------------------------------------------- restarts / instances

def test_second_tracker_on_same_data_dir_is_refused(tmp_path):
    with winsys.single_instance("stt-test-lock") as first:
        with winsys.single_instance("stt-test-lock") as second:
            assert first and not second
    with winsys.single_instance("stt-test-lock") as again:
        assert again  # released when the first tracker stops


def test_tracker_exits_if_already_running(monkeypatch, tmp_path):
    from contextlib import contextmanager

    @contextmanager
    def taken(name):
        yield False

    monkeypatch.setattr(winsys, "single_instance", taken)
    with pytest.raises(SystemExit, match="already running"):
        tracker.run(tracker.parse_args(["--local", "--data-dir", str(tmp_path)]))


def test_console_close_saves_pending_usage_to_queue(backend, tmp_path, monkeypatch):  # noqa: F811
    """Closing the console / signing out / shutting down: unsent seconds go to the queue."""
    hooks = []
    monkeypatch.setattr(winsys, "on_console_close", hooks.append)
    backend.fail_next = 0
    samples = iter([TIKTOK] * 3)

    def fg():
        try:
            return next(samples)
        except StopIteration:
            hooks[0]()  # Windows calls the handler, then kills the process
            raise SystemExit

    fake_clock(monkeypatch, [])
    monkeypatch.setattr(tracker, "get_foreground", fg)
    with pytest.raises(SystemExit):
        tracker.run(tracker.parse_args(["--api-url", backend.url, "--pair", "482913", "--data-dir", str(tmp_path),
                                        "--interval", "2", "--report-every", "60"]))
    (path,) = queued_files(tmp_path)
    batch = json.loads(path.read_text())
    assert [(e["app"], e["seconds"]) for e in batch["events"]] == [("TikTok", 6)]


def test_startup_entry_round_trip(monkeypatch):
    store = {}

    class FakeKey:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class FakeWinreg:
        HKEY_CURRENT_USER = KEY_SET_VALUE = KEY_QUERY_VALUE = REG_SZ = 0

        @staticmethod
        def OpenKey(*a):
            return FakeKey()

        @staticmethod
        def QueryValueEx(k, name):
            if name not in store:
                raise FileNotFoundError
            return store[name], 1

        @staticmethod
        def SetValueEx(k, name, _, __, value):
            store[name] = value

        @staticmethod
        def DeleteValue(k, name):
            del store[name]

    monkeypatch.setattr(winsys, "winreg", FakeWinreg)
    assert winsys.set_startup('"x.exe"') is False and store == {"ScreenTimeTariffTracker": '"x.exe"'}
    assert winsys.set_startup(None) is True and store == {}
    assert winsys.set_startup(None) is False


def test_startup_command_points_at_exe_or_script(monkeypatch, tmp_path):
    args = tracker.parse_args(["--data-dir", str(tmp_path)])
    cmd = tracker.startup_command(args)
    assert "tracker.py" in cmd and f'"--data-dir" "{tmp_path.resolve()}"' in cmd
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", r"C:\Apps\STT\ScreenTimeTariffTracker.exe")
    assert tracker.startup_command(args).startswith(r'"C:\Apps\STT\ScreenTimeTariffTracker.exe" "--data-dir"')


# ---------------------------------------------------------------- packaged .exe paths

def test_frozen_exe_keeps_data_next_to_exe_and_reads_bundled_blocklist(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(tmp_path / "app" / "ScreenTimeTariffTracker.exe"))
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path / "bundle"), raising=False)
    try:
        importlib.reload(state)
        assert state.HERE == (tmp_path / "app").resolve()  # token, queue, .env: persistent, writable
        assert state.RESOURCES == tmp_path / "bundle"  # blocklist.json: read-only temp extraction
        assert state.STATE_FILE.parent == state.HERE
    finally:
        monkeypatch.undo()
        importlib.reload(state)
    assert state.HERE == state.RESOURCES
