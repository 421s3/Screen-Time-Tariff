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
| `mock` (default in `.env.example`) | Building and demoing **before the program is deployed** | An in-memory copy of the program's rules (`src/chain/fakeChain.ts`). `POST /groups` and `/stakes` create the group and stake on the user's behalf; slashes and settlement get `mock_…` signatures. Resets when the server restarts |
| `devnet` | The real thing | Xayden's program via Anchor. Needs `PROGRAM_ID`, the funded oracle key, and the dashboard creating groups and staking on-chain |

## Penalty precision (`PENALTY_PRECISION`)

- `seconds` (default): usage and the allowance are compared in seconds. The cumulative charge for the
  period is `floor(secondsOver × tariffLamportsPerMinute / 60)` lamports, capped at the stake; each worker
  tick charges only the unpaid difference (one `slash` per member per tick, never one per second).
  `rules.allowanceSeconds` (optional, e.g. `30`) sets a finer allowance; `allowanceMinutes` still works.
- `minutes`: the previous behaviour, `floor(seconds / 60) − allowanceMinutes` whole minutes.
- `CHAIN_MODE=devnet` always uses `minutes`: the program's `slash(total_minutes_over)` and
  `allowance_minutes` are whole minutes. Seconds work in `off` and `mock` (FakeChain has `slashToLamports`).
- `/state` keeps the same keys. In seconds mode `rules.allowanceMinutes`, `usage.minutesOver`,
  `usage.minutesCharged` and `penalty.minutes` can be fractional (2 decimals, display only); lamports are exact.

### For Dev 2 (program): to charge by the second on devnet

Add a cumulative, lamport-based slash next to the current one (same oracle check, same "only the
difference" rule, so resends stay harmless):

```rust
pub fn slash_lamports(ctx: Context<Slash>, total_lamports_owed: u64) -> Result<()> {
    let m = &mut ctx.accounts.member;
    let delta = total_lamports_owed.saturating_sub(m.total_slashed);
    let amount = delta.min(m.balance);
    m.balance -= amount;
    m.total_slashed += amount;
    ctx.accounts.group.penalty_pool += amount;
    // emit the same Slashed event with lamports = amount
    Ok(())
}
```

Optional: `allowance_seconds: u32` on `Group` (today the backend keeps sub-minute allowances off-chain).
Then `AnchorChain.slashToLamports` calls it, and devnet gets second precision with no other backend change.
Dev 1: the dashboard can show fractional minutes (e.g. "0.32 min") or convert `minutes × 60` to seconds.

## Status (Checkpoint 3)

| Piece | Status |
|---|---|
| All CP1 endpoints | ✅ |
| `slash` sent for each new penalty | ✅ Tested on the mock chain; the real Anchor path builds correct transactions against devnet but **can't be sent until the program is deployed** |
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
- `/state` money is as fresh as the worker. Set `WORKER_INTERVAL_SEC=5` for the demo.
- **For the demo:** `ENFORCE_OFFLINE=true`, and **pair every tracker before the period starts** (the gap from `periodStart` to the first check-in counts). Create groups with `grace_secs = 600`.

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

The backend signs `slash` transactions with `keys/oracle.json` (gitignored). The team already has one; get it from Dev 4 instead of making a new one, because the program trusts that specific key. Public key: `E3rfdAa2KxeqEcAb9AnxRPS3XdamFzBVdYF2vzYSSSAy`. Without the file, the backend still runs, but `/config` returns `oraclePubkey: null`. To create a new one: `npm run make-oracle`, then fund it at faucet.solana.com (devnet).
