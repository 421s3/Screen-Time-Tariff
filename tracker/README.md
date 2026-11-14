# tracker/ — Windows screen-time tracker (Dev 3)

Watches the window in front, checks it against the group's blocklist, and reports seconds
spent on blocked apps and sites to the backend every 30 s. The report doubles as the
tracker's check-in.

## Spec

- Matching rules and blocklist format: [`../docs/contract.md`](../docs/contract.md) section 5
- Endpoints it calls (`/pair/complete`, `/tracker/config`, `/usage`): section 4
- Where the code differs from the contract: see [Contract status](#contract-status) below.

## Setup

Needs Windows and Python 3.10+. No dependencies beyond `pywin32` and `psutil`; HTTP is stdlib.

```powershell
cd tracker
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt        # requirements-dev.txt adds pytest
copy .env.example .env                 # then set API_URL to the backend
```

## Run

```powershell
python tracker.py                      # first run asks for the pairing code from the dashboard, then tracks
python tracker.py --pair 482913        # pair (or re-pair) without the prompt
python tracker.py --fake               # synthetic usage (30 s TikTok, 30 s Valorant, 30 s unblocked), no browser needed
python tracker.py --local              # Checkpoint 1 mode: no backend, print batches only
python tracker.py --once               # print what's in front right now and exit
python tracker.py --unpair             # forget the saved token
```

Other options: `--api-url URL`, `--data-dir DIR` (token + queue location; use two dirs to run
two trackers on one machine), `--blocklist FILE`, `--interval S`, `--report-every S`, `--verbose`.

Stop with Ctrl+C; it sends a final batch. Example output:

```
Paired as Alice (H9Rje...) in group 6734f0c2a1b2c3d4e5f60718.
Blocklist from backend: 4 processes, 5 titles. Sampling every 2s, reporting every 30s. Ctrl+C to stop.
14:06:29  BLOCKED [Valorant/process]     VALORANT-Win64-Shipping.exe | 'VALORANT'
--- batch [{"app": "Valorant", "matchType": "process", "startedAt": 1794690389474, "seconds": 30}]  totals {"Valorant": 30.0}  uptime 30s  [sent 1 batch(es)]
```

**Check the real titles on the demo laptop:** open TikTok/YouTube in the demo browser
and run `python tracker.py --once` to confirm each one shows `BLOCKED`.

### Backend URL

`--api-url` beats the `API_URL` environment variable, which beats `tracker/.env`, which
defaults to `http://localhost:4000`. The token is tied to the URL it was issued by:
pointing the tracker at a different backend asks for a new pairing code. The tracker
warns if a non-local URL uses plain `http` (the token would travel unencrypted; use the
https ngrok/host URL).

## Mock backend (until the real one is up)

`mock_backend.py` implements `/health`, `/pair/complete`, `/tracker/config` and `/usage`
from the contract, checks every `/usage` body against it, and ignores repeated `batchId`s.

```powershell
python mock_backend.py                         # http://localhost:4000, pairing code 482913
python tracker.py --fake --pair 482913         # in a second terminal
```

The mock prints each batch it receives. It keeps tokens in memory, so after restarting
it the tracker gets a 401 and asks you to pair again (queued usage is kept).
Switching to the real backend is only a URL change (`API_URL` / `--api-url`) and a new pairing code.

## Tests

```powershell
pip install -r requirements-dev.txt
python -m pytest                       # ~20 s; the offline tests wait for Windows to refuse connections
```

`tests/test_backend.py` runs the client, queue and the whole tracker against the mock over real HTTP.

## Blocklist

From `GET /tracker/config` once paired (re-fetched every 5 minutes; the last good copy is
cached for when the backend is down). `blocklist.json` is used by `--local` and as a
last-resort fallback. Format per the contract:

```json
{
  "processes": [{ "match": "VALORANT-Win64-Shipping.exe", "label": "Valorant" }],
  "titles":    [{ "match": "TikTok", "label": "TikTok" }],
  "browsers":  ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe"]
}
```

- `processes`: exact exe name, case-insensitive → `matchType: "process"`. Wins over titles.
- `titles`: whole-word, case-insensitive match in the window title, **only when the
  foreground process is a browser** → `matchType: "title"`. First entry in list order wins.
- `label` is reported as `app`. Plain strings are accepted too (`"TikTok"` = match and label).
- `browsers`: tracker-only, optional; defaults to Chrome, Edge, Firefox, Brave, Opera, Opera GX,
  Vivaldi, Arc.

## Reporting

Every `reportIntervalSec` (30) it sends `POST /usage` with `Authorization: Bearer <token>`:

```json
{
  "batchId": "b1f2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "sentAt": 1794729570000,
  "idle": false,
  "current": { "app": "TikTok", "matchType": "title" },
  "events": [{ "app": "TikTok", "matchType": "title", "startedAt": 1794729540000, "seconds": 30 }]
}
```

- One event per app + match type in the batch. `startedAt` is when that app's first unreported
  second began. `current` is what's in front now (`null` if nothing blocked, and on shutdown).
- **Heartbeat:** a batch with `events: []` is still sent, so the backend sees the check-in.
- **Offline queue:** a batch with events is written to `queue/<pairing id>/` (atomically) *before* it's sent and
  deleted only after a 2xx. Network errors, timeouts, 408, 429 and 5xx leave it queued; the next
  report sends the queue oldest first, then the new batch. Queued batches survive restarts.
- **No duplicates:** a retry resends the same file, so the same `batchId` (and original `sentAt`);
  the backend ignores ids it already stored. Covered by a test where the backend stores the batch
  but the response is lost.
- Empty heartbeats aren't queued (a replayed check-in means nothing).
- A batch the backend rejects with another 4xx (contract mismatch) is moved to
  `queue/<pairing id>/rejected/`, not deleted, and the rest keep flowing.
- **401/403:** the token is deleted and the tracker exits asking for a new pairing code. The queue
  is kept and sent after re-pairing.
- **Queues are per pairing.** `<pairing id>` is a hash of backend URL + wallet + group. Batches are
  only ever sent with the token of the pairing that recorded them. Re-pairing the same wallet
  (new token) reuses the folder and sends its backlog; pairing the laptop to a *different* wallet
  leaves the old folder untouched (the tracker prints a note) until that wallet pairs here again.

## Token storage

`.tracker_token.json` (gitignored) holds the backend URL, wallet, group, last config and the
token. The token is encrypted with Windows DPAPI (`CryptProtectData`): only the same Windows
user on the same machine can decrypt it. It is never printed or logged. If it can't be
decrypted (copied from another PC, corrupted), the tracker asks to pair again.

## How timing works

- Every `sampleIntervalSec` (2) it reads the foreground window
  (`GetForegroundWindow` + `psutil` process name).
- The time between two samples is credited to the match seen at the earlier sample,
  measured with a monotonic clock (immune to wall-clock changes). The loop sleeps
  to a fixed schedule so it doesn't drift.
- A gap longer than 3 intervals (sleep/hibernate, frozen loop) is capped at 3 intervals.
  Time the tracker itself spends in a slow HTTP call is not capped (it's credited to what was in front).
- Batches report whole seconds; fractions carry over to the next batch, so nothing is lost.
  The `totals` line is rounded to 0.1 s, so it can read `2.0` while the batch says `1`
  (the other 0.99 s goes out in the next batch).
- Lock screen / no window / protected process: counted as not blocked.
- `idle` is `true` when there's been no keyboard/mouse input for `idleThresholdSec` (120)
  (`GetLastInputInfo`). Idle time is **still counted** for now; see Contract status.

## Known limits

- Title matching can't tell a TikTok tab from a Google search for "tiktok"
  (fix: the stretch Chrome extension reading the real URL).
- Only the foreground window counts: a YouTube video playing in a background tab isn't charged.
- Microsoft Store apps show up as `ApplicationFrameHost.exe`.
- Interval changes from `/tracker/config` apply on the next start; blocklist changes apply live.
- Batches queued for a wallet that never pairs on this laptop again stay in its `queue/` folder.

## Contract status

Implemented as written in `docs/contract.md` v0.1: `/pair/complete`, `/tracker/config`, `/usage`
body and headers, error body `{error: {code, message}}`, `{match, label}` blocklist entries,
`matchType`, process-over-title and list-order precedence, ms timestamps.

Remaining differences and assumptions, for Dev 4 (the contract itself is unchanged):

| # | Topic | Contract | Tracker | Needs from Dev 4 |
|---|---|---|---|---|
| 1 | Title matching | case-insensitive substring | case-insensitive **whole word** ("Redditch" ≠ "Reddit") | agree; tracker can switch in one line |
| 2 | Browsers | 4 listed (Chrome, Edge, Firefox, Brave) | optional `browsers` list in the blocklist; default 8 (adds Opera, Opera GX, Vivaldi, Arc) | OK to accept/ignore the extra key |
| 3 | `sentAt` | "sentAt" (meaning not specified) | creation time of the batch; **unchanged on retries**, like `batchId` | confirm |
| 4 | Seconds cap | cap batch seconds at real time since the tracker's previous batch | queued batches from an outage arrive back to back | **blocker:** cap by `sentAt` gaps, not arrival time, or offline usage is cut |
| 5 | Idle | TBD | sends `idle` (no input for `idleThresholdSec`); idle time still counted | decide the rule |
| 6 | Auth errors | not specified | 401/403 = token invalid (re-pair); other 4xx = batch rejected | confirm status codes |
| 7 | `/pair/complete` response | `trackerToken`, `wallet`, `groupId`, `displayName` | `trackerToken`, `wallet`, `groupId` are **required** (wallet + group key the offline queue) | always return them |
| 8 | Pair error codes | `PAIR_CODE_INVALID`, `PAIR_CODE_EXPIRED` | shown to the user as returned; any 4xx ends pairing | none |
| 9 | Config refresh | "every few minutes" | every 5 min; blocklist applies live, interval changes on restart | none |
| 10 | Batch size | not specified | one event per app + match type per batch; an outage backlog is sent as many small requests | none |
| 11 | Localhost | `http://localhost:4000` | Windows tries IPv6 `::1` first; an IPv4-only server costs ~2 s per request | listen on both, or use `127.0.0.1` |

## Privacy

Only blocked matches leave the machine: app label, match type, timestamps and seconds, plus
the device's hostname at pairing. No keystrokes, no browsing history, no window titles
(titles are only printed to the local console).
