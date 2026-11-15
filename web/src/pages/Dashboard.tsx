import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { Coins, Crown, Eye, Flame, Moon, Plug, Plus, ShieldCheck, Ticket, Trophy, Unplug, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useGroupState } from '../api/hooks'
import { ApiError } from '../api/base'
import { forgetGroup } from '../lib/currentGroup'
import type { GroupState, LeaderboardEntry, Member, Penalty } from '../types'
import { chargeEvery, fmtClock, fmtCountdown, fmtDuration, fmtSol, shortAddr, tariffPerCharge } from '../lib/format'
import { Mascot } from '../components/Mascot'
import { tomForGroup } from '../lib/tomMood'
import { PenaltyFeed } from '../components/PenaltyFeed'
import { ActivityBadge, activityOf } from '../components/Activity'
import { TomMoment, type TomMomentName } from '../components/TomMoment'
import { EmptyState, ErrorBox, LiveStatus, Loading, Notice, UsageBar } from '../components/kit'

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export function Dashboard() {
  const { groupId = '' } = useParams()
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? null
  const state = useGroupState(groupId)
  const now = useNow()

  // Mascot popup whenever a new penalty lands in the pool (not on first load).
  const lastSeen = useRef<string | null>(null)
  // 5 s groups land a penalty every few seconds: pop the mascot at most every 30 s
  const lastPopupAt = useRef(0)
  const [popup, setPopup] = useState<Penalty | null>(null)
  // Only confirmed charges celebrate: a 'sent' transaction can still fail.
  const newest = state.data?.penalties.find((p) => p.status === 'confirmed') ?? null
  const newestId = newest?.penaltyId ?? null
  useEffect(() => {
    if (!newest || !newestId) return
    const previous = lastSeen.current
    lastSeen.current = newestId
    if (previous === null || previous === newestId) return
    if (Date.now() - lastPopupAt.current < 30_000) return
    lastPopupAt.current = Date.now()
    setPopup(newest)
    toast(`${newest.displayName} paid ${fmtSol(newest.lamports)} into the pool (${newest.app})`)
    const t = setTimeout(() => setPopup(null), 4500)
    return () => clearTimeout(t)
    // Only react to a new penalty id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId])

  if (state.isLoading) return <Loading label="Loading group dashboard…" />
  if (state.isError && !state.data) {
    if (state.error instanceof ApiError && state.error.code === 'GROUP_NOT_FOUND') {
      if (wallet) forgetGroup(wallet, groupId)
      return (
        <EmptyState title="Group not found" body="Create a group or join one with an invite code.">
          <Button asChild>
            <Link to="/create">
              <Plus /> Create a group
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/join">
              <Ticket /> Join with a code
            </Link>
          </Button>
        </EmptyState>
      )
    }
    return <ErrorBox message={(state.error as Error).message} onRetry={() => state.refetch()} />
  }

  const data = state.data!
  const { group, members, leaderboard, penalties, totals } = data
  const me = wallet ? members.find((m) => m.wallet === wallet) : undefined
  const leaders = leaderboard.filter((l) => l.leading)
  const leadingSet = new Set(leaders.map((l) => l.wallet))
  const rankOf = new Map(leaderboard.map((l) => [l.wallet, l.rank]))
  // Podium styling follows the backend's eligibility: only staked members place; every leader is gold (ties).
  const stakedSet = new Set(members.filter((m) => m.staked).map((m) => m.wallet))
  const medalOf = (l: LeaderboardEntry): 1 | 2 | 3 | null =>
    l.leading ? 1 : stakedSet.has(l.wallet) && l.rank <= 3 ? (Math.max(2, l.rank) as 2 | 3) : null
  const ordered = [...members].sort((a, b) => (rankOf.get(a.wallet) ?? 99) - (rankOf.get(b.wallet) ?? 99))
  const settled = group.settlement?.status === 'confirmed'
  const tom = tomForGroup(data, wallet, state.isError)

  return (
    <div className="space-y-6">
      {!connected && (
        <Notice tone="info">You're viewing this group without a wallet. Connect Phantom to stake or pair a tracker.</Notice>
      )}

      <header className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-1 basis-72 items-start gap-4">
          {headerMoment(tom.mood) ? (
            <TomMoment moment={headerMoment(tom.mood)!} size={84} className="-my-2 hidden sm:block" />
          ) : null}
          <Mascot size={52} mood={tom.mood} className={cn('shrink-0', headerMoment(tom.mood) && 'sm:hidden')} />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">{group.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Invite code <span className="font-mono font-semibold tracking-widest text-ink">{group.joinCode}</span> ·{' '}
              {group.rules.allowanceMinutes} min allowance · {fmtSol(group.rules.tariffLamportsPerMinute)}/min, charged{' '}
              {chargeEvery(group.rules.chargeUnitSecs)} over
              {group.blocklist.steamGames && ' · Steam games count'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <LiveStatus updatedAt={state.dataUpdatedAt} failing={state.isError} now={now} />
              <AnimatePresence mode="wait">
                <motion.span
                  key={tom.say}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className={cn(
                    'inline-flex max-w-full rounded-full px-2.5 py-1 text-xs font-medium text-ink',
                    tom.mood === 'angry' ? 'bg-coral' : 'bg-lilac',
                  )}
                  role="status"
                >
                  <span className="mr-1 font-semibold">Tom:</span>
                  <span className="truncate">{tom.say}</span>
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1.25fr_0.9fr_1.15fr]">
        <PoolCard
          pool={totals.penaltyPoolLamports}
          staked={totals.stakedLamports}
          charges={penalties.filter((p) => p.status === 'confirmed').length}
          mine={me ? (me.staked ? `You can withdraw ${fmtSol(me.remainingLamports)}` : "You haven't staked yet") : null}
        />
        <StatusClock data={data} now={now} />
        <WinnerCard leaders={leaders} settled={settled} />
      </div>

      <DashboardActions groupId={groupId} className="grid lg:hidden" />

      {group.status === 'ended' && (
        <Notice tone="good">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>The period is over. {settled ? 'The pool has been paid out.' : 'Settling the pool…'}</span>
            <Button asChild size="sm">
              <Link to={`/group/${groupId}/results`}>
                <Trophy /> See results
              </Link>
            </Button>
          </span>
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <h2 className="text-lg font-semibold">Members</h2>
            <p className="text-xs text-muted-foreground">Staked first, then lowest blocked time</p>
          </div>
          {members.length === 0 ? (
            <EmptyState title="No members yet" body={`Share the invite code ${group.joinCode}.`} />
          ) : (
            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              <AnimatePresence initial={false}>
                {ordered.map((m) => (
                  <motion.li key={m.wallet} layout transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
                    <MemberRow
                      member={m}
                      rank={rankOf.get(m.wallet) ?? null}
                      leading={leadingSet.has(m.wallet)}
                      allowance={group.rules.allowanceMinutes}
                      tariff={tariffPerCharge(group.rules.tariffLamportsPerMinute, group.rules.chargeUnitSecs)}
                      chargeUnitSecs={group.rules.chargeUnitSecs ?? 60}
                      isMe={m.wallet === wallet}
                      now={now}
                      active={group.status === 'active'}
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>

        <aside className="min-w-0 space-y-6">
          <DashboardActions groupId={groupId} className="hidden lg:grid lg:grid-cols-1" />

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Leaderboard</h2>
            <ol className="divide-y overflow-hidden rounded-xl border bg-card">
              {leaderboard.map((l) => (
                <motion.li
                  layout
                  transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                  key={l.wallet}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2.5 text-sm',
                    medalOf(l) === 1 && 'bg-gradient-to-r from-[#fff1c4] to-white py-3',
                    medalOf(l) === 2 && 'bg-gradient-to-r from-[#eeeaf8] to-white',
                    medalOf(l) === 3 && 'bg-gradient-to-r from-[#fbe3d3] to-white',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                      medalOf(l) === 1
                        ? 'bg-gradient-to-br from-[#ffd45e] to-[#f5a524] text-ink'
                        : medalOf(l) === 2
                          ? 'bg-gradient-to-br from-[#e4e1ef] to-[#b9b4cf] text-ink'
                          : medalOf(l) === 3
                            ? 'bg-gradient-to-br from-[#f3c7a4] to-[#d08a5a] text-ink'
                            : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {l.rank}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {l.leading && <Crown className="mr-1 inline size-4 align-[-2px]" />}
                    {l.displayName}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {fmtClock(l.blockedSeconds ?? l.blockedMinutes * 60)}
                  </span>
                </motion.li>
              ))}
            </ol>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Penalty feed</h2>
            <PenaltyFeed penalties={penalties} />
          </section>
        </aside>
      </div>

      <AnimatePresence>
        {popup && (
          <motion.div
            key={popup.penaltyId}
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="fixed bottom-4 left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 items-center gap-3 rounded-xl border bg-card p-3 shadow-[0_16px_40px_-20px_rgba(23,22,42,0.45)]"
            role="status"
          >
            <TomMoment moment="penalty" size={84} stage={false} />
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold">+{fmtSol(popup.lamports)} to the pool</p>
              <p className="text-sm text-muted-foreground">
                {popup.displayName} paid the {popup.app} tariff.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function headerMoment(mood: string): TomMomentName | null {
  return mood === 'angry' ? 'tracking' : mood === 'worried' ? 'offline' : mood === 'celebrate' ? 'win' : null
}

function DashboardActions({ groupId, className = '' }: { groupId: string; className?: string }) {
  return (
    <div className={cn('grid-cols-3 gap-2', className)}>
      <Button asChild variant="cta">
        <Link to={`/group/${groupId}/stake`}>
          <Coins /> Stake
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link to={`/group/${groupId}/pair`}>
          <Plug /> Pair<span className="hidden min-[420px]:inline lg:inline"> tracker</span>
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link to={`/group/${groupId}/results`}>
          <Trophy /> Results
        </Link>
      </Button>
    </div>
  )
}

/** Stack of coins that grows with the number of charges. */
function CoinStack({ count }: { count: number }) {
  const n = Math.min(6, Math.max(1, Math.ceil(count / 2)))
  return (
    <svg viewBox="0 0 80 96" className="w-16 sm:w-20" aria-hidden="true">
      <ellipse cx="40" cy="90" rx="34" ry="5" fill="#17152d" fillOpacity="0.18" />
      {Array.from({ length: n }, (_, i) => (
        <motion.g
          key={i}
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18, delay: i * 0.03 }}
        >
          <ellipse cx="40" cy={82 - i * 11} rx="30" ry="9" fill="#c8890f" />
          <ellipse cx="40" cy={78 - i * 11} rx="30" ry="9" fill="#ffd45e" />
          <ellipse cx="40" cy={78 - i * 11} rx="16" ry="4.5" fill="none" stroke="#c8890f" strokeWidth="2" />
        </motion.g>
      ))}
    </svg>
  )
}

function PoolCard({ pool, staked, charges, mine }: { pool: number; staked: number; charges: number; mine: string | null }) {
  // Float a "+x" chip when the pool grows.
  const prev = useRef(pool)
  const [delta, setDelta] = useState<{ id: number; lamports: number } | null>(null)
  useEffect(() => {
    const d = pool - prev.current
    prev.current = pool
    if (d <= 0) return
    setDelta({ id: Date.now(), lamports: d })
    const t = setTimeout(() => setDelta(null), 2400)
    return () => clearTimeout(t)
  }, [pool])
  return (
    <div className="wash-purple relative col-span-2 flex items-stretch justify-between gap-3 overflow-hidden rounded-2xl p-4 text-white sm:p-5 md:min-h-[148px] lg:col-span-1">
      <span aria-hidden="true" className="absolute -right-10 -top-14 size-40 rounded-full bg-white/10" />
      <div className="relative flex min-w-0 flex-col">
        <p className="text-sm font-medium text-white/90">Penalty pool · winner takes it</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <motion.p
            key={pool}
            initial={{ scale: 1.1 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 14 }}
            className="origin-left whitespace-nowrap font-display text-4xl font-semibold tabular-nums sm:text-[2.6rem]"
          >
            {fmtSol(pool)}
          </motion.p>
          <AnimatePresence>
            {delta && (
              <motion.span
                key={delta.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="rounded-md bg-[#ffe39a] px-1.5 py-0.5 text-xs font-semibold text-ink"
              >
                +{fmtSol(delta.lamports)}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <p className="mt-auto pt-3 text-xs text-white/90">
          {charges} {charges === 1 ? 'charge' : 'charges'} · {fmtSol(staked)} staked
          {mine && <span className="block text-white/80">{mine}</span>}
        </p>
      </div>
      <div className="relative self-end">
        <CoinStack count={charges} />
      </div>
    </div>
  )
}

function WinnerCard({ leaders, settled }: { leaders: LeaderboardEntry[]; settled: boolean }) {
  const top = leaders[0]
  return (
    <div className="relative flex min-w-0 items-center gap-3 overflow-hidden rounded-2xl border border-[#f0dc9a] bg-gradient-to-br from-[#fff1c4] via-[#ffe39a] to-[#bcefe0] p-4 sm:p-5 md:min-h-[148px]">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink/80">{settled ? 'Won the pool' : 'Winning right now'}</p>
        <AnimatePresence mode="wait">
          <motion.p
            key={leaders.map((l) => l.wallet).join()}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mt-1 flex min-w-0 items-center gap-1.5 font-display text-xl font-semibold sm:text-3xl"
          >
            <Crown className="size-5 shrink-0 sm:size-6" />
            <span className="truncate">{leaders.length ? leaders.map((l) => l.displayName).join(' & ') : '—'}</span>
          </motion.p>
        </AnimatePresence>
        <p className="mt-1 text-xs text-ink/80">
          {top
            ? `${fmtClock(top.blockedSeconds ?? top.blockedMinutes * 60)} blocked${leaders.length > 1 && !settled ? ' · tied, they would split it' : ' · lowest in the group'}`
            : 'Nobody has staked yet'}
        </p>
      </div>
      <TomMoment moment="win" size={112} stage={false} className="-mb-6 -mr-3 hidden self-end sm:block" />
    </div>
  )
}

function StatusClock({ data, now }: { data: GroupState; now: number }) {
  const { group } = data
  let label = 'Time left'
  let value = fmtCountdown(group.periodEnd - now)
  let frac = Math.max(0, Math.min(1, (group.periodEnd - now) / Math.max(1, group.periodEnd - group.periodStart)))
  if (group.status === 'upcoming') {
    label = 'Starts in'
    value = fmtCountdown(group.periodStart - now)
    frac = 1
  } else if (group.status === 'ended') {
    label = 'Period over'
    frac = 0
    const s = group.settlement?.status
    value =
      s === 'confirmed' ? 'Settled' : s === 'skipped' ? 'No stakes' : s === 'failed' ? 'Settle failed' : 'Settling…'
  }
  const urgent = group.status === 'active' && frac < 0.2
  const C = 2 * Math.PI * 26
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col items-start gap-2 rounded-2xl border p-4 transition-colors duration-700 sm:flex-row sm:items-center sm:gap-4 sm:p-5 md:min-h-[148px]',
        urgent ? 'border-[#f3c1cc] bg-gradient-to-br from-[#ffe1e6] to-[#f6b9d6]' : 'border-[#d6dcfb] bg-gradient-to-br from-[#e7e0ff] to-[#dce6ff]',
      )}
    >
      <svg viewBox="0 0 64 64" className="size-10 shrink-0 -rotate-90 sm:size-16" aria-hidden="true">
        <circle cx="32" cy="32" r="26" fill="none" stroke="#ffffff" strokeOpacity="0.8" strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r="26"
          fill="none"
          stroke={urgent ? '#d6364a' : '#6a47f0'}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.7s' }}
        />
      </svg>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink/80">{label}</p>
        <p className="truncate font-mono text-2xl font-semibold tabular-nums sm:text-3xl">{value}</p>
        <p className="text-xs text-ink/75">
          {group.status === 'active' ? (urgent ? 'Final stretch. Put the phone down.' : 'until the pool is settled') : group.status === 'upcoming' ? 'until tracking starts' : 'final standings below'}
        </p>
      </div>
    </div>
  )
}

type RowState = 'over' | 'tracked' | 'offline' | 'idle' | 'safe' | 'unpaired' | 'ended'

const STATE: Record<RowState, { label: string; chip: string; row: string; avatar: string; Icon: typeof Eye }> = {
  over: { label: 'Over limit', chip: 'bg-[#d6364a] text-white', row: 'border-l-[#d6364a] bg-[#fff0f2]', avatar: 'bg-[#d6364a] text-white', Icon: Flame },
  tracked: { label: 'Tracked app', chip: 'bg-[#f6b9d6] text-ink', row: 'border-l-[#e26aa5] bg-[#fdf3f8]', avatar: 'bg-[#f6b9d6] text-ink', Icon: Eye },
  offline: { label: 'Offline', chip: 'bg-[#ffe39a] text-ink', row: 'border-l-[#e0a400] bg-[#fffaeb]', avatar: 'bg-[#ffe39a] text-ink', Icon: WifiOff },
  idle: { label: 'Idle', chip: 'bg-[#e7e0ff] text-ink', row: 'border-l-[#b9a5ff]', avatar: 'bg-[#e7e0ff] text-ink', Icon: Moon },
  safe: { label: 'Safe', chip: 'bg-[#bcefe0] text-ink', row: 'border-l-[#3fbf95]', avatar: 'bg-[#bcefe0] text-ink', Icon: ShieldCheck },
  unpaired: { label: 'Not paired', chip: 'bg-muted text-ink', row: 'border-l-transparent', avatar: 'bg-muted text-ink', Icon: Unplug },
  ended: { label: 'Done', chip: 'bg-muted text-ink', row: 'border-l-transparent', avatar: 'bg-muted text-ink', Icon: ShieldCheck },
}

function MemberRow({
  member: m,
  rank,
  leading,
  allowance,
  tariff,
  chargeUnitSecs,
  isMe,
  now,
  active,
}: {
  member: Member
  rank: number | null
  leading: boolean
  allowance: number
  tariff: number // lamports per charge
  chargeUnitSecs: number
  isMe: boolean
  now: number
  active: boolean
}) {
  // Tick per second between polls: while they're on a blocked app, count up from the last report,
  // capped at 3 s so it never runs ahead of what the tracker will actually report.
  const lastSeen = m.tracker.lastSeenAt
  const ticking = active && m.tracker.online && !m.tracker.idle && m.current !== null && lastSeen !== null
  const liveSeconds = m.usage.blockedSeconds + (ticking ? Math.min(3, Math.max(0, (now - lastSeen) / 1000)) : 0)
  const onBlocked = !!m.current && active
  const over = active && liveSeconds > allowance * 60
  const rowState: RowState = !active
    ? 'ended'
    : !m.tracker.paired
      ? 'unpaired'
      : onBlocked && over
        ? 'over'
        : onBlocked
          ? 'tracked'
          : !m.tracker.online
            ? 'offline'
            : m.tracker.idle
              ? 'idle'
              : 'safe'
  const st = STATE[rowState]
  const act = activityOf(m, now)
  return (
    <div className={cn('border-l-4 px-4 py-3.5 transition-colors duration-500 sm:py-4', st.row, leading && 'bg-gradient-to-r from-[#fff6d8] to-transparent', !m.staked && active && 'opacity-85')}>
      <div className="flex items-center gap-3">
        <span className="relative shrink-0">
          <span
            className={cn('flex size-9 items-center justify-center rounded-full font-display text-sm font-semibold transition-colors duration-500', st.avatar)}
            aria-hidden="true"
          >
            {m.displayName.slice(0, 2).toUpperCase()}
          </span>
          <span
            className={cn(
              'absolute -bottom-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ring-2 ring-white',
              leading ? 'bg-gradient-to-br from-[#ffd45e] to-[#f5a524] text-ink' : 'bg-ink text-white',
            )}
            aria-label={leading ? 'Leading' : rank ? `Rank ${rank}` : 'Unranked'}
          >
            {leading ? <Crown className="size-2.5" /> : rank ?? '–'}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold">{m.displayName}</span>
            {isMe && <span className="text-xs font-medium text-brand">(you)</span>}
            <span className="hidden font-mono text-xs text-muted-foreground md:inline" title={m.wallet}>
              {shortAddr(m.wallet)}
            </span>
          </p>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={act.icon + (m.current?.app ?? '') + rowState}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="mt-0.5 truncate text-xs"
            >
              {active || !m.tracker.paired ? <ActivityBadge member={m} now={now} /> : <span className="text-muted-foreground">Period over</span>}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="font-mono text-lg font-semibold tabular-nums sm:text-xl" title="Blocked screen time this period">
            {fmtClock(liveSeconds)}
          </p>
          <motion.span
            key={rowState}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold', st.chip)}
          >
            <st.Icon className="size-3" /> {st.label}
          </motion.span>
        </div>
      </div>

      <div className="mt-2.5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-6">
        <UsageBar
          usedSeconds={liveSeconds}
          allowanceSeconds={allowance * 60}
          tariffLamports={tariff}
          chargeUnitSecs={chargeUnitSecs}
          charging={active && m.staked}
        />
        {m.staked ? (
          <dl className="flex gap-4 text-xs sm:grid sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Staked</dt>
              <dd className="font-semibold tabular-nums">{fmtSol(m.stakedLamports)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Into pool</dt>
              <dd className="font-semibold tabular-nums text-bad">−{fmtSol(m.slashedLamports)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{m.receivedLamports > 0 ? 'Prize' : 'Balance'}</dt>
              <dd className={cn('font-semibold tabular-nums', m.receivedLamports > 0 && 'text-good')}>
                {m.receivedLamports > 0 ? `+${fmtSol(m.receivedLamports)}` : fmtSol(m.remainingLamports)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">Not staked: can't be charged or win the pool.</p>
        )}
      </div>

      {m.usage.byApp.length > 0 && (
        <p
          className="mt-2 hidden truncate text-xs text-muted-foreground sm:block"
          title={m.usage.byApp.map((a) => `${a.app} ${fmtDuration(a.seconds)}`).join(', ')}
        >
          Top apps:{' '}
          {m.usage.byApp
            .slice(0, 3)
            .map((a) => `${a.app} ${fmtDuration(a.seconds)}`)
            .join(' · ')}
        </p>
      )}
    </div>
  )
}
