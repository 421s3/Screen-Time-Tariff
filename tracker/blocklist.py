"""Blocklist loading and matching.

Format (docs/contract.md section 5; the backend sends it in GET /tracker/config):
    {
      "processes": [{"match": "VALORANT-Win64-Shipping.exe", "label": "Valorant"}, ...],
      "titles":    [{"match": "TikTok", "label": "TikTok"}, ...],
      "browsers":  ["chrome.exe", ...]          # tracker extension, optional
    }
Plain strings are also accepted as entries ("TikTok" == {"match": "TikTok", "label": "TikTok"}).
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import NamedTuple, Optional

from foreground import Sample

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
        return cls(**kwargs)

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
        # Titles only count in browsers, so an editor open on "youtube_notes.txt" isn't charged
        if proc in self._browsers:
            for label, rx in self._title_res:
                if rx.search(sample.title):
                    return Match(label, "title")
        return None
