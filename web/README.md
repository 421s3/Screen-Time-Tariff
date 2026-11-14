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

With `VITE_USE_MOCK=true` (the default) the whole app runs on simulated data and shows a **DEMO MODE** badge. No backend is needed. Set `VITE_USE_MOCK=false` and `VITE_API_URL` to use the real backend.

Other scripts: `npm run build` (type-check + production build), `npm run preview`, `npm run lint`.

## Build against

- [`../docs/contract.md`](../docs/contract.md) — API formats (section 4) and the program's instructions (section 6)
- [`../docs/mock-state.json`](../docs/mock-state.json) — a full `/state` response. `src/api/mockApi.ts` loads it until the backend is up.

## Layout

- `src/types.ts` — the `/state` contract types. Tell the backend devs before changing them.
- `src/api/` — the only data access: `mockApi` (simulated live demo) and `realApi` (backend), picked by `VITE_USE_MOCK`.
- `src/pages/` — Landing, Create, Join, Stake, Pair tracker, Dashboard, Results.
- `src/components/` — layout, mascot (Tariff Tom), penalty feed, shared states (loading/empty/error/disconnected).
