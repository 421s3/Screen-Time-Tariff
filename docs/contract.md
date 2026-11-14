# Interface Contract (draft v0.2: title matching is whole-word, blocklist has an optional `browsers` list)

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
  "programId": "6sCrwiknWJUMwJ8By4a9m6LPdSgjxr7YYd6RMexXuF8U",
  "oraclePubkey": "CvdZLhJ6xnD74pSL1iXhGGL32ezL8CvyBFX8THYw7CG7"
}
```

### `POST /groups` (dashboard, `X-Wallet` = creator)
Called **after** the creator's `create_group` transaction confirms.
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
→ `200 { "ok": true }`. Stretch: backend reads the Member PDA to verify instead of trusting the body.

### `GET /groups/:groupId/state` (dashboard, polled every 2–3 s)
Everything the dashboard shows. Full example: [`mock-state.json`](mock-state.json).
```ts
type GroupState = {
  serverTime: number;
  group: {
    groupId: string;
    name: string;
    joinCode: string;
    groupPda: string;
    programId: string;
    status: "upcoming" | "active" | "ended";
    periodStart: number;
    periodEnd: number;
    demoMode: boolean;
    rules: { allowanceMinutes: number; tariffLamportsPerMinute: number };
    blocklist: Blocklist;               // section 5
  };
  members: Member[];
  leaderboard: { wallet: string; displayName: string; blockedMinutes: number; rank: number }[]; // lowest first
  penalties: Penalty[];                 // newest first, max 50
  totals: { stakedLamports: number; paidOutLamports: number };
};

type Member = {
  wallet: string;
  displayName: string;
  stakedLamports: number;               // total deposited
  slashedLamports: number;              // total paid out as penalties
  receivedLamports: number;             // total received from others' penalties (lands in their wallet)
  remainingLamports: number;            // stakedLamports - slashedLamports (withdrawable after period end)
  withdrawn: boolean;
  usage: {
    blockedSeconds: number;             // this period, blocked apps only
    blockedMinutes: number;             // floor(blockedSeconds / 60)
    minutesOver: number;                // max(0, blockedMinutes - allowanceMinutes)
    minutesCharged: number;             // confirmed on-chain so far
    offlineMinutes: number;             // missed check-ins counted against them
    byApp: { app: string; seconds: number }[];  // sorted desc
  };
  current: { app: string; matchType: "process" | "title"; since: number } | null; // null = not on a blocked app
  tracker: { paired: boolean; online: boolean; lastSeenAt: number | null };
};

type Penalty = {
  penaltyId: string;
  wallet: string;                       // who paid
  displayName: string;
  app: string;                          // what they were on; "Tracker offline" for missed check-ins
  minutes: number;
  lamports: number;
  recipients: { wallet: string; displayName: string; lamports: number }[];
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

## 6. Solana program (Dev 2) — placeholders until Dev 2 confirms

Program name: `screen_time_tariff`. Program ID: **TBD after first deploy** (put it here and in every `.env.example`).

### PDAs (seeds)
| Account | Seeds |
|---|---|
| `Group` | `["group", admin_pubkey, group_seed_u64_le]` |
| `Member` | `["member", group_pubkey, member_wallet]` |
| Vault | `["vault", group_pubkey]` (system-owned PDA holding lamports; the program signs for it with these seeds) |

`group_seed` is any `u64` the creator picks (e.g. current unix seconds), so one wallet can create several groups. The backend stores it as a string (`groupSeed`) to avoid JS number precision issues.

### Accounts
```rust
pub struct Group {
    pub admin: Pubkey,
    pub oracle: Pubkey,                  // backend key allowed to slash
    pub seed: u64,
    pub allowance_minutes: u32,
    pub tariff_lamports_per_minute: u64,
    pub period_start: i64,               // unix seconds
    pub period_end: i64,                 // unix seconds
    pub members: Vec<Pubkey>,            // max 8
    pub bump: u8,
    pub vault_bump: u8,
}

pub struct Member {
    pub group: Pubkey,
    pub wallet: Pubkey,
    pub staked: u64,                     // lamports
    pub slashed: u64,                    // lamports, total so far
    pub withdrawn: bool,
    pub bump: u8,
}
```

### Instructions
| Instruction | Signer | Args | Effect |
|---|---|---|---|
| `create_group` | admin | `seed: u64, allowance_minutes: u32, tariff_lamports_per_minute: u64, period_start: i64, period_end: i64, oracle: Pubkey` | Creates `Group` and funds the vault with the rent-exempt minimum so it can exist. |
| `join_and_stake` | member wallet | `lamports: u64` | Creates `Member`, appends wallet to `group.members`, transfers `lamports` wallet → vault. Rejects if group is full or the period has ended. |
| `slash` | **oracle only** | `new_total_slashed: u64` | `delta = min(new_total_slashed, member.staked) - member.slashed`. Rejects if `delta == 0` or `new_total_slashed <= member.slashed`. Splits `delta` evenly across the other members' wallets (passed as `remaining_accounts`, writable, in `group.members` order, offender excluded); any remainder lamport goes to the first recipient. Sets `member.slashed += delta`. Allowed until `period_end + 600` s so final minutes can be charged. |
| `withdraw` | member wallet | — | After `period_end + 600` s: pays `staked - slashed` vault → wallet once, sets `withdrawn = true`. |

The backend computes `new_total_slashed = minutesCharged_after * tariff_lamports_per_minute`, so the program never has to know about minutes. Passing a running total (not a delta) makes retries safe: resending the same value is rejected instead of charging twice.

### Errors (suggested)
`GroupFull`, `PeriodEnded`, `PeriodNotEnded`, `UnauthorizedOracle`, `NothingToSlash`, `WrongRecipients`, `AlreadyWithdrawn`.

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
| `ORACLE_KEYPAIR_PATH` | backend | `./keys/oracle.json` (gitignored) |
| `GEMINI_API_KEY` | backend | — |
| `ENFORCE_OFFLINE` | backend | `false` in development |
