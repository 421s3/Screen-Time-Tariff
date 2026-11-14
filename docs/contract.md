# Interface Contract (draft v0.4: section 6 is the program as built in `program/`; v0.3: winner-takes-pool. Penalties go into the group's pool; the lowest-screen-time staked member wins it at settlement)

This file is the single source of truth for how the four parts talk to each other. **Build against it, and tell the team before you change it.** Bump the version line when you do.

Owners: API sections → Dev 4. On-chain section → Dev 2. Blocklist/tracker section → Dev 3. Dashboard needs → Dev 1 reviews `/state`.

Status: **draft for CP0 review.** Anything marked `TBD` gets decided at CP0.

---

## 1. Conventions (everyone)

| Thing | Rule |
|---|---|
| SOL amounts | **Integer lamports** everywhere (1 SOL = 1,000,000,000 lamports). Never send SOL as a float. Format to SOL only in the UI. |
| Times in the API | **Unix milliseconds** (`number`), UTC. |
| Times on-chain | Unix **seconds** (`i64`), from Solana's `Clock`. Convert at the boundary (`ms / 1000`). |
| Minutes | Whole minutes, rounded **down** (`Math.floor(seconds / 60)`). |
| Wallets / addresses | Base58 strings. |
| Cluster | `devnet` only. |
| Explorer links | `https://explorer.solana.com/tx/<signature>?cluster=devnet` (addresses: `/address/<pubkey>?cluster=devnet`). |
| JSON field names | `camelCase`. |
| Errors | HTTP 4xx/5xx with body `{ "error": { "code": "SOME_CODE", "message": "Human readable" } }`. |

Example demo values: allowance `1` minute, tariff `10000000` lamports/min (0.01 SOL), stake `500000000` (0.5 SOL), period 15 minutes.

---

## 2. Authentication

| Caller | How | Notes |
|---|---|---|
| Dashboard | Header `X-Wallet: <pubkey>` | **v1: unverified**, good enough to build against. v2 (stretch): user signs a message with Phantom, backend verifies with `tweetnacl` and returns a session token sent as `Authorization: Bearer <session>`. |
| Tracker | Header `Authorization: Bearer <trackerToken>` | Token comes from pairing (section 4). One token per tracker; it identifies the wallet and group. |

---

## 3. Who does what, in order

```
Dashboard                         Backend                    Solana program
─────────                         ───────                    ──────────────
GET /config  ───────────────────▶ programId, oraclePubkey
create_group (user signs) ─────────────────────────────────▶ Group + Vault PDAs
POST /groups {groupPda, ...} ───▶ stores group, returns joinCode
                                                             
(friend) POST /groups/join ─────▶ adds member
join_and_stake (user signs) ───────────────────────────────▶ Member PDA, SOL → vault
POST /groups/:id/stakes {sig} ──▶ records stake (reads chain to verify, stretch)
POST /pair/start ───────────────▶ pairing code

Tracker
───────
POST /pair/complete {code} ─────▶ trackerToken
GET  /tracker/config ───────────▶ blocklist, intervals
POST /usage  (every ~30 s) ─────▶ stores usage
                                  worker: over limit? ──────▶ slash (oracle signs)
                                                             SOL → other members' wallets
Dashboard polls GET /groups/:id/state every 2–3 s
withdraw (user signs, after period end) ───────────────────▶ remaining stake → user
```

---

## 4. HTTP API (Dev 4)

Base URL: `API_URL` env var (e.g. `http://localhost:4000` in development).

### `GET /health`
→ `200 { "ok": true }`

### `GET /config`
Public. Tells the dashboard which program and oracle to use.
```json
{
  "cluster": "devnet",
  "chainMode": "devnet",
  "programId": "GfR8egohvnFsdcLfPEJFccd1an274TVsfPhpWsUR3CGi",
  "oraclePubkey": "E3rfdAa2KxeqEcAb9AnxRPS3XdamFzBVdYF2vzYSSSAy"
}
```
`oraclePubkey` above is the real, funded devnet oracle. `programId` is `null` until `PROGRAM_ID` is set in the backend's `.env`.

`chainMode` is the backend's `CHAIN_MODE`:
- `off`: penalties are calculated and stay `pending`; stakes are self-reported. No chain at all.
- `mock`: an in-memory copy of the program runs inside the backend. `POST /groups` and `/stakes` do `create_group` / `join_and_stake` on the user's behalf, and penalties and settlement get `mock_...` signatures (no Explorer links). For building the dashboard before the program is deployed.
- `devnet`: the real program. The rules below apply.

### `POST /groups` (dashboard, `X-Wallet` = creator)
Called **after** the creator's `create_group` transaction confirms.

- **`devnet` mode:** `groupPda` and `groupSeed` are **required**. The backend checks that `groupPda` is the PDA for (your wallet, `groupSeed`), that the account exists, and that its oracle is the backend's. `allowanceMinutes`, `tariffLamportsPerMinute`, and `periodEnd` are then **taken from the chain** (body values are ignored); `periodStart` only exists off-chain. Errors: `ONCHAIN_GROUP_REQUIRED`, `GROUP_PDA_MISMATCH`, `GROUP_NOT_ON_CHAIN`, `WRONG_ORACLE`.
- **`mock` / `off` mode:** `groupPda`, `groupSeed`, and `createSignature` are optional (in `mock` the backend creates the group on the fake chain).
- `blocklist` is optional; the backend uses the default list from section 5. Blocklist entries may be `{ match, label }` objects or plain strings (label = match).
```json
// request
{
  "name": "Finals Week Survivors",
  "displayName": "Alice",
  "groupPda": "CMx7Jm8hHqbxyKDXMxbeWikjyVrJnUn1LrEnB2bPqxXm",
  "groupSeed": "1794729000",
  "createSignature": "<tx signature>",
  "rules": {
    "allowanceMinutes": 1,
    "tariffLamportsPerMinute": 10000000,
    "periodStart": 1794729000000,
    "periodEnd": 1794729900000,
    "demoMode": true
  },
  "blocklist": { "...": "see section 5" }
}
// 201 response
{ "groupId": "6734f0c2a1b2c3d4e5f60718", "joinCode": "TAX42Z" }
```
`groupId` is the backend's ID (MongoDB ObjectId string). `joinCode` is 6 uppercase letters/digits.

### `POST /groups/join` (dashboard, `X-Wallet` = joiner)
```json
// request
{ "joinCode": "TAX42Z", "displayName": "Bob" }
// 200 response
{ "groupId": "6734f0c2a1b2c3d4e5f60718", "groupPda": "CMx7...", "rules": { ... } }
```
The dashboard then sends `join_and_stake` on-chain.

### `POST /groups/:groupId/stakes` (dashboard, `X-Wallet` = staker)
Called after `join_and_stake` confirms.
```json
{ "lamports": 500000000, "signature": "<tx signature>" }
```
→ `200 { "ok": true }`. In `devnet` and `mock` mode the backend reads the member's on-chain account and records its `deposited` amount; the body's `lamports` is ignored (409 `STAKE_NOT_FOUND` if there's no on-chain stake). Only `off` mode trusts the body.

### `GET /groups/:groupId/state` (dashboard, polled every 2–3 s)
Everything the dashboard shows. Full example: [`mock-state.json`](mock-state.json).
```ts
type GroupState = {
  serverTime: number;
  group: {
    groupId: string;
    name: string;
    joinCode: string;
    groupPda: string | null;            // null only in chainMode "off"
    programId: string | null;           // null until PROGRAM_ID is set
    chainMode: "off" | "mock" | "devnet";
    status: "upcoming" | "active" | "ended";
    periodStart: number;
    periodEnd: number;
    demoMode: boolean;
    rules: { allowanceMinutes: number; tariffLamportsPerMinute: number };
    blocklist: Blocklist;               // section 5
    settlement: Settlement | null;      // null until the period ends and the backend settles
  };
  members: Member[];
  // Staked members first, then lowest blocked time. `leading` = would win if the period ended now
  // (after settlement: the actual winners). Unstaked members never lead.
  leaderboard: { wallet: string; displayName: string; blockedMinutes: number; rank: number; leading: boolean }[];
  penalties: Penalty[];                 // newest first, max 50
  totals: { stakedLamports: number; penaltyPoolLamports: number }; // pool charged so far (after settle: the pool that was paid out)
};

type Settlement = {
  status: "pending" | "sent" | "confirmed" | "failed" | "skipped"; // skipped = nobody staked
  poolLamports: number;
  winners: { wallet: string; displayName: string; prizeLamports: number }[];
  signature: string | null;
  explorerUrl: string | null;           // devnet only
  settledAt: number | null;
};

type Member = {
  wallet: string;
  displayName: string;
  staked: boolean;                      // has an on-chain Member account (can be charged and can win)
  stakedLamports: number;               // on-chain deposit
  slashedLamports: number;              // moved into the pool
  receivedLamports: number;             // prize won at settlement (0 before)
  remainingLamports: number;            // withdrawable: staked - slashed + received
  withdrawn: boolean;
  usage: {
    blockedSeconds: number;             // this period, blocked apps only
    blockedMinutes: number;             // floor(blockedSeconds / 60)
    minutesOver: number;                // max(0, blockedMinutes - allowanceMinutes)
    minutesCharged: number;             // charged on-chain so far
    offlineMinutes: number;             // missed check-ins counted against them
    byApp: { app: string; seconds: number }[];  // sorted desc
  };
  current: { app: string; matchType: "process" | "title"; since: number } | null; // null = not on a blocked app
  tracker: { paired: boolean; online: boolean; lastSeenAt: number | null };
};

type Penalty = {
  penaltyId: string;
  wallet: string;                       // who was charged (the SOL goes into the group's pool)
  displayName: string;
  app: string;                          // what they were on; "Tracker offline" for missed check-ins
  minutes: number;
  lamports: number;                     // estimate while pending; the amount actually charged once confirmed
  status: "pending" | "sent" | "confirmed" | "failed";
  signature: string | null;
  explorerUrl: string | null;
  roast: string | null;                 // Gemini, optional
  createdAt: number;
};
```

### `POST /pair/start` (dashboard, `X-Wallet`)
```json
// request
{ "groupId": "6734f0c2a1b2c3d4e5f60718" }
// 200 response
{ "code": "482913", "expiresAt": 1794730200000 }
```
6 digits, valid for 10 minutes, single use.

### `POST /pair/complete` (tracker, no auth)
```json
// request
{ "code": "482913", "deviceName": "ALICE-LAPTOP" }
// 200 response
{ "trackerToken": "trk_9f8e7d...", "wallet": "H9Rje...", "groupId": "6734f0c2a1b2c3d4e5f60718", "displayName": "Alice" }
```
Errors: `PAIR_CODE_INVALID`, `PAIR_CODE_EXPIRED`.

### `GET /tracker/config` (tracker, Bearer)
```json
{
  "groupId": "6734f0c2a1b2c3d4e5f60718",
  "blocklist": { "...": "section 5" },
  "periodStart": 1794729000000,
  "periodEnd": 1794729900000,
  "sampleIntervalSec": 2,
  "reportIntervalSec": 30,
  "idleThresholdSec": 120
}
```
Tracker re-fetches this every few minutes (or on each report response, stretch).

### `POST /usage` (tracker, Bearer, every ~30 s; also the check-in)
```json
// request
{
  "batchId": "b1f2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d",   // UUID; resend the SAME id on retry
  "sentAt": 1794729570000,
  "idle": false,
  "current": { "app": "TikTok", "matchType": "title" },  // null if not on a blocked app
  "events": [
    { "app": "TikTok", "matchType": "title", "startedAt": 1794729540000, "seconds": 30 }
  ]
}
// 200 response
{ "accepted": true, "duplicate": false }
```
- `events` contains **blocked activity only**. Empty array is fine (still counts as a check-in).
- Backend ignores a `batchId` it has already stored (`duplicate: true`).
- Backend caps total `seconds` in a batch at the real time since that tracker's previous batch (+ a few seconds of slack).
- Usage outside `periodStart`–`periodEnd` is stored but not charged.

### Winner-takes-pool (backend rules)
- Each penalty is sent as `slash(totalMinutesOver)` (cumulative, so resends are harmless). The SOL moves from the member's stake into the group's pool inside the vault; nobody's wallet changes yet.
- Members who haven't staked on-chain can't be charged (nothing to take) and can't win.
- **Winner:** at least 30 s after `periodEnd`, the member(s) **with the lowest `blockedSeconds` among staked members** win the whole pool. Exact ties split it equally; the leftover lamport goes to the lowest public key (same as the program). The backend then calls `settle`.
- After settlement every member calls `withdraw` from the dashboard to get `remainingLamports` back.
- `/state` money fields are synced from the chain by the worker every `WORKER_INTERVAL_SEC` (use 5 for the demo).

### Missed check-ins (backend rule)
During an active period, if a tracker's last `/usage` is older than `OFFLINE_GRACE_SEC` (TBD, e.g. 120), the gap counts as blocked time with app `"Tracker offline"`. Controlled by env `ENFORCE_OFFLINE=true|false` (off in development).

---

## 5. Blocklist format (Dev 3 + Dev 4)

Stored per group, sent to the tracker by `/tracker/config`.
```json
{
  "processes": [
    { "match": "VALORANT-Win64-Shipping.exe", "label": "Valorant" },
    { "match": "League of Legends.exe",       "label": "League of Legends" },
    { "match": "steam.exe",                   "label": "Steam" },
    { "match": "Discord.exe",                 "label": "Discord" }
  ],
  "titles": [
    { "match": "TikTok",    "label": "TikTok" },
    { "match": "YouTube",   "label": "YouTube" },
    { "match": "Reddit",    "label": "Reddit" },
    { "match": "Instagram", "label": "Instagram" },
    { "match": "Twitch",    "label": "Twitch" }
  ],
  "browsers": ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "opera_gx.exe", "vivaldi.exe", "arc.exe"]
}
```
Matching rules (these follow the tracker's implementation in `tracker/blocklist.py`):
- `processes`: case-insensitive **exact** match on the foreground process's file name. `matchType: "process"`.
- `titles`: case-insensitive **whole-word** match on the foreground window title (so "Reddit" doesn't match "Redditch", but "YouTube" matches "YouTube Music"), **only when the process is in `browsers`**. `matchType: "title"`.
- `browsers`: optional. If it's missing, the tracker uses the 8 defaults shown above.
- Process matches win over title matches. First match in list order wins.
- `label` is what gets reported as `app` and shown on the dashboard.
- Idle (no keyboard/mouse input for `idleThresholdSec`) is not counted. TBD at CP0: whether a blocked app playing video in front counts while idle (suggestion: yes for `title` matches, so watching YouTube hands-off still counts).

---

## 6. Solana program (Dev 2)

Program name: `screen_time_tariff`. Anchor 0.31.1. Program ID: **TBD after first deploy** (put it here and in every `.env.example`). IDL: `program/idl/screen_time_tariff.json`.

**Payout model: winner-takes-pool.** `slash` moves a member's penalty from their stake into the group's penalty pool; the SOL stays in the vault. After the period ends the oracle calls `settle` with the winners, who split the pool. Then every member withdraws their unspent stake plus any prize.

Oracle (pass as `oracle` to `create_group`): `E3rfdAa2KxeqEcAb9AnxRPS3XdamFzBVdYF2vzYSSSAy` (devnet, funded, held by the backend).

### PDAs (seeds)
| Account | Seeds |
|---|---|
| `Group` | `["group", admin_pubkey, group_id_u64_le]` |
| `Member` | `["member", group_pubkey, member_wallet]` |
| Vault | `["vault", group_pubkey]` (system-owned PDA holding lamports; the program signs for it with these seeds) |

`group_id` is any `u64` the creator picks (e.g. current unix seconds), so one wallet can create several groups. The backend stores it as a string (`groupSeed`) to avoid JS number precision issues.

### Accounts
```rust
pub struct Group {
    pub admin: Pubkey,
    pub oracle: Pubkey,                  // backend key allowed to slash and settle
    pub group_id: u64,
    pub allowance_minutes: u32,
    pub tariff_lamports_per_min: u64,
    pub period_end: i64,                 // unix seconds
    pub grace_secs: i64,                 // emergency_refund opens at period_end + grace_secs
    pub member_count: u32,               // max 8
    pub total_staked: u64,               // lamports, sum of deposits
    pub penalty_pool: u64,               // lamports slashed so far, held in the vault until settle
    pub settled: bool,
    pub winner_count: u32,
    pub bump: u8,
    pub vault_bump: u8,
}

pub struct Member {
    pub group: Pubkey,
    pub wallet: Pubkey,
    pub deposited: u64,                  // lamports staked
    pub balance: u64,                    // withdrawable: deposited - total_slashed, plus prize after settle
    pub total_slashed: u64,              // lamports moved into the pool
    pub total_received: u64,             // lamports won at settle
    pub minutes_charged: u32,            // cumulative minutes over already charged
    pub withdrawn: bool,
    pub bump: u8,
}
```
There is no `period_start` or member list on-chain. Find members with `getProgramAccounts` filtered on `Member.group`, or from the backend's DB.

### Instructions
| Instruction | Signer | Args | Effect |
|---|---|---|---|
| `create_group` | admin | `group_id: u64, oracle: Pubkey, allowance_minutes: u32, tariff_lamports_per_min: u64, period_end: i64, grace_secs: i64` | Creates `Group` and funds the vault with the rent-exempt minimum. Rejects if `period_end` is in the past or the tariff is 0. |
| `join_and_stake` | member wallet | `amount: u64` | Creates `Member`, transfers `amount` wallet → vault. Rejects if the group is full (8) or the period has ended. |
| `slash` | **oracle only** | `total_minutes_over: u32` | **Cumulative** minutes over the allowance this period. Charges `(total_minutes_over - minutes_charged) * tariff`, capped at `balance`, from `balance` into `penalty_pool`. Resending the same or a lower total is a no-op (succeeds, charges nothing). Allowed until the group is settled. |
| `settle` | **oracle only** | — (remaining accounts: winners' `Member` PDAs, writable, sorted by strictly ascending pubkey) | Once, after `period_end`. Splits `penalty_pool` equally among the winners; the remainder lamports go to the lowest pubkey. Required before anyone can `withdraw`. |
| `withdraw` | member wallet | — | After `settle`, once: pays `balance` vault → wallet. |
| `emergency_refund` | member wallet | — | Only if the group is **not** settled and `now >= period_end + grace_secs`: pays back the original `deposited`, once. |

The backend sends `slash(minutesCharged_after)` with whole minutes (contract §1); the program multiplies by the tariff. Lamports charged = the `Slashed` event's `lamports` field, or the change in `Member.total_slashed`.

**Who wins (backend rule):** at `settle`, winners are the members with the fewest `minutesOver` for the period (ties all win). If nobody was slashed the pool is 0 and `settle` still has to run so members can withdraw.

### Events
`Joined { group, wallet, amount }`, `Slashed { group, wallet, minutes_charged, lamports, total_minutes_over, penalty_pool }`, `Settled { group, winner_count, pool }`, `Withdrawn { group, wallet, amount }`.

### Errors
`Unauthorized`, `InvalidRules`, `ZeroAmount`, `PeriodOver`, `PeriodNotOver`, `GroupFull`, `BadWinners`, `AlreadySettled`, `NotSettled`, `GraceNotOver`, `AlreadyWithdrawn`, `Math`.

### Fallback (if the program isn't ready by ~2 AM)
Backend holds a vault keypair. Members send their stake to it with a plain transfer, and the backend's `slash()` sends plain transfers to the other members. Same API, same dashboard.

---

## 7. Environment variables

See each folder's `.env.example`. Never commit real values or keypair files.

| Var | Used by | Example |
|---|---|---|
| `API_URL` / `VITE_API_URL` | tracker, web | `http://localhost:4000` |
| `PROGRAM_ID` / `VITE_PROGRAM_ID` | backend, web | from section 6 |
| `SOLANA_RPC_URL` / `VITE_SOLANA_RPC_URL` | backend, web | `https://api.devnet.solana.com` |
| `MONGODB_URI` | backend | shared by DM |
| `MONGODB_DB` | backend | `screen-time-tariff` (the default) |
| `ORACLE_KEYPAIR_PATH` | backend | `./keys/oracle.json` (gitignored) |
| `GEMINI_API_KEY` | backend | — |
| `ENFORCE_OFFLINE` | backend | `false` in development |
