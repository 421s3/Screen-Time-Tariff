# Mechanic change: winner-takes-all pot (replaces per-minute tariffs)

Written by the frontend dev on Nov 14. The dashboard (`web/`) already uses this model on mock data. `docs/contract.md`, `program/`, and `backend/` still describe the tariff model; their owners decide how to update them.

## The new rules

- Everyone pays the **same fixed entry stake**, set by the creator. Pot = stake × staked members.
- **2–8** staked members. The creator presses **Start**. Joining and staking close at start, and anyone who didn't stake isn't in the race.
- Session presets: **demo (90 s), day, week, month** (30 days).
- Blocked-app time **accumulates**. No allowance, no per-minute charges, no slashing.
- Missed tracker check-ins **count as screen time** (`"Tracker offline"`), same as the old plan's rule.
- At the end, **lowest total seconds wins the whole pot**. Ties split it evenly, with the leftover lamport going to the first winner.

## `/state` contract changes (`web/src/types.ts` vs `docs/contract.md` §4)

**Removed**
- `group.rules.allowanceMinutes`, `group.rules.tariffLamportsPerMinute`
- `Member.slashedLamports`, `Member.receivedLamports`, `Member.remainingLamports`
- `Member.usage.blockedMinutes`, `minutesOver`, `minutesCharged`
- `GroupState.leaderboard` (folded into `Member.rank`)
- `GroupState.penalties` and the `Penalty` type
- `totals.paidOutLamports`

**Changed**
- `group.rules` → `{ stakeLamports, sessionPreset: 'demo'|'day'|'week'|'month', sessionMs, maxMembers }`
- `group.status` → `'upcoming' | 'active' | 'ended' | 'settled'`
- `group.periodStart`, `group.periodEnd` → `number | null` (null until Start)
- `Member.usage` → `{ totalSeconds, blockedSeconds, offlineSeconds, byApp }`, where `totalSeconds = blockedSeconds + offlineSeconds` is what's ranked
- `totals` → `{ potLamports, stakedMembers }`
- `members` sorted by rank (lowest time first), unstaked members last

**Added**
- `group.creatorWallet: string`
- `Member.joinedAt: number`, `Member.staked: boolean`, `Member.rank: number | null` (competition ranking 1, 1, 3; null = not in the race)
- `GroupState.events: RankEvent[]` (newest first, max 50):
  `{ eventId, kind: 'session_started'|'took_lead'|'passed'|'session_ended', wallet, displayName, otherWallet, otherDisplayName, newRank, roast, createdAt }`
- `GroupState.result: { winners: { wallet, displayName, payoutLamports }[], potLamports, signature, explorerUrl, settledAt } | null`, set once settled

**Requests the dashboard sends**
- `POST /groups` body: `{ name, displayName, stakeLamports, sessionPreset, blocklist, groupPda, groupSeed, createSignature }` (no allowance or tariff)
- `POST /groups/join`: unchanged; rejected after start or when the group is full
- `POST /groups/:id/stakes`: `{ signature }` (amount is the group's fixed stake)
- **New** `POST /groups/:id/start` (creator only, at least 2 staked): sets `periodStart`/`periodEnd`

## Message for the team (paste into Discord)

> **Heads up: game mechanic changed to winner-takes-all.** The frontend is already switched over (mock data, `web/` on the `frontend` branch). Full details are in `web/MECHANIC_CHANGE.md`.
>
> **New rules:** everyone pays the same fixed entry stake (creator sets it). 2–8 members. The creator presses Start, and joining closes then. Screen time just accumulates over the session (presets: 90 s demo / 1 day / 1 week / 1 month). Lowest total wins the whole pot; ties split it evenly. Missed check-ins still count as screen time. No per-minute charges anymore.
>
> **Anchor program (Dev 2):**
> - Remove `slash`. Remove `allowance_minutes` and `tariff_lamports_per_minute` from `Group`. Add `stake_lamports`, `session_seconds`, `started: bool`, `settled: bool`. `period_start`/`period_end` are set at start.
> - `create_group(seed, stake_lamports, session_seconds, oracle)`.
> - `join_and_stake()`: transfers exactly `stake_lamports`. Rejected after start or when 8 members.
> - New `start_session()`: admin only, needs ≥ 2 members; sets `period_start = now`, `period_end = now + session_seconds`.
> - New `settle(winners: Vec<Pubkey>)`: oracle only, after `period_end`, once. Pays the whole vault (minus rent) split evenly across `winners` (remainder to the first). Winners must be group members, passed as writable `remaining_accounts`.
> - `withdraw` goes away (or becomes a refund path only if a session is cancelled before start).
> - The trust story still holds: the oracle can only pick winners from the group's members; it can't send funds anywhere else.
>
> **Backend (Dev 4):**
> - Drop the penalty engine and per-minute charges. Keep usage ingestion, idle handling, and missed check-ins (they add to `offlineSeconds`).
> - `/state` returns the new shape: `totalSeconds`/`blockedSeconds`/`offlineSeconds`, `rank`, `events` (rank changes; Gemini roasts on lead changes), `totals.potLamports`, `result`.
> - New `POST /groups/:id/start` (calls or verifies `start_session`). At `period_end`, compute the winner(s) by lowest `totalSeconds` and send `settle` with the winner list, then fill `result` with the signature.
> - Please update `docs/contract.md` §4 and §6. `web/src/types.ts` has the exact shapes the dashboard reads.
>
> **Tracker (Dev 3):** no change. Keep reporting `/usage` batches; the backend sums them.
