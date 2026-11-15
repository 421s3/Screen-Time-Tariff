"""Windows process plumbing: one tracker per data dir, sign-in start, saving on console close."""

import sys
from contextlib import contextmanager

try:
    import win32api
    import win32con
    import win32event
    import winerror
    import winreg
except ImportError:  # non-Windows: these become no-ops
    win32api = win32con = win32event = winerror = winreg = None

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE = "ScreenTimeTariffTracker"
_keep = []  # handles/callbacks that must live as long as the process


@contextmanager
def single_instance(name: str):
    """Hold a named mutex while the block runs. Yields False if another holder exists.

    Windows frees the mutex if the process dies, so a crash never leaves it stuck.
    """
    if win32event is None:
        yield True
        return
    handle = win32event.CreateMutex(None, False, f"Local\\{name}")
    try:
        yield win32api.GetLastError() != winerror.ERROR_ALREADY_EXISTS
    finally:
        handle.Close()


def get_startup():
    """The current user's sign-in command for this tracker, or None."""
    if winreg is None:
        return None
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_QUERY_VALUE) as k:
            return winreg.QueryValueEx(k, RUN_VALUE)[0]
    except OSError:
        return None


def set_startup(command):
    """Add (command) or remove (None) the current user's sign-in entry. Returns whether one existed."""
    if winreg is None:
        raise RuntimeError("sign-in start is Windows only")
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE | winreg.KEY_QUERY_VALUE) as k:
        try:
            winreg.QueryValueEx(k, RUN_VALUE)
            existed = True
        except FileNotFoundError:
            existed = False
        if command is None:
            if existed:
                winreg.DeleteValue(k, RUN_VALUE)
        else:
            winreg.SetValueEx(k, RUN_VALUE, 0, winreg.REG_SZ, command)
    return existed


def on_console_close(callback) -> None:
    """Run callback when the console window is closed, the user signs out, or Windows shuts down.

    Ctrl+C is left to Python (KeyboardInterrupt). Windows kills the process ~5 s after these events.
    """
    if win32api is None:
        return
    events = {win32con.CTRL_CLOSE_EVENT, win32con.CTRL_LOGOFF_EVENT, win32con.CTRL_SHUTDOWN_EVENT}

    def handler(event):
        if event in events:
            try:
                callback()
            except Exception as e:  # never block shutdown
                print(f"could not save usage on exit: {e}", file=sys.stderr)
            return True
        return False

    _keep.append(handler)
    win32api.SetConsoleCtrlHandler(handler, True)
