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
| `npm run smoke` | End-to-end test of every endpoint, the worker, slashing, and settlement (on the in-memory chain), using a throwaway database it drops afterwards |
| `npm run devnet-e2e` | **After the program is deployed:** the full money loop on real devnet (create group, stake, slash, settle, withdraw). Costs the oracle ~0.12 devnet SOL |
| `npm run sync-idl` | Copies the program's IDL from `../program/idl/` into `src/chain/idl/` after the program changes |
| `npm run check-db` | Tests the Atlas connection in `.env` |
| `npm run typecheck` | TypeScript check |
| `npm run make-oracle` | Creates `keys/oracle.json` (refuses to overwrite) |

## Chain modes (`CHAIN_MODE` in `.env`)

| Mode | Use it for | What happens |
|---|---|---|
| `off` | Nothing on-chain | Penalties are calculated and stay `pending`; stakes are self-reported |
| `mock` (default in `.env.example`) | Building and testing **until the dashboard signs Phantom transactions** | An in-memory copy of the program's rules (`src/chain/fakeChain.ts`). `POST /groups` and `/stakes` create the group and stake on the user's behalf; slashes and settlement get `mock_…` signatures. Rebuilt from MongoDB on restart, so redeploys keep working |
| `devnet` | The real thing | Xayden's program via Anchor (deployed). Needs `PROGRAM_ID`, the funded oracle key, and the dashboard creating groups and staking on-chain |

## Status (Checkpoint 4)

| Piece | Status |
|---|---|
| All CP1 endpoints | ✅ |
| `slash` sent for each new penalty | ✅ **Passed on real devnet** (`npm run devnet-e2e`: create, stake, slash, settle, withdraw) |
| Works with the real tracker | ✅ Justin's tracker (`--fake`) → usage, live current app, penalty, offline detection |
| Deployable | ✅ `Dockerfile`, `ORACLE_SECRET_KEY` env var, mock chain survives restarts. See **Deploy** below |
| On-chain balances synced into `/state` | ✅ every worker tick |
| Settlement after the period ends | ✅ lowest blocked time among staked members wins; ties split |
| Settle window | ✅ settles before `periodEnd + grace_secs`; after that it's marked `failed` and members use `emergency_refund`. `autoSettle: false` groups (refund demo) are never settled |
| Stakes verified on-chain | ✅ in `mock` and `devnet` |
| Missed check-ins | ✅ with `ENFORCE_OFFLINE=true`: silence beyond `OFFLINE_GRACE_SEC` (120 s) counts as "Tracker offline" blocked time for staked members |

Notes for teammates:
- **Dashboard auth** is the `X-Wallet: <address>` header, not verified yet.
- **Tracker auth** is `Authorization: Bearer <trackerToken>` from `/pair/complete`.
- **`/usage` budget:** a tracker can never report more seconds in total than have passed since it was paired (+30 s). Batches saved during an outage and resent back-to-back are fine.
- Usage counts toward a period by when the **server receives it**, so laptop clock differences don't matter.
- **Winner-takes-pool:** a penalty moves SOL from the member's stake into the group's pool; nobody's wallet changes until `settle` and `withdraw`. Members who never staked can't be charged or win.
- **Dashboard in `devnet` mode:** create the group on-chain first (oracle `E3rfdAa2KxeqEcAb9AnxRPS3XdamFzBVdYF2vzYSSSAy`), then `POST /groups` with `groupPda` + `groupSeed`. Members `join_and_stake` on-chain, then `POST /groups/:id/stakes`. After settlement, members sign `withdraw` themselves.
- `/state` money is as fresh as the worker (`WORKER_INTERVAL_SEC`).

## Deploy (Railway, recommended)

Railway keeps the server running all the time, which matters: the worker has to keep slashing and settling. Free hosts that sleep when idle (like Render's free plan) would stop it and miss the settle window.

1. railway.com → sign in with GitHub → **New Project → Deploy from GitHub repo** → pick this repo.
2. In the service's **Settings**: **Root Directory** = `backend`. Railway builds from `backend/Dockerfile`. Set the health check path to `/health`.
3. In **Variables**, add:

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | the Atlas connection string (same as your `.env`) |
   | `CHAIN_MODE` | `mock` until the dashboard signs Phantom transactions, then `devnet` |
   | `PROGRAM_ID` | `GfR8egohvnFsdcLfPEJFccd1an274TVsfPhpWsUR3CGi` |
   | `ORACLE_SECRET_KEY` | the **contents** of `keys/oracle.json` (the `[12,34,…]` array). Private: only paste it into Railway |
   | `ENFORCE_OFFLINE` | `true` for the demo |
   | `WORKER_INTERVAL_SEC` | `5` |
   | `SOLANA_RPC_URL` | `https://api.devnet.solana.com` (or a free Helius/QuickNode devnet URL if the public one rate-limits) |

   Don't set `PORT`; Railway provides it.
4. **Settings → Networking → Generate Domain.** You get `https://<name>.up.railway.app`.
5. Check `https://<name>.up.railway.app/config`: it should show the right `chainMode` and `oraclePubkey`.
6. Share the URL: Justin's tracker uses it as `API_URL` (in `tracker/.env` or `--api-url`), and the dashboard as `VITE_API_URL`.

Railway redeploys on every push to `main`. Logs are under **Deployments → View logs** (look for `[worker]` lines).

**Fallback, this laptop + ngrok:** `npm start` here, then `ngrok http 4000` and share the `https://…ngrok-free.app` URL. The laptop must stay on and awake. **Other hosts (Vultr VM, Fly, Render paid):** anything that runs the `Dockerfile` with the variables above works.

## Demo checklist

- [ ] `ENFORCE_OFFLINE=true` and `WORKER_INTERVAL_SEC=5` on the host.
- [ ] `CHAIN_MODE=devnet` once the dashboard creates groups and stakes with Phantom; until then `mock`.
- [ ] Demo groups: `grace_secs = 600`, period ending during the pitch (3–15 min out). Refund-demo group: `autoSettle: false`.
- [ ] **Pair every tracker before the period starts** (the gap from `periodStart` to the first check-in counts as offline).
- [ ] Oracle has devnet SOL (`/config` shows the key; check it on Explorer). ~0.000005 SOL per transaction.
- [ ] `/config` on the hosted URL shows the expected `chainMode`, `programId`, and `oraclePubkey`.

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
  chain/          Chain interface, anchorChain.ts (real), fakeChain.ts (mock), pda.ts, idl/ (copied from program/)
  services/       state.ts (/state), penalties.ts (penalty math), chainSync.ts (sync + slash),
                  settlement.ts (winner + settle), offline.ts (missed check-ins), usage.ts
  worker.ts       each tick: penalties → sync + slash → settle
scripts/          smoke.ts, check-db.ts, make-oracle.ts
```

## Oracle keypair

The backend signs `slash` and `settle` with the oracle key: `ORACLE_SECRET_KEY` (env var, used on hosts) if set, otherwise `keys/oracle.json` (gitignored). The team already has one; get it from Dev 4 instead of making a new one, because every group trusts that specific key. Public key: `E3rfdAa2KxeqEcAb9AnxRPS3XdamFzBVdYF2vzYSSSAy`. Without it the backend still runs, but `/config` returns `oraclePubkey: null` and `devnet` mode won't start. To create a new one: `npm run make-oracle`, then fund it at faucet.solana.com (devnet). It's a devnet-only key: never use it with real SOL.
