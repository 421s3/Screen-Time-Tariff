# tracker/ — Windows game-time tracker (Dev 3)

Watches what's in front on a Windows PC, mainly **PC games** (Valorant, League of Legends,
anything launched from Steam, any configured exe), and reports seconds of tracked use to the
backend every second (near real time). The report doubles as the tracker's check-in. Browser tab tracking
(TikTok, YouTube, …) is optional.

**Tracking only.** The tracker never closes, blocks or interrupts anything: listed apps, games and
sites stay fully usable. The `blocklist` is the list of things whose foreground time is measured
and sent to the backend, which charges tariffs once the allowance is used up.

- Demo procedure: [DEMO.md](DEMO.md)
- Spec: [`../docs/contract.md`](../docs/contract.md) section 4 (endpoints) and section 5 (blocklist)
- Differences from the contract: [Contract status](#contract-status)

## Desktop app (what users download)

**`ScreenTimeTariff.exe`**: one file, no Python or terminal needed.

1. Download `ScreenTimeTariff.exe` and put it in a folder you can write to (e.g.
   `C:\ScreenTimeTariff\`). Its pairing, offline queue and `tracker.log` are saved next to it.
2. Double-click it. Windows SmartScreen may warn about an unsigned app the first time:
   **More info → Run anyway**.
3. On the dashboard, open your group's **Pair tracker** page and copy the 6-digit code.
4. Type it into the app and click **Pair tracker**. Tracking starts right away and the window shows
   what's being tracked, this session's totals, and whether reports are reaching the backend.

After that:

- **Restarting** the app (or the PC) reconnects on its own with the saved, DPAPI-encrypted pairing.
  Tick **Start at Windows sign-in** to have it start in the tray at every sign-in.
- **Minimizing** keeps tracking. **Closing the window (X)** hides it to the system-tray icon and keeps
  tracking; use the tray icon's **Quit** to stop (it sends the last report first).
- **Offline:** reports are saved and sent automatically when the connection is back.
- **Open dashboard** opens your group on the dashboard website.
- **Disconnect** forgets the pairing on this PC (unsent usage stays queued); pair again with a new code.
- **Settings…** changes the backend and dashboard URLs (saved to `.env` next to the app). A different
  backend needs a new pairing code.
- Only one tracker runs per folder: a second copy (or the command-line tracker) refuses to start.

The app only measures what's in front. It never blocks, closes or slows down any app or site.

### Backend and dashboard URLs (Railway / Vercel)

The app finds them in this order, so they can change **without rebuilding**:

1. `--api-url` / `--dashboard-url` on the command line
2. `API_URL` / `DASHBOARD_URL` environment variables
3. `.env` next to the exe (what **Settings…** writes), e.g.
   ```
   API_URL=https://<name>.up.railway.app
   DASHBOARD_URL=https://<name>.vercel.app
   ```
4. The defaults baked in at build time (`build_exe.py --api-url … --dashboard-url …`)
5. `http://localhost:4000` and `http://localhost:5173`

Only these public URLs are ever bundled. The exe contains no API keys, MongoDB credentials,
Solana keys or tokens; the tracker never needs any (it authenticates with its own pairing token,
created on this PC at pairing time and stored encrypted next to the exe). A non-local `http://`
backend shows a warning: use the `https://` Railway URL.

### Build the exes

```powershell
cd tracker
.venv\Scriptsctivate
pip install -r requirements.txt -r requirements-build.txt
python build_exe.py --api-url https://backend-production-340855b8.up.railway.app --dashboard-url https://screen-time-tariff.vercel.app
```

If an exe in `dist\` is running (and so locked), build elsewhere with `--out dist
ext`.

Those are the deployed backend (Railway, `chainMode: devnet`) and dashboard (Vercel). **Open dashboard**
opens the paired group's page (`/group/<groupId>`; Vercel serves it thanks to `web/vercel.json`).

`dist\ScreenTimeTariff.exe` (desktop app, ~18 MB) and `dist\ScreenTimeTariffTracker.exe` (command line,
~8 MB). `--only gui|cli` builds one. The build bundles code, `blocklist.json` and the default URLs only,
and fails if a local `.env`/token's contents end up inside an exe. `dist/` and `build/` are gitignored.

### From source

Needs Windows and Python 3.10+. Runtime dependencies: `pywin32`, `psutil`, and for the tray icon
`pystray` + `Pillow` (without them the app still works and minimizes instead).

```powershell
cd tracker
python -m venv .venv
.venv\Scriptsctivate
pip install -r requirements.txt        # requirements-dev.txt adds pytest
python tracker_gui.py                  # desktop app (--minimized, --fake, --api-url, --dashboard-url, --data-dir)
```

## Command-line tracker

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
Blocklist from backend: 3 processes, Steam games on, 5 browser titles. Sampling every 1s, reporting every 1s. Ctrl+C to stop.
14:06:29  TRACKED [Valorant/process]     VALORANT-Win64-Shipping.exe | 'VALORANT'
14:07:02  TRACKED [Team Fortress 2/process]  tf_win64.exe | 'Team Fortress 2'
14:07:40  ok                             Discord.exe | '#general - Discord'   (idle)
--- batch [{"app": "Valorant", "matchType": "process", "startedAt": 1794690389474, "seconds": 30}]  ...  [sent 1 batch(es)]
```

### `--fake` (demo fallback)

`--fake` ignores real windows and plays 30 s of Valorant, 30 s of Team Fortress 2 (as a Steam
game), 30 s of something unblocked, repeating. The console prints
`*** SYNTHETIC MODE ***` and tags every batch `(SYNTHETIC)`. The backend receives normal
batches (the contract has no "synthetic" flag), so **say it out loud** if you use it in a demo.

### Backend URL (command line)

Same order as the desktop app (see [Backend and dashboard URLs](#backend-and-dashboard-urls-railway--vercel)).
The token is tied to the URL it was issued by: a different backend needs a new pairing code.

## What counts as playing

Every `sampleIntervalSec` (1 s, from the backend's `/tracker/config`) the tracker reads the foreground window and its process.

| Situation | Counted? | How |
|---|---|---|
| Game in front, windowed / borderless / exclusive fullscreen | yes | foreground window's exe |
| Valorant (`VALORANT-Win64-Shipping.exe`), League in game (`League of Legends.exe`) | yes | `processes` rules |
| Riot Client, League client/lobby (`LeagueClientUx.exe`) | no | not listed |
| Any game under `steamapps\common\<Game>\` (any Steam library, any drive) | yes, as `<Game>` | `steamGames: true` |
| Steam client (`steam.exe`, `steamwebhelper.exe`), Steamworks redistributables, SteamVR | no | outside the game folders / excluded |
| Alt+Tab to Discord / desktop | only if that app is on the list | only the foreground window counts |
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

Every `reportIntervalSec` (1 s, from the backend), `POST /usage` with `Authorization: Bearer <token>`.
Requests go out one at a time from the tracking loop, so they never overlap. While the backend is
unreachable, each second's usage is still written to the queue, but the network is only retried after
1, 2, 4 … 30 s, so a long outage doesn't stall sampling every second. Request timeout: 5 s.
An hour offline while playing queues ~3,600 small batches; they're sent oldest first on reconnect.

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
python -m pytest                       # ~40 s; the offline tests wait for Windows to refuse connections
```

- `test_gui.py`: the desktop app: pairing errors, pair → track → stop, restart without a code,
  offline recovery, disconnect, revoked token, URL settings, and the Tk window itself.
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

- Desktop app: if Windows shuts down or the app is killed (Task Manager), up to one report
  interval (1 s) of not-yet-sent usage is lost; tray **Quit** sends it first. (The console tracker
  saves it to the queue on console close / sign-out / shutdown.)
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

### Tested against the real backend (2026-11-14)

`origin/main` backend (`b3ca464`) on `http://127.0.0.1:4000`, MongoDB Atlas (separate test database
`screen-time-tariff-tracker-e2e`), `CHAIN_MODE=mock` (no Solana transactions):

| Check | Result |
|---|---|
| `/pair/complete` with a dashboard code from `/pair/start` | paired; token stored DPAPI-encrypted on the PC, as a hash in MongoDB |
| `/tracker/config` | blocklist + intervals applied |
| `--fake` usage, 4 × 5 s batches | 20 s stored in `usageEvents`; `trackers.current`/`idle`/`lastSeenAt` updated |
| Same batch sent 3 times (resend + queued retry) | stored once (`duplicate: true`); queue emptied |
| Backend stopped, tracker keeps running, backend restarted | 2 queued batches (10 s) sent on reconnect, stored once, not scaled by the rate cap |
| One website event (TikTok, `title`) + one game event (Valorant, `process`) | both stored; both in `/groups/:id/state` `byApp`, `current: Valorant`, tracker online |
| Invalid token | `401 TRACKER_TOKEN_INVALID` (tracker re-pairs) |

### Open items (Dev 4 / Dev 1); the contract is unchanged

| # | Topic | Backend today | Tracker | Needs |
|---|---|---|---|---|
| 1 | **Steam games** | backend fix ready, not merged yet: schema keeps `steamGames`, default list has `steamGames: true` and no `steam.exe` (explicit `steam.exe` still allowed). The dashboard (`web/src/pages/CreateGroup.tsx`) still sends its own list with `steam.exe` and no `steamGames` | `steamGames: true` counts Steam-launched games; without it they aren't counted | merge the backend fix; Dev 1: send `steamGames` from the dashboard |
| 2 | Period boundary | usage counts toward a period by `receivedAt` | an outage backlog may arrive after `periodEnd` | optional: count by `startedAt` |
| 3 | Idle | TBD in contract | games/apps not counted while idle; browser titles still counted; `idle` sent | confirm |
| 4 | `sentAt` | stored per batch, not used | creation time; unchanged on retries | none |
| 5 | Synthetic usage | no flag | `--fake` batches look real | optional flag if the dashboard should label it |

Resolved since CP2: the seconds cap is a budget since pairing (an outage backlog fits); 401 codes,
410 `PAIR_CODE_EXPIRED`, `wallet`/`groupId` always returned; the server listens on IPv4 and IPv6.

## Privacy

Only listed matches leave the machine: app label, match type, timestamps and seconds, plus the
PC's hostname at pairing. No keystrokes, no browsing history, no window titles or exe paths
(titles and paths are only used locally).
