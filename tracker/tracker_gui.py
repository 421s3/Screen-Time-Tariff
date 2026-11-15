"""Screen Time Tariff desktop app: a window (and tray icon) around tracker.track().

    python tracker_gui.py                 # or ScreenTimeTariff.exe
    python tracker_gui.py --minimized     # start in the tray (used by "Start at Windows sign-in")

Enter the 6-digit code from the dashboard, click Pair, and tracking starts. The pairing is saved
(DPAPI-encrypted), so the next launch reconnects on its own. Tracking only: nothing is ever
blocked or closed.
"""

import argparse
import logging
import logging.handlers
import os
import queue
import re
import sys
import threading
import webbrowser
from pathlib import Path

import tracker
import winsys
from api import ApiClient, ApiError, is_insecure_remote
from outbox import AuthFailed
from state import HERE, PairingState, resolve_api_url, resolve_dashboard_url, write_env_values

APP_NAME = "Screen Time Tariff"
log = logging.getLogger("tracker-gui")


def friendly_error(e: Exception, api_url: str) -> str:
    """Turn backend/network errors into something a user can act on."""
    code = getattr(e, "code", "")
    if code == "PAIR_CODE_INVALID":
        return "That code is wrong or was already used. Get a new code on the dashboard's Pair tracker page."
    if code == "PAIR_CODE_EXPIRED":
        return "That code has expired (codes last 10 minutes). Get a new one on the dashboard."
    if code == "NETWORK":
        return f"Can't reach the backend at {api_url}. Check your internet connection or the backend URL."
    if code == "VALIDATION_ERROR":
        return "The backend didn't accept that code. Codes are 6 digits."
    message = getattr(e, "message", None) or str(e)
    return f"Pairing failed: {message}"


def describe_app(label, match_type) -> str:
    if not label:
        return "Not on a tracked app"
    return f"{label} ({'game/app' if match_type == 'process' else 'website'})"


def fmt_seconds(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600}h {s % 3600 // 60:02d}m" if s >= 3600 else f"{s // 60}m {s % 60:02d}s"


# ---------------------------------------------------------------- controller (no UI toolkit)

class _EventUI:
    """tracker.track() output → controller events. Called on the tracking thread."""

    _SAMPLE_LINE = re.compile(r"^\d\d:\d\d:\d\d  ")

    def __init__(self, post):
        self.post = post

    def log(self, text: str) -> None:
        # Not in the log file: window titles (sample lines), and the once-a-second empty heartbeat
        if self._SAMPLE_LINE.match(text) or (text.startswith("--- batch []") and "[sent" in text):
            return
        log.info(text)

    def on_sample(self, sample, match, idle: bool) -> None:
        self.post("sample", {"label": match.label if match else None,
                             "matchType": match.match_type if match else None, "idle": idle})

    def on_report(self, events, totals, status, queued) -> None:
        self.post("report", {"totals": totals, "status": status, "queued": queued,
                             "online": not status.startswith("offline")})


class Controller:
    """Pairing, tracking and disconnecting, thread-safe and UI-agnostic.

    Every change is posted to `events` as (kind, payload); the window drains that queue on the
    Tk thread. Network calls and the tracking loop never run on the caller's thread.
    """

    def __init__(self, data_dir=HERE, api_url=None, dashboard_url=None, fake=False,
                 interval=None, report_every=None, read_window=None, events=None):
        self.data_dir = Path(data_dir)
        self.env_file = self.data_dir / ".env"
        self.events = events or queue.Queue()
        self.fake, self.interval, self.report_every = fake, interval, report_every
        self.read_window = read_window
        self._cli_api, self._cli_dash = api_url, dashboard_url
        self._lock = threading.Lock()
        self._thread = None
        self._stop = None
        self.pairing = PairingState(self.data_dir / ".tracker_token.json")
        self._load()

    # -- settings / state
    def _load(self):
        self.api_url = resolve_api_url(self._cli_api, self.env_file)
        self.dashboard_url = resolve_dashboard_url(self._cli_dash, self.env_file)
        self.client = ApiClient(self.api_url, self.pairing.load(self.api_url))

    @property
    def paired(self) -> bool:
        return bool(self.client.token)

    @property
    def tracking(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    @property
    def identity(self) -> dict:
        return {k: self.pairing.data.get(k) for k in ("displayName", "wallet", "groupId")}

    def dashboard_link(self) -> str:
        """The paired group's dashboard page (needs the dashboard to serve deep links, see web/vercel.json)."""
        gid = self.pairing.data.get("groupId") if self.paired else None
        return f"{self.dashboard_url}/group/{gid}" if gid else self.dashboard_url + "/"

    def insecure_backend(self) -> bool:
        return is_insecure_remote(self.api_url)

    def post(self, kind, payload=None):
        self.events.put((kind, payload))

    def set_urls(self, api_url: str, dashboard_url: str) -> None:
        """Save to .env next to the app. A different backend needs a new pairing (tokens are per backend)."""
        api_url, dashboard_url = api_url.strip().rstrip("/"), dashboard_url.strip().rstrip("/")
        for url in (api_url, dashboard_url):
            if not re.match(r"^https?://[^\s/]+", url):
                raise ValueError(f"Not a web address: {url!r}")
        changed_backend = api_url != self.api_url
        if changed_backend:
            self.stop()
        write_env_values(self.env_file, {"API_URL": api_url, "DASHBOARD_URL": dashboard_url})
        self._cli_api = self._cli_dash = None  # the saved values win from now on
        self._load()
        self.post("settings", {"apiUrl": self.api_url, "dashboardUrl": self.dashboard_url})
        if changed_backend:
            self.post("unpaired" if not self.paired else "paired", self.identity)
            if self.paired:
                self.start()

    # -- pairing
    def pair_async(self, code: str) -> bool:
        """Validate locally, then pair on a worker thread. Returns False if the code is malformed."""
        code = re.sub(r"\s", "", code or "")
        if not re.fullmatch(r"\d{6}", code):
            self.post("pair_error", "Enter the 6-digit code shown on the dashboard.")
            return False
        self.post("pairing", None)
        threading.Thread(target=self._pair, args=(code,), daemon=True, name="pair").start()
        return True

    def _pair(self, code):
        self.stop()
        try:
            tracker.pair_with_code(self.client, self.pairing, self.api_url, code)
        except (ApiError, tracker.PairingError) as e:
            self.post("pair_error", friendly_error(e, self.api_url))
            return
        except Exception as e:  # never kill the UI over a bad response
            log.exception("pairing crashed")
            self.post("pair_error", f"Pairing failed: {e}")
            return
        log.info("paired as %s in group %s", self.identity["displayName"], self.identity["groupId"])
        self.post("paired", self.identity)
        self.start()

    # -- tracking
    def _args(self):
        argv = ["--data-dir", str(self.data_dir), "--api-url", self.api_url]
        if self.fake:
            argv.append("--fake")
        if self.interval is not None:
            argv += ["--interval", str(self.interval)]
        if self.report_every is not None:
            argv += ["--report-every", str(self.report_every)]
        return tracker.parse_args(argv)

    def start(self) -> bool:
        with self._lock:
            if not self.paired or self.tracking:
                return False
            args = self._args()
            read_window = self.read_window or (tracker.fake_samples() if self.fake else tracker.get_foreground)
            self._stop = threading.Event()
            self._thread = threading.Thread(target=self._run, args=(args, read_window, self._stop),
                                            daemon=True, name="tracking")
            self._thread.start()
        self.post("started", None)
        return True

    def _run(self, args, read_window, stop):
        try:
            tracker.track(args, read_window, ui=_EventUI(self.post), stop=stop,
                          connection=(self.client, self.pairing))
        except AuthFailed:
            self.client.token = None
            self.post("auth_failed", "This tracker was disconnected by the backend. Enter a new pairing code.")
        except Exception as e:
            log.exception("tracking stopped with an error")
            self.post("engine_error", str(e))
        finally:
            self.post("stopped", None)

    def stop(self, timeout: float = 20) -> None:
        """Stop tracking; the loop sends its final batch first (or queues it if offline)."""
        with self._lock:
            thread, stop = self._thread, self._stop
        if thread and thread.is_alive():
            stop.set()
            thread.join(timeout)

    def disconnect(self) -> None:
        """Stop and forget the token. Queued usage stays in queue/ for if this wallet pairs again."""
        self.stop()
        self.pairing.clear()
        self.client.token = None
        self.post("unpaired", None)


# ---------------------------------------------------------------- look & feel

THEME = {
    "bg_top": "#120e2b", "bg_bottom": "#251a52", "card": "#1d1740", "card_edge": "#3b3175",
    "field": "#151034", "field_edge": "#4c3fa0", "text": "#f5f3ff", "muted": "#a7a0cf",
    "faint": "#6f68a0", "violet": "#8b5cf6", "violet_hi": "#a78bfa", "mint": "#34d399",
    "red": "#fb4f6e", "amber": "#fbbf24", "indigo": "#818cf8",
}
GLOW = {"happy": THEME["violet"], "angry": THEME["red"], "worried": THEME["amber"], "sleepy": THEME["indigo"]}


class View:
    """What the window shows for one tracker state (pure data, easy to test)."""

    def __init__(self, mood, headline, sub, pill_text, pill_color, accent):
        self.mood, self.headline, self.sub = mood, headline, sub
        self.pill_text, self.pill_color, self.accent = pill_text, pill_color, accent

    def __repr__(self):
        return f"View({self.mood}, {self.headline!r})"


def view_for(paired, busy=False, online=None, queued=0, label=None, match_type=None, idle=False, error=None):
    """Map tracker state to Tom's mood and the copy around him."""
    t = THEME
    if not paired:
        if busy:
            return View("happy", "Checking your code…", "Tom is talking to the backend.", "Pairing", t["amber"], t["violet"])
        if error:
            return View("worried", "Hmm, that didn't work", "Check the note under the code box and try again.",
                        "Not paired", t["faint"], t["amber"])
        return View("happy", "Hi, I'm Tariff Tom!",
                    "Pair this PC and I'll keep count of your screen time.", "Not paired", t["faint"], t["violet"])
    if error:
        return View("worried", "Tracking stopped", error, "Stopped", t["red"], t["amber"])
    live = (("Offline", t["amber"]) if online is False else ("Live", t["mint"]) if online else ("Connecting", t["amber"]))
    if label:
        kind = "game" if match_type == "process" else "site"
        return View("angry", f"Tariff Tom sees {label}",
                    f"Tracked {kind}: this time counts toward your allowance.", *live, t["red"])
    if online is False:
        return View("worried", "Offline, saving your usage",
                    f"{queued} report{'s' if queued != 1 else ''} saved. They'll sync when you're back online.",
                    *live, t["amber"])
    if idle:
        return View("sleepy", "Taking a break?", "You've been idle, so games are paused.", *live, t["indigo"])
    if online is None:
        return View("happy", "Connecting…", "Starting to watch this PC for tracked apps.", *live, t["violet"])
    return View("happy", "All clear", "You're off tracked apps. Tom's happy.", *live, t["mint"])


def _font_family(root):
    import tkinter.font as tkfont

    families = set(tkfont.families(root))
    for name in ("Segoe UI Variable Display", "Segoe UI"):
        if name in families:
            return name
    return "TkDefaultFont"


# ---------------------------------------------------------------- tray icon (optional)

def make_icon_image(size=64, mood="happy"):
    from tom_art import tom_face_icon

    return tom_face_icon(mood, size)


class Tray:
    """System-tray icon showing Tom's current mood. Its menu callbacks run on pystray's thread, so
    they only post events."""

    def __init__(self, post):
        import pystray

        self._mood = "happy"
        self._icon = pystray.Icon(
            "screen-time-tariff", make_icon_image(), APP_NAME,
            menu=pystray.Menu(
                pystray.MenuItem("Show Tariff Tom", lambda: post("tray_show"), default=True),
                pystray.MenuItem("Open dashboard", lambda: post("tray_dashboard")),
                pystray.MenuItem("Quit", lambda: post("tray_quit")),
            ),
        )
        self._icon.run_detached()

    def title(self, text: str) -> None:
        self._icon.title = f"{APP_NAME}: {text}"[:127]

    def mood(self, mood: str) -> None:
        if mood != self._mood:
            self._mood = mood
            self._icon.icon = make_icon_image(64, mood)

    def notify(self, text: str) -> None:
        try:
            self._icon.notify(text, APP_NAME)
        except Exception:  # notifications are best-effort
            pass

    def stop(self) -> None:
        self._icon.stop()


def make_tray(post):
    try:
        return Tray(post)
    except Exception as e:  # no pystray/Pillow, or no tray on this desktop: minimize instead
        log.warning("no tray icon: %s", e)
        return None


# ---------------------------------------------------------------- window

class PillButton:
    """Solid, tactile button drawn on the canvas, in the website's style: a coloured face on a
    darker edge. Hover lifts it, press sinks it into the edge (animated over a few frames), and
    the action fires on release, like a real button. Each button has its own icon."""

    EDGE = 6  # px of 3D edge at 100% scaling
    STYLES = {  # face, hover face, edge
        "primary": ("#6d4aff", "#7c5cff", "#4022c9"),
        "ghost": ("#2a2354", "#332a63", "#15102f"),
        "off": ("#3b3466", "#3b3466", "#262049"),
    }

    def __init__(self, app, x, y, w, h, text, command, primary=True, icon=None):
        import tom_art

        self.app, self.command, self.enabled = app, command, True
        self.kind = "primary" if primary else "ghost"
        self.x, self.y, self.w, self.h = x, y, w, h
        self.offset, self.target, self.hot, self._anim = 2.0, 2.0, False, None
        c, s, t = app.canvas, app.s, THEME
        self._tom_art = tom_art
        self.tag = f"btn{id(self)}"
        self.bg = c.create_image(s(x), s(y), anchor="nw", tags=self.tag)
        self._ink = t["text"] if primary else "#e4dcff"
        self.icon_img = ({on: app.photo(tom_art.icon(icon, s(18), self._ink if on else t["faint"])) for on in (True, False)}
                         if icon else None)
        self.icon = c.create_image(0, 0, tags=self.tag) if icon else None
        self.label = c.create_text(0, 0, text=text, fill=self._ink, font=(app.family, 11, "bold"), tags=self.tag)
        self._layout()
        c.tag_bind(self.tag, "<Enter>", lambda _e: self._hover(True))
        c.tag_bind(self.tag, "<Leave>", lambda _e: self._hover(False))
        c.tag_bind(self.tag, "<ButtonPress-1>", lambda _e: self.enabled and self._go(self.EDGE))
        c.tag_bind(self.tag, "<ButtonRelease-1>", lambda _e: self._release())

    # -- drawing
    def _image(self):
        s = self.app.s
        face, hover, edge = self.STYLES[self.kind if self.enabled else "off"]
        return self.app.photo(self._tom_art.button(s(self.w), s(self.h), hover if self.hot and self.enabled else face,
                                                   edge, s(16), s(self.EDGE), s(self.offset)))

    def _layout(self):
        c, s = self.app.canvas, self.app.s
        c.itemconfigure(self.bg, image=self._image())
        cy = self.y + self.offset + self.h / 2
        text_w = 7.2 * len(c.itemcget(self.label, "text"))
        if self.icon:
            left = self.x + (self.w - text_w - 26) / 2
            c.coords(self.icon, s(left + 9), s(cy))
            c.itemconfigure(self.icon, image=self.icon_img[self.enabled])
            c.coords(self.label, s(left + 26 + text_w / 2), s(cy))
        else:
            c.coords(self.label, s(self.x + self.w / 2), s(cy))

    # -- animation: ease the face toward the target offset, one frame every 16 ms
    def _go(self, target):
        self.target = float(target)
        if self._anim is None:
            self._step()

    def _step(self):
        diff = self.target - self.offset
        if abs(diff) < 0.35:
            self.offset, self._anim = self.target, None
        else:
            self.offset += diff * 0.55
            self._anim = self.app.root.after(16, self._step)
        self._layout()

    def _hover(self, on):
        self.hot = on
        self.app.canvas.configure(cursor="hand2" if on and self.enabled else "")
        self._go(0 if on and self.enabled else 2)

    def _release(self):
        if not self.enabled:
            return
        self._go(0 if self.hot else 2)  # spring back
        if self.hot:
            self.command()

    # -- API used by the window
    def set_enabled(self, on: bool):
        self.enabled = on
        self.app.canvas.itemconfigure(self.label, fill=self._ink if on else THEME["faint"])
        self._go(2)
        self._layout()

    def show(self, visible: bool):
        self.app.canvas.itemconfigure(self.tag, state="normal" if visible else "hidden")


class PetPopup:
    """Desktop-pet Tom: slides in at the screen edge while you're on a tracked app or site.

    It never takes focus (WS_EX_NOACTIVATE): if it did, it would become the "app in front" and
    the tracker would stop counting the site you're actually on. Click it to dismiss it for that app.
    """

    W, H = 312, 104
    KEY = "#010203"  # transparent colour for the rounded corners
    MARGIN = 16

    def __init__(self, app):
        import tkinter as tk

        from PIL import Image

        import tom_art

        self.app, s, t = app, app.s, THEME
        self.visible, self.snoozed, self.label = False, None, None
        self._slide = None
        self.top = top = tk.Toplevel(app.root)
        top.withdraw()
        top.overrideredirect(True)
        top.attributes("-topmost", True)
        try:
            top.attributes("-transparentcolor", self.KEY)
        except tk.TclError:  # not on Windows: square corners
            pass
        top.configure(bg=self.KEY)
        self.canvas = c = tk.Canvas(top, width=s(self.W), height=s(self.H), bg=self.KEY,
                                    highlightthickness=0, bd=0, cursor="hand2")
        c.pack()
        # Card composited onto the key colour, so only the corners turn transparent
        card = Image.new("RGBA", (s(self.W), s(self.H)), self.KEY)
        card.alpha_composite(tom_art.rounded_box(s(self.W - 6), s(self.H - 6), "#2a1630", t["red"], s(22)), (s(3), s(3)))
        c.create_image(0, 0, anchor="nw", image=app.photo(card.convert("RGB")))
        self.tom = c.create_image(s(52), s(self.H / 2), image=app.photo(tom_art.tom("angry", s(84))))
        self.title = c.create_text(s(100), s(self.H / 2 - 14), anchor="w", fill=t["text"],
                                   font=(app.family, 12, "bold"), width=s(self.W - 112))
        self.sub = c.create_text(s(100), s(self.H / 2 + 14), anchor="w", fill="#fda4af",
                                 font=(app.family, 9), width=s(self.W - 112))
        c.bind("<Button-1>", lambda _e: self.dismiss())

        self.y = self._workarea()[3] - s(self.H) - s(self.MARGIN)
        self.x = self._off_x()
        top.geometry(f"+{self.x}+{self.y}")
        # Shown once, off-screen; after that it only ever moves. Make it non-activating first, and
        # if Windows still hands it focus on that first show, give focus straight back.
        prev = self._foreground()
        top.update_idletasks()
        self._no_activate()
        top.deiconify()
        top.update_idletasks()
        self._no_activate()
        if prev and self._foreground() == self._hwnd():
            self._set_foreground(prev)

    # -- Windows plumbing
    def _hwnd(self):
        import ctypes

        return ctypes.windll.user32.GetParent(self.top.winfo_id())

    @staticmethod
    def _foreground():
        try:
            import ctypes

            return ctypes.windll.user32.GetForegroundWindow()
        except Exception:
            return None

    @staticmethod
    def _set_foreground(hwnd):
        try:
            import ctypes

            ctypes.windll.user32.SetForegroundWindow(hwnd)
        except Exception:
            pass

    def _no_activate(self):
        try:
            import ctypes

            GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST = -20, 0x08000000, 0x80, 0x8
            u = ctypes.windll.user32
            hwnd = self._hwnd()
            u.SetWindowLongW(hwnd, GWL_EXSTYLE,
                             u.GetWindowLongW(hwnd, GWL_EXSTYLE) | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST)
        except Exception:  # best-effort outside Windows
            pass

    def _workarea(self):
        """Screen area without the taskbar, in physical pixels (the app is DPI-aware)."""
        try:
            import ctypes
            from ctypes import wintypes

            r = wintypes.RECT()
            ctypes.windll.user32.SystemParametersInfoW(0x30, 0, ctypes.byref(r), 0)  # SPI_GETWORKAREA
            return r.left, r.top, r.right, r.bottom
        except Exception:
            return 0, 0, self.top.winfo_screenwidth(), self.top.winfo_screenheight()

    def _off_x(self):
        return self._workarea()[2] + 4

    def _on_x(self):
        return self._workarea()[2] - self.app.s(self.W) - self.app.s(self.MARGIN)

    # -- behaviour
    def update(self, label, match_type):
        """Called on every sample: show for a tracked app/site, hide otherwise."""
        if label and label != self.snoozed:
            if label != self.label:
                kind = "game" if match_type == "process" else "site"
                self.canvas.itemconfigure(self.title, text=f"Tariff Tom sees {label}")
                self.canvas.itemconfigure(self.sub, text=f"Tracked {kind}: this time counts toward your allowance.")
                self.label = label
            if not self.visible:
                self._slide_to(self._on_x())
                self.visible = True
        else:
            if not label:
                self.snoozed = None  # off tracked apps: next visit pops up again
            if self.visible:
                self._slide_to(self._off_x())
                self.visible = False
            self.label = None if not label else self.label

    def dismiss(self):
        self.snoozed = self.label
        self.update(self.label, None)

    def _slide_to(self, target):
        if self._slide:
            self.app.root.after_cancel(self._slide)
        start, steps = self.x, 12

        def step(i=1):
            f = 1 - (1 - i / steps) ** 3  # ease-out
            self.x = int(start + (target - start) * f)
            self.top.geometry(f"+{self.x}+{self.y}")
            self._slide = self.app.root.after(16, step, i + 1) if i < steps else None

        step()

    def bob(self, t):
        import math

        if self.visible:
            self.canvas.coords(self.tom, self.app.s(52 + 1.6 * math.sin(t * 30) * (math.sin(t * 1.7) > 0.7)),
                               self.app.s(self.H / 2 + 2.5 * math.sin(t * 2.6)))


class App:
    """Tariff Tom's window: one canvas, so text and art sit straight on the gradient."""

    POLL_MS = 150
    FRAME_MS = 40
    W, H = 420, 700
    CARD = (20, 352, 400, 612)
    TOM = (210, 166, 176)  # center x, center y, size

    def __init__(self, root, controller: Controller, tray_factory=make_tray, start_hidden=False, pet=True):
        import tkinter as tk

        self.tk, self.root, self.c = tk, root, controller
        self.totals, self.queued, self.online, self.closing = {}, 0, None, False
        self.current = (None, None)
        self.idle, self.busy, self.error = False, False, None
        self._told_tray = False
        self._photos = {}
        self.scale = max(1.0, root.winfo_fpixels("1i") / 96)
        self.family = _font_family(root)
        self.view = None

        root.title(APP_NAME)
        root.resizable(False, False)
        root.configure(bg=THEME["bg_top"])
        self._dark_title_bar()
        self._set_window_icon()
        root.protocol("WM_DELETE_WINDOW", self.on_close)

        # State the tests (and the canvas) read
        self.status_var, self.pair_msg, self.code_var, self.backend_var = (tk.StringVar() for _ in range(4))
        self.who_var, self.now_var, self.session_var, self.sync_var = (tk.StringVar() for _ in range(4))
        self.headline_var, self.sub_var = tk.StringVar(), tk.StringVar()

        s = self.s
        self.canvas = c = tk.Canvas(root, width=s(self.W), height=s(self.H), highlightthickness=0,
                                    bd=0, bg=THEME["bg_top"])
        c.pack()
        self.bg_item = c.create_image(0, 0, anchor="nw")
        self.glow_ring = c.create_image(0, 0)
        self.tom_item = c.create_image(s(self.TOM[0]), s(self.TOM[1]))
        self._build_header()
        self._text(self.headline_var, 210, 286, 20, "bold", THEME["text"])
        self._text(self.sub_var, 210, 318, 10, "", THEME["muted"], width=350)
        self._build_pairing_card()
        self._build_paired_card()
        self._build_footer()

        self.tray = tray_factory(self.c.post) if tray_factory else None
        self.pet = PetPopup(self) if pet else None
        self._show_settings_line()
        self._render_pairing_state()
        self._t0 = __import__("time").monotonic()
        self._fx = {"hop": 0.0, "shake": 0.0}
        if self.c.paired:
            self.c.start()
        if start_hidden and self.tray and self.c.paired:
            root.withdraw()
        root.after(self.POLL_MS, self._drain)
        root.after(self.FRAME_MS, self._animate)
        root.after_idle(self._prewarm)

    def _dark_title_bar(self):
        """Dark, app-coloured title bar on Windows 10/11 (best-effort)."""
        try:
            import ctypes

            self.root.update_idletasks()
            hwnd = ctypes.windll.user32.GetParent(self.root.winfo_id())
            dwm = ctypes.windll.dwmapi
            dwm.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(ctypes.c_int(1)), 4)  # immersive dark mode
            r, g, b = (int(THEME["bg_top"][i:i + 2], 16) for i in (1, 3, 5))
            dwm.DwmSetWindowAttribute(hwnd, 35, ctypes.byref(ctypes.c_int(b << 16 | g << 8 | r)), 4)  # caption colour
        except Exception:
            pass

    # -- drawing helpers
    def s(self, v):
        return int(round(v * self.scale))

    def photo(self, pil_image):
        from PIL import ImageTk

        key = id(pil_image)
        if key not in self._photos:  # Tk forgets images that Python doesn't keep alive
            self._photos[key] = (pil_image, ImageTk.PhotoImage(pil_image))
        return self._photos[key][1]

    def _text(self, var, x, y, size, weight, color, width=None, anchor="center", tags=()):
        item = self.canvas.create_text(self.s(x), self.s(y), text=var.get(), fill=color, anchor=anchor,
                                       font=(self.family, size, weight) if weight else (self.family, size),
                                       width=self.s(width) if width else 0,
                                       justify="center" if anchor == "center" else "left", tags=tags)
        var.trace_add("write", lambda *_: self.canvas.itemconfigure(item, text=var.get()))
        return item

    def _label(self, text, x, y, tags):
        return self.canvas.create_text(self.s(x), self.s(y), text=text, fill=THEME["faint"], anchor="w",
                                       font=(self.family, 8, "bold"), tags=tags)

    def _backdrop(self, mood):
        import tom_art

        s, (x0, y0, x1, y1) = self.s, self.CARD
        return tom_art.backdrop(s(self.W), s(self.H), THEME["bg_top"], THEME["bg_bottom"], GLOW[mood],
                                (s(self.TOM[0]), s(self.TOM[1] + 6), s(118)),
                                (s(x0), s(y0), s(x1), s(y1)), THEME["card"], THEME["card_edge"])

    def _prewarm(self):
        import tom_art

        for mood in tom_art.MOODS:  # render once so mood swaps are instant
            self._backdrop(mood)
            tom_art.tom(mood, self.s(self.TOM[2]))

    # -- layout
    def _build_header(self):
        import tom_art

        c, s, t = self.canvas, self.s, THEME
        c.create_text(s(24), s(30), text="Screen Time Tariff", anchor="w", fill=t["muted"],
                      font=(self.family, 10, "bold"))
        self.pill_bg = c.create_image(s(396), s(30), anchor="e")
        self.pill_halo = c.create_image(0, s(30), state="hidden")  # soft pulse around the Live dot
        self.pill_dot = c.create_image(0, s(30))
        self.pill_text = c.create_text(0, s(30), anchor="w", fill=t["text"], font=(self.family, 9, "bold"))
        self._pill_cache = {}
        self._tom_art = tom_art

    def _set_pill(self, text, color):
        c, s, t = self.canvas, self.s, THEME
        w = 34 + 7 * len(text)
        key = (text, color)
        if key not in self._pill_cache:
            self._pill_cache[key] = (self.photo(self._tom_art.pill(s(w), s(26), t["card"], t["card_edge"])),
                                     self.photo(self._tom_art.dot(color, s(8))))
        bg, dot = self._pill_cache[key]
        c.itemconfigure(self.pill_bg, image=bg)
        c.coords(self.pill_dot, s(396 - w + 15), s(30))
        c.coords(self.pill_halo, s(396 - w + 15), s(30))
        c.itemconfigure(self.pill_halo, image=self.photo(self._tom_art.pill(s(16), s(16), color, "", 70)))
        c.itemconfigure(self.pill_dot, image=dot)
        c.coords(self.pill_text, s(396 - w + 24), s(30))
        c.itemconfigure(self.pill_text, text=text)
        self._pulse = text == "Live"

    def _build_pairing_card(self):
        import tom_art

        c, s, t, tag = self.canvas, self.s, THEME, "pairing"
        x0, y0, x1, _ = self.CARD
        c.create_text(s(x0 + 24), s(y0 + 30), text="Pair this PC", anchor="w", fill=t["text"],
                      font=(self.family, 14, "bold"), tags=tag)
        c.create_text(s(x0 + 24), s(y0 + 56), text="Enter the 6-digit code from your group's Pair tracker page "
                      "on the dashboard.", anchor="w", fill=t["muted"], font=(self.family, 9),
                      width=s(x1 - x0 - 48), tags=tag)
        fw = x1 - x0 - 48
        c.create_image(s(x0 + 24), s(y0 + 84), anchor="nw", tags=tag,
                       image=self.photo(tom_art.rounded_box(s(fw), s(56), t["field"], t["field_edge"], s(16))))
        vcmd = (self.root.register(lambda v: len(v) <= 9 and all(ch.isdigit() or ch == " " for ch in v)), "%P")
        self.code_entry = self.tk.Entry(c, textvariable=self.code_var, justify="center", relief="flat", bd=0,
                                        highlightthickness=0, bg=t["field"], fg=t["text"],
                                        insertbackground=t["violet_hi"], disabledbackground=t["field"],
                                        disabledforeground=t["faint"], font=("Consolas", 24, "bold"),
                                        validate="key", validatecommand=vcmd)
        self.code_entry.bind("<Return>", lambda _e: self.on_pair())
        c.create_window(s(210), s(y0 + 112), window=self.code_entry, width=s(fw - 40), height=s(44), tags=tag)
        self.pair_btn = PillButton(self, x0 + 24, y0 + 150, fw, 48, "Pair tracker", self.on_pair, icon="key")
        c.addtag_withtag(tag, self.pair_btn.tag)
        # The backend URL (backend_var) lives in Settings, not here, to keep the card calm
        self.pair_msg_item = self._text(self.pair_msg, x0 + 24, y0 + 216, 9, "", t["red"], width=fw,
                                        anchor="nw", tags=tag)

    def _build_paired_card(self):
        c, s, t, tag = self.canvas, self.s, THEME, "paired"
        x0, y0, x1, _ = self.CARD
        self._text(self.who_var, x0 + 24, y0 + 26, 9, "", t["muted"], anchor="w", tags=tag)
        self._label("NOW", x0 + 24, y0 + 54, tag)
        self._text(self.now_var, x0 + 24, y0 + 78, 15, "bold", t["text"], width=230, anchor="w", tags=tag)
        self.tag_bg = c.create_image(s(x1 - 24), s(y0 + 78), anchor="e", tags=tag)
        self.tag_text = c.create_text(0, s(y0 + 78), fill=t["text"], font=(self.family, 8, "bold"), tags=tag)
        self._label("THIS SESSION", x0 + 24, y0 + 112, tag)
        self._text(self.session_var, x0 + 24, y0 + 134, 10, "", t["text"], width=x1 - x0 - 48, anchor="w", tags=tag)
        self._label("SYNC", x0 + 24, y0 + 164, tag)
        self._text(self.sync_var, x0 + 24, y0 + 186, 10, "", t["text"], width=x1 - x0 - 48, anchor="w", tags=tag)
        self.dash_btn = PillButton(self, x0 + 24, y0 + 200, 200, 42, "Open dashboard", self.open_dashboard, icon="chart")
        self.disconnect_btn = PillButton(self, x0 + 236, y0 + 200, x1 - x0 - 260, 42, "Disconnect",
                                         self.on_disconnect, primary=False, icon="plug")
        for b in (self.dash_btn, self.disconnect_btn):
            c.addtag_withtag(tag, b.tag)

    def _set_tag(self, text, color):
        import tom_art

        s, (_, y0, x1, _) = self.s, self.CARD
        w = 18 + 6.4 * len(text)
        self.canvas.itemconfigure(self.tag_bg, image=self.photo(tom_art.pill(s(w), s(22), color, "", 60)))
        self.canvas.coords(self.tag_text, s(x1 - 24 - w / 2), s(y0 + 78))
        self.canvas.itemconfigure(self.tag_text, text=text, fill=color)

    def _build_footer(self):
        import tom_art

        c, s, t = self.canvas, self.s, THEME
        y = self.CARD[3] + 34
        self.startup_on = bool(winsys.get_startup())
        self.startup_var = self.tk.BooleanVar(value=self.startup_on)
        self.switch_item = c.create_image(s(24), s(y), anchor="w", tags="switch")
        c.create_text(s(72), s(y), text="Start at Windows sign-in", anchor="w", fill=t["muted"],
                      font=(self.family, 9), tags="switch")
        c.tag_bind("switch", "<Button-1>", lambda _e: self._toggle_startup())
        self._switch_imgs = {on: self.photo(tom_art.switch(bool(on), t["violet"], scale=self.scale)) for on in (0, 1)}
        self._paint_switch()
        link = c.create_text(s(396), s(y), text="Settings", anchor="e", fill=t["violet_hi"],
                             font=(self.family, 9, "bold"), tags="settings")
        c.tag_bind("settings", "<Button-1>", lambda _e: self.on_settings())
        for tg in ("settings", "switch"):
            c.tag_bind(tg, "<Enter>", lambda _e: c.configure(cursor="hand2"))
            c.tag_bind(tg, "<Leave>", lambda _e: c.configure(cursor=""))
        c.create_text(s(210), s(self.H - 22), text="Tracking only. Tom never blocks or closes your apps.",
                      fill=t["faint"], font=(self.family, 8))
        _ = link

    def _paint_switch(self):
        self.canvas.itemconfigure(self.switch_item, image=self._switch_imgs[int(self.startup_var.get())])

    # -- state → screen
    def _set_window_icon(self):
        try:
            from PIL import ImageTk

            self._icon_img = ImageTk.PhotoImage(make_icon_image(64))
            self.root.iconphoto(True, self._icon_img)
        except Exception:
            pass

    def _set_status(self, text, _color=None):
        """Status line (also the tray tooltip)."""
        self.status_var.set(text)
        if self.tray:
            self.tray.title(text)

    def _show_settings_line(self):
        warn = "  (not encrypted: use https)" if self.c.insecure_backend() else ""
        self.backend_var.set(f"Backend: {self.c.api_url}{warn}")

    def render(self):
        """Recompute Tom's mood and copy from the current state, and repaint what changed."""
        label, match_type = self.current
        v = view_for(self.c.paired, self.busy, self.online, self.queued, label, match_type, self.idle, self.error)
        if self.view is None or v.mood != self.view.mood:
            self.canvas.itemconfigure(self.bg_item, image=self.photo(self._backdrop(v.mood)))
            self.canvas.itemconfigure(self.tom_item, image=self.photo(self._tom_art.tom(v.mood, self.s(self.TOM[2]))))
            if self.view is not None:
                self._fx["shake" if v.mood == "angry" else "hop"] = 1.0
            if self.tray:
                self.tray.mood(v.mood)
        self.view = v
        if self.pet:
            self.pet.update(label if self.c.paired and not self.closing else None, match_type)
        self.headline_var.set(v.headline)
        self.sub_var.set(v.sub)
        self._set_pill(v.pill_text, v.pill_color)
        if self.c.paired:
            if label:
                self._set_tag("TRACKED GAME" if match_type == "process" else "TRACKED SITE", THEME["red"])
            elif self.idle:
                self._set_tag("IDLE", THEME["indigo"])
            else:
                self._set_tag("NOT TRACKED", THEME["mint"])

    def _render_pairing_state(self, message=""):
        c = self.canvas
        if self.c.paired:
            c.itemconfigure("pairing", state="hidden")
            c.itemconfigure("paired", state="normal")
            self.disconnect_btn.set_enabled(True)
            who = self.c.identity
            gid = who["groupId"] or "?"
            self.who_var.set(f"Paired as {who['displayName'] or '?'}  ·  group {gid[:6]}…{gid[-4:]}")
            self.now_var.set("Starting…")
            self.session_var.set("Nothing tracked yet")
            self.sync_var.set("Connecting…")
            self._set_status("Connecting…")
        else:
            c.itemconfigure("paired", state="hidden")
            c.itemconfigure("pairing", state="normal")
            self.pair_btn.set_enabled(True)
            self.code_entry.configure(state="normal")
            self.pair_msg.set(message)
            self._set_status("Not paired: enter the code from the dashboard")
            self.code_entry.focus_set()
        self.error = message or None
        self.render()

    # -- animation: Tom bobs, hops on a mood change, shakes when angry; the Live dot pulses
    def _animate(self):
        import math
        import time

        if self.closing:
            return
        t = time.monotonic() - self._t0
        s, (cx, cy, _) = self.s, self.TOM
        dx = dy = 0.0
        dy += 3.5 * math.sin(t * 2.2)
        if self._fx["hop"] > 0:
            dy -= 14 * math.sin(math.pi * (1 - self._fx["hop"]))
            self._fx["hop"] = max(0.0, self._fx["hop"] - 0.08)
        if self._fx["shake"] > 0:
            dx += 7 * math.sin(t * 60) * self._fx["shake"]
            self._fx["shake"] = max(0.0, self._fx["shake"] - 0.06)
        elif self.view and self.view.mood == "angry":
            dx += 1.5 * math.sin(t * 25) * (math.sin(t * 1.3) > 0.85)  # occasional grumble
        self.canvas.coords(self.tom_item, s(cx + dx), s(cy + dy))
        if self.pet:
            self.pet.bob(t)
        pulse = getattr(self, "_pulse", False) and math.sin(t * 3.5) > 0
        self.canvas.itemconfigure(self.pill_halo, state="normal" if pulse else "hidden")
        self.root.after(self.FRAME_MS, self._animate)

    # -- events from the controller / tray (always handled on the Tk thread)
    def _drain(self):
        try:
            while not self.closing:  # after Quit the window is gone; drop anything still queued
                kind, payload = self.c.events.get_nowait()
                self.handle(kind, payload)
        except queue.Empty:
            pass
        if not self.closing:
            self.root.after(self.POLL_MS, self._drain)

    def handle(self, kind, payload):
        if kind == "pairing":
            self.busy = True
            self.pair_btn.set_enabled(False)
            self.code_entry.configure(state="disabled")
            self.pair_msg.set("")
            self._set_status("Pairing…")
            self.error = None
            self.render()
        elif kind == "pair_error":
            self.busy = False
            self._render_pairing_state(payload)
        elif kind == "paired":
            self.busy = False
            self.code_var.set("")
            self.totals, self.online, self.current, self.idle = {}, None, (None, None), False
            self._render_pairing_state()
        elif kind in ("unpaired", "auth_failed"):
            self.busy = False
            self.totals, self.online, self.current, self.idle = {}, None, (None, None), False
            self._render_pairing_state(payload or "")
            if kind == "auth_failed" and self.tray:
                self.tray.notify(payload)
        elif kind == "started":
            self.error = None
            self._set_status("Tracking…")
            self.render()
        elif kind == "sample":
            self.current = (payload["label"], payload["matchType"])
            self.idle = payload["idle"]
            self.now_var.set(payload["label"] or ("Idle" if self.idle else "Nothing tracked"))
            self.render()
        elif kind == "report":
            self.totals, self.queued, self.online = payload["totals"], payload["queued"], payload["online"]
            top = sorted(self.totals.items(), key=lambda kv: -kv[1])[:3]
            self.session_var.set(", ".join(f"{k} {fmt_seconds(v)}" for k, v in top) or "Nothing tracked yet")
            if self.online:
                self.sync_var.set("Live · reporting every second" + (f" · {self.queued} queued" if self.queued else ""))
                self._set_status("Tracking · connected")
            else:
                self.sync_var.set(f"Offline · {self.queued} report(s) saved, syncing when you're back")
                self._set_status("Tracking · offline (usage is saved)")
            self.render()
        elif kind == "engine_error":
            self.error = f"{payload}"
            self._set_status(f"Tracking stopped: {payload}")
            self.render()
        elif kind == "stopped":
            if self.c.paired and not self.closing:
                self.error = self.error or "Tracking stopped. Restart the app to resume."
                self._set_status("Tracking stopped")
                self.render()
        elif kind == "settings":
            self._show_settings_line()
        elif kind == "tray_show":
            self.show()
        elif kind == "tray_dashboard":
            self.open_dashboard()
        elif kind == "tray_quit":
            self.quit()

    # -- user actions
    def on_pair(self):
        self.c.pair_async(self.code_var.get())

    def on_disconnect(self):
        from tkinter import messagebox

        if not messagebox.askyesno(APP_NAME, "Disconnect this PC from the group? Tracking stops until you "
                                             "pair again with a new code.", parent=self.root):
            return
        self.disconnect_btn.set_enabled(False)
        self._set_status("Disconnecting…")
        threading.Thread(target=self.c.disconnect, daemon=True, name="disconnect").start()

    def open_dashboard(self):
        webbrowser.open(self.c.dashboard_link())

    def on_settings(self):
        from tkinter import messagebox, simpledialog

        api = simpledialog.askstring(APP_NAME, "Backend URL (e.g. https://<name>.up.railway.app):",
                                     initialvalue=self.c.api_url, parent=self.root)
        if api is None:
            return
        dash = simpledialog.askstring(APP_NAME, "Dashboard URL (e.g. https://<name>.vercel.app):",
                                      initialvalue=self.c.dashboard_url, parent=self.root)
        if dash is None:
            return
        try:
            self.c.set_urls(api, dash)
        except ValueError as e:
            messagebox.showerror(APP_NAME, str(e), parent=self.root)

    def _toggle_startup(self):
        self.startup_var.set(not self.startup_var.get())
        self.on_startup_toggle()

    def on_startup_toggle(self):
        from tkinter import messagebox

        try:
            winsys.set_startup(startup_command(self.c.data_dir) if self.startup_var.get() else None)
        except Exception as e:
            self.startup_var.set(not self.startup_var.get())
            messagebox.showerror(APP_NAME, f"Couldn't change the sign-in setting: {e}", parent=self.root)
        self._paint_switch()

    def show(self):
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def on_close(self):
        """The X keeps tracking in the tray; Quit (tray menu) really exits."""
        if self.tray and self.c.paired:
            self.root.withdraw()
            if not self._told_tray:
                self.tray.notify("Tom's still tracking. Use the tray icon to open the window or quit.")
                self._told_tray = True
        else:
            self.quit()

    def quit(self):
        if self.closing:
            return
        self.closing = True
        self._set_status("Saving and closing…")
        self.root.update_idletasks()
        self.c.stop()  # final batch (or queued if offline)
        if self.tray:
            self.tray.stop()
        self.root.destroy()


# ---------------------------------------------------------------- entry point

def startup_command(data_dir) -> str:
    target = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, str(Path(__file__).resolve())]
    return " ".join(f'"{a}"' for a in [*target, "--minimized", "--data-dir", str(Path(data_dir).resolve())])


def setup_logging(data_dir: Path):
    data_dir.mkdir(parents=True, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(data_dir / "tracker.log", maxBytes=1_000_000,
                                                   backupCount=1, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)


def main(argv=None):
    p = argparse.ArgumentParser(description=f"{APP_NAME} desktop tracker (window + tray).")
    p.add_argument("--api-url", help="backend URL (default: API_URL env var, .env next to the app, build default)")
    p.add_argument("--dashboard-url", help="dashboard URL (default: DASHBOARD_URL, .env, build default)")
    p.add_argument("--data-dir", default=str(HERE), help="where the token, queue/ and tracker.log live")
    p.add_argument("--minimized", action="store_true", help="start in the tray if already paired")
    p.add_argument("--fake", action="store_true", help="SYNTHETIC usage (demo fallback)")
    args = p.parse_args(argv)

    # A windowed .exe has no console: make stray prints harmless
    for name in ("stdout", "stderr"):
        if getattr(sys, name) is None:
            setattr(sys, name, open(os.devnull, "w", encoding="utf-8"))
    data_dir = Path(args.data_dir)
    setup_logging(data_dir)

    import tkinter as tk
    from tkinter import messagebox

    try:  # crisp at 125-200% display scaling; the window scales its own art and layout
        import ctypes

        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    with winsys.single_instance(tracker.instance_lock_name(data_dir)) as ok:
        if not ok:
            r = tk.Tk()
            r.withdraw()
            messagebox.showinfo(APP_NAME, "Screen Time Tariff is already running (check the tray icon, "
                                          "or close the command-line tracker).")
            r.destroy()
            return 1
        controller = Controller(data_dir, args.api_url, args.dashboard_url, fake=args.fake)
        root = tk.Tk()
        App(root, controller, start_hidden=args.minimized)
        root.mainloop()
        controller.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
