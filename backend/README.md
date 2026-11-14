# backend/ — API, penalty worker, database (Dev 4)

Node.js + TypeScript + Express, MongoDB Atlas, Anchor TypeScript client.

## Spec

All endpoints and response formats: [`../docs/contract.md`](../docs/contract.md) section 4. The `/state` response must match [`../docs/mock-state.json`](../docs/mock-state.json) exactly, because the dashboard is built against it (`npm run smoke` checks this).

## Run

```
cd backend
npm install
cp .env.example .env      # then fill in MONGODB_URI (get it from the team by DM)
npm run dev               # http://localhost:4000/health → {"ok":true}
```

| Script | Does |
|---|---|
| `npm run dev` | Starts the API and penalty worker; restarts on save |
| `npm run smoke` | End-to-end test of every endpoint and the worker, on a throwaway database (`screen-time-tariff-smoke`) that it drops afterwards |
| `npm run check-db` | Tests the Atlas connection in `.env` |
| `npm run typecheck` | TypeScript check |
| `npm run make-oracle` | Creates `keys/oracle.json` (refuses to overwrite) |

## Status (Checkpoint 1)

| Endpoint | Status |
|---|---|
| `GET /health`, `GET /config` | ✅ |
| `POST /groups`, `POST /groups/join`, `POST /groups/:groupId/stakes` | ✅ `groupPda` optional until the program is deployed |
| `GET /groups/:groupId/state` | ✅ Public (no wallet header), poll every 2–3 s |
| `POST /pair/start`, `POST /pair/complete` | ✅ |
| `GET /tracker/config`, `POST /usage` | ✅ |
| Penalty worker | ✅ Creates `pending` penalties. **Not sent on-chain yet** (CP2) |
| Missed check-ins, Gemini roasts | CP3 |

Notes for teammates:
- **Dashboard auth** is the `X-Wallet: <address>` header, not verified yet.
- **Tracker auth** is `Authorization: Bearer <trackerToken>` from `/pair/complete`.
- **`/usage` caps seconds** at the real time since that tracker's previous batch (+5 s), so a batch can't claim more time than passed. The first batch may report up to 35 s.
- Usage counts toward a period by when the **server receives it**, so laptop clock differences don't matter.
- Penalties only count as charged (`minutesCharged`, `slashedLamports`, `receivedLamports`) once `confirmed`. In CP1 they stay `pending`.
- A member alone in a group is never charged, since there's nobody to pay.

## Layout

```
src/
  index.ts        startup: config → db → server + worker
  app.ts          Express app and error handler
  config.ts       env parsing (zod) and fixed rules
  db.ts           collections and indexes
  types.ts        database document types
  auth.ts         X-Wallet and tracker token middleware
  routes/         meta, groups, pairing, tracker
  services/       state.ts (/state), penalties.ts (penalty math), usage.ts
  worker.ts       runs the penalty engine every WORKER_INTERVAL_SEC
scripts/          smoke.ts, check-db.ts, make-oracle.ts
```

## Oracle keypair

The backend signs `slash` transactions with `keys/oracle.json` (gitignored). The team already has one; get it from Dev 4 instead of making a new one, because the program trusts that specific key. Public key: `E3rfdAa2KxeqEcAb9AnxRPS3XdamFzBVdYF2vzYSSSAy`. Without the file, the backend still runs, but `/config` returns `oraclePubkey: null`. To create a new one: `npm run make-oracle`, then fund it at faucet.solana.com (devnet).
