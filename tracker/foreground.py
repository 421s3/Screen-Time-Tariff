"""Read the window the user is looking at right now (Windows only)."""

import ctypes
import time
from dataclasses import dataclass
from typing import Optional

import psutil

try:
    import win32api
    import win32con
    import win32gui
    import win32process
    import win32service
except ImportError:  # non-Windows machines can still import this module and run the tests
    win32api = win32con = win32gui = win32process = win32service = None

# Windows shell surfaces that can sit in front without the user "using" anything
LOCK_PROCESSES = {"lockapp.exe", "logonui.exe"}


class _XInputState(ctypes.Structure):
    _fields_ = [("packet", ctypes.c_uint32), ("buttons", ctypes.c_uint16), ("lt", ctypes.c_uint8),
                ("rt", ctypes.c_uint8), ("lx", ctypes.c_int16), ("ly", ctypes.c_int16),
                ("rx", ctypes.c_int16), ("ry", ctypes.c_int16)]


def _load_xinput():
    for dll in ("xinput1_4", "xinput9_1_0"):
        try:
            return getattr(ctypes, "windll").LoadLibrary(dll).XInputGetState
        except (OSError, AttributeError):
            continue
    return None


_xinput = _load_xinput()
_pad_packets: dict = {}  # controller slot -> last packet number seen
_pad_active_at = None  # time.monotonic() of the last controller change we noticed


def gamepad_idle_seconds() -> float:
    """Seconds since an XInput controller (Xbox and most PC pads) last changed state.

    Polled each sample: a changed packet number means buttons/sticks/triggers moved since
    the last poll. Returns infinity when no controller has been used yet.
    """
    global _pad_active_at
    if _xinput is None:
        return float("inf")
    state = _XInputState()
    for slot in range(4):
        if _xinput(slot, ctypes.byref(state)) != 0:  # not connected
            _pad_packets.pop(slot, None)
            continue
        if slot in _pad_packets and _pad_packets[slot] != state.packet:
            _pad_active_at = time.monotonic()
        _pad_packets[slot] = state.packet
    return float("inf") if _pad_active_at is None else time.monotonic() - _pad_active_at


def idle_seconds() -> float:
    """Seconds since the last keyboard, mouse, or controller input (0 where unsupported).

    GetLastInputInfo only sees keyboard/mouse, so XInput controllers are checked separately.
    """
    if win32api is None:
        return 0.0
    # Both are 32-bit tick counts that wrap every ~49.7 days; the mask keeps the difference right
    keyboard_mouse = ((win32api.GetTickCount() - win32api.GetLastInputInfo()) & 0xFFFFFFFF) / 1000.0
    return min(keyboard_mouse, gamepad_idle_seconds())


def session_locked() -> bool:
    """True on the lock screen / Ctrl+Alt+Del / UAC secure desktop.

    While locked, the input desktop is "Winlogon" and a normal user can't open it, so
    the foreground window reported by GetForegroundWindow (often the last app) is stale.
    """
    if win32service is None:
        return False
    try:
        desk = win32service.OpenInputDesktop(0, False, win32con.DESKTOP_READOBJECTS)
    except Exception:  # pywintypes.error: access denied = secure desktop
        return True
    try:
        return win32service.GetUserObjectInformation(desk, win32con.UOI_NAME).lower() != "default"
    finally:
        desk.CloseDesktop()


@dataclass(frozen=True)
class Sample:
    process: str  # executable name, e.g. "chrome.exe"
    title: str  # window title, e.g. "TikTok - Make Your Day - Google Chrome"
    path: str = ""  # full exe path when readable (used for Steam games); "" if access is denied


def _sample(hwnd) -> Optional[Sample]:
    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        name = proc.name()
    except (psutil.Error, OSError, ValueError):
        return None
    try:
        path = proc.exe()
    except (psutil.Error, OSError):  # elevated/protected game: name still works, path doesn't
        path = ""
    return Sample(process=name, title=win32gui.GetWindowText(hwnd), path=path)


def get_foreground() -> Optional[Sample]:
    """Return the foreground window's process name and title, or None if there isn't one.

    None happens on the lock screen, during UAC prompts, and when the owning
    process exits or is protected (e.g. some anti-cheat processes deny access).
    """
    if win32gui is None:
        raise RuntimeError("pywin32 is not installed; the tracker only runs on Windows")
    if session_locked():
        return None
    hwnd = win32gui.GetForegroundWindow()
    # A minimized window can keep foreground status (e.g. a game minimized with Win+D or
    # Alt+Tab out of exclusive fullscreen) but nobody is playing it
    if not hwnd or win32gui.IsIconic(hwnd):
        return None
    sample = _sample(hwnd)
    if sample is None or sample.process.lower() in LOCK_PROCESSES:
        return None
    return sample


def visible_windows() -> list:
    """Every visible, titled top-level window (for --scan; nothing here needs to be in front)."""
    if win32gui is None:
        raise RuntimeError("pywin32 is not installed; the tracker only runs on Windows")
    hwnds = []
    win32gui.EnumWindows(lambda h, _: hwnds.append(h) if win32gui.IsWindowVisible(h) and
                         win32gui.GetWindowText(h).strip() else None, None)
    samples = {s for s in map(_sample, hwnds) if s is not None}
    return sorted(samples, key=lambda s: (s.process.lower(), s.title))
