import json

import pytest

from blocklist import Blocklist, Match
from foreground import Sample
from tracker import DEFAULT_BLOCKLIST

BL = Blocklist.load(DEFAULT_BLOCKLIST)
P, T = "process", "title"


@pytest.mark.parametrize("process,title,expected", [
    # Games/apps: exact process name, any case, any title; reported by label
    ("VALORANT-Win64-Shipping.exe", "VALORANT  ", Match("Valorant", P)),
    ("league of legends.exe", "League of Legends (TM) Client", Match("League of Legends", P)),
    ("Discord.exe", "#general | Friends - Discord", Match("Discord", P)),
    # Browser tabs: title keyword, across browsers and incognito/profile suffixes
    ("chrome.exe", "TikTok - Make Your Day - Google Chrome", Match("TikTok", T)),
    ("chrome.exe", "funny cat | TikTok - Google Chrome", Match("TikTok", T)),
    ("msedge.exe", "lofi beats - YouTube and 3 more pages - Personal - Microsoft Edge", Match("YouTube", T)),
    ("firefox.exe", "(12) YouTube — Mozilla Firefox Private Browsing", Match("YouTube", T)),
    ("brave.exe", "r/funny on Reddit - Brave", Match("Reddit", T)),
    ("chrome.exe", "Instagram - Google Chrome (Incognito)", Match("Instagram", T)),
    ("opera.exe", "xQc - Twitch - Opera", Match("Twitch", T)),
    # Not blocked
    ("chrome.exe", "Gmail - Google Chrome", None),
    ("chrome.exe", "Redditch weather - Google Chrome", None),  # whole words only
    ("Code.exe", "youtube.py - Visual Studio Code", None),     # titles only count in browsers
    ("notepad.exe", "TikTok ideas.txt - Notepad", None),
    ("explorer.exe", "", None),
])
def test_match(process, title, expected):
    assert BL.match(Sample(process, title)) == expected


def test_no_window_is_not_blocked():
    assert BL.match(None) is None


def test_title_search_false_positive_is_known():
    # Documented limitation: a search for "tiktok" looks like TikTok (fixed by the stretch Chrome extension)
    assert BL.match(Sample("chrome.exe", "tiktok - Google Search - Google Chrome")) == Match("TikTok", T)


def test_plain_string_entries_still_work():
    bl = Blocklist.from_dict({"processes": ["steam.exe"], "titles": ["YouTube"]})
    assert bl.match(Sample("Steam.exe", "Steam")) == Match("steam.exe", P)
    assert bl.match(Sample("msedge.exe", "YouTube - Microsoft Edge")) == Match("YouTube", T)


def test_process_beats_title_and_first_entry_wins():
    bl = Blocklist.from_dict({
        "processes": [{"match": "chrome.exe", "label": "Chrome"}, {"match": "CHROME.EXE", "label": "Dup"}],
        "titles": [{"match": "YouTube", "label": "YouTube"}],
    })
    assert bl.match(Sample("chrome.exe", "YouTube")) == Match("Chrome", P)
    bl = Blocklist.from_dict({"titles": [{"match": "Shorts", "label": "A"}, {"match": "YouTube", "label": "B"}]})
    assert bl.match(Sample("chrome.exe", "Shorts - YouTube")) == Match("A", T)


def test_custom_browsers_and_defaults():
    bl = Blocklist.from_dict({"titles": [{"match": "YouTube", "label": "YouTube"}]})
    assert bl.processes == []
    assert bl.match(Sample("msedge.exe", "YouTube - Microsoft Edge")) == Match("YouTube", T)
    bl = Blocklist.from_dict({"titles": ["YouTube"], "browsers": ["chrome.exe"]})
    assert bl.match(Sample("msedge.exe", "YouTube - Microsoft Edge")) is None


def test_regex_characters_in_keywords_are_literal():
    bl = Blocklist.from_dict({"titles": ["C++ (live)"]})
    assert bl.match(Sample("chrome.exe", "C++ (live) - Google Chrome")) == Match("C++ (live)", T)
    assert bl.match(Sample("chrome.exe", "C (live) - Google Chrome")) is None


@pytest.mark.parametrize("bad", [
    [], {"titles": "TikTok"}, {"processes": [1]}, {"titles": [""]},
    {"titles": [{"label": "x"}]}, {"titles": [{"match": "x", "label": ""}]}, {"browsers": "chrome.exe"},
])
def test_invalid_config_rejected(bad):
    with pytest.raises(ValueError):
        Blocklist.from_dict(bad)


def test_load_from_file(tmp_path):
    path = tmp_path / "bl.json"
    path.write_text(json.dumps({"processes": [{"match": "steam.exe", "label": "Steam"}]}), encoding="utf-8")
    assert Blocklist.load(path).match(Sample("Steam.exe", "Steam")) == Match("Steam", P)
