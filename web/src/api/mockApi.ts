import { DEMO_GROUP_ID } from '../config'
import {
  MAX_MEMBERS,
  MIN_MEMBERS_TO_START,
  type CreateGroupInput,
  type GroupState,
  type Member,
  type RankEvent,
  type SessionPreset,
  type SessionResult,
} from '../types'
import { ApiError, type Api } from './base'

// Simulated "lowest screen time takes the pot" race. Every session runs for 90 s in demo
// mode, whatever preset was chosen. Usage follows a fixed script so the demo is reliable:
// Alice leads early, Carol takes over after Alice's TikTok binge, Bob wins at the end.

const MOCK_SESSION_MS = 90_000
const SETTLE_DELAY_MS = 2_000
const DEFAULT_STAKE = 500_000_000 // 0.5 SOL
const JOIN_CODE = 'TAX42Z'
const PROGRAM_ID = '6sCrwiknWJUMwJ8By4a9m6LPdSgjxr7YYd6RMexXuF8U'
const GROUP_PDA = 'CMx7Jm8hHqbxyKDXMxbeWikjyVrJnUn1LrEnB2bPqxXm'

const PROCESS_APPS = new Set(['Valorant', 'League of Legends', 'Steam', 'Discord'])
const OFFLINE = 'Tracker offline'

// rate = screen-time seconds added per real second (demo time is compressed).
type Segment = { from: number; to: number; rate: number; app: string }
type Scripted = { wallet: string; displayName: string; segments: Segment[] }

const SCRIPT: Scripted[] = [
  {
    wallet: 'H9Rje39uEcwMyQYZ946h6ZfhhQjNg5HxegbtgMYu2Uyx',
    displayName: 'Alice',
    segments: [
      { from: 0, to: 30, rate: 5, app: 'TikTok' },
      { from: 30, to: 60, rate: 40, app: 'TikTok' },
      { from: 60, to: 90, rate: 10, app: 'YouTube' },
    ],
  },
  {
    wallet: 'rqMZmzrJczycbBj1Nfhs81tazV3anaGZ2dxtEK8Yuqm',
    displayName: 'Bob',
    segments: [
      { from: 0, to: 30, rate: 15, app: 'Steam' },
      { from: 30, to: 90, rate: 8, app: 'Discord' },
    ],
  },
  {
    wallet: 'HnxWhh8bo2HXFumxPCJVHBSdrWTpjtSwPJhMjsnmVWos',
    displayName: 'Carol',
    segments: [
      { from: 0, to: 30, rate: 10, app: 'Reddit' },
      { from: 30, to: 60, rate: 5, app: 'Reddit' },
      { from: 60, to: 75, rate: 30, app: 'YouTube' },
      { from: 75, to: 90, rate: 5, app: 'Reddit' },
    ],
  },
  {
    wallet: '7d4KQmVvJ8hxfS2nTq1rP9cYbW3eL6uA5gZ2kHjN8oXi',
    displayName: 'Dave',
    segments: [
      { from: 0, to: 45, rate: 20, app: 'League of Legends' },
      { from: 45, to: 90, rate: 2, app: 'Discord' },
    ],
  },
  {
    wallet: '4mT9xLwQ2sR7vB1nC8dF3gH6jK5pZ0aY9eU2iO4qW7tE',
    displayName: 'Erin',
    segments: [{ from: 0, to: 90, rate: 12, app: 'Instagram' }],
  },
  {
    wallet: '9pL2kJ7hG4fD1sA8zX5cV3bN6mQ0wE2rT9yU4iO7pLkJ',
    displayName: 'Frank',
    segments: [
      { from: 0, to: 20, rate: 8, app: 'YouTube' },
      { from: 20, to: 50, rate: 25, app: OFFLINE }, // closed the tracker: counts anyway
      { from: 50, to: 90, rate: 6, app: 'Twitch' },
    ],
  },
]

// Real wallets that join in the mock have no tracker, so their time counts as offline.
const UNPAIRED_SEGMENTS: Segment[] = [{ from: 0, to: 90, rate: 13, app: OFFLINE }]

const ROASTS: ((winner: string, loser: string) => string)[] = [
  (w, l) => `${l} opened TikTok "for one second." ${w} sends thanks.`,
  (w, l) => `${w} touched grass. ${l} touched the For You page.`,
  (w, l) => `${l}'s screen time has its own zip code now. ${w} moves up.`,
  (w) => `${w} is suspiciously productive. The tax collector is watching.`,
]

type Extra = { wallet: string; displayName: string; joinedAt: number; staked: boolean }

type Session = {
  name: string
  preset: SessionPreset
  stakeLamports: number
  creatorWallet: string
  startedAt: number | null // null = upcoming
  createdAt: number
  extras: Extra[]
}

function demoSession(): Session {
  const now = Date.now()
  return {
    name: 'Finals Week Survivors',
    preset: 'demo',
    stakeLamports: DEFAULT_STAKE,
    creatorWallet: SCRIPT[0].wallet,
    startedAt: now, // the demo group starts racing as soon as the page loads
    createdAt: now,
    extras: [],
  }
}

let session: Session = demoSession()

/** Mock only: restart the 90 s demo race from zero. */
export function restartDemo() {
  session = demoSession()
}

type Racer = {
  wallet: string
  displayName: string
  joinedAt: number
  staked: boolean
  segments: Segment[]
}

function racers(): Racer[] {
  return [
    ...SCRIPT.map((s) => ({
      wallet: s.wallet,
      displayName: s.displayName,
      joinedAt: session.createdAt,
      staked: true,
      segments: s.segments,
    })),
    ...session.extras.map((e) => ({ ...e, segments: UNPAIRED_SEGMENTS })),
  ]
}

/** Usage after `t` seconds of the session. */
function usageAt(segments: Segment[], t: number) {
  let blocked = 0
  let offline = 0
  const byApp = new Map<string, number>()
  for (const s of segments) {
    const secs = Math.max(0, Math.min(t, s.to) - s.from) * s.rate
    if (secs <= 0) continue
    if (s.app === OFFLINE) offline += secs
    else blocked += secs
    byApp.set(s.app, (byApp.get(s.app) ?? 0) + secs)
  }
  return {
    totalSeconds: Math.round(blocked + offline),
    blockedSeconds: Math.round(blocked),
    offlineSeconds: Math.round(offline),
    byApp: [...byApp.entries()]
      .map(([app, seconds]) => ({ app, seconds: Math.round(seconds) }))
      .sort((a, b) => b.seconds - a.seconds),
  }
}

function segmentAt(segments: Segment[], t: number): Segment | null {
  return segments.find((s) => t >= s.from && t < s.to) ?? null
}

/** Competition ranking (1, 1, 3) by total seconds, lowest first. Staked racers only. */
function rankAt(list: Racer[], t: number): Map<string, number> {
  const totals = list
    .filter((r) => r.staked)
    .map((r) => ({ wallet: r.wallet, total: usageAt(r.segments, t).totalSeconds }))
    .sort((a, b) => a.total - b.total)
  const ranks = new Map<string, number>()
  totals.forEach((x, i) => {
    const prev = totals[i - 1]
    ranks.set(x.wallet, prev && prev.total === x.total ? ranks.get(prev.wallet)! : i + 1)
  })
  return ranks
}

function leaderOf(ranks: Map<string, number>): string | null {
  const firsts = [...ranks.entries()].filter(([, r]) => r === 1)
  return firsts.length === 1 ? firsts[0][0] : null // a tie for 1st has no single leader
}

/** Replays the race second by second to build the rank-change feed. */
function buildEvents(list: Racer[], startedAt: number, elapsedSec: number, ended: boolean) {
  const name = new Map(list.map((r) => [r.wallet, r.displayName]))
  const events: RankEvent[] = [
    {
      eventId: 'start',
      kind: 'session_started',
      wallet: null,
      displayName: null,
      otherWallet: null,
      otherDisplayName: null,
      newRank: null,
      roast: null,
      createdAt: startedAt,
    },
  ]
  let prev = rankAt(list, 1)
  let roastIdx = 0
  for (let s = 2; s <= elapsedSec; s++) {
    const cur = rankAt(list, s)
    const prevLeader = leaderOf(prev)
    const curLeader = leaderOf(cur)
    for (const [wallet, rank] of cur) {
      const before = prev.get(wallet)
      if (before === undefined || rank >= before || rank > 3) continue
      // Who did they pass? Someone now ranked right below them who used to be ahead.
      const passed = [...cur.entries()].find(
        ([w, r]) => w !== wallet && r > rank && (prev.get(w) ?? 99) <= rank,
      )?.[0]
      const tookLead = rank === 1 && curLeader === wallet && prevLeader !== wallet
      const other = tookLead ? prevLeader ?? passed : passed
      events.push({
        eventId: `e-${s}-${wallet}`,
        kind: tookLead ? 'took_lead' : 'passed',
        wallet,
        displayName: name.get(wallet) ?? '?',
        otherWallet: other ?? null,
        otherDisplayName: other ? name.get(other) ?? '?' : null,
        newRank: rank,
        roast:
          tookLead && other
            ? ROASTS[roastIdx++ % ROASTS.length](name.get(wallet) ?? '?', name.get(other) ?? '?')
            : null,
        createdAt: startedAt + s * 1000,
      })
    }
    prev = cur
  }
  if (ended) {
    events.push({
      eventId: 'end',
      kind: 'session_ended',
      wallet: null,
      displayName: null,
      otherWallet: null,
      otherDisplayName: null,
      newRank: null,
      roast: null,
      createdAt: startedAt + MOCK_SESSION_MS,
    })
  }
  return events.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50)
}

function buildState(): GroupState {
  const now = Date.now()
  const list = racers()
  const { startedAt } = session
  const periodEnd = startedAt === null ? null : startedAt + MOCK_SESSION_MS
  const status =
    startedAt === null
      ? 'upcoming'
      : now < periodEnd!
        ? 'active'
        : now < periodEnd! + SETTLE_DELAY_MS
          ? 'ended'
          : 'settled'
  const elapsedMs = startedAt === null ? 0 : Math.min(now - startedAt, MOCK_SESSION_MS)
  const t = elapsedMs / 1000
  const running = status === 'active'
  const ranks = startedAt === null ? new Map<string, number>() : rankAt(list, t)

  const members: Member[] = list.map((r) => {
    const seg = running ? segmentAt(r.segments, t) : null
    const offlineNow = seg?.app === OFFLINE
    const isScripted = SCRIPT.some((s) => s.wallet === r.wallet)
    return {
      wallet: r.wallet,
      displayName: r.displayName,
      joinedAt: r.joinedAt,
      staked: r.staked,
      stakedLamports: r.staked ? session.stakeLamports : 0,
      rank: ranks.get(r.wallet) ?? null,
      usage: r.staked
        ? usageAt(r.segments, t)
        : { totalSeconds: 0, blockedSeconds: 0, offlineSeconds: 0, byApp: [] },
      current:
        seg && !offlineNow && r.staked
          ? {
              app: seg.app,
              matchType: PROCESS_APPS.has(seg.app) ? 'process' : 'title',
              since: (startedAt ?? now) + seg.from * 1000,
            }
          : null,
      tracker: isScripted
        ? { paired: true, online: !offlineNow, lastSeenAt: offlineNow ? null : now - 1500 }
        : { paired: false, online: false, lastSeenAt: null },
    }
  })
  members.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.joinedAt - b.joinedAt)

  const staked = members.filter((m) => m.staked)
  const pot = staked.length * session.stakeLamports

  let result: SessionResult | null = null
  if (status === 'settled') {
    const winners = staked.filter((m) => m.rank === 1)
    const share = Math.floor(pot / winners.length)
    const remainder = pot - share * winners.length
    result = {
      winners: winners.map((w, i) => ({
        wallet: w.wallet,
        displayName: w.displayName,
        payoutLamports: share + (i === 0 ? remainder : 0),
      })),
      potLamports: pot,
      signature: null, // mock: no on-chain settle transaction
      explorerUrl: null,
      settledAt: periodEnd! + SETTLE_DELAY_MS,
    }
  }

  return {
    serverTime: now,
    group: {
      groupId: DEMO_GROUP_ID,
      name: session.name,
      joinCode: JOIN_CODE,
      groupPda: GROUP_PDA,
      programId: PROGRAM_ID,
      creatorWallet: session.creatorWallet,
      status,
      periodStart: startedAt,
      periodEnd,
      demoMode: true,
      rules: {
        stakeLamports: session.stakeLamports,
        sessionPreset: session.preset,
        sessionMs: MOCK_SESSION_MS,
        maxMembers: MAX_MEMBERS,
      },
      blocklist: { processes: [], titles: [] },
    },
    members,
    events:
      startedAt === null
        ? []
        : buildEvents(list, startedAt, Math.floor(t), status !== 'active'),
    totals: { potLamports: pot, stakedMembers: staked.length },
    result,
  }
}

function requireUpcoming(action: string) {
  if (session.startedAt !== null) {
    throw new ApiError('SESSION_STARTED', `The session already started, so ${action} is closed.`)
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
    // Demo: replace the running race with a new upcoming group (creator + scripted friends).
    session = {
      name: input.name,
      preset: input.sessionPreset,
      stakeLamports: input.stakeLamports,
      creatorWallet: wallet,
      startedAt: null,
      createdAt: Date.now(),
      extras: [{ wallet, displayName: input.displayName, joinedAt: Date.now(), staked: false }],
    }
    return { groupId: DEMO_GROUP_ID, joinCode: JOIN_CODE }
  },

  async joinGroup(joinCode, displayName, wallet) {
    await delay()
    if (joinCode.trim().toUpperCase() !== JOIN_CODE) {
      throw new ApiError('JOIN_CODE_INVALID', 'That invite code was not found.')
    }
    requireUpcoming('joining')
    const existing = session.extras.find((e) => e.wallet === wallet)
    if (existing) {
      existing.displayName = displayName
    } else {
      if (SCRIPT.length + session.extras.length >= MAX_MEMBERS) {
        throw new ApiError('GROUP_FULL', `This group is full (${MAX_MEMBERS} members max).`)
      }
      session.extras.push({ wallet, displayName, joinedAt: Date.now(), staked: false })
    }
    return { groupId: DEMO_GROUP_ID }
  },

  async recordStake(_groupId, wallet) {
    await delay(600)
    requireUpcoming('staking')
    const me = session.extras.find((e) => e.wallet === wallet)
    if (!me) throw new ApiError('NOT_A_MEMBER', 'Join the group before staking.')
    if (me.staked) throw new ApiError('ALREADY_STAKED', 'You already paid the entry stake.')
    me.staked = true
    return { ok: true, signature: null } // mock: no on-chain transaction
  },

  async startSession(_groupId, wallet) {
    await delay()
    requireUpcoming('starting')
    if (wallet !== session.creatorWallet) {
      throw new ApiError('NOT_CREATOR', 'Only the group creator can start the session.')
    }
    const stakedCount = racers().filter((r) => r.staked).length
    if (stakedCount < MIN_MEMBERS_TO_START) {
      throw new ApiError('NOT_ENOUGH_MEMBERS', `At least ${MIN_MEMBERS_TO_START} staked members are needed.`)
    }
    session.startedAt = Date.now()
    return { ok: true }
  },

  async startPairing() {
    await delay()
    const code = String(Math.floor(100000 + Math.random() * 900000))
    return { code, expiresAt: Date.now() + 10 * 60 * 1000 }
  },
}
