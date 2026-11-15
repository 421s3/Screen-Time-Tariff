// Contract with the backend: docs/contract.md v0.5 (winner-takes-pool, no roasts), section 4,
// GET /groups/:id/state. Matches backend/src/services/state.ts. If a type here changes,
// tell the backend devs. Amounts are lamports, times are unix ms.
//
// Model: each member stakes; minutes over the allowance are charged at the tariff and moved
// into the group's penalty pool; after the period, the staked member(s) with the lowest
// blocked time win the whole pool; then everyone withdraws remaining stake + prize.

export type Blocklist = {
  processes: { match: string; label: string }[]
  titles: { match: string; label: string }[]
  browsers?: string[]
  // Tracker extension (Dev 3): count any Steam-launched game, reported by its folder name.
  // NOT in the contract yet: the backend currently drops this key (ask Dev 4).
  steamGames?: boolean
}

export type Rules = {
  allowanceMinutes: number
  tariffLamportsPerMinute: number
  /** Seconds per charge: 5 = charged every 5 s over, 60 = per full minute. Missing on old backends (= 60). */
  chargeUnitSecs?: number
}

export type ChainMode = 'off' | 'mock' | 'devnet'

export type SettlementStatus = 'pending' | 'sent' | 'confirmed' | 'failed' | 'skipped'

export type Settlement = {
  status: SettlementStatus // skipped = nobody staked
  poolLamports: number
  winners: { wallet: string; displayName: string; prizeLamports: number }[]
  signature: string | null
  explorerUrl: string | null // devnet only
  settledAt: number | null
}

export type Group = {
  groupId: string
  name: string
  joinCode: string
  groupPda: string | null // null only in chainMode "off"
  programId: string | null
  chainMode: ChainMode
  status: 'upcoming' | 'active' | 'ended'
  periodStart: number
  periodEnd: number
  demoMode: boolean
  rules: Rules
  blocklist: Blocklist
  settlement: Settlement | null // null until the period ends and the backend settles
}

export type Member = {
  wallet: string
  displayName: string
  staked: boolean // has an on-chain Member account (can be charged and can win)
  stakedLamports: number // on-chain deposit
  slashedLamports: number // moved into the pool
  receivedLamports: number // prize won at settlement (0 before)
  remainingLamports: number // withdrawable: staked - slashed + received
  withdrawn: boolean
  usage: {
    blockedSeconds: number
    blockedMinutes: number
    minutesOver: number
    minutesCharged: number
    offlineMinutes: number
    byApp: { app: string; seconds: number }[]
  }
  // app is the label the tracker reports, e.g. "Valorant", "TikTok", or a Steam game's
  // folder name like "Team Fortress 2". null = not on a blocked app.
  current: { app: string; matchType: 'process' | 'title'; since: number } | null
  // `idle` is NOT in the contract yet: the tracker sends it on every /usage batch and the
  // backend stores it, but /state doesn't return it. Treated as false when missing.
  tracker: { paired: boolean; online: boolean; lastSeenAt: number | null; idle?: boolean }
}

export type LeaderboardEntry = {
  wallet: string
  displayName: string
  blockedSeconds: number // exact (contract v0.8); blockedMinutes is floored
  blockedMinutes: number
  rank: number
  leading: boolean // would win if the period ended now (after settlement: the actual winners)
}

export type Penalty = {
  penaltyId: string
  wallet: string // who was charged (the SOL goes into the group's pool)
  displayName: string
  app: string // "Tracker offline" for missed check-ins
  minutes: number
  /** Over-allowance seconds this penalty charges for (contract v0.9; older backends only send minutes). */
  seconds?: number
  lamports: number // estimate while pending; the amount actually charged once confirmed
  status: 'pending' | 'sent' | 'confirmed' | 'failed'
  signature: string | null
  explorerUrl: string | null
  createdAt: number
}

export type GroupState = {
  serverTime: number
  group: Group
  members: Member[]
  leaderboard: LeaderboardEntry[] // staked first, then lowest blocked time
  penalties: Penalty[] // newest first, max 50
  totals: { stakedLamports: number; penaltyPoolLamports: number }
}

/** What the Create Group form collects; realApi turns it into the POST /groups body. */
export type CreateGroupInput = {
  name: string
  displayName: string
  allowanceMinutes: number
  tariffLamportsPerMinute: number
  periodMs: number
  demoMode: boolean
  blocklist: Blocklist
}

export const PERIOD_PRESETS: { id: string; label: string; ms: number; demo: boolean }[] = [
  { id: 'demo', label: 'Demo (3 min)', ms: 3 * 60_000, demo: true },
  { id: 'day', label: '1 day', ms: 24 * 60 * 60_000, demo: false },
  { id: 'week', label: '1 week', ms: 7 * 24 * 60 * 60_000, demo: false },
  { id: 'month', label: '1 month (30 days)', ms: 30 * 24 * 60 * 60_000, demo: false },
]
