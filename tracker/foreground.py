"""Read the window the user is looking at right now (Windows only)."""

from dataclasses import dataclass
from typing import Optional

import psutil

try:
    import win32gui
    import win32process
except ImportError:  # non-Windows machines can still import this module and run the tests
    win32gui = win32process = None


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
