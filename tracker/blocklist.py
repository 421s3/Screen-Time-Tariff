"""Blocklist loading and matching.

Format (same shape the backend stores with each group's rules):
    {
      "processes": ["VALORANT-Win64-Shipping.exe", ...],   # exact exe name, case-insensitive
      "titles":    ["TikTok", "YouTube", ...],             # whole word in a browser window title
      "browsers":  ["chrome.exe", ...]                     # optional; which exes count as browsers
    }
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from foreground import Sample

DEFAULT_BROWSERS = (
    "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe",
    "opera.exe", "opera_gx.exe", "vivaldi.exe", "arc.exe",
)


@dataclass
class Blocklist:
    processes: list = field(default_factory=list)
    titles: list = field(default_factory=list)
    browsers: list = field(default_factory=lambda: list(DEFAULT_BROWSERS))

    def __post_init__(self):
        self._procs = {p.lower(): p for p in self.processes}
        self._browsers = {b.lower() for b in self.browsers}
        # Whole-word match so "Reddit" doesn't hit "Redditch" and "YouTube" hits "YouTube Music"
        self._title_res = [(t, re.compile(rf"(?<!\w){re.escape(t)}(?!\w)", re.IGNORECASE)) for t in self.titles]

    @classmethod
    def from_dict(cls, data: dict) -> "Blocklist":
        if not isinstance(data, dict):
            raise ValueError("blocklist must be a JSON object")
        kwargs = {}
        for key in ("processes", "titles", "browsers"):
            if key in data:
                value = data[key]
                if not isinstance(value, list) or not all(isinstance(v, str) and v.strip() for v in value):
                    raise ValueError(f"blocklist '{key}' must be a list of non-empty strings")
                kwargs[key] = [v.strip() for v in value]
        return cls(**kwargs)

    @classmethod
    def load(cls, path) -> "Blocklist":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    def match(self, sample: Optional[Sample]) -> Optional[str]:
        """Return the blocklist entry the sample counts against, or None if it isn't blocked."""
        if sample is None:
            return None
        proc = sample.process.lower()
        if proc in self._procs:
            return self._procs[proc]
        # Titles only count in browsers, so an editor open on "youtube_notes.txt" isn't charged
        if proc in self._browsers:
            for name, rx in self._title_res:
                if rx.search(sample.title):
                    return name
        return None
