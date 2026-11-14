// Contract with the backend for GET /groups/:id/state.
// MECHANIC: everyone pays the same entry stake; lowest total screen time at the end
// of the session takes the whole pot (ties split it). See web/MECHANIC_CHANGE.md for
// the diff against docs/contract.md. Amounts are lamports, times are unix ms.

export type Blocklist = {
  processes: { match: string; label: string }[]
  titles: { match: string; label: string }[]
}

export type SessionPreset = 'demo' | 'day' | 'week' | 'month'

export type Rules = {
  stakeLamports: number // fixed entry stake, same for everyone
  sessionPreset: SessionPreset
  sessionMs: number // length of the session once started
  maxMembers: number // 8
}

export type GroupStatus = 'upcoming' | 'active' | 'ended' | 'settled'

export type Group = {
  groupId: string
  name: string
  joinCode: string
  groupPda: string
  programId: string
  creatorWallet: string
  status: GroupStatus
  periodStart: number | null // null until the creator presses Start
  periodEnd: number | null
  demoMode: boolean
  rules: Rules
  blocklist: Blocklist
}

export type Member = {
  wallet: string
  displayName: string
  joinedAt: number
  staked: boolean
  stakedLamports: number
  rank: number | null // 1 = least screen time; ties share a rank; null = not in the race
  usage: {
    totalSeconds: number // blockedSeconds + offlineSeconds, this is what's ranked
    blockedSeconds: number
    offlineSeconds: number // missed tracker check-ins count as screen time
    byApp: { app: string; seconds: number }[]
  }
  current: { app: string; matchType: 'process' | 'title'; since: number } | null
  tracker: { paired: boolean; online: boolean; lastSeenAt: number | null }
}

export type RankEventKind = 'session_started' | 'took_lead' | 'passed' | 'session_ended'

export type RankEvent = {
  eventId: string
  kind: RankEventKind
  wallet: string | null // who moved up (null for session events)
  displayName: string | null
  otherWallet: string | null // who they passed
  otherDisplayName: string | null
  newRank: number | null
  roast: string | null // Gemini, optional
  createdAt: number
}

export type SessionResult = {
  winners: { wallet: string; displayName: string; payoutLamports: number }[]
  potLamports: number
  signature: string | null // settle transaction
  explorerUrl: string | null
  settledAt: number | null
}

export type GroupState = {
  serverTime: number
  group: Group
  members: Member[] // sorted by rank, then unstaked members
  events: RankEvent[] // newest first, max 50
  totals: { potLamports: number; stakedMembers: number }
  result: SessionResult | null // set once the session is settled
}

export type CreateGroupInput = {
  name: string
  displayName: string
  stakeLamports: number
  sessionPreset: SessionPreset
  blocklist: Blocklist
}

export const SESSION_PRESETS: { id: SessionPreset; label: string; ms: number }[] = [
  { id: 'demo', label: 'Demo (90 s)', ms: 90_000 },
  { id: 'day', label: '1 day', ms: 24 * 60 * 60_000 },
  { id: 'week', label: '1 week', ms: 7 * 24 * 60 * 60_000 },
  { id: 'month', label: '1 month (30 days)', ms: 30 * 24 * 60 * 60_000 },
]

export const MAX_MEMBERS = 8
export const MIN_MEMBERS_TO_START = 2
