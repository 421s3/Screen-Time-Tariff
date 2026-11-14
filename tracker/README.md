# Tracker (Windows)

Watches the window in front, checks it against the group's blocklist, and counts
seconds spent on blocked apps and sites. **Checkpoint 1 prints usage locally;
sending it to the backend comes next.**

## Setup

Needs Windows and Python 3.10+.

```powershell
cd tracker
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt        # add -dev to also get pytest
```

## Run

```powershell
python tracker.py                      # track with blocklist.json, print changes + a batch every 30 s
python tracker.py --once               # print what's in front right now and exit
python tracker.py --verbose            # print every 2 s sample
python tracker.py --blocklist my.json --interval 2 --report-every 30
```

Stop with Ctrl+C; it prints a final batch. Example output:

```
13:40:04  BLOCKED [TikTok]         chrome.exe | 'TikTok - Make Your Day - Google Chrome'
13:40:30  ok                       Code.exe | 'tracker.py - Visual Studio Code'
--- usage batch [{"app": "TikTok", "seconds": 26}]  totals {"TikTok": 26.0}  uptime 30s
```

**Check the real titles on the demo laptop:** open TikTok/YouTube in the demo browser
and run `python tracker.py --once` to confirm each one shows `BLOCKED`.

## Tests

```powershell
pip install -r requirements-dev.txt
python -m pytest
```

## Blocklist

`blocklist.json` (later this comes from the group's rules on the backend):

```json
{
  "processes": ["VALORANT-Win64-Shipping.exe", "League of Legends.exe", "steam.exe", "Discord.exe"],
  "titles":    ["TikTok", "YouTube", "Reddit", "Instagram", "Twitch"],
  "browsers":  ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "opera_gx.exe", "vivaldi.exe", "arc.exe"]
}
```

- `processes`: exact exe name, case-insensitive. Matches whatever the window title is.
- `titles`: whole-word, case-insensitive match in the window title, **only when the
  foreground process is in `browsers`** (so an editor open on `youtube.py` isn't charged).
- `browsers`: optional; defaults to the list above.
- The reported `app` is the blocklist entry that matched (`"TikTok"`, `"steam.exe"`).

## How timing works

- Every `--interval` seconds (default 2) it reads the foreground window
  (`GetForegroundWindow` + `psutil` process name).
- The time between two samples is credited to the app seen at the earlier sample,
  measured with a monotonic clock (immune to wall-clock changes). The loop sleeps
  to a fixed schedule so it doesn't drift.
- A gap longer than 3 intervals (sleep/hibernate, frozen loop) is capped at 3 intervals.
- Batches report whole seconds; fractions carry over to the next batch, so nothing is lost.
- Lock screen / no window / protected process: counted as not blocked.

## Known limits

- Title matching can't tell a TikTok tab from a Google search for "tiktok"
  (fix: the stretch Chrome extension reading the real URL).
- Only the foreground window counts: a YouTube video playing in a background tab isn't charged.
- Microsoft Store apps show up as `ApplicationFrameHost.exe`.
- No idle detection: a blocked window left in front while AFK keeps counting.

## Backend integration (next checkpoint)

Each batch is `[{"app": str, "seconds": int}, ...]`, only apps with ≥1 s, sent every 30 s.
The plan is to POST it to `/usage` with the paired user and a check-in timestamp
(ms, per `docs/contract.md`); empty batches still count as a check-in.
