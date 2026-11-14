r"""Blocklist loading and matching.

Format (docs/contract.md section 5; the backend sends it in GET /tracker/config):
    {
      "processes": [{"match": "VALORANT-Win64-Shipping.exe", "label": "Valorant"}, ...],
      "titles":    [{"match": "TikTok", "label": "TikTok"}, ...],
      "browsers":  ["chrome.exe", ...],         # optional (contract v0.2)
      "steamGames": true                         # tracker extension, optional, default false
    }
`steamGames`: any foreground exe installed under a Steam library's `steamapps\common\<Game>\`
counts as a game, labelled `<Game>`. The Steam client itself (steam.exe, steamwebhelper.exe)
lives outside that folder, so it never matches unless listed in `processes`.
Plain strings are also accepted as entries ("TikTok" == {"match": "TikTok", "label": "TikTok"}).
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import NamedTuple, Optional

from foreground import Sample

STEAM_COMMON = "\\steamapps\\common\\"
STEAM_NOT_GAMES = {"steamworks shared", "steamvr", "steam controller configs"}  # redistributables/tools

DEFAULT_BROWSERS = (
    "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe",
    "opera.exe", "opera_gx.exe", "vivaldi.exe", "arc.exe",
)


class Match(NamedTuple):
    label: str  # reported as "app"
    match_type: str  # "process" or "title"


def _entry(value, key):
    if isinstance(value, str):
        value = {"match": value}
    if not isinstance(value, dict):
        raise ValueError(f"blocklist '{key}' entries must be strings or {{match, label}} objects")
    match, label = value.get("match"), value.get("label", value.get("match"))
    if not all(isinstance(v, str) and v.strip() for v in (match, label)):
        raise ValueError(f"blocklist '{key}' entries need a non-empty 'match' (and 'label' if given)")
    return {"match": match.strip(), "label": label.strip()}


@dataclass
class Blocklist:
    processes: list = field(default_factory=list)  # [{"match", "label"}]
    titles: list = field(default_factory=list)
    browsers: list = field(default_factory=lambda: list(DEFAULT_BROWSERS))
    steam_games: bool = False

    def __post_init__(self):
        self._procs = {}
        for e in self.processes:
            self._procs.setdefault(e["match"].lower(), e["label"])  # first match in list order wins
        self._browsers = {b.lower() for b in self.browsers}
        # Whole-word match so "Reddit" doesn't hit "Redditch" and "YouTube" hits "YouTube Music"
        self._title_res = [(e["label"], re.compile(rf"(?<!\w){re.escape(e['match'])}(?!\w)", re.IGNORECASE))
                           for e in self.titles]

    @classmethod
    def from_dict(cls, data: dict) -> "Blocklist":
        if not isinstance(data, dict):
            raise ValueError("blocklist must be a JSON object")
        kwargs = {}
        for key in ("processes", "titles"):
            value = data.get(key, [])
            if not isinstance(value, list):
                raise ValueError(f"blocklist '{key}' must be a list")
            kwargs[key] = [_entry(v, key) for v in value]
        if "browsers" in data:
            value = data["browsers"]
            if not isinstance(value, list) or not all(isinstance(v, str) and v.strip() for v in value):
                raise ValueError("blocklist 'browsers' must be a list of non-empty strings")
            kwargs["browsers"] = [v.strip() for v in value]
        if "steamGames" in data:
            if not isinstance(data["steamGames"], bool):
                raise ValueError("blocklist 'steamGames' must be true or false")
            kwargs["steam_games"] = data["steamGames"]
        return cls(**kwargs)

    def without_titles(self) -> "Blocklist":
        """Games-only copy: browser title matching off."""
        return Blocklist(self.processes, [], self.browsers, self.steam_games)

    @classmethod
    def load(cls, path) -> "Blocklist":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    def match(self, sample: Optional[Sample]) -> Optional[Match]:
        """Return what the sample counts against, or None if it isn't blocked."""
        if sample is None:
            return None
        proc = sample.process.lower()
        if proc in self._procs:  # process matches win over title matches
            return Match(self._procs[proc], "process")
        if self.steam_games:
            game = steam_game(sample.path)
            if game:
                return Match(game, "process")
        # Titles only count in browsers, so an editor open on "youtube_notes.txt" isn't charged
        if proc in self._browsers:
            for label, rx in self._title_res:
                if rx.search(sample.title):
                    return Match(label, "title")
        return None


def steam_game(path: str) -> Optional[str]:
    """Game folder name if `path` is an exe inside a Steam library's steamapps\\common, else None.

    >>> steam_game(r"D:\\SteamLibrary\\steamapps\\common\\Team Fortress 2\\tf_win64.exe")
    'Team Fortress 2'
    """
    if not path:
        return None
    norm = path.replace("/", "\\")
    i = norm.lower().find(STEAM_COMMON)
    if i < 0:
        return None
    game = norm[i + len(STEAM_COMMON):].split("\\", 1)[0]
    return game if game and game.lower() not in STEAM_NOT_GAMES else None
