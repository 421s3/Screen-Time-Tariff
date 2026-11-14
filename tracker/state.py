"""Local settings and pairing state: backend URL, tracker token, last config from the backend."""

import base64
import hashlib
import json
import os
from pathlib import Path
from typing import Optional

try:
    import win32crypt
except ImportError:  # non-Windows: token is stored unencrypted (still never printed or committed)
    win32crypt = None

HERE = Path(__file__).resolve().parent
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


def resolve_api_url(cli_value: Optional[str] = None, env_file: Path = HERE / ".env") -> str:
    """--api-url beats the API_URL environment variable, which beats tracker/.env."""
    return (cli_value or os.environ.get("API_URL") or read_env_file(env_file).get("API_URL")
            or DEFAULT_API_URL).rstrip("/")


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
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)  # atomic: a crash never leaves a half-written token file
