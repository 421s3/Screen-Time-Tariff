"""Read the window the user is looking at right now (Windows only)."""

from dataclasses import dataclass
from typing import Optional

import psutil

try:
    import win32api
    import win32gui
    import win32process
except ImportError:  # non-Windows machines can still import this module and run the tests
    win32api = win32gui = win32process = None


def idle_seconds() -> float:
    """Seconds since the last keyboard/mouse input (0 where unsupported)."""
    if win32api is None:
        return 0.0
    # Both are 32-bit tick counts that wrap every ~49.7 days; the mask keeps the difference right
    return ((win32api.GetTickCount() - win32api.GetLastInputInfo()) & 0xFFFFFFFF) / 1000.0


@dataclass(frozen=True)
class Sample:
    process: str  # executable name, e.g. "chrome.exe"
    title: str  # window title, e.g. "TikTok - Make Your Day - Google Chrome"


def get_foreground() -> Optional[Sample]:
    """Return the foreground window's process name and title, or None if there isn't one.

    None happens on the lock screen, during UAC prompts, and when the owning
    process exits or is protected (e.g. some anti-cheat processes deny access).
    """
    if win32gui is None:
        raise RuntimeError("pywin32 is not installed; the tracker only runs on Windows")
    hwnd = win32gui.GetForegroundWindow()
    if not hwnd:
        return None
    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        name = psutil.Process(pid).name()
    except (psutil.Error, OSError, ValueError):
        return None
    return Sample(process=name, title=win32gui.GetWindowText(hwnd))
