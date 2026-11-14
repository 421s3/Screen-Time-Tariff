import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { api } from '../api'
import { useGroupState } from '../api/hooks'
import { MIN_MEMBERS_TO_START, SESSION_PRESETS, type GroupState, type Member, type RankEvent } from '../types'
import { fmtCountdown, fmtDuration, fmtSol, ordinal, shortAddr } from '../lib/format'
import { Mascot } from '../components/Mascot'
import { RankFeed } from '../components/RankFeed'
import {
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  TimeBar,
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

  // Mascot popup whenever someone takes the lead (not on first load).
  const lastSeen = useRef<string | null>(null)
  const [popup, setPopup] = useState<RankEvent | null>(null)
  const newest = state.data?.events[0] ?? null
  const newestId = newest?.eventId ?? null
  useEffect(() => {
    if (!newest || !newestId) return
    const previous = lastSeen.current
    lastSeen.current = newestId
    if (previous === null || previous === newestId || newest.kind !== 'took_lead') return
    setPopup(newest)
    toast(`👑 ${newest.displayName} took the lead`)
    const t = setTimeout(() => setPopup(null), 4500)
    return () => clearTimeout(t)
    // Only react to a new event id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId])

  if (state.isLoading) return <Loading label="Loading group dashboard…" />
  if (state.isError)
    return <ErrorBox message={(state.error as Error).message} onRetry={() => state.refetch()} />

  const data = state.data!
  const { group, members, events, totals } = data
  const me = wallet ? members.find((m) => m.wallet === wallet) : undefined
  const racing = members.filter((m) => m.staked)
  const maxSeconds = Math.max(0, ...racing.map((m) => m.usage.totalSeconds))
  const presetLabel =
    SESSION_PRESETS.find((p) => p.id === group.rules.sessionPreset)?.label ?? group.rules.sessionPreset
  const finished = group.status === 'ended' || group.status === 'settled'

  return (
    <div className="space-y-6">
      {!connected && (
        <Card className="border-sky-400/30 bg-sky-500/10 text-sm text-sky-100">
          You're viewing this group without a wallet. Connect Phantom to join, stake, or pair a
          tracker.
        </Card>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{group.name}</h2>
          <p className="text-sm text-white/60">
            Invite code{' '}
            <span className="font-mono font-semibold tracking-widest">{group.joinCode}</span> ·{' '}
            {fmtSol(group.rules.stakeLamports)} entry · {presetLabel} · lowest screen time wins
          </p>
        </div>
        <StatusClock data={data} now={now} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-emerald-400/30 bg-emerald-500/10 p-4">
          <p className="text-xs text-emerald-200/80">Pot (winner takes all)</p>
          <p className="text-3xl font-extrabold text-emerald-200">{fmtSol(totals.potLamports)}</p>
        </Card>
        <Stat
          label="In the race"
          value={`${totals.stakedMembers} of ${group.rules.maxMembers} max`}
        />
        <Stat
          label="Your rank"
          value={
            !me
              ? connected
                ? 'Not a member'
                : '—'
              : me.rank
                ? `${ordinal(me.rank)} of ${totals.stakedMembers}`
                : me.staked
                  ? 'Starts with session'
                  : 'Not staked'
          }
        />
      </div>

      {group.status === 'upcoming' && <StartPanel data={data} wallet={wallet} />}

      {finished && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-violet-400/40">
          <p className="font-semibold">
            {group.status === 'settled' ? '🏆 The session is over and the pot has been paid.' : '⏱️ Session over. Settling the pot…'}
          </p>
          <Link className={btnPrimary} to={`/group/${groupId}/results`}>
            See results
          </Link>
        </Card>
      )}

      {members.length === 0 ? (
        <EmptyState title="No members yet" body={`Share the invite code ${group.joinCode}.`} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence initial={false}>
            {members.map((m) => (
              <motion.div key={m.wallet} layout transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
                <MemberCard
                  member={m}
                  maxSeconds={maxSeconds}
                  isMe={m.wallet === wallet}
                  upcoming={group.status === 'upcoming'}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">Rank changes</h3>
          <div className="flex flex-wrap gap-2">
            <Link className={btnGhost} to={`/group/${groupId}/stake`}>
              Stake
            </Link>
            <Link className={btnGhost} to={`/group/${groupId}/pair`}>
              Pair tracker
            </Link>
            <Link className={btnGhost} to={`/group/${groupId}/results`}>
              Results
            </Link>
          </div>
        </div>
        <RankFeed events={events} />
      </section>

      <AnimatePresence>
        {popup && (
          <motion.div
            key={popup.eventId}
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
              <p className="text-xl font-extrabold text-emerald-300">👑 {popup.displayName} leads!</p>
              {popup.otherDisplayName && (
                <p className="text-sm text-white/80">Passed {popup.otherDisplayName} for 1st place.</p>
              )}
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
  let value = '—'
  if (group.status === 'upcoming') {
    label = 'Status'
    value = 'Not started'
  } else if (group.status === 'active' && group.periodEnd) {
    value = fmtCountdown(group.periodEnd - now)
  } else if (group.status === 'ended') {
    label = 'Status'
    value = 'Settling…'
  } else if (group.status === 'settled') {
    label = 'Status'
    value = 'Finished'
  }
  return (
    <Card className="px-4 py-2 text-right">
      <p className="text-xs text-white/50">{label}</p>
      <p className="font-mono text-2xl font-bold">{value}</p>
    </Card>
  )
}

function StartPanel({ data, wallet }: { data: GroupState; wallet: string | null }) {
  const queryClient = useQueryClient()
  const { group, totals } = data
  const isCreator = wallet === group.creatorWallet
  const enough = totals.stakedMembers >= MIN_MEMBERS_TO_START
  const mutation = useMutation({
    mutationFn: () => api.startSession(group.groupId, wallet!),
    onSuccess: () => {
      toast.success('Session started. May the least-online win.')
      queryClient.invalidateQueries({ queryKey: ['state', group.groupId] })
    },
  })
  return (
    <Card className="space-y-3 border-amber-300/30 bg-amber-300/5">
      <p className="font-semibold">Waiting to start</p>
      <p className="text-sm text-white/70">
        Members join with code <span className="font-mono">{group.joinCode}</span> and pay the
        entry stake. Joining and staking close when the session starts. Members who haven't staked
        sit this one out.
      </p>
      {mutation.isError && <ErrorBox message={(mutation.error as Error).message} />}
      {isCreator ? (
        <button
          className={btnPrimary}
          disabled={!enough || mutation.isPending}
          onClick={() => mutation.mutate()}
          title={enough ? undefined : `Needs at least ${MIN_MEMBERS_TO_START} staked members`}
        >
          {mutation.isPending ? 'Starting…' : enough ? 'Start session' : `Need ${MIN_MEMBERS_TO_START}+ staked members`}
        </button>
      ) : (
        <p className="text-sm text-white/50">Only the group creator can start the session.</p>
      )}
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
  maxSeconds,
  isMe,
  upcoming,
}: {
  member: Member
  maxSeconds: number
  isMe: boolean
  upcoming: boolean
}) {
  const leading = m.rank === 1
  return (
    <Card
      className={`h-full ${!m.staked ? 'opacity-50' : ''} ${
        leading ? 'border-emerald-400/50' : isMe ? 'border-violet-400/50' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
              leading ? 'bg-emerald-400/25 text-emerald-200' : 'bg-white/10 text-white/70'
            }`}
            aria-label={m.rank ? `Rank ${m.rank}` : 'Unranked'}
          >
            {m.rank ? (leading ? '👑' : `#${m.rank}`) : '–'}
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
        <span
          className={`flex items-center gap-1 text-xs ${m.tracker.online ? 'text-emerald-300' : 'text-white/40'}`}
        >
          <span className={`h-2 w-2 rounded-full ${m.tracker.online ? 'bg-emerald-400' : 'bg-white/30'}`} />
          {m.tracker.paired ? (m.tracker.online ? 'Tracker online' : 'Tracker offline') : 'Not paired'}
        </span>
      </div>

      {!m.staked ? (
        <p className="mt-3 text-sm text-white/60">
          {upcoming ? 'Hasn’t paid the entry stake yet.' : 'Not in the race (didn’t stake before start).'}
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-baseline justify-between">
            <p className="text-2xl font-bold">{fmtDuration(m.usage.totalSeconds)}</p>
            <p className="text-xs text-white/50">screen time</p>
          </div>
          <div className="mt-2">
            <TimeBar seconds={m.usage.totalSeconds} maxSeconds={maxSeconds} leading={leading} />
          </div>
          <p className="mt-3 text-sm">
            {m.current ? (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-red-200">
                {m.current.matchType === 'process' ? '🎮' : '🌐'} On {m.current.app}
              </span>
            ) : m.tracker.paired && !m.tracker.online && !upcoming ? (
              <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-amber-200">
                📴 Offline: counts as screen time
              </span>
            ) : (
              <span className="text-white/50">Not on a blocked app</span>
            )}
          </p>
          {m.usage.offlineSeconds > 0 && (
            <p className="mt-2 text-xs text-amber-200/80">
              Includes {fmtDuration(m.usage.offlineSeconds)} of missed tracker check-ins
            </p>
          )}
        </>
      )}
    </Card>
  )
}
