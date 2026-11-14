# tracker/ — Windows game-time tracker (Dev 3)

Watches what's in front on a Windows PC, mainly **PC games** (Valorant, League of Legends,
anything launched from Steam, any configured exe), and reports seconds of blocked play to the
backend every 30 s. The report doubles as the tracker's check-in. Browser tab tracking
(TikTok, YouTube, …) is optional.

- Demo procedure: [DEMO.md](DEMO.md)
- Spec: [`../docs/contract.md`](../docs/contract.md) section 4 (endpoints) and section 5 (blocklist)
- Differences from the contract: [Contract status](#contract-status)

## Setup

### Packaged `.exe` (demo laptops)

1. Put `ScreenTimeTariffTracker.exe` in a folder you can write to (e.g. `C:\ScreenTimeTariff\`).
2. Next to it, create `.env` with one line: `API_URL=https://<backend host>`.
3. Run it, enter the pairing code from the dashboard. The token and offline queue are stored
   in that same folder.
4. Optional: `ScreenTimeTariffTracker.exe --install-startup` starts it at every sign-in.

The `.exe` contains no URL, token or key. Everything machine-specific lives next to it.

### From source

Needs Windows and Python 3.10+. Runtime dependencies: `pywin32` and `psutil` only (HTTP is stdlib).

```powershell
cd tracker
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt        # requirements-dev.txt adds pytest
copy .env.example .env                 # then set API_URL to the backend
```

### Build the `.exe`

```powershell
pip install -r requirements-build.txt  # PyInstaller
python build_exe.py                    # -> dist\ScreenTimeTariffTracker.exe (~8 MB, one file, console)
```

The build bundles code and `blocklist.json` only, never `.env`, the token file or `queue/`. It
fails if a local `.env`/token's contents end up inside the exe. `dist/` and `build/` are gitignored.
Windows SmartScreen may warn about an unsigned exe the first time: "More info", then "Run anyway".

## Run

```powershell
python tracker.py                      # first run asks for the pairing code, then tracks
python tracker.py --pair 482913        # pair (or re-pair) without the prompt
python tracker.py --games-only         # ignore browser titles; games/apps only
python tracker.py --scan               # classify every open window (check a demo laptop)
python tracker.py --once               # classify what's in front right now
python tracker.py --fake               # SYNTHETIC usage for demos (see below)
python tracker.py --local              # Checkpoint 1 mode: no backend, print batches only
python tracker.py --unpair             # forget the saved token
python tracker.py --install-startup    # start at Windows sign-in (current user); --uninstall-startup removes it
```

The `.exe` takes the same options (`ScreenTimeTariffTracker.exe --scan`). Other options:
`--api-url URL`, `--data-dir DIR` (token + queue location; two dirs = two trackers on one PC),
`--blocklist FILE`, `--interval S`, `--report-every S`, `--verbose`.

Stop with Ctrl+C (sends a final batch). Closing the console window, signing out or shutting
down saves unsent seconds to the queue instead (no time for the network); they go out next start.

```
Paired as Alice (H9Rje...) in group 6734f0c2a1b2c3d4e5f60718.
Blocklist from backend: 3 processes, Steam games on, 5 browser titles. Sampling every 2s, reporting every 30s. Ctrl+C to stop.
14:06:29  BLOCKED [Valorant/process]     VALORANT-Win64-Shipping.exe | 'VALORANT'
14:07:02  BLOCKED [Team Fortress 2/process]  tf_win64.exe | 'Team Fortress 2'
14:07:40  ok                             Discord.exe | '#general - Discord'   (idle)
--- batch [{"app": "Valorant", "matchType": "process", "startedAt": 1794690389474, "seconds": 30}]  ...  [sent 1 batch(es)]
```

### `--fake` (demo fallback)

`--fake` ignores real windows and plays 30 s of Valorant, 30 s of Team Fortress 2 (as a Steam
game), 30 s of something unblocked, repeating. The console prints
`*** SYNTHETIC MODE ***` and tags every batch `(SYNTHETIC)`. The backend receives normal
batches (the contract has no "synthetic" flag), so **say it out loud** if you use it in a demo.

### Backend URL

`--api-url` beats the `API_URL` environment variable, which beats `.env` (next to the exe, or in
`tracker/`), which defaults to `http://localhost:4000`. The token is tied to the URL it was issued
by: a different backend needs a new pairing code. The tracker warns if a non-local URL uses plain
`http` (the token would travel unencrypted).

## What counts as playing

Every `sampleIntervalSec` (2 s) the tracker reads the foreground window and its process.

| Situation | Counted? | How |
|---|---|---|
| Game in front, windowed / borderless / exclusive fullscreen | yes | foreground window's exe |
| Valorant (`VALORANT-Win64-Shipping.exe`), League in game (`League of Legends.exe`) | yes | `processes` rules |
| Riot Client, League client/lobby (`LeagueClientUx.exe`) | no | not listed |
| Any game under `steamapps\common\<Game>\` (any Steam library, any drive) | yes, as `<Game>` | `steamGames: true` |
| Steam client (`steam.exe`, `steamwebhelper.exe`), Steamworks redistributables, SteamVR | no | outside the game folders / excluded |
| Alt+Tab to Discord / desktop | only if that app is blocked | only the foreground window counts |
| Game minimized (Win+D, Alt+Tab out of exclusive fullscreen) | no | minimized windows are ignored even if Windows still calls them "foreground" |
| No keyboard, mouse **or controller** input for `idleThresholdSec` (120 s) | games: no; browser video: yes | `GetLastInputInfo` + XInput |
| Lock screen, Ctrl+Alt+Del, UAC prompt | no | secure desktop / `LockApp.exe` detected |
| Sleep / hibernate | no | gap capped at 3 samples; schedule restarts on wake |
| Elevated/protected game process | by exe name, yes; as a Steam game, no | its path can't be read |

Browser tabs (optional): `titles` keywords, whole-word, only in `browsers`. `--games-only` turns
them off locally; a group can also send an empty `titles` list.

## Blocklist

From `GET /tracker/config` once paired (re-fetched every 5 min; the last good copy is cached for
when the backend is down). `blocklist.json` is used by `--local`, `--scan`, `--once` and as a
last-resort fallback.

```json
{
  "processes": [
    { "match": "VALORANT-Win64-Shipping.exe", "label": "Valorant" },
    { "match": "League of Legends.exe",       "label": "League of Legends" },
    { "match": "Discord.exe",                 "label": "Discord" }
  ],
  "steamGames": true,
  "titles":   [{ "match": "TikTok", "label": "TikTok" }],
  "browsers": ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe"]
}
```

- `processes`: exact exe name, case-insensitive → `matchType: "process"`. Wins over everything else.
  Add any game here (`"cs2.exe"`, `"FortniteClient-Win64-Shipping.exe"`, …). The Steam client
  only counts if you list `steam.exe` here yourself.
- `steamGames` (**tracker extension**, optional, default `false`): Steam-launched games, reported
  as `matchType: "process"` with the game's folder name as `app` (e.g. `"Team Fortress 2"`).
- `titles` / `browsers`: per contract v0.2 (whole-word, browsers only, `browsers` optional).
- `label` is reported as `app`. Plain strings are accepted too (`"TikTok"` = match and label).

## Reporting

Every `reportIntervalSec` (30 s), `POST /usage` with `Authorization: Bearer <token>`:

```json
{
  "batchId": "b1f2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "sentAt": 1794729570000,
  "idle": false,
  "current": { "app": "Valorant", "matchType": "process" },
  "events": [{ "app": "Valorant", "matchType": "process", "startedAt": 1794729540000, "seconds": 30 }]
}
```

- One event per app + match type. `startedAt` is when that app's first unreported second began.
  `current` is what's in front now (`null` if nothing blocked, while idle in a game, and on shutdown).
- **Heartbeat:** a batch with `events: []` is still sent, so the backend sees the check-in.
- **Offline queue:** a batch with events is written to `queue/<pairing id>/` (atomically) *before*
  it's sent and deleted only after a 2xx. Network errors, timeouts, 408, 429 and 5xx leave it
  queued; the next report sends the queue oldest first. Queued batches survive restarts.
- **No duplicates:** a retry resends the same file, so the same `batchId` and `sentAt`; the backend
  ignores ids it already stored.
- Empty heartbeats aren't queued. A batch rejected with another 4xx goes to
  `queue/<pairing id>/rejected/`, not deleted.
- **401/403:** the token is deleted and the tracker exits asking for a new pairing code. The queue
  is kept and sent after re-pairing.
- **Queues are per pairing** (hash of backend URL + wallet + group): batches are only ever sent with
  the token of the pairing that recorded them.

## Token storage and process safety

- `.tracker_token.json` (gitignored) holds the backend URL, wallet, group, last config and the token.
  The token is encrypted with Windows DPAPI: only the same Windows user on the same PC can read
  it. It's never printed or logged.
- Only one tracker runs per data folder (a named mutex), so a sign-in start plus a manual start
  can't double-count. Windows releases the mutex if the tracker crashes.

## How timing works

- Time between two samples is credited to what was in front at the earlier sample, measured
  with a monotonic clock. The loop sleeps to a fixed schedule so it doesn't drift.
- A gap longer than 3 samples (sleep, hibernate, a frozen loop) is capped at 3 samples, and the
  schedule restarts from now. (Before this fix, waking from sleep replayed every missed sample
  and sent one report per missed sample.)
- Time spent inside the tracker's own slow HTTP calls is credited, not capped.
- Batches report whole seconds; fractions carry over, so the `totals` line (0.1 s) can read
  `2.0` while the batch says `1`.

## Tests

```powershell
pip install -r requirements-dev.txt
python -m pytest                       # ~25 s; the offline tests wait for Windows to refuse connections
```

- `test_games.py`: process rules, Steam games vs the Steam client, minimized/Alt+Tab, controller idle.
- `test_windows_lifecycle.py`: lock screen, idle, sleep/resume, single instance, sign-in entry,
  console close, packaged-exe paths.
- `test_backend.py`: pairing, reporting, heartbeats, offline queue, retries, re-pairing, against
  `mock_backend.py` over real HTTP.
- `test_blocklist.py`, `test_usage.py`, `test_tracker.py`: matching (including real browser titles
  captured on Windows), timing, CLI.

## Mock backend (until the real one is up)

`mock_backend.py` implements `/health`, `/pair/complete`, `/tracker/config`, `/usage` from the
contract, validates every `/usage` body and ignores repeated `batchId`s. Not included in the exe.

```powershell
python mock_backend.py                         # http://localhost:4000, pairing code 482913
python tracker.py --fake --pair 482913         # second terminal
```

It keeps tokens in memory: after restarting it, the tracker gets a 401 and asks to pair again.

## Known limits

- Games launched outside Steam and not in `processes` aren't counted (e.g. Epic, Battle.net):
  add their exe to `processes`.
- A game that runs elevated hides its path, so `steamGames` can't see it; list its exe instead.
- Some launchers live inside a game's Steam folder and count as that game while open.
- Controllers: XInput (Xbox and most PC pads) only; a DirectInput-only pad looks idle after 120 s.
- Browser titles: a Google search for "tiktok" counts as TikTok; Edge titles a subreddit page
  by its name only ("funny"), so it isn't caught. Background tabs don't count.
- Microsoft Store apps show up as `ApplicationFrameHost.exe`.
- Interval changes from `/tracker/config` apply on next start; blocklist changes apply live.

## Contract status

Matches `docs/contract.md` **v0.2**: endpoints, headers, `/usage` body, error body, `{match, label}`
entries, `matchType`, precedence, whole-word titles, optional `browsers`, ms timestamps.

Open items for Dev 4 (and Dev 1 for the dashboard's default blocklist); the contract is unchanged:

| # | Topic | Contract | Tracker | Needs |
|---|---|---|---|---|
| 1 | **Steam games** | not covered; example blocklist lists `steam.exe` | optional `steamGames: true` key; the Steam client isn't gameplay | add `steamGames` to the blocklist format and the dashboard's default; drop `steam.exe` from the default |
| 2 | **Seconds cap** | cap batch seconds at real time since the previous batch | queued batches from an outage arrive back to back | **blocker:** cap by `sentAt` gaps, not arrival time |
| 3 | Idle | TBD (suggests: titles count while idle) | games/apps not counted while idle, browser titles still counted; `idle` sent | confirm |
| 4 | `sentAt` | not specified | creation time; unchanged on retries | confirm |
| 5 | Auth errors | not specified | 401/403 = re-pair; other 4xx = batch rejected | confirm |
| 6 | `/pair/complete` | returns `trackerToken`, `wallet`, `groupId`, `displayName` | `trackerToken`, `wallet`, `groupId` **required** | always return them |
| 7 | Localhost | `http://localhost:4000` | Windows tries `::1` first; IPv4-only costs ~2 s per request | listen on both, or use `127.0.0.1` |
| 8 | Synthetic usage | no flag | `--fake` batches look real to the backend | optional: a `synthetic` flag if the dashboard should label it |

## Privacy

Only blocked matches leave the machine: app label, match type, timestamps and seconds, plus the
PC's hostname at pairing. No keystrokes, no browsing history, no window titles or exe paths
(titles and paths are only used locally).
