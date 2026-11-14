# web/CLAUDE.md — Frontend (Developer 1)

This file is for work inside `web/`. The project overview, architecture, and repo rules are in the root `CLAUDE.md`; follow those too (especially: no AI attribution in commits/PRs/code, never commit `.env`, never push to `main`).

## Game mechanic (changed Nov 14; replaces per-minute tariffs)

- Everyone in a group pays the **same fixed entry stake**, set by the creator. Pot = stake × staked members.
- Groups have **2–8 staked members**. The creator presses **Start**. Joining and staking close at start, and members who didn't stake sit it out.
- Session length is a preset: **Demo (90 s), 1 day, 1 week, 1 month**.
- Time on blocked apps and sites just **accumulates**. There are **no per-minute penalties**, no allowance, and no slashing.
- Missed tracker check-ins **count as screen time** ("Tracker offline").
- At the end, the **lowest total screen time wins the whole pot**. Ties split it evenly, with any leftover lamport going to the first winner. Ranking uses seconds.

The root `CLAUDE.md` and `docs/contract.md` still describe the old tariff model. `web/MECHANIC_CHANGE.md` lists the contract changes and has a message for the Anchor and backend devs. Don't edit their folders.

## Team workflow

- Team: 4 developers (1 frontend, 3 backend). I own `web/` only; don't edit `program/`, `backend/`, or `tracker/`.
- I work on my own branch, which merges into `main` via PRs at each checkpoint. Per the root rules it should be named `sh-<name>` (currently `frontend`). Never push to `main`, never force-push.
- Deadline: Sunday, Nov 15, 2026, 11:00 AM MST. Prefer a working demo over polish.
- Commit after each working piece, with short messages.

## Stack

- Vite + React + TypeScript + Tailwind CSS
- React Router (pages), TanStack Query (fetching + polling every 3 s)
- Framer Motion (mascot popups, rank animations, winner celebration), Sonner (toasts)
- Solana: `@solana/web3.js` v1 (not `@solana/kit`), `@solana/wallet-adapter-react`, `-react-ui`, `-wallets`; Phantom on devnet only
- `@coral-xyz/anchor` to call the program (`join_and_stake`, `start_session`, `settle`) once the IDL arrives (not installed yet)
- `vite-plugin-node-polyfills` (needed for `Buffer`)
- Explorer links: `https://explorer.solana.com/tx/<signature>?cluster=devnet`
- Amounts are stored in lamports (1 SOL = 1_000_000_000); convert only for display.

## Architecture rules

- All data access goes through one `api` interface (`src/api/base.ts`), with two implementations:
  - `mockApi`: a scripted 90-second race with 6 members. Alice leads early, Carol takes over after Alice's TikTok binge, and Bob wins. Frank's tracker goes offline mid-session. The race auto-starts on page load, settles about 2 s after the end, and has a **Restart demo** button in the header. A page reload also restarts it, since mock state lives in memory.
  - `realApi`: calls the backend. Only `getState` is real so far; the other calls reject with "arrives at CP2/CP3."
  - Selected by `VITE_USE_MOCK=true|false`. Components never call `fetch` directly.
- `src/types.ts` is the contract with the backend. If a type changes, update `web/MECHANIC_CHANGE.md` and tell the backend devs.
- When mock data is on, show a clearly visible "DEMO MODE" badge.
- The app must work end to end without the backend, so a judge can navigate the whole competition with no backend tools.
- Every screen needs loading, empty, error, and wallet-disconnected states.
- Responsive: works at desktop and phone widths.
- The tax-collector mascot ("Tariff Tom") is an original SVG; don't copy existing characters.

## Deliverables

1. Wallet authentication: connect/disconnect Phantom; show address and devnet SOL balance; handle Phantom not installed and rejected transactions.
2. Group management: create a group (name, fixed entry stake, session preset, blocklist); join with an invite code while the group is upcoming (max 8); list members and their wallet addresses; creator presses Start (needs at least 2 staked).
3. Staking: pay the fixed entry stake before start; show the stake, pot, and staked-member count; transaction confirmation with Explorer link.
4. Live dashboard: pot size; status and countdown; each member's live rank (crown on #1), total screen time, relative time bar, currently active app/site, tracker status, and offline time; unstaked members greyed out; auto-refresh by polling.
5. Rank-change feed: session started, "X took 1st place from Y" (with an optional Gemini roast and a mascot popup), "X passed Y for 2nd", and session ended.
6. Results: winner(s) and payout (whole pot, or an even split on ties), final standings with screen time and payouts, settle transaction link, and winner celebration.
7. UI polish: responsive layout, mascot, all states above, labeled demo mode.

## Pages

Landing / Connect Wallet → Create Group → Join Group → Stake → Pair Tracker (shows code) → Group Dashboard (main demo view; Start button) → Results.

## Checkpoints

- CP1: full dashboard on mock data, wallet connection, navigation between all pages.
- CP2: real `/state`, create, join, start, and pairing endpoints in `realApi`. Needs from backend: base URL + endpoint list with response shapes matching `src/types.ts`.
- CP3: staking and settle via Anchor + Phantom, live rank feed, results from the on-chain payout. Needs from the Anchor dev: program ID, IDL JSON, PDA seeds.
- CP4: polish, mobile, demo rehearsal, bug fixes.

## Status (update as you go)

- [ ] CP1: built and verified on mock data for the **new winner-takes-all mechanic** (all pages, states, DEMO MODE badge, 90 s race with lead changes, offline time, settled winner, Restart demo, phone width). Remaining: confirm Phantom connect + devnet balance in a browser with Phantom, then tick.
- [ ] CP2
- [ ] CP3
- [ ] CP4

## Known gotchas

- `Buffer is not defined` → node polyfills plugin is missing.
- Transactions fail / zero balance → Phantom isn't on devnet.
- Don't poll the public devnet RPC every second (rate limits); poll the backend instead.
- The mock race restarts on every full page reload (in-memory state). Use the in-app nav links during a demo, not the browser's refresh button.
