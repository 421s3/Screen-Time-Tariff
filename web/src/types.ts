// Contract with the backend: see ../docs/contract.md (section 4, GET /groups/:id/state).
// If a type here changes, tell the backend devs. Amounts are lamports, times are unix ms.

export type Blocklist = {
  processes: { match: string; label: string }[]
  titles: { match: string; label: string }[]
}

export type Rules = {
  allowanceMinutes: number
  tariffLamportsPerMinute: number
}

export type Group = {
  groupId: string
  name: string
  joinCode: string
  groupPda: string
  programId: string
  status: 'upcoming' | 'active' | 'ended'
  periodStart: number
  periodEnd: number
  demoMode: boolean
  rules: Rules
  blocklist: Blocklist
}

export type Member = {
  wallet: string
  displayName: string
  stakedLamports: number
  slashedLamports: number
  receivedLamports: number
  remainingLamports: number
  withdrawn: boolean
  usage: {
    blockedSeconds: number
    blockedMinutes: number
    minutesOver: number
    minutesCharged: number
    offlineMinutes: number
    byApp: { app: string; seconds: number }[]
  }
  current: { app: string; matchType: 'process' | 'title'; since: number } | null
  tracker: { paired: boolean; online: boolean; lastSeenAt: number | null }
}

export type LeaderboardEntry = {
  wallet: string
  displayName: string
  blockedMinutes: number
  rank: number
}

export type Penalty = {
  penaltyId: string
  wallet: string
  displayName: string
  app: string
  minutes: number
  lamports: number
  recipients: { wallet: string; displayName: string; lamports: number }[]
  status: 'pending' | 'sent' | 'confirmed' | 'failed'
  signature: string | null
  explorerUrl: string | null
  roast: string | null
  createdAt: number
}

export type GroupState = {
  serverTime: number
  group: Group
  members: Member[]
  leaderboard: LeaderboardEntry[]
  penalties: Penalty[]
  totals: { stakedLamports: number; paidOutLamports: number }
}

// Inputs for the forms (the real request bodies are in contract.md).
export type CreateGroupInput = {
  name: string
  displayName: string
  allowanceMinutes: number
  tariffLamportsPerMinute: number
  periodMinutes: number
  blocklist: Blocklist
}
