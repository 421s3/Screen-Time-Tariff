import raw from '../../../docs/mock-state.json'
import { DEMO_GROUP_ID } from '../config'
import type { CreateGroupInput, GroupState, Member, Penalty } from '../types'
import { ApiError, type Api } from './base'

// Simulates a live demo on top of docs/mock-state.json (shaped exactly like /state):
// Alice's blocked time keeps climbing, and a new penalty with a roast lands every ~20 s.

const startedAt = Date.now()
const PENALTY_EVERY_MS = 20_000
// The mock challenge ends 10 minutes after the page loads, so the results screen is reachable.
const MOCK_PERIOD_MS = 10 * 60_000
const base = rebase(raw as unknown as GroupState)
const ALICE = base.members[0]

// The sample file has fixed timestamps; shift them so the sample's "now" is when this tab loaded.
function rebase(s: GroupState): GroupState {
  const shift = (t: number) => t + (startedAt - s.serverTime)
  return {
    ...s,
    serverTime: startedAt,
    group: {
      ...s.group,
      periodStart: shift(s.group.periodStart),
      periodEnd: startedAt + MOCK_PERIOD_MS,
    },
    members: s.members.map((m) => ({
      ...m,
      current: m.current ? { ...m.current, since: shift(m.current.since) } : null,
      tracker: {
        ...m.tracker,
        lastSeenAt: m.tracker.lastSeenAt === null ? null : shift(m.tracker.lastSeenAt),
      },
    })),
    penalties: s.penalties.map((p) => ({ ...p, createdAt: shift(p.createdAt) })),
  }
}

const ROASTS = [
  'Alice just paid the TikTok tax again. The algorithm sends its thanks.',
  'One more video, Alice said. 0.01 SOL ago.',
  'Alice has donated more to her friends than to her GPA this week.',
  'The tax collector would like a word with Alice.',
  'Alice: "just five minutes." The vault: "that will be 0.01 SOL."',
]

// Members added through the Create/Join/Stake flows live only in this browser tab.
const extraMembers: Member[] = []
let nameOverride: string | null = null

function newMember(wallet: string, displayName: string): Member {
  return {
    wallet,
    displayName,
    stakedLamports: 0,
    slashedLamports: 0,
    receivedLamports: 0,
    remainingLamports: 0,
    withdrawn: false,
    usage: {
      blockedSeconds: 0,
      blockedMinutes: 0,
      minutesOver: 0,
      minutesCharged: 0,
      offlineMinutes: 0,
      byApp: [],
    },
    current: null,
    tracker: { paired: false, online: false, lastSeenAt: null },
  }
}

function ensureMember(wallet: string, displayName: string): Member {
  let m = extraMembers.find((x) => x.wallet === wallet)
  if (!m) {
    m = newMember(wallet, displayName)
    extraMembers.push(m)
  } else if (displayName) {
    m.displayName = displayName
  }
  return m
}

function generatedPenalties(elapsedMs: number): Penalty[] {
  const count = Math.floor(elapsedMs / PENALTY_EVERY_MS)
  const others = base.members.filter((m) => m.wallet !== ALICE.wallet)
  const tariff = base.group.rules.tariffLamportsPerMinute
  const out: Penalty[] = []
  for (let i = 1; i <= count; i++) {
    out.push({
      penaltyId: `mock-${i}`,
      wallet: ALICE.wallet,
      displayName: ALICE.displayName,
      app: i % 2 === 0 ? 'YouTube' : 'TikTok',
      minutes: 1,
      lamports: tariff,
      recipients: others.map((o) => ({
        wallet: o.wallet,
        displayName: o.displayName,
        lamports: Math.floor(tariff / others.length),
      })),
      status: 'confirmed',
      signature: null, // mock-only: no real transaction exists
      explorerUrl: null,
      roast: ROASTS[(i - 1) % ROASTS.length],
      createdAt: startedAt + i * PENALTY_EVERY_MS,
    })
  }
  return out
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

function buildState(): GroupState {
  const now = Date.now()
  const elapsed = Math.min(now - startedAt, MOCK_PERIOD_MS)
  const ended = now >= base.group.periodEnd
  const penalties = [...generatedPenalties(elapsed), ...base.penalties]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
  const paid = penalties.filter((p) => p.status === 'confirmed' || p.status === 'sent')
  const confirmed = penalties.filter((p) => p.status === 'confirmed')
  const allowance = base.group.rules.allowanceMinutes

  const members: Member[] = [...base.members, ...extraMembers].map((m) => {
    const isAlice = m.wallet === ALICE.wallet
    const blockedSeconds = isAlice
      ? m.usage.blockedSeconds + Math.round((elapsed / 1000) * 1.5)
      : m.usage.blockedSeconds
    const blockedMinutes = Math.floor(blockedSeconds / 60)
    const slashed = sum(paid.filter((p) => p.wallet === m.wallet).map((p) => p.lamports))
    const received = sum(
      confirmed
        .flatMap((p) => p.recipients)
        .filter((r) => r.wallet === m.wallet)
        .map((r) => r.lamports),
    )
    return {
      ...m,
      slashedLamports: slashed,
      receivedLamports: received,
      remainingLamports: Math.max(0, m.stakedLamports - slashed),
      usage: {
        ...m.usage,
        blockedSeconds,
        blockedMinutes,
        minutesOver: Math.max(0, blockedMinutes - allowance),
        minutesCharged: sum(
          confirmed.filter((p) => p.wallet === m.wallet).map((p) => p.minutes),
        ),
      },
      current: ended ? null : m.current,
      tracker: isAlice && !ended
        ? { ...m.tracker, lastSeenAt: now - 2000, online: true }
        : m.tracker,
    }
  })

  const leaderboard = [...members]
    .sort((a, b) => a.usage.blockedMinutes - b.usage.blockedMinutes)
    .map((m, i) => ({
      wallet: m.wallet,
      displayName: m.displayName,
      blockedMinutes: m.usage.blockedMinutes,
      rank: i + 1,
    }))

  return {
    ...base,
    serverTime: now,
    group: {
      ...base.group,
      name: nameOverride ?? base.group.name,
      status: ended ? 'ended' : 'active',
    },
    members,
    leaderboard,
    penalties,
    totals: {
      stakedLamports: sum(members.map((m) => m.stakedLamports)),
      paidOutLamports: sum(confirmed.map((p) => p.lamports)),
    },
  }
}

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms))

export const mockApi: Api = {
  async getState(groupId) {
    await delay(300)
    if (groupId !== DEMO_GROUP_ID) {
      throw new ApiError('GROUP_NOT_FOUND', 'No group with that id in demo data.')
    }
    return buildState()
  },

  async createGroup(input: CreateGroupInput, wallet) {
    await delay()
    nameOverride = input.name
    ensureMember(wallet, input.displayName)
    return { groupId: DEMO_GROUP_ID, joinCode: base.group.joinCode }
  },

  async joinGroup(joinCode, displayName, wallet) {
    await delay()
    if (joinCode.trim().toUpperCase() !== base.group.joinCode) {
      throw new ApiError('JOIN_CODE_INVALID', 'That invite code was not found.')
    }
    ensureMember(wallet, displayName)
    return { groupId: DEMO_GROUP_ID }
  },

  async recordStake(_groupId, lamports, wallet) {
    await delay(600)
    const m = ensureMember(wallet, 'You')
    m.stakedLamports += lamports
    return { ok: true, signature: null } // mock: no on-chain transaction
  },

  async startPairing() {
    await delay()
    const code = String(Math.floor(100000 + Math.random() * 900000))
    return { code, expiresAt: Date.now() + 10 * 60 * 1000 }
  },
}
