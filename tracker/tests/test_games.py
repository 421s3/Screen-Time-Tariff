"""PC game detection: process rules, Steam-launched games, the Steam client, window states, idle."""

import pytest

import foreground
import tracker
from blocklist import Blocklist, Match, steam_game
from foreground import Sample
from tests.test_backend import backend, usage_bodies  # noqa: F401  (fixture)
from tests.test_tracker import fake_clock
from tracker import DEFAULT_BLOCKLIST

BL = Blocklist.load(DEFAULT_BLOCKLIST)
STEAM = r"C:\Program Files (x86)\Steam"
TF2 = Sample("tf_win64.exe", "Team Fortress 2 - Direct3D 9 - 64 Bit",
             STEAM + r"\steamapps\common\Team Fortress 2\tf_win64.exe")
AIMLAB = Sample("AimLab_tb.exe", "Aim Lab", r"D:\SteamLibrary\steamapps\common\Aim Lab\AimLab_tb.exe")
STEAM_CLIENT = Sample("steam.exe", "Steam", STEAM + r"\steam.exe")
STEAM_WEB = Sample("steamwebhelper.exe", "Steam", STEAM + r"\bin\cef\cef.win7x64\steamwebhelper.exe")
VALORANT = Sample("VALORANT-Win64-Shipping.exe", "VALORANT  ",
                  r"C:\Riot Games\VALORANT\live\ShooterGame\Binaries\Win64\VALORANT-Win64-Shipping.exe")
LEAGUE = Sample("League of Legends.exe", "League of Legends (TM) Client",
                r"C:\Riot Games\League of Legends\Game\League of Legends.exe")
LEAGUE_CLIENT = Sample("LeagueClientUx.exe", "League of Legends", r"C:\Riot Games\League of Legends\LeagueClientUx.exe")
RIOT_CLIENT = Sample("RiotClientServices.exe", "Riot Client", r"C:\Riot Games\Riot Client\RiotClientServices.exe")


@pytest.mark.parametrize("sample,expected", [
    (VALORANT, Match("Valorant", "process")),
    (LEAGUE, Match("League of Legends", "process")),           # the in-game process
    (LEAGUE_CLIENT, None),                                      # lobby/launcher isn't gameplay
    (RIOT_CLIENT, None),
    (TF2, Match("Team Fortress 2", "process")),                # any Steam game, labelled by folder
    (AIMLAB, Match("Aim Lab", "process")),                      # second Steam library on another drive
    (STEAM_CLIENT, None),                                       # the Steam client is not gameplay
    (STEAM_WEB, None),
    (Sample("vc_redist.x64.exe", "Setup", STEAM + r"\steamapps\common\Steamworks Shared\_CommonRedist\vc_redist.x64.exe"), None),
    (Sample("tf_win64.exe", "Team Fortress 2", ""), None),     # path unreadable (elevated): not guessed
])
def test_default_game_rules(sample, expected):
    assert BL.match(sample) == expected


def test_steam_client_counts_only_when_explicitly_listed():
    bl = Blocklist.from_dict({"processes": [{"match": "steam.exe", "label": "Steam"}]})
    assert bl.match(STEAM_CLIENT) == Match("Steam", "process")
    assert bl.match(TF2) is None  # steamGames defaults to off (backend configs without the key)


def test_explicit_process_rule_beats_steam_folder_label():
    bl = Blocklist.from_dict({"processes": [{"match": "tf_win64.exe", "label": "TF2"}], "steamGames": True})
    assert bl.match(TF2) == Match("TF2", "process")


def test_steam_games_flag_validated():
    with pytest.raises(ValueError):
        Blocklist.from_dict({"steamGames": "yes"})


@pytest.mark.parametrize("path,game", [
    (r"C:\Program Files (x86)\Steam\steamapps\common\FPSAimTrainer\FPSAimTrainer\Binaries\Win64\x.exe", "FPSAimTrainer"),
    ("E:/Games/SteamApps/Common/MarvelRivals/MarvelGame/Marvel.exe", "MarvelRivals"),
    (r"C:\Program Files (x86)\Steam\steamapps\common\SteamVR\bin\vrmonitor.exe", None),
    (r"C:\Games\steamapps\commonwealth\x.exe", None),
    (r"C:\Program Files (x86)\Steam\steamapps\common\\", None),
])
def test_steam_game_path_parsing(path, game):
    assert steam_game(path) == game


def test_games_only_ignores_browsers_but_keeps_games():
    bl = BL.without_titles()
    assert bl.match(Sample("chrome.exe", "YouTube - Google Chrome")) is None
    assert bl.match(TF2) == Match("Team Fortress 2", "process")
    assert bl.match(VALORANT) == Match("Valorant", "process")


# ---------------------------------------------------------------- window states

class FakeWin:
    """Just enough of win32gui for get_foreground()."""

    def __init__(self, iconic=False):
        self.iconic = iconic

    def GetForegroundWindow(self):
        return 42

    def IsIconic(self, hwnd):
        return self.iconic

    def GetWindowText(self, hwnd):
        return TF2.title


def test_minimized_game_is_not_in_front(monkeypatch):
    monkeypatch.setattr(foreground, "session_locked", lambda: False)
    monkeypatch.setattr(foreground, "_sample", lambda h: TF2)
    monkeypatch.setattr(foreground, "win32gui", FakeWin(iconic=True))
    assert foreground.get_foreground() is None
    monkeypatch.setattr(foreground, "win32gui", FakeWin(iconic=False))  # fullscreen/borderless in front
    assert foreground.get_foreground() == TF2


def test_alt_tab_switches_what_is_charged(monkeypatch, capsys):
    """Game -> Alt+Tab to Discord -> Alt+Tab switcher -> back to the game, 2 s samples."""
    switcher = Sample("explorer.exe", "Task Switching", r"C:\Windows\explorer.exe")
    discord = Sample("Discord.exe", "#general - Discord")
    fake_clock(monkeypatch, [TF2, TF2, switcher, discord, discord, switcher, TF2, TF2])
    tracker.run(tracker.parse_args(["--local", "--interval", "2", "--report-every", "60"]))
    out = capsys.readouterr().out
    assert '"Discord": 4.0' in out and '"Team Fortress 2": 8.0' in out


def test_controller_input_keeps_game_active(monkeypatch):
    packets = iter([1, 1, 2, 2])  # unchanged, then a button press, then nothing
    clock = iter([102.0, 102.0, 160.0])  # only read once a controller has been used

    def fake_get_state(slot, ref):
        if slot:
            return 1167  # ERROR_DEVICE_NOT_CONNECTED
        ref._obj.packet = next(packets)
        return 0

    monkeypatch.setattr(foreground, "_xinput", fake_get_state)
    monkeypatch.setattr(foreground, "_pad_packets", {})
    monkeypatch.setattr(foreground, "_pad_active_at", None)
    monkeypatch.setattr(foreground.time, "monotonic", lambda: next(clock))
    assert foreground.gamepad_idle_seconds() == float("inf")  # first look: no baseline yet
    assert foreground.gamepad_idle_seconds() == float("inf")  # nothing pressed
    assert foreground.gamepad_idle_seconds() == 0.0  # pressed (at t=102)
    assert foreground.gamepad_idle_seconds() == 58.0  # read at t=160


def test_idle_takes_the_most_recent_of_keyboard_and_controller(monkeypatch):
    monkeypatch.setattr(foreground, "gamepad_idle_seconds", lambda: 5.0)
    assert foreground.idle_seconds() <= 5.0


# ---------------------------------------------------------------- reported to the backend

def test_steam_game_reported_as_process_event(backend, tmp_path, monkeypatch):  # noqa: F811
    fake_clock(monkeypatch, [TF2] * 3 + [STEAM_CLIENT] * 3)
    tracker.run(tracker.parse_args(["--api-url", backend.url, "--pair", "482913", "--data-dir", str(tmp_path),
                                    "--interval", "2", "--report-every", "60"]))
    events = [e for b in usage_bodies(backend) for e in b["events"]]
    assert events == [{"app": "Team Fortress 2", "matchType": "process", "startedAt": 1794729000000, "seconds": 6}]
