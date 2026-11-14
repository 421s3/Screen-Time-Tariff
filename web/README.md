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

With `VITE_USE_MOCK=true` (the default) the whole app runs on simulated data and shows a **DEMO MODE** badge. No backend is needed: a scripted 90-second race (6 members, lowest screen time wins the 3 SOL pot) starts on page load, and **Restart demo** in the header runs it again. Set `VITE_USE_MOCK=false` and `VITE_API_URL` to use the real backend.

The game: everyone pays the same entry stake, blocked-app time adds up over the session, and the lowest total at the end wins the whole pot (ties split it). See [`MECHANIC_CHANGE.md`](MECHANIC_CHANGE.md) for how this differs from `docs/contract.md`.

Other scripts: `npm run build` (type-check + production build), `npm run preview`, `npm run lint`.

## Build against

- [`../docs/contract.md`](../docs/contract.md) — API formats (section 4) and the program's instructions (section 6)
- `src/types.ts` — the new `/state` shape (winner-takes-all). `docs/mock-state.json` is the old tariff shape and is no longer used by the mock.

## Layout

- `src/types.ts` — the `/state` contract types. Tell the backend devs before changing them.
- `src/api/` — the only data access: `mockApi` (simulated live demo) and `realApi` (backend), picked by `VITE_USE_MOCK`.
- `src/pages/` — Landing, Create, Join, Stake, Pair tracker, Dashboard, Results.
- `src/components/` — layout, mascot (Tariff Tom), rank-change feed, shared states (loading/empty/error/disconnected).
