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


# ---------------------------------------------------------------- tray icon (optional)

def make_icon_image(size=64):
    from PIL import Image, ImageDraw

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((2, 2, size - 2, size - 2), fill=(124, 58, 237, 255))  # violet coin
    w = size // 8
    d.rectangle((size * 0.25, size * 0.25, size * 0.75, size * 0.25 + w), fill="white")  # "T"
    d.rectangle((size / 2 - w / 2, size * 0.25, size / 2 + w / 2, size * 0.78), fill="white")
    return img


class Tray:
    """System-tray icon. Its menu callbacks run on pystray's thread, so they only post events."""

    def __init__(self, post):
        import pystray

        self._icon = pystray.Icon(
            "screen-time-tariff", make_icon_image(), APP_NAME,
            menu=pystray.Menu(
                pystray.MenuItem("Show window", lambda: post("tray_show"), default=True),
                pystray.MenuItem("Open dashboard", lambda: post("tray_dashboard")),
                pystray.MenuItem("Quit", lambda: post("tray_quit")),
            ),
        )
        self._icon.run_detached()

    def title(self, text: str) -> None:
        self._icon.title = f"{APP_NAME}: {text}"[:127]

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

class App:
    POLL_MS = 150
    COLORS = {"ok": "#16a34a", "warn": "#d97706", "bad": "#dc2626", "idle": "#6b7280"}

    def __init__(self, root, controller: Controller, tray_factory=make_tray, start_hidden=False):
        import tkinter as tk
        from tkinter import ttk

        self.tk, self.ttk = tk, ttk
        self.root, self.c = root, controller
        self.totals, self.queued, self.online, self.closing = {}, 0, None, False
        self._told_tray = False
        root.title(APP_NAME)
        root.minsize(440, 0)
        root.resizable(False, False)
        self._set_window_icon()
        root.protocol("WM_DELETE_WINDOW", self.on_close)

        pad = {"padx": 14, "pady": 6}
        outer = ttk.Frame(root, padding=10)
        outer.pack(fill="both", expand=True)
        ttk.Label(outer, text=APP_NAME, font=("Segoe UI", 14, "bold")).pack(anchor="w", **pad)

        status = ttk.Frame(outer)
        status.pack(fill="x", **pad)
        self.dot = tk.Canvas(status, width=12, height=12, highlightthickness=0)
        self.dot_id = self.dot.create_oval(1, 1, 11, 11, fill=self.COLORS["idle"], outline="")
        self.dot.pack(side="left", padx=(0, 8))
        self.status_var = tk.StringVar(value="Starting…")
        ttk.Label(status, textvariable=self.status_var, font=("Segoe UI", 10, "bold")).pack(side="left")

        # -- not paired
        self.pair_frame = ttk.Frame(outer)
        ttk.Label(self.pair_frame, text="Pairing code from the dashboard (Pair tracker page)").pack(anchor="w")
        row = ttk.Frame(self.pair_frame)
        row.pack(fill="x", pady=4)
        self.code_var = tk.StringVar()
        self.code_entry = ttk.Entry(row, textvariable=self.code_var, width=12, font=("Consolas", 16), justify="center")
        self.code_entry.pack(side="left")
        self.code_entry.bind("<Return>", lambda _e: self.on_pair())
        self.pair_btn = ttk.Button(row, text="Pair tracker", command=self.on_pair)
        self.pair_btn.pack(side="left", padx=8)
        self.pair_msg = tk.StringVar()
        ttk.Label(self.pair_frame, textvariable=self.pair_msg, foreground=self.COLORS["bad"], wraplength=400).pack(anchor="w")

        # -- paired
        self.paired_frame = ttk.Frame(outer)
        self.who_var, self.now_var, self.session_var, self.sync_var = (tk.StringVar() for _ in range(4))
        for var in (self.who_var, self.now_var, self.session_var, self.sync_var):
            ttk.Label(self.paired_frame, textvariable=var, wraplength=400).pack(anchor="w", pady=1)
        btns = ttk.Frame(self.paired_frame)
        btns.pack(fill="x", pady=(8, 0))
        ttk.Button(btns, text="Open dashboard", command=self.open_dashboard).pack(side="left")
        self.disconnect_btn = ttk.Button(btns, text="Disconnect", command=self.on_disconnect)
        self.disconnect_btn.pack(side="left", padx=8)

        # -- footer
        footer = ttk.Frame(outer)
        footer.pack(side="bottom", fill="x", **pad)
        ttk.Separator(footer).pack(fill="x", pady=(0, 6))
        urlrow = ttk.Frame(footer)
        urlrow.pack(fill="x")
        self.backend_var = tk.StringVar()
        ttk.Label(urlrow, textvariable=self.backend_var, foreground="#555").pack(side="left")
        ttk.Button(urlrow, text="Settings…", command=self.on_settings).pack(side="right")
        ttk.Button(urlrow, text="Dashboard", command=self.open_dashboard).pack(side="right", padx=4)
        self.startup_var = tk.BooleanVar(value=bool(winsys.get_startup()))
        ttk.Checkbutton(footer, text="Start at Windows sign-in", variable=self.startup_var,
                        command=self.on_startup_toggle).pack(anchor="w", pady=(4, 0))
        ttk.Label(footer, text="Tracking only: apps and sites are never blocked or closed.",
                  foreground="#555").pack(anchor="w")

        self.tray = tray_factory(self.c.post) if tray_factory else None
        self._show_settings_line()
        self._render_pairing_state()
        if self.c.paired:
            self.c.start()
        if start_hidden and self.tray and self.c.paired:
            root.withdraw()
        root.after(self.POLL_MS, self._drain)

    # -- helpers
    def _set_window_icon(self):
        try:
            from PIL import ImageTk

            self._icon_img = ImageTk.PhotoImage(make_icon_image(32))
            self.root.iconphoto(True, self._icon_img)
        except Exception:
            pass

    def _set_status(self, text, color):
        self.status_var.set(text)
        self.dot.itemconfigure(self.dot_id, fill=self.COLORS[color])
        if self.tray:
            self.tray.title(text)

    def _show_settings_line(self):
        warn = "  (not encrypted: use https)" if self.c.insecure_backend() else ""
        self.backend_var.set(f"Backend: {self.c.api_url}{warn}")

    def _render_pairing_state(self, message=""):
        if self.c.paired:
            self.pair_frame.pack_forget()
            self.paired_frame.pack(fill="x", padx=14, pady=6)
            who = self.c.identity
            self.who_var.set(f"Paired as {who['displayName'] or '?'} · group {who['groupId'] or '?'}")
            self.now_var.set("Now: starting…")
            self.session_var.set("This session: nothing tracked yet")
            self.sync_var.set("")
            self._set_status("Connecting…", "warn")
        else:
            self.paired_frame.pack_forget()
            self.pair_frame.pack(fill="x", padx=14, pady=6)
            self.pair_btn.state(["!disabled"])
            self.code_entry.state(["!disabled"])
            self.pair_msg.set(message)
            self._set_status("Not paired: enter the code from the dashboard", "idle")
            self.code_entry.focus_set()

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
            self.pair_btn.state(["disabled"])
            self.code_entry.state(["disabled"])
            self.pair_msg.set("")
            self._set_status("Pairing…", "warn")
        elif kind == "pair_error":
            self._render_pairing_state(payload)
        elif kind == "paired":
            self.code_var.set("")
            self.totals = {}
            self._render_pairing_state()
        elif kind in ("unpaired", "auth_failed"):
            self.totals = {}
            self._render_pairing_state(payload or "")
            if kind == "auth_failed" and self.tray:
                self.tray.notify(payload)
        elif kind == "started":
            self._set_status("Tracking…", "ok")
        elif kind == "sample":
            idle = "  (idle: games paused)" if payload["idle"] else ""
            self.now_var.set(f"Now: {describe_app(payload['label'], payload['matchType'])}{idle}")
        elif kind == "report":
            self.totals, self.queued, self.online = payload["totals"], payload["queued"], payload["online"]
            top = sorted(self.totals.items(), key=lambda kv: -kv[1])[:3]
            self.session_var.set("This session: " + (", ".join(f"{k} {fmt_seconds(v)}" for k, v in top)
                                                     or "nothing tracked yet"))
            if self.online:
                self.sync_var.set("Last report sent" + (f" · {self.queued} queued" if self.queued else ""))
                self._set_status("Tracking · connected", "ok")
            else:
                self.sync_var.set(f"Offline: {self.queued} report(s) saved, sent automatically when back online")
                self._set_status("Tracking · offline (usage is saved)", "warn")
        elif kind == "engine_error":
            self._set_status(f"Tracking stopped: {payload}", "bad")
        elif kind == "stopped":
            if self.c.paired and not self.closing:
                self._set_status("Tracking stopped", "bad")
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
        self.disconnect_btn.state(["disabled"])
        self._set_status("Disconnecting…", "warn")
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

    def on_startup_toggle(self):
        from tkinter import messagebox

        try:
            winsys.set_startup(startup_command(self.c.data_dir) if self.startup_var.get() else None)
        except Exception as e:
            self.startup_var.set(not self.startup_var.get())
            messagebox.showerror(APP_NAME, f"Couldn't change the sign-in setting: {e}", parent=self.root)

    def show(self):
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def on_close(self):
        """The X keeps tracking in the tray; Quit (tray menu) really exits."""
        if self.tray and self.c.paired:
            self.root.withdraw()
            if not self._told_tray:
                self.tray.notify("Still tracking. Use the tray icon to open the window or quit.")
                self._told_tray = True
        else:
            self.quit()

    def quit(self):
        if self.closing:
            return
        self.closing = True
        self._set_status("Saving and closing…", "warn")
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
