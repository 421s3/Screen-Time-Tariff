import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { useGroupState } from '../api/hooks'
import type { Member, Penalty } from '../types'
import { fmtCountdown, fmtSol, shortAddr } from '../lib/format'
import { Mascot } from '../components/Mascot'
import { PenaltyFeed } from '../components/PenaltyFeed'
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

  // Pop up the mascot whenever a new penalty arrives (not on first load).
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
    toast(`${newest.displayName} paid ${fmtSol(newest.lamports)} for ${newest.app}`)
    const t = setTimeout(() => setPopup(null), 4500)
    return () => clearTimeout(t)
    // Only react to a new penalty id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId])

  if (state.isLoading) return <Loading label="Loading group dashboard…" />
  if (state.isError)
    return <ErrorBox message={(state.error as Error).message} onRetry={() => state.refetch()} />

  const { group, members, leaderboard, penalties, totals } = state.data!
  const remainingMs = group.periodEnd - now
  const me = wallet ? members.find((m) => m.wallet === wallet) : undefined

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
            Invite code <span className="font-mono font-semibold tracking-widest">{group.joinCode}</span>{' '}
            · {group.rules.allowanceMinutes} min allowance · {fmtSol(group.rules.tariffLamportsPerMinute)}
            /min over
          </p>
        </div>
        <Card className="px-4 py-2 text-right">
          <p className="text-xs text-white/50">
            {group.status === 'ended' || remainingMs <= 0 ? 'Challenge ended' : 'Time left'}
          </p>
          <p className="font-mono text-2xl font-bold">{fmtCountdown(remainingMs)}</p>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total staked" value={fmtSol(totals.stakedLamports)} />
        <Stat label="Paid out in penalties" value={fmtSol(totals.paidOutLamports)} />
        <Stat
          label="Your remaining stake"
          value={me ? fmtSol(me.remainingLamports) : connected ? 'Not staked' : '—'}
        />
      </div>

      {members.length === 0 ? (
        <EmptyState title="No members yet" body={`Share the invite code ${group.joinCode}.`} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <MemberCard
              key={m.wallet}
              member={m}
              allowance={group.rules.allowanceMinutes}
              isMe={m.wallet === wallet}
            />
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Leaderboard</h3>
          <Card className="p-0">
            {leaderboard.length === 0 ? (
              <p className="p-4 text-sm text-white/60">No usage yet.</p>
            ) : (
              <ol>
                {leaderboard.map((l) => (
                  <li
                    key={l.wallet}
                    className="flex items-center justify-between border-b border-white/5 px-4 py-3 last:border-0"
                  >
                    <span>
                      <span className="mr-2 text-white/40">#{l.rank}</span>
                      {l.rank === 1 ? '👑 ' : ''}
                      {l.displayName}
                    </span>
                    <span className="text-sm text-white/60">{l.blockedMinutes} min</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <p className="text-xs text-white/40">Lowest screen time first.</p>
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
            <motion.div
              animate={{ rotate: [0, -10, 10, -6, 0] }}
              transition={{ duration: 0.8 }}
            >
              <Mascot size={72} />
            </motion.div>
            <div>
              <p className="text-xl font-extrabold text-emerald-300">
                +{fmtSol(popup.lamports)}
              </p>
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
  allowance,
  isMe,
}: {
  member: Member
  allowance: number
  isMe: boolean
}) {
  return (
    <Card className={isMe ? 'border-violet-400/50' : ''}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            {m.displayName} {isMe && <span className="text-xs text-violet-300">(you)</span>}
          </p>
          <p className="font-mono text-xs text-white/40" title={m.wallet}>
            {shortAddr(m.wallet)}
          </p>
        </div>
        <span
          className={`flex items-center gap-1 text-xs ${
            m.tracker.online ? 'text-emerald-300' : 'text-white/40'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${m.tracker.online ? 'bg-emerald-400' : 'bg-white/30'}`}
          />
          {m.tracker.paired ? (m.tracker.online ? 'Tracker online' : 'Tracker offline') : 'Not paired'}
        </span>
      </div>

      <p className="mt-3 text-sm">
        {m.current ? (
          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-red-200">
            {m.current.matchType === 'process' ? '🎮' : '🌐'} On {m.current.app}
          </span>
        ) : (
          <span className="text-white/50">Not on a blocked app</span>
        )}
      </p>

      <div className="mt-3">
        <UsageBar usedMinutes={m.usage.blockedMinutes} allowanceMinutes={allowance} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-white/50">Remaining stake</p>
          <p className="font-semibold">{fmtSol(m.remainingLamports)}</p>
        </div>
        <div>
          <p className="text-white/50">Paid / received</p>
          <p className="font-semibold">
            <span className="text-red-300">-{fmtSol(m.slashedLamports)}</span> /{' '}
            <span className="text-emerald-300">+{fmtSol(m.receivedLamports)}</span>
          </p>
        </div>
      </div>
    </Card>
  )
}
