"""Local settings and pairing state: backend URL, tracker token, last config from the backend."""

import base64
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Optional

try:
    import win32crypt
except ImportError:  # non-Windows: token is stored unencrypted (still never printed or committed)
    win32crypt = None

if getattr(sys, "frozen", False):  # PyInstaller .exe
    HERE = Path(sys.executable).resolve().parent  # .env, token and queue/ live next to the .exe
    RESOURCES = Path(getattr(sys, "_MEIPASS", HERE))  # bundled read-only files (blocklist.json)
else:
    HERE = RESOURCES = Path(__file__).resolve().parent
DEFAULT_API_URL = "http://localhost:4000"
STATE_FILE = HERE / ".tracker_token.json"  # gitignored
_DPAPI_DESC = "screen-time-tariff tracker token"


def read_env_file(path: Path) -> dict:
    """Minimal .env reader: KEY=VALUE lines, # comments, optional quotes."""
    env = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip("'\"")
    return env


DEFAULT_DASHBOARD_URL = "http://localhost:5173"
BUILD_DEFAULTS = RESOURCES / "build_defaults.json"  # written by build_exe.py --api-url/--dashboard-url


def _build_default(key: str, defaults_file: Path) -> Optional[str]:
    """URLs baked into the .exe at build time (not secrets), so a downloaded .exe works without a .env."""
    try:
        return json.loads(defaults_file.read_text(encoding="utf-8")).get(key) or None
    except (OSError, ValueError):
        return None


def resolve_api_url(cli_value: Optional[str] = None, env_file: Path = HERE / ".env",
                    defaults_file: Path = BUILD_DEFAULTS) -> str:
    """--api-url beats the API_URL environment variable, then .env next to the tracker/.exe,
    then the URL baked in at build time, then http://localhost:4000."""
    return (cli_value or os.environ.get("API_URL") or read_env_file(env_file).get("API_URL")
            or _build_default("apiUrl", defaults_file) or DEFAULT_API_URL).rstrip("/")


def resolve_dashboard_url(cli_value: Optional[str] = None, env_file: Path = HERE / ".env",
                          defaults_file: Path = BUILD_DEFAULTS) -> str:
    """Same order as the backend URL, with DASHBOARD_URL."""
    return (cli_value or os.environ.get("DASHBOARD_URL") or read_env_file(env_file).get("DASHBOARD_URL")
            or _build_default("dashboardUrl", defaults_file) or DEFAULT_DASHBOARD_URL).rstrip("/")


def write_env_values(path: Path, values: dict) -> None:
    """Set KEY=VALUE lines in a .env file, keeping every other line (used by the GUI's settings)."""
    lines = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
    todo = dict(values)
    out = []
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else None
        if key in todo:
            out.append(f"{key}={todo.pop(key)}")
        else:
            out.append(line)
    out += [f"{k}={v}" for k, v in todo.items()]
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text("\n".join(out) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def protect(token: str) -> dict:
    if win32crypt is None:
        return {"scheme": "plain", "value": token}
    blob = win32crypt.CryptProtectData(token.encode("utf-8"), _DPAPI_DESC, None, None, None, 0)
    return {"scheme": "dpapi", "value": base64.b64encode(blob).decode("ascii")}


def unprotect(stored: dict) -> str:
    if stored.get("scheme") == "plain":
        return stored["value"]
    if stored.get("scheme") == "dpapi" and win32crypt is not None:
        _, data = win32crypt.CryptUnprotectData(base64.b64decode(stored["value"]), None, None, None, 0)
        return data.decode("utf-8")
    raise ValueError("stored token can't be decrypted on this machine/user; pair again")


class PairingState:
    """What pairing returned, plus the last /tracker/config, persisted in one JSON file.

    The token is encrypted with Windows DPAPI (only this Windows user can decrypt it) and
    is bound to the backend URL it came from: switching backends requires pairing again.
    """

    def __init__(self, path: Path = STATE_FILE):
        self.path = Path(path)
        self.data: dict = {}

    def load(self, api_url: str) -> Optional[str]:
        """Return the token if we're paired with this backend, else None."""
        try:
            self.data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.data = {}
            return None
        if self.data.get("apiUrl") != api_url or "token" not in self.data:
            return None
        try:
            return unprotect(self.data["token"])
        except Exception:  # corrupt entry, or pywintypes.error: blob from another user/machine
            return None

    def save_pairing(self, api_url: str, pair_response: dict) -> None:
        self.data = {
            "apiUrl": api_url,
            "token": protect(pair_response["trackerToken"]),
            "wallet": pair_response.get("wallet"),
            "groupId": pair_response.get("groupId"),
            "displayName": pair_response.get("displayName"),
        }
        self._write()

    def save_config(self, config: dict) -> None:
        self.data["config"] = config
        self._write()

    @property
    def identity(self) -> str:
        """Stable id for who usage is reported as (backend + wallet + group), used to keep each
        pairing's offline queue separate. Re-pairing the same wallet keeps the same id."""
        key = "|".join(str(self.data.get(k)) for k in ("apiUrl", "wallet", "groupId"))
        return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]

    @property
    def config(self) -> Optional[dict]:
        return self.data.get("config")

    def clear(self) -> None:
        self.data = {}
        self.path.unlink(missing_ok=True)

    def _write(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)  # a new --data-dir
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)  # atomic: a crash never leaves a half-written token file
