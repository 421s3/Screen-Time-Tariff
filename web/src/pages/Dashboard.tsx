import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { useGroupState } from '../api/hooks'
import type { GroupState, Member, Penalty } from '../types'
import { fmtCountdown, fmtDuration, fmtSol, shortAddr } from '../lib/format'
import { Mascot } from '../components/Mascot'
import { PenaltyFeed } from '../components/PenaltyFeed'
import { ActivityBadge } from '../components/Activity'
import {
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  UsageBar,
  btnGhost,
  btnPrimary,
} from '../components/ui'

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
  const [popup, setPopup] = useState<Penalty | null>(null)
  const newest = state.data?.penalties[0] ?? null
  const newestId = newest?.penaltyId ?? null
  useEffect(() => {
    if (!newest || !newestId) return
    const previous = lastSeen.current
    lastSeen.current = newestId
    if (previous === null || previous === newestId) return
    setPopup(newest)
    toast(`${newest.displayName} paid ${fmtSol(newest.lamports)} into the pool (${newest.app})`)
    const t = setTimeout(() => setPopup(null), 4500)
    return () => clearTimeout(t)
    // Only react to a new penalty id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId])

  if (state.isLoading) return <Loading label="Loading group dashboard…" />
  if (state.isError)
    return <ErrorBox message={(state.error as Error).message} onRetry={() => state.refetch()} />

  const data = state.data!
  const { group, members, leaderboard, penalties, totals } = data
  const me = wallet ? members.find((m) => m.wallet === wallet) : undefined
  const leaders = leaderboard.filter((l) => l.leading)
  const leadingSet = new Set(leaders.map((l) => l.wallet))
  const rankOf = new Map(leaderboard.map((l) => [l.wallet, l.rank]))
  const ordered = [...members].sort((a, b) => (rankOf.get(a.wallet) ?? 99) - (rankOf.get(b.wallet) ?? 99))
  const settled = group.settlement?.status === 'confirmed'

  return (
    <div className="space-y-6">
      {!connected && (
        <Card className="border-sky-400/30 bg-sky-500/10 text-sm text-sky-100">
          You're viewing this group without a wallet. Connect Phantom to stake or pair a tracker.
        </Card>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{group.name}</h2>
          <p className="text-sm text-white/60">
            Invite code <span className="font-mono font-semibold tracking-widest">{group.joinCode}</span> ·{' '}
            {group.rules.allowanceMinutes} min allowance · {fmtSol(group.rules.tariffLamportsPerMinute)}/min over
            goes into the pool
            {group.blocklist.steamGames && ' · Steam games count'}
          </p>
        </div>
        <StatusClock data={data} now={now} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-emerald-400/30 bg-emerald-500/10 p-4">
          <p className="text-xs text-emerald-200/80">Penalty pool (winner takes it)</p>
          <p className="text-3xl font-extrabold text-emerald-200">{fmtSol(totals.penaltyPoolLamports)}</p>
        </Card>
        <Stat label="Total staked" value={fmtSol(totals.stakedLamports)} />
        <Stat
          label="Your withdrawable balance"
          value={me ? (me.staked ? fmtSol(me.remainingLamports) : 'Not staked') : connected ? 'Not a member' : '—'}
        />
      </div>

      {leaders.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-violet-400/40">
          <p className="font-semibold">
            👑 {leaders.map((l) => l.displayName).join(' & ')}{' '}
            {settled ? 'won the pool' : leaders.length > 1 ? 'are tied to win the pool' : 'would win the pool right now'}
          </p>
          {group.status === 'ended' && (
            <Link className={btnPrimary} to={`/group/${groupId}/results`}>
              See results
            </Link>
          )}
        </Card>
      )}

      {members.length === 0 ? (
        <EmptyState title="No members yet" body={`Share the invite code ${group.joinCode}.`} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence initial={false}>
            {ordered.map((m) => (
              <motion.div key={m.wallet} layout transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
                <MemberCard
                  member={m}
                  rank={rankOf.get(m.wallet) ?? null}
                  leading={leadingSet.has(m.wallet)}
                  allowance={group.rules.allowanceMinutes}
                  isMe={m.wallet === wallet}
                  now={now}
                  active={group.status === 'active'}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Leaderboard</h3>
          <Card className="p-0">
            <ol>
              {leaderboard.map((l) => (
                <li
                  key={l.wallet}
                  className="flex items-center justify-between border-b border-white/5 px-4 py-3 last:border-0"
                >
                  <span>
                    <span className="mr-2 text-white/40">#{l.rank}</span>
                    {l.leading ? '👑 ' : ''}
                    {l.displayName}
                  </span>
                  <span className="text-sm text-white/60">{l.blockedMinutes} min</span>
                </li>
              ))}
            </ol>
          </Card>
          <p className="text-xs text-white/40">Staked members first, then lowest blocked time.</p>
          <div className="flex flex-wrap gap-2">
            <Link className={btnPrimary} to={`/group/${groupId}/stake`}>
              Stake
            </Link>
            <Link className={btnGhost} to={`/group/${groupId}/pair`}>
              Pair tracker
            </Link>
            <Link className={btnGhost} to={`/group/${groupId}/results`}>
              Results
            </Link>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Penalty feed</h3>
          <PenaltyFeed penalties={penalties} />
        </section>
      </div>

      <AnimatePresence>
        {popup && (
          <motion.div
            key={popup.penaltyId}
            initial={{ opacity: 0, y: 40, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="fixed bottom-6 left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 items-center gap-4 rounded-2xl border border-violet-400/40 bg-[#1a1530] p-4 shadow-2xl"
            role="status"
          >
            <motion.div animate={{ rotate: [0, -10, 10, -6, 0] }} transition={{ duration: 0.8 }}>
              <Mascot size={72} />
            </motion.div>
            <div>
              <p className="text-xl font-extrabold text-emerald-300">+{fmtSol(popup.lamports)} to the pool</p>
              <p className="text-sm text-white/80">
                {popup.displayName} paid the {popup.app} tariff.
              </p>
              {popup.roast && <p className="mt-1 text-xs italic text-violet-200">“{popup.roast}”</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function StatusClock({ data, now }: { data: GroupState; now: number }) {
  const { group } = data
  let label = 'Time left'
  let value = fmtCountdown(group.periodEnd - now)
  if (group.status === 'upcoming') {
    label = 'Starts in'
    value = fmtCountdown(group.periodStart - now)
  } else if (group.status === 'ended') {
    label = 'Period over'
    const s = group.settlement?.status
    value =
      s === 'confirmed' ? 'Settled' : s === 'skipped' ? 'No stakes' : s === 'failed' ? 'Settle failed' : 'Settling…'
  }
  return (
    <Card className="px-4 py-2 text-right">
      <p className="text-xs text-white/50">{label}</p>
      <p className="font-mono text-2xl font-bold">{value}</p>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-white/50">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </Card>
  )
}

function MemberCard({
  member: m,
  rank,
  leading,
  allowance,
  isMe,
  now,
  active,
}: {
  member: Member
  rank: number | null
  leading: boolean
  allowance: number
  isMe: boolean
  now: number
  active: boolean
}) {
  return (
    <Card
      className={`h-full ${!m.staked ? 'opacity-60' : ''} ${
        leading ? 'border-emerald-400/50' : isMe ? 'border-violet-400/50' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
              leading ? 'bg-emerald-400/25 text-emerald-200' : 'bg-white/10 text-white/70'
            }`}
            aria-label={leading ? 'Leading' : rank ? `Rank ${rank}` : 'Unranked'}
          >
            {leading ? '👑' : rank ? `#${rank}` : '–'}
          </span>
          <div>
            <p className="font-semibold">
              {m.displayName} {isMe && <span className="text-xs text-violet-300">(you)</span>}
            </p>
            <p className="font-mono text-xs text-white/40" title={m.wallet}>
              {shortAddr(m.wallet)}
            </p>
          </div>
        </div>
        <p className="text-right text-lg font-bold" title="Blocked screen time this period">
          {fmtDuration(m.usage.blockedSeconds)}
        </p>
      </div>

      <p className="mt-3 text-sm">
        {active || !m.tracker.paired ? (
          <ActivityBadge member={m} now={now} />
        ) : (
          <span className="text-white/50">Period over</span>
        )}
      </p>

      <div className="mt-3">
        <UsageBar usedMinutes={m.usage.blockedMinutes} allowanceMinutes={allowance} />
      </div>

      {m.staked ? (
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <p className="text-white/50">Staked</p>
            <p className="font-semibold">{fmtSol(m.stakedLamports)}</p>
          </div>
          <div>
            <p className="text-white/50">Into pool</p>
            <p className="font-semibold text-red-300">-{fmtSol(m.slashedLamports)}</p>
          </div>
          <div>
            <p className="text-white/50">{m.receivedLamports > 0 ? 'Prize' : 'Balance'}</p>
            <p className={`font-semibold ${m.receivedLamports > 0 ? 'text-emerald-300' : ''}`}>
              {m.receivedLamports > 0 ? `+${fmtSol(m.receivedLamports)}` : fmtSol(m.remainingLamports)}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-white/50">Not staked: can't be charged and can't win the pool.</p>
      )}

      {(m.usage.offlineMinutes > 0 || m.usage.byApp.length > 0) && (
        <p className="mt-2 truncate text-xs text-white/40" title={m.usage.byApp.map((a) => `${a.app} ${fmtDuration(a.seconds)}`).join(', ')}>
          {m.usage.byApp
            .slice(0, 3)
            .map((a) => `${a.app} ${fmtDuration(a.seconds)}`)
            .join(' · ')}
        </p>
      )}
    </Card>
  )
}
