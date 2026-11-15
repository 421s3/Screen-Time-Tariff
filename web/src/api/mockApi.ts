import { DEMO_GROUP_ID } from '../config'
import type {
  CreateGroupInput,
  GroupState,
  Member,
  Penalty,
  Rules,
  Settlement,
} from '../types'
import { ApiError, type Api } from './base'

// Simulated winner-takes-pool race (docs/contract.md v0.5). Every demo period runs 90 s of
// real time, with screen time compressed so minutes add up fast:
//  - minutes over the allowance are charged every 10 s (one penalty per member per tick),
//    first "sent", then "confirmed" a few seconds later, and moved into the penalty pool;
//  - the staked member with the lowest blocked time is "leading" and wins the pool;
//  - 3 s after the end the pool is settled; then members can withdraw.
// Alice leads early, Carol takes over after Alice's TikTok binge, Bob passes Carol during her
// YouTube hole, and Carol wins it back by going clean for the last 15 s.

const MOCK_PERIOD_MS = 90_000
const TICK_SEC = 10 // like the backend's WORKER_INTERVAL_SEC
const CONFIRM_DELAY_MS = 3_000
const SETTLE_DELAY_MS = 3_000 // the real backend waits ~30 s
const JOIN_CODE = 'TAX42Z'
const PROGRAM_ID = 'GfR8egohvnFsdcLfPEJFccd1an274TVsfPhpWsUR3CGi'
const GROUP_PDA = 'CMx7Jm8hHqbxyKDXMxbeWikjyVrJnUn1LrEnB2bPqxXm'
const SOL = 1_000_000_000

const DEFAULT_RULES: Rules = { allowanceMinutes: 1, tariffLamportsPerMinute: 10_000_000, chargeUnitSecs: 60 }

// What a member is doing during a stretch of the period. `rate` = blocked seconds added per
// real second (demo time is compressed). Idle and unblocked stretches add nothing.
type Activity =
  | { kind: 'process' | 'title'; app: string; rate: number }
  | { kind: 'idle' } // tracker online, no input: games don't count while idle
  | { kind: 'clear' } // tracker online, not on a blocked app
  | { kind: 'offline'; rate: number } // missed check-ins count as "Tracker offline"
type Segment = { from: number; to: number } & Activity
type Scripted = {
  wallet: string
  displayName: string
  stakeLamports: number // 0 = joined but never staked
  segments: Segment[]
}

const OFFLINE_APP = 'Tracker offline'

const SCRIPT: Scripted[] = [
  {
    wallet: 'H9Rje39uEcwMyQYZ946h6ZfhhQjNg5HxegbtgMYu2Uyx',
    displayName: 'Alice',
    stakeLamports: 0.5 * SOL,
    segments: [
      { from: 0, to: 30, kind: 'title', app: 'TikTok', rate: 5 },
      { from: 30, to: 60, kind: 'title', app: 'TikTok', rate: 40 },
      { from: 60, to: 90, kind: 'title', app: 'YouTube', rate: 10 },
    ],
  },
  {
    wallet: 'rqMZmzrJczycbBj1Nfhs81tazV3anaGZ2dxtEK8Yuqm',
    displayName: 'Bob',
    stakeLamports: 0.5 * SOL,
    segments: [
      { from: 0, to: 30, kind: 'process', app: 'Team Fortress 2', rate: 15 }, // Steam game
      { from: 30, to: 90, kind: 'process', app: 'Discord', rate: 8 },
    ],
  },
  {
    wallet: 'HnxWhh8bo2HXFumxPCJVHBSdrWTpjtSwPJhMjsnmVWos',
    displayName: 'Carol',
    stakeLamports: 0.3 * SOL,
    segments: [
      { from: 0, to: 30, kind: 'title', app: 'Reddit', rate: 10 },
      { from: 30, to: 60, kind: 'title', app: 'Reddit', rate: 5 },
      { from: 60, to: 75, kind: 'title', app: 'YouTube', rate: 30 },
      { from: 75, to: 90, kind: 'clear' },
    ],
  },
  {
    wallet: '7d4KQmVvJ8hxfS2nTq1rP9cYbW3eL6uA5gZ2kHjN8oXi',
    displayName: 'Dave',
    stakeLamports: 1 * SOL,
    segments: [
      { from: 0, to: 45, kind: 'process', app: 'League of Legends', rate: 20 },
      { from: 45, to: 90, kind: 'process', app: 'Discord', rate: 2 },
    ],
  },
  {
    wallet: '4mT9xLwQ2sR7vB1nC8dF3gH6jK5pZ0aY9eU2iO4qW7tE',
    displayName: 'Erin',
    stakeLamports: 0.5 * SOL,
    segments: [
      { from: 0, to: 40, kind: 'title', app: 'Instagram', rate: 14 },
      { from: 40, to: 65, kind: 'idle' }, // walked away from Valorant: not counted
      { from: 65, to: 90, kind: 'process', app: 'Valorant', rate: 18 },
    ],
  },
  {
    wallet: '9pL2kJ7hG4fD1sA8zX5cV3bN6mQ0wE2rT9yU4iO7pLkJ',
    displayName: 'Frank',
    stakeLamports: 0.25 * SOL,
    segments: [
      { from: 0, to: 20, kind: 'title', app: 'YouTube', rate: 8 },
      { from: 20, to: 50, kind: 'offline', rate: 25 }, // closed the tracker: counts anyway
      { from: 50, to: 90, kind: 'process', app: 'Elden Ring', rate: 6 }, // Steam game
    ],
  },
  {
    wallet: 'Fq8nW3xK2vB7cM5rT1yJ9hD4gL6sA0pE3uZ8iO2kN5w',
    displayName: 'Hana',
    stakeLamports: 0, // joined, never staked: can't be charged, can't win
    segments: [{ from: 0, to: 90, kind: 'title', app: 'TikTok', rate: 3 }],
  },
]


type Extra = { wallet: string; displayName: string; stakeLamports: number }

type Session = {
  name: string
  rules: Rules
  periodStart: number
  extras: Extra[] // real wallets that created/joined in this tab
  withdrawn: Set<string>
}

function demoSession(): Session {
  return {
    name: 'Finals Week Survivors',
    rules: DEFAULT_RULES,
    periodStart: Date.now(),
    extras: [],
    withdrawn: new Set(),
  }
}

let session: Session = demoSession()

/** Mock only: restart the demo period from zero. */
export function restartDemo() {
  session = demoSession()
}

type Racer = { wallet: string; displayName: string; stakeLamports: number; segments: Segment[] }

function racers(): Racer[] {
  return [
    ...SCRIPT,
    // Real wallets have no tracker in the mock, so they record no usage.
    ...session.extras.map((e) => ({ ...e, segments: [] as Segment[] })),
  ]
}

function usageAt(segments: Segment[], t: number) {
  const byApp = new Map<string, number>()
  let offline = 0
  for (const s of segments) {
    if (s.kind === 'idle' || s.kind === 'clear') continue
    const secs = Math.max(0, Math.min(t, s.to) - s.from) * s.rate
    if (secs <= 0) continue
    const app = s.kind === 'offline' ? OFFLINE_APP : s.app
    if (s.kind === 'offline') offline += secs
    byApp.set(app, (byApp.get(app) ?? 0) + secs)
  }
  const list = [...byApp.entries()]
    .map(([app, seconds]) => ({ app, seconds: Math.round(seconds) }))
    .sort((a, b) => b.seconds - a.seconds)
  const blockedSeconds = list.reduce((sum, a) => sum + a.seconds, 0)
  return { blockedSeconds, offlineMinutes: Math.floor(offline / 60), byApp: list }
}

function segmentAt(segments: Segment[], t: number): Segment | null {
  return segments.find((s) => t >= s.from && t < s.to) ?? null
}

/** Penalties issued so far: one per member per worker tick, for new minutes over the allowance. */
function penaltiesAt(list: Racer[], elapsedSec: number, now: number): Penalty[] {
  const { allowanceMinutes, tariffLamportsPerMinute } = session.rules
  const out: Penalty[] = []
  for (const r of list) {
    if (r.stakeLamports === 0) continue // can't charge a member who never staked
    let charged = 0
    let chargedLamports = 0
    for (let tick = TICK_SEC; tick <= elapsedSec; tick += TICK_SEC) {
      const u = usageAt(r.segments, tick)
      const over = Math.max(0, Math.floor(u.blockedSeconds / 60) - allowanceMinutes)
      const minutes = over - charged
      if (minutes <= 0) continue
      const lamports = Math.min(minutes * tariffLamportsPerMinute, r.stakeLamports - chargedLamports)
      if (lamports <= 0) break // stake fully used up
      const seg = segmentAt(r.segments, tick - 0.001)
      const app =
        seg?.kind === 'offline' ? OFFLINE_APP : seg && 'app' in seg ? seg.app : u.byApp[0]?.app ?? '?'
      const createdAt = session.periodStart + tick * 1000
      const confirmed = now - createdAt >= CONFIRM_DELAY_MS
      out.push({
        penaltyId: `p-${r.displayName}-${tick}`,
        wallet: r.wallet,
        displayName: r.displayName,
        app,
        minutes,
        seconds: minutes * 60,
        lamports,
        status: confirmed ? 'confirmed' : 'sent',
        signature: null, // mock: no real transaction
        explorerUrl: null,
        createdAt,
      })
      charged = over
      chargedLamports += lamports
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

function buildState(): GroupState {
  const now = Date.now()
  const list = racers()
  const { periodStart, rules } = session
  const periodEnd = periodStart + MOCK_PERIOD_MS
  const status = now < periodStart ? 'upcoming' : now > periodEnd ? 'ended' : 'active'
  const elapsedMs = Math.min(Math.max(0, now - periodStart), MOCK_PERIOD_MS)
  const t = elapsedMs / 1000
  const running = status === 'active'

  const penalties = penaltiesAt(list, Math.floor(t), now)
  const confirmed = penalties.filter((p) => p.status === 'confirmed')
  const pool = confirmed.reduce((sum, p) => sum + p.lamports, 0)

  // Settlement: lowest blocked time among staked members wins the pool; ties split it.
  let settlement: Settlement | null = null
  const usage = new Map(list.map((r) => [r.wallet, usageAt(r.segments, t)]))
  const staked = list.filter((r) => r.stakeLamports > 0)
  if (status === 'ended' && now >= periodEnd + SETTLE_DELAY_MS) {
    if (staked.length === 0) {
      settlement = { status: 'skipped', poolLamports: 0, winners: [], signature: null, explorerUrl: null, settledAt: now }
    } else {
      const best = Math.min(...staked.map((r) => usage.get(r.wallet)!.blockedSeconds))
      const winners = staked.filter((r) => usage.get(r.wallet)!.blockedSeconds === best)
      const share = Math.floor(pool / winners.length)
      settlement = {
        status: 'confirmed',
        poolLamports: pool,
        winners: winners.map((w, i) => ({
          wallet: w.wallet,
          displayName: w.displayName,
          prizeLamports: share + (i === 0 ? pool - share * winners.length : 0),
        })),
        signature: null, // mock: no on-chain settle transaction
        explorerUrl: null,
        settledAt: periodEnd + SETTLE_DELAY_MS,
      }
    }
  }

  const members: Member[] = list.map((r) => {
    const u = usage.get(r.wallet)!
    const paid = confirmed.filter((p) => p.wallet === r.wallet)
    const slashed = paid.reduce((sum, p) => sum + p.lamports, 0)
    const prize = settlement?.winners.find((w) => w.wallet === r.wallet)?.prizeLamports ?? 0
    const isScripted = SCRIPT.some((s) => s.wallet === r.wallet)
    const seg = running ? segmentAt(r.segments, t) : null
    const offlineNow = seg?.kind === 'offline'
    const blockedMinutes = Math.floor(u.blockedSeconds / 60)
    return {
      wallet: r.wallet,
      displayName: r.displayName,
      staked: r.stakeLamports > 0,
      stakedLamports: r.stakeLamports,
      slashedLamports: slashed,
      receivedLamports: prize,
      remainingLamports: r.stakeLamports - slashed + prize,
      withdrawn: session.withdrawn.has(r.wallet),
      usage: {
        blockedSeconds: u.blockedSeconds,
        blockedMinutes,
        minutesOver: Math.max(0, blockedMinutes - rules.allowanceMinutes),
        minutesCharged: paid.reduce((sum, p) => sum + p.minutes, 0),
        offlineMinutes: u.offlineMinutes,
        byApp: u.byApp,
      },
      current:
        seg && (seg.kind === 'process' || seg.kind === 'title')
          ? { app: seg.app, matchType: seg.kind, since: periodStart + seg.from * 1000 }
          : null,
      tracker: isScripted
        ? {
            paired: true,
            online: !offlineNow,
            lastSeenAt: offlineNow ? periodStart + (seg?.from ?? 0) * 1000 : now - 1500,
            idle: seg?.kind === 'idle',
          }
        : { paired: false, online: false, lastSeenAt: null, idle: false },
    }
  })

  // Staked first, then lowest blocked time, then name (same order as the backend).
  const best = staked.length
    ? Math.min(...members.filter((m) => m.staked).map((m) => m.usage.blockedSeconds))
    : null
  const leaderboard = [...members]
    .sort(
      (a, b) =>
        Number(b.staked) - Number(a.staked) ||
        a.usage.blockedSeconds - b.usage.blockedSeconds ||
        a.displayName.localeCompare(b.displayName),
    )
    .map((m, i) => ({
      wallet: m.wallet,
      displayName: m.displayName,
      blockedSeconds: m.usage.blockedSeconds,
      blockedMinutes: m.usage.blockedMinutes,
      rank: i + 1,
      leading: settlement
        ? settlement.winners.some((w) => w.wallet === m.wallet)
        : m.staked && m.usage.blockedSeconds === best,
    }))

  return {
    serverTime: now,
    group: {
      groupId: DEMO_GROUP_ID,
      name: session.name,
      joinCode: JOIN_CODE,
      groupPda: GROUP_PDA,
      programId: PROGRAM_ID,
      chainMode: 'mock',
      status,
      periodStart,
      periodEnd,
      demoMode: true,
      rules,
      blocklist: { processes: [], titles: [], steamGames: true },
      settlement,
    },
    members,
    leaderboard,
    penalties: penalties.slice(0, 50),
    totals: {
      stakedLamports: members.reduce((sum, m) => sum + m.stakedLamports, 0),
      penaltyPoolLamports: settlement?.poolLamports ?? pool,
    },
  }
}

function ensureExtra(wallet: string, displayName: string): Extra {
  let e = session.extras.find((x) => x.wallet === wallet)
  if (!e) {
    e = { wallet, displayName, stakeLamports: 0 }
    session.extras.push(e)
  } else if (displayName) {
    e.displayName = displayName
  }
  return e
}

function requireActive(action: string) {
  if (Date.now() > session.periodStart + MOCK_PERIOD_MS) {
    throw new ApiError('PERIOD_ENDED', `This group's period has ended, so ${action} is closed.`)
  }
}

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms))

export const mockApi: Api = {
  async getState(groupId) {
    await delay(200)
    if (groupId !== DEMO_GROUP_ID) {
      throw new ApiError('GROUP_NOT_FOUND', 'No group with that id in demo data.')
    }
    return buildState()
  },

  async createGroup(input: CreateGroupInput, wallet) {
    await delay()
    // Demo: start a fresh period with your rules (always 90 s in demo mode) plus the scripted friends.
    session = {
      name: input.name,
      rules: {
        allowanceMinutes: input.allowanceMinutes,
        tariffLamportsPerMinute: input.tariffLamportsPerMinute,
      },
      periodStart: Date.now(),
      extras: [{ wallet, displayName: input.displayName, stakeLamports: 0 }],
      withdrawn: new Set(),
    }
    return { groupId: DEMO_GROUP_ID, joinCode: JOIN_CODE }
  },

  async joinGroup(joinCode, displayName, wallet) {
    await delay()
    if (joinCode.trim().toUpperCase() !== JOIN_CODE) {
      throw new ApiError('GROUP_NOT_FOUND', 'No group with that join code.')
    }
    requireActive('joining')
    if (!session.extras.some((e) => e.wallet === wallet) && racers().length >= 8) {
      throw new ApiError('GROUP_FULL', 'Groups are limited to 8 members.')
    }
    ensureExtra(wallet, displayName)
    return { groupId: DEMO_GROUP_ID }
  },

  async recordStake(_groupId, lamports, wallet) {
    await delay(600)
    requireActive('staking')
    const me = session.extras.find((e) => e.wallet === wallet)
    if (!me) throw new ApiError('NOT_A_MEMBER', 'Join the group before staking.')
    me.stakeLamports += lamports
    return { ok: true, signature: null } // mock: no on-chain transaction
  },

  async withdraw(_groupId, wallet) {
    await delay(600)
    const state = buildState()
    if (state.group.settlement?.status !== 'confirmed') {
      throw new ApiError('NOT_SETTLED', 'You can withdraw once the pool has been settled.')
    }
    const me = state.members.find((m) => m.wallet === wallet)
    if (!me || !me.staked) throw new ApiError('NOT_A_MEMBER', 'Only members who staked can withdraw.')
    if (me.withdrawn) throw new ApiError('ALREADY_WITHDRAWN', 'You already withdrew.')
    session.withdrawn.add(wallet)
    return { ok: true, signature: null }
  },

  async startPairing() {
    await delay()
    const code = String(Math.floor(100000 + Math.random() * 900000))
    return { code, expiresAt: Date.now() + 10 * 60 * 1000 }
  },
}
