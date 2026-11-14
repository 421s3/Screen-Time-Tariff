# web/ — Dashboard (Dev 1)

Vite + React + TypeScript + Tailwind + Solana wallet adapter (Phantom, devnet only).

## Run

Needs Node.js 20+ and, to connect a wallet, the Phantom extension set to **Solana Devnet**.

```
cd web
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:5173.

With `VITE_USE_MOCK=true` (the default) the whole app runs on simulated data and shows a **DEMO MODE** badge. No backend is needed: a scripted 90-second period starts on page load (penalties flow into the pool, then the lowest screen time wins it), and **Restart demo** in the header runs it again. Set `VITE_USE_MOCK=false` and `VITE_API_URL` to use the real backend (works with `CHAIN_MODE=off` or `mock` today).

The game (contract v0.5, winner-takes-pool): members stake SOL; every minute over the allowance is charged at the tariff into the group's pool; when the period ends, the staked member with the lowest blocked time wins the whole pool (ties split it), and everyone withdraws what's left plus any prize.

Other scripts: `npm run build` (type-check + production build), `npm run preview`, `npm run lint`.

## Build against

- [`../docs/contract.md`](../docs/contract.md) — API formats (section 4) and the program's instructions (section 6)
- [`../docs/mock-state.json`](../docs/mock-state.json) — a sample `/state` response (`src/types.ts` mirrors it, plus `blocklist.steamGames` and `tracker.idle`, which the backend doesn't send yet)

## Layout

- `src/types.ts` — the `/state` contract types. Tell the backend devs before changing them.
- `src/api/` — the only data access: `mockApi` (simulated live demo) and `realApi` (backend), picked by `VITE_USE_MOCK`.
- `src/pages/` — Landing, Create, Join, Stake, Pair tracker, Dashboard, Results.
- `src/components/` — layout, mascot (Tariff Tom), penalty feed, live activity badge, shared states (loading/empty/error/disconnected).
