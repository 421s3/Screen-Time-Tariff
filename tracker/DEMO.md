# Tracker demo procedure (3 minutes)

Two laptops on the projector: **Alice** (plays) and **Bob** (watches the dashboard). Both are in
one group with demo mode on (1-minute allowance, 0.01 SOL/min), staked, and paired.

## Before judging (at least 30 min ahead)

On **Alice's** laptop:

1. `ScreenTimeTariff.exe` (desktop app) in `C:\ScreenTimeTariff\`. Built with the Railway/Vercel URLs, or
   set them in **Settings…**.
2. Pair it with a fresh dashboard code. The window should say **Tracking · connected**.
3. Install one light Steam game that starts in under 10 s (e.g. Aim Lab or a small free game).
   Launch it once ahead of time so shaders and updates are done.
4. Run `ScreenTimeTariffTracker.exe --scan --games-only` with the game open: the game must show
   `TRACKED [<Game>/process]`, and `steam.exe` must show `ok`.
5. Close the game. Leave the app window visible on the side (its **Now:** line shows the game).
6. Check the dashboard shows Alice's tracker online.
7. Turn off sleep and screen lock for the demo (Settings → Power), and silence notifications.

Backups: the `--fake` run below, and the recorded video.

## Script

| Time | Who | Action | What the audience sees |
|---|---|---|---|
| 0:00–0:30 | presenter | Problem + pitch | — |
| 0:30–0:50 | Bob | Show group, stakes on Explorer, blocklist (Valorant, League, Steam games) | dashboard |
| 0:50–1:00 | Alice | Launch the Steam game from Steam | Steam client in front: tracker console says `ok` (the launcher isn't gameplay) |
| 1:00–2:10 | Alice | Play | console: `TRACKED [<Game>/process]`; dashboard: Alice "🎮 <Game>", usage bar fills, limit passes, **penalty lands**, Bob's screen shows "+0.01 SOL" and the roast |
| 2:10–2:25 | Alice | Alt+Tab to the desktop, then back | console switches to `ok`, then back to `TRACKED`; the bar pauses |
| 2:25–2:30 | Alice | Minimize the game | console `(no foreground window)`: a minimized game isn't charged |
| 2:30–3:00 | presenter | Trust and next steps; click a penalty through to Explorer | Explorer |

Reports go out every second and the dashboard refreshes every second, so usage bars move live; the
penalty worker runs every `WORKER_INTERVAL_SEC` (5–30 s), so a penalty lands within that after the limit is crossed. Start playing by 1:00.

## If something breaks

| Problem | Do this |
|---|---|
| Game won't start / too slow | Keep talking. Run `ScreenTimeTariffTracker.exe --fake` and **say "this is synthetic usage"**. It plays Valorant, then Team Fortress 2, then idle, every 30 s. Its console says `SYNTHETIC MODE`. |
| Tracker shows `offline (...)` | Usage is queued and sent when the network is back. Show the queue count in the console; switch to the hotspot. |
| Tracker says the token was rejected | `ScreenTimeTariffTracker.exe --pair <new code>` from the dashboard. Queued usage is kept. |
| `Another tracker is already running` | One is already running (maybe from sign-in). Use that window, or close it first. |
| Backend down | Play the recorded video. |

## Judge questions

- **"Can't I just close it?"** Missed check-ins count as over the limit (backend rule), and closing
  the window first saves unsent minutes to disk, which are sent on the next start.
- **"Does it touch the game? Anti-cheat?"** No. It only asks Windows which window is in front
  and the name of its program, every second. No injection, no memory reads.
- **"What if I leave the game running and walk away?"** No keyboard, mouse or controller input for
  2 minutes stops game time. Minimized or locked doesn't count either.
- **"What does it send?"** Game name, seconds, timestamps. Never window titles, keystrokes or history.
