# web/CLAUDE.md — Frontend (Developer 1)

This file is for work inside `web/`. The project overview, game rules, architecture, and repo rules are in the root `CLAUDE.md`, and the API/program formats are in `docs/contract.md`. **Those are the source of truth; follow them.** Especially: no AI attribution in commits/PRs/code, never commit `.env`, never push to `main`.

## Game model (team decision: contract v0.5, winner-takes-pool)

- Each member stakes devnet SOL (any amount). Only staked members can be charged and can win.
- The group has an **allowance** (minutes) and a **tariff** (lamports per minute). Each minute of blocked time over the allowance is charged (`slash`) from the member's stake **into the group's penalty pool**.
- The period starts when the group is created and ends at `periodEnd`. There's no Start button.
- About 30 s after the period ends, the backend calls `settle`. The staked member(s) with the **lowest blocked screen time win the whole pool**, and ties split it. Then everyone **withdraws** `remainingLamports` = staked − slashed + prize.
- Missed tracker check-ins count as blocked time ("Tracker offline") when the backend enforces them.

## Team workflow

- Team: 4 developers. I own `web/` only; don't edit `program/`, `backend/`, `tracker/`, or `docs/` (ask the owner).
- My branch is `sh-new` (local branch `frontend` pushes to it). Get work into `main` through PRs. Never push to `main`, never force-push.
- Deadline: Sunday, Nov 15, 2026, 11:00 AM MST. Prefer a working demo over polish.
- Commit after each working piece, with short messages.

## Stack

- Vite + React + TypeScript + Tailwind CSS
- React Router (pages), TanStack Query (fetching + polling every 2 s)
- Framer Motion (mascot popups, winner celebration), Sonner (toasts)
- Solana: `@solana/web3.js` v1 (not `@solana/kit`), `@solana/wallet-adapter-react`, `-react-ui`, `-wallets`; Phantom on devnet only
- `@coral-xyz/anchor` for `create_group` / `join_and_stake` / `withdraw` with Phantom at CP3. The IDL is copied from `program/idl/` into `src/chain/idl/` (program `GfR8egohvnFsdcLfPEJFccd1an274TVsfPhpWsUR3CGi` is deployed to devnet; the backend's `/config` returns it).
- `vite-plugin-node-polyfills` (needed for `Buffer`)
- Explorer links: `https://explorer.solana.com/tx/<signature>?cluster=devnet` (no link for `mock_...` signatures)
- Amounts are stored in lamports (1 SOL = 1_000_000_000); convert only for display.

## Architecture rules

- All data access goes through one `api` interface (`src/api/base.ts`), with two implementations:
  - `mockApi`: a scripted 90-second demo period with 7 members on the pool model. Alice binges TikTok, Bob plays a Steam game, Erin goes idle, Frank's tracker goes offline, and Hana never stakes. Penalties land every 10 s (sent → confirmed). Carol wins the pool when it settles 3 s after the end, then members can withdraw. **Restart demo** in the header reruns it; a page reload also restarts it, since mock state lives in memory.
  - `realApi`: calls the backend per contract v0.5 (`/groups`, `/groups/join`, `/groups/:id/stakes`, `/groups/:id/state`, `/pair/start`). It works against a backend in `CHAIN_MODE=off` or `mock`. Devnet mode also needs the Phantom transactions (CP3), and `withdraw` rejects until then.
  - Selected by `VITE_USE_MOCK=true|false`. Components never call `fetch` directly.
- `src/types.ts` mirrors contract v0.5 / `backend/src/services/state.ts`, plus two fields the tracker needs that the contract doesn't have yet:
  - `blocklist.steamGames?: boolean`. The backend's validation currently drops it; ask Dev 4.
  - `member.tracker.idle?: boolean`. The tracker sends `idle` and the backend stores it, but `/state` doesn't return it yet; ask Dev 4.
- When mock data is on, show a clearly visible "DEMO MODE" badge.
- The app must work end to end without the backend, so a judge can navigate the whole competition with no backend tools.
- Every screen needs loading, empty, error, and wallet-disconnected states.
- Responsive: works at desktop and phone widths.
- The tax-collector mascot ("Tariff Tom") is an original SVG; don't copy existing characters.

## Deliverables

1. Wallet authentication: connect/disconnect Phantom; show address and devnet SOL balance; handle Phantom not installed and rejected transactions.
2. Group management: create a group (name, allowance, tariff, period preset, blocklist chips, **"Count every Steam game" toggle**; `steam.exe` is not in the default list); join with an invite code (max 8, before the period ends); list members and their wallets.
3. Staking: deposit devnet SOL (any amount, can add more); show deposited, paid into the pool, and withdrawable; transaction confirmation with Explorer link.
4. Live dashboard:
   - penalty pool, total staked, countdown, and who would win right now
   - per member: blocked time, usage bar vs. allowance, staked / into pool / balance, top apps
   - **live activity**: "🎮 Playing Team Fortress 2", "🌐 On TikTok", "💤 Idle", "📴 Tracker offline", "🔌 Not paired"
   - leaderboard; polling
5. Penalty feed: who paid how much into the pool, for which app and how many minutes, status, and Explorer link. (No Gemini roasts: removed in contract v0.5.)
6. Results: settlement status, winner(s) and prize, per-member staked / into pool / prize / withdrawable, a withdraw button, and a winner celebration.
7. UI polish: responsive layout, mascot, all states above, labeled demo mode.

## Pages

Landing / Connect Wallet → Create Group → Join Group → Stake → Pair Tracker (shows code) → Group Dashboard (main demo view) → Results (withdraw).

## Checkpoints

- CP1: full dashboard on mock data, wallet connection, navigation between all pages.
- CP2: `realApi` against the running backend (`CHAIN_MODE=mock`): create, join, stake, `/state`, pairing.
- CP3: Phantom transactions via Anchor (`create_group`, `join_and_stake`, `withdraw`) for `CHAIN_MODE=devnet`; real Explorer links.
- CP4: polish, mobile, demo rehearsal, bug fixes.

## Status (update as you go)

- [x] CP1: built and verified on mock data for the **winner-takes-pool** model (all pages and states, DEMO MODE badge, 90 s period with pool penalties, Steam game / idle / offline activity states, settlement + withdraw, Restart demo). Phantom connect + devnet balance confirmed.
- [x] CP2: `realApi` verified against the real backend (Atlas, `CHAIN_MODE=mock`): create, join, stake, pair, `/usage` → penalty → pool, all live on the dashboard. Polls every 2 s (also in background tabs), keeps last data on a failed poll, and shows a Live / Reconnecting pill.
- [ ] CP3: code ready, **not yet tested in a browser with Phantom**. `src/chain/program.ts` (Anchor + Phantom: `create_group`, `join_and_stake`, `withdraw`), wired into `realApi` when the backend's `/config` says `chainMode: devnet`. Note: the program's `join_and_stake` uses `init`, so a wallet can stake only once per group on devnet (UI shows ALREADY_STAKED). The program is deployed and the Railway backend runs in devnet mode, so the full loop (create, stake, pair, penalty, settle, withdraw) is now testable.
- [ ] CP4: polish, mobile, demo rehearsal. Deployed on Vercel (`vercel.json` rewrites for SPA routes); tracker download and pair page done. Remaining: end-to-end devnet test, `failed` settlement / emergency-refund messaging, set `VITE_USE_MOCK=false` and `VITE_API_URL` on Vercel.

## Known gotchas

- `Buffer is not defined` → node polyfills plugin is missing.
- Transactions fail / zero balance → Phantom isn't on devnet.
- Don't poll the public devnet RPC every second (rate limits); poll the backend instead.
- The mock period restarts on every full page reload (in-memory state). During a demo, use the in-app nav links, not the browser's refresh button.
- If the dev server shows unstyled pages after a branch switch, restart `npm run dev` (Tailwind's plugin can drop out when `vite.config.ts` changes under a running server).
