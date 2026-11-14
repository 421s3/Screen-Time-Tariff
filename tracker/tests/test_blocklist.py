import json

import pytest

from blocklist import Blocklist
from foreground import Sample
from tracker import DEFAULT_BLOCKLIST

BL = Blocklist.load(DEFAULT_BLOCKLIST)


@pytest.mark.parametrize("process,title,expected", [
    # Games/apps: exact process name, any case, any title
    ("VALORANT-Win64-Shipping.exe", "VALORANT  ", "VALORANT-Win64-Shipping.exe"),
    ("league of legends.exe", "League of Legends (TM) Client", "League of Legends.exe"),
    ("Discord.exe", "#general | Friends - Discord", "Discord.exe"),
    # Browser tabs: title keyword, across browsers and incognito/profile suffixes
    ("chrome.exe", "TikTok - Make Your Day - Google Chrome", "TikTok"),
    ("chrome.exe", "funny cat | TikTok - Google Chrome", "TikTok"),
    ("msedge.exe", "lofi beats - YouTube and 3 more pages - Personal - Microsoft Edge", "YouTube"),
    ("firefox.exe", "(12) YouTube — Mozilla Firefox Private Browsing", "YouTube"),
    ("brave.exe", "r/funny on Reddit - Brave", "Reddit"),
    ("chrome.exe", "Instagram - Google Chrome (Incognito)", "Instagram"),
    ("opera.exe", "xQc - Twitch - Opera", "Twitch"),
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
    assert BL.match(Sample("chrome.exe", "tiktok - Google Search - Google Chrome")) == "TikTok"


def test_custom_browsers_and_defaults():
    bl = Blocklist.from_dict({"titles": ["YouTube"]})
    assert bl.processes == []
    assert bl.match(Sample("msedge.exe", "YouTube - Microsoft Edge")) == "YouTube"
    bl = Blocklist.from_dict({"titles": ["YouTube"], "browsers": ["chrome.exe"]})
    assert bl.match(Sample("msedge.exe", "YouTube - Microsoft Edge")) is None


def test_regex_characters_in_keywords_are_literal():
    bl = Blocklist.from_dict({"titles": ["C++ (live)"]})
    assert bl.match(Sample("chrome.exe", "C++ (live) - Google Chrome")) == "C++ (live)"
    assert bl.match(Sample("chrome.exe", "C (live) - Google Chrome")) is None


@pytest.mark.parametrize("bad", [[], {"titles": "TikTok"}, {"processes": [1]}, {"titles": [""]}])
def test_invalid_config_rejected(bad):
    with pytest.raises(ValueError):
        Blocklist.from_dict(bad)


def test_load_from_file(tmp_path):
    path = tmp_path / "bl.json"
    path.write_text(json.dumps({"processes": ["steam.exe"], "titles": []}), encoding="utf-8")
    assert Blocklist.load(path).match(Sample("Steam.exe", "Steam")) == "steam.exe"
