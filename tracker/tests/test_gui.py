"""Desktop app: the Controller (pairing, tracking thread, restart, offline, disconnect) against the
mock backend over real HTTP, plus a smoke test of the Tk window."""

import json
import queue
import time

import pytest

import state
import tracker
import tracker_gui
from foreground import Sample
from mock_backend import MockBackend
from state import resolve_api_url, resolve_dashboard_url, write_env_values
from tracker_gui import Controller

VALORANT = Sample("VALORANT-Win64-Shipping.exe", "VALORANT")


@pytest.fixture
def backend():
    m = MockBackend().start()
    yield m
    m.stop()


@pytest.fixture(autouse=True)
def active_user(monkeypatch):
    monkeypatch.setattr(tracker, "idle_seconds", lambda: 0.0)  # games count only while the user is active


def make(backend, tmp_path, **kw):
    kw.setdefault("read_window", lambda: VALORANT)
    return Controller(tmp_path, api_url=backend.url, dashboard_url="https://dash.example",
                      interval=0.1, report_every=0.3, **kw)


def wait_for(c, kind, timeout=8.0, where=lambda p: True):
    """Drain controller events until one of `kind` (matching `where`) arrives; return its payload."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            k, p = c.events.get(timeout=0.1)
        except queue.Empty:
            continue
        if k == kind and where(p):
            return p
    raise AssertionError(f"no {kind!r} event within {timeout}s")


def usage_seconds(backend):
    return sum(e["seconds"] for b in backend.batches.values() for e in b["events"])


# ---------------------------------------------------------------- pairing

def test_code_must_be_six_digits_no_network(backend, tmp_path):
    c = make(backend, tmp_path)
    assert c.pair_async("12ab") is False
    assert "6-digit" in wait_for(c, "pair_error")
    assert not [r for r in backend.requests if r[1] == "/pair/complete"]


def test_wrong_code_is_explained(backend, tmp_path):
    c = make(backend, tmp_path)
    assert c.pair_async("000000")
    assert "wrong or was already used" in wait_for(c, "pair_error")
    assert not c.paired


def test_unreachable_backend_is_explained(tmp_path):
    c = Controller(tmp_path, api_url="http://127.0.0.1:9", dashboard_url="https://d", read_window=lambda: VALORANT)
    c.pair_async("482913")
    assert "Can't reach the backend at http://127.0.0.1:9" in wait_for(c, "pair_error")


def test_pair_then_track_then_stop(backend, tmp_path):
    c = make(backend, tmp_path)
    assert c.pair_async(" 482 913 ")  # spaces from copy/paste are fine
    who = wait_for(c, "paired")
    assert who["displayName"] == "Alice" and who["groupId"]
    wait_for(c, "started")
    sample = wait_for(c, "sample")
    assert sample == {"label": "Valorant", "matchType": "process", "idle": False}
    rep = wait_for(c, "report", where=lambda p: sum(p["totals"].values()) >= 2)
    assert rep["online"] and rep["queued"] == 0 and "Valorant" in rep["totals"]
    t0 = time.monotonic()
    c.stop()
    assert time.monotonic() - t0 < 3, "stop interrupts the sleep instead of waiting a full interval"
    assert not c.tracking
    wait_for(c, "stopped")
    assert usage_seconds(backend) >= 1
    # Token saved encrypted next to the app; dashboard link points at the paired group
    raw = (tmp_path / ".tracker_token.json").read_text()
    assert "trk_" not in raw or state.win32crypt is None
    assert c.dashboard_link() == f"https://dash.example/group/{who['groupId']}"


def test_restart_reconnects_without_a_code(backend, tmp_path):
    c = make(backend, tmp_path)
    c.pair_async("482913")
    wait_for(c, "started")
    c.stop()
    pairs = len([r for r in backend.requests if r[1] == "/pair/complete"])

    again = make(backend, tmp_path)  # app restarted
    assert again.paired and again.identity["displayName"] == "Alice"
    assert again.start()
    wait_for(again, "report", where=lambda p: sum(p["totals"].values()) >= 2)
    again.stop()
    assert len([r for r in backend.requests if r[1] == "/pair/complete"]) == pairs, "no second pairing"


def test_offline_then_recovers(backend, tmp_path):
    c = make(backend, tmp_path)
    c.pair_async("482913")
    wait_for(c, "started")
    backend.fail_next = 10_000  # backend returns 503 for /usage
    off = wait_for(c, "report", where=lambda p: not p["online"] and p["queued"] > 0)
    assert off["status"].startswith("offline")
    backend.fail_next = 0
    wait_for(c, "report", where=lambda p: p["online"] and p["queued"] == 0)
    c.stop()
    assert usage_seconds(backend) >= 1


def test_disconnect_forgets_token_keeps_queue(backend, tmp_path):
    c = make(backend, tmp_path)
    c.pair_async("482913")
    wait_for(c, "started")
    backend.fail_next = 10_000
    wait_for(c, "report", where=lambda p: p["queued"] > 0)
    c.disconnect()
    assert wait_for(c, "unpaired") is None
    assert not c.paired and not (tmp_path / ".tracker_token.json").exists()
    assert list((tmp_path / "queue").glob("*/*.json")), "unsent usage kept for if this wallet pairs again"
    assert not c.start(), "can't track without pairing"


def test_backend_revoking_the_token_asks_for_a_new_code(backend, tmp_path):
    c = make(backend, tmp_path)
    c.pair_async("482913")
    wait_for(c, "started")
    backend.tokens.clear()
    assert "new pairing code" in wait_for(c, "auth_failed")
    assert not c.paired


def test_changing_backend_url_needs_new_pairing(backend, tmp_path):
    c = make(backend, tmp_path)
    c.pair_async("482913")
    wait_for(c, "started")
    c.set_urls("https://other.example", "https://dash2.example")
    assert not c.paired and not c.tracking
    env = state.read_env_file(tmp_path / ".env")
    assert env == {"API_URL": "https://other.example", "DASHBOARD_URL": "https://dash2.example"}
    with pytest.raises(ValueError):
        c.set_urls("not a url", "https://d")
    c.set_urls(backend.url, "https://dash2.example")  # back to the original backend: token still valid
    assert c.paired


def test_gui_and_cli_share_the_single_instance_lock(tmp_path):
    assert tracker.instance_lock_name(tmp_path) == tracker.instance_lock_name(str(tmp_path) + "\\.")


def test_friendly_errors():
    from api import ApiError

    assert "expired" in tracker_gui.friendly_error(ApiError(410, "PAIR_CODE_EXPIRED", "x"), "u")
    assert tracker_gui.describe_app("TikTok", "title") == "TikTok (website)"
    assert tracker_gui.describe_app(None, None) == "Not on a tracked app"
    assert tracker_gui.fmt_seconds(65) == "1m 05s" and tracker_gui.fmt_seconds(3720) == "1h 02m"


# ---------------------------------------------------------------- URLs (Railway / Vercel without rebuilding)

def test_url_precedence_and_build_defaults(tmp_path, monkeypatch):
    for var in ("API_URL", "DASHBOARD_URL"):
        monkeypatch.delenv(var, raising=False)
    env, defaults = tmp_path / ".env", tmp_path / "build_defaults.json"
    assert resolve_api_url(None, env, defaults) == "http://localhost:4000"
    defaults.write_text(json.dumps({"apiUrl": "https://stt.up.railway.app/", "dashboardUrl": "https://stt.vercel.app"}))
    assert resolve_api_url(None, env, defaults) == "https://stt.up.railway.app"
    assert resolve_dashboard_url(None, env, defaults) == "https://stt.vercel.app"
    write_env_values(env, {"API_URL": "https://override.example"})
    assert resolve_api_url(None, env, defaults) == "https://override.example"  # .env beats the build default
    monkeypatch.setenv("DASHBOARD_URL", "https://env.example")
    assert resolve_dashboard_url(None, env, defaults) == "https://env.example"
    assert resolve_api_url("https://cli.example", env, defaults) == "https://cli.example"


def test_write_env_values_keeps_other_lines(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# my settings\nAPI_URL=http://old\nOTHER=1\n")
    write_env_values(env, {"API_URL": "https://new", "DASHBOARD_URL": "https://d"})
    assert env.read_text().splitlines() == ["# my settings", "API_URL=https://new", "OTHER=1", "DASHBOARD_URL=https://d"]


# ---------------------------------------------------------------- the window

@pytest.fixture
def tk_root():
    tk = pytest.importorskip("tkinter")
    try:
        root = tk.Tk()
    except tk.TclError:
        pytest.skip("no display")
    root.withdraw()
    yield root
    try:
        root.destroy()
    except tk.TclError:
        pass


def pump(app, until, timeout=8.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if not app.closing:
            app.root.update()
        app._drain()
        if until():
            return
        time.sleep(0.05)
    raise AssertionError("window never reached the expected state")


def test_window_pairs_tracks_and_disconnects(backend, tmp_path, tk_root, monkeypatch):
    from tkinter import messagebox

    c = make(backend, tmp_path)
    app = tracker_gui.App(tk_root, c, tray_factory=None)
    assert "Not paired" in app.status_var.get()
    app.code_var.set("000000")
    app.on_pair()
    pump(app, lambda: "wrong" in app.pair_msg.get())
    app.code_var.set("482913")
    app.on_pair()
    pump(app, lambda: "connected" in app.status_var.get())
    assert app.who_var.get().startswith("Paired as Alice")
    assert app.now_var.get() == "Valorant"
    assert app.view.mood == "angry" and app.view.headline == "Tariff Tom sees Valorant"
    pump(app, lambda: "Valorant" in app.session_var.get())
    assert "Backend: http://127.0.0.1" in app.backend_var.get()  # shown in Settings, kept for the record

    monkeypatch.setattr(messagebox, "askyesno", lambda *a, **k: True)
    app.on_disconnect()
    pump(app, lambda: "Not paired" in app.status_var.get())
    assert not c.paired


def test_window_close_without_tray_quits_cleanly(backend, tmp_path, tk_root):
    c = make(backend, tmp_path)
    c.pair_async("482913")
    wait_for(c, "started")
    app = tracker_gui.App(tk_root, c, tray_factory=None)
    app.on_close()  # no tray: closing quits, after the final batch
    assert app.closing and not c.tracking


def test_close_with_tray_keeps_tracking(backend, tmp_path, tk_root):
    class FakeTray:
        def __init__(self, post):
            self.notes, self.moods = [], []

        def title(self, t):
            pass

        def notify(self, t):
            self.notes.append(t)

        def mood(self, m):
            self.moods.append(m)

        def stop(self):
            pass

    c = make(backend, tmp_path)
    c.pair_async("482913")
    wait_for(c, "started")
    app = tracker_gui.App(tk_root, c, tray_factory=FakeTray)
    app.on_close()
    assert c.tracking and not app.closing, "the X hides to the tray; tracking continues"
    assert app.tray.notes and "still tracking" in app.tray.notes[0]
    c.post("tray_quit")
    pump(app, lambda: app.closing)
    assert not c.tracking


def test_tray_icon_image():
    for mood in ("happy", "angry", "worried", "sleepy"):
        img = tracker_gui.make_icon_image(32, mood)
        assert img.size == (32, 32) and img.getbbox()  # Tom's face, not a blank square


# ---------------------------------------------------------------- Tariff Tom's moods

from tracker_gui import view_for  # noqa: E402


@pytest.mark.parametrize("state,mood,headline", [
    ({"paired": False}, "happy", "Hi, I'm Tariff Tom!"),
    ({"paired": False, "busy": True}, "happy", "Checking your code…"),
    ({"paired": False, "error": "bad code"}, "worried", "Hmm, that didn't work"),
    ({"paired": True, "online": True}, "happy", "All clear"),
    ({"paired": True, "online": True, "label": "TikTok", "match_type": "title"}, "angry", "Tariff Tom sees TikTok"),
    ({"paired": True, "online": True, "label": "Valorant", "match_type": "process"}, "angry", "Tariff Tom sees Valorant"),
    ({"paired": True, "online": False, "queued": 3}, "worried", "Offline, saving your usage"),
    ({"paired": True, "online": False, "label": "TikTok", "match_type": "title"}, "angry", "Tariff Tom sees TikTok"),
    ({"paired": True, "online": True, "idle": True}, "sleepy", "Taking a break?"),
    ({"paired": True, "online": None}, "happy", "Connecting…"),
    ({"paired": True, "error": "boom"}, "worried", "Tracking stopped"),
])
def test_tom_mood_for_each_state(state, mood, headline):
    v = view_for(**state)
    assert (v.mood, v.headline) == (mood, headline)


def test_offline_copy_counts_saved_reports_and_pill():
    v = view_for(True, online=False, queued=1)
    assert "1 report saved" in v.sub and v.pill_text == "Offline"
    assert view_for(True, online=True).pill_text == "Live"
    assert "tracked site" in view_for(True, online=True, label="YouTube", match_type="title").sub.lower()


def test_copy_never_claims_to_block():
    import itertools

    for paired, online, label, idle in itertools.product((True, False), (True, False, None), (None, "TikTok"), (True, False)):
        v = view_for(paired, online=online, label=label, match_type="title", idle=idle)
        assert not any(w in (v.headline + v.sub).lower() for w in ("blocked", "closing", "closed", "will block"))


def test_tom_art_moods_render():
    import tom_art

    imgs = {m: tom_art.tom(m, 96) for m in tom_art.MOODS}
    assert all(i.size == (96, 96) for i in imgs.values())
    assert imgs["happy"].tobytes() != imgs["angry"].tobytes()


def test_window_mood_follows_the_foreground_app(backend, tmp_path, tk_root):  # noqa: F811
    c = make(backend, tmp_path)
    c.start = lambda: False
    app = tracker_gui.App(tk_root, c, tray_factory=None)
    c.client.token = "trk_x"
    c.pairing.data = {"displayName": "A", "wallet": "W", "groupId": "G" * 24}
    app.handle("paired", c.identity)
    app.handle("report", {"totals": {}, "status": "sent", "queued": 0, "online": True})
    app.handle("sample", {"label": None, "matchType": None, "idle": False})
    assert app.view.mood == "happy" and app.headline_var.get() == "All clear"
    app.handle("sample", {"label": "TikTok", "matchType": "title", "idle": False})
    assert app.view.mood == "angry" and app._fx["shake"] == 1.0, "Tom shakes when he turns angry"
    app.handle("sample", {"label": None, "matchType": None, "idle": False})
    assert app.view.mood == "happy" and app._fx["hop"] == 1.0, "and hops back to happy"
    app.handle("report", {"totals": {}, "status": "offline", "queued": 4, "online": False})
    assert app.view.mood == "worried" and app.status_var.get().startswith("Tracking · offline")


def test_pet_popup_follows_tracked_apps(backend, tmp_path, tk_root):  # noqa: F811
    c = make(backend, tmp_path)
    c.start = lambda: False
    app = tracker_gui.App(tk_root, c, tray_factory=None)
    pet = app.pet
    app.handle("sample", {"label": "Instagram", "matchType": "title", "idle": False})
    assert not pet.visible, "never pops up before pairing"
    c.client.token = "trk_x"
    c.pairing.data = {"displayName": "A", "wallet": "W", "groupId": "G" * 24}
    app.handle("paired", c.identity)

    app.handle("sample", {"label": "Instagram", "matchType": "title", "idle": False})
    assert pet.visible and pet.canvas.itemcget(pet.title, "text") == "Tariff Tom sees Instagram"
    assert "Tracked site" in pet.canvas.itemcget(pet.sub, "text")
    app.handle("sample", {"label": "Valorant", "matchType": "process", "idle": False})
    assert pet.visible and "Valorant" in pet.canvas.itemcget(pet.title, "text")
    assert "Tracked game" in pet.canvas.itemcget(pet.sub, "text")

    pet.dismiss()  # click: snooze for this app
    assert not pet.visible
    app.handle("sample", {"label": "Valorant", "matchType": "process", "idle": False})
    assert not pet.visible, "stays dismissed while still on the same app"
    app.handle("sample", {"label": None, "matchType": None, "idle": False})
    app.handle("sample", {"label": "Valorant", "matchType": "process", "idle": False})
    assert pet.visible, "comes back on the next visit"

    app.handle("sample", {"label": None, "matchType": None, "idle": False})
    assert not pet.visible
    end = time.monotonic() + 0.6  # the slide takes ~0.2 s
    while time.monotonic() < end:
        tk_root.update()
        time.sleep(0.01)
    assert pet.x > pet._workarea()[2], "slid off the screen"
