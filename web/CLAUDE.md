# web/CLAUDE.md — Frontend (Developer 1)

This file is for work inside `web/`. The project overview, architecture, and repo rules are in the root `CLAUDE.md`; follow those too (especially: no AI attribution in commits/PRs/code, never commit `.env`, never push to `main`).

## Team workflow

- Team: 4 developers (1 frontend, 3 backend). I own `web/` only; don't edit `program/`, `backend/`, or `tracker/`.
- I work on my own branch (`frontend`). At each checkpoint it merges into the team's integration branch. Never push to `main`, never force-push.
- Deadline: Sunday, Nov 15, 2026, 11:00 AM MST. Prefer a working demo over polish.
- Commit after each working piece, with short messages.

## Stack

- Vite + React + TypeScript + Tailwind CSS
- React Router (pages), TanStack Query (fetching + polling every 3–5 s)
- Framer Motion (mascot, "+0.01 SOL" popups, winner celebration), Sonner (toasts)
- Solana: `@solana/web3.js` v1 (not `@solana/kit`), `@solana/wallet-adapter-react`, `-react-ui`, `-wallets`; Phantom on devnet only
- `@coral-xyz/anchor` to call the program (`join_and_stake`, `withdraw`) once the IDL arrives
- `vite-plugin-node-polyfills` (needed for `Buffer`)
- Import `@solana/wallet-adapter-react-ui/styles.css`
- Explorer links: `https://explorer.solana.com/tx/<signature>?cluster=devnet`
- Amounts are stored in lamports (1 SOL = 1_000_000_000); convert only for display.

## Architecture rules

- All data access goes through one `api` interface (`src/api/`), with two implementations:
  - `mockApi`: simulates a live demo (Alice's usage climbs past her allowance, a penalty with a roast appears every ~20 s, results screen at the end).
  - `realApi`: calls the backend.
  - Selected by `VITE_USE_MOCK=true|false`. Components never call `fetch` directly.
- `src/types.ts` is the contract with the backend. If a type changes, tell me so I can tell the backend devs.
- When mock data is on, show a clearly visible "DEMO MODE" badge.
- The app must work end to end without the backend, so a judge can navigate the whole competition with no backend tools.
- Every screen needs loading, empty, error, and wallet-disconnected states.
- Responsive: works at desktop and phone widths.
- The tax-collector mascot is an original character (own SVG); don't copy existing characters.

## Deliverables

1. Wallet authentication: connect/disconnect Phantom; show address and devnet SOL balance; handle Phantom not installed and rejected transactions.
2. Group management: create a group and configure rules (blocked apps and sites, daily allowance, tariff rate, challenge duration); join with an invite code; list members and their wallet addresses.
3. Staking: deposit devnet SOL; show deposited amount, remaining stake, pending penalties; transaction confirmation with Explorer link.
4. Live dashboard: each member's tracked screen time; currently active app/site; usage bar vs. daily allowance; leaderboard; total penalty pool; remaining stakes; auto-refresh by polling.
5. Penalty feed: who, which app, minutes charged, amount, confirmed transaction link, optional Gemini roast.
6. Challenge results: lowest-screen-time winner, final payouts and refunds, winner celebration animation.
7. UI polish: responsive layout, mascot, all states above, labeled demo mode.

Open question for the team: the root CLAUDE.md says members just withdraw what's left at the end; the deliverables add a "winner" with "payouts." Until the team decides whether the winner gets extra (e.g. the penalty pool), build the results screen so it works either way.

## Pages

Landing / Connect Wallet → Create Group → Join Group → Stake → Pair Tracker (shows code) → Group Dashboard (main demo view) → Challenge Results.

## Checkpoints

- CP1: full dashboard on mock data, wallet connection, navigation between all pages.
- CP2: real group, member, and usage endpoints in `realApi`. Needs from backend: base URL + endpoint list with response shapes.
- CP3: staking via Anchor + Phantom, live penalty feed, settlement results. Needs from the Anchor dev: program ID, IDL JSON, PDA seeds.
- CP4: polish, mobile, demo rehearsal, bug fixes.

## Status (update as you go)

- [ ] CP1: built and verified on mock data (all pages, states, DEMO MODE badge, live penalty popup, phone width). Remaining: confirm Phantom connect + devnet balance in a browser with Phantom, then tick.
- [ ] CP2
- [ ] CP3
- [ ] CP4

## Known gotchas

- `Buffer is not defined` → node polyfills plugin is missing.
- Transactions fail / zero balance → Phantom isn't on devnet.
- Don't poll the public devnet RPC every second (rate limits); poll the backend instead.
