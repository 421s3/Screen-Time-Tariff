import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useGroupState } from '../api/hooks'
import { fmtSol, shortAddr } from '../lib/format'
import { Mascot } from '../components/Mascot'
import { Card, EmptyState, ErrorBox, Loading, btnGhost } from '../components/ui'

const CONFETTI = ['🎉', '✨', '◎', '🪙', '🎊']

// Agreed payout model (docs/deliverables.md): penalties are paid out immediately and everyone
// withdraws what's left. The "winner" is the lowest screen time; no extra pool is assumed.
export function Results() {
  const { groupId = '' } = useParams()
  const state = useGroupState(groupId)

  if (state.isLoading) return <Loading label="Loading results…" />
  if (state.isError)
    return <ErrorBox message={(state.error as Error).message} onRetry={() => state.refetch()} />

  const { group, members, leaderboard } = state.data!
  if (members.length === 0) return <EmptyState title="No members in this group" />

  const winner = leaderboard[0]
  const ended = group.status === 'ended' || Date.now() >= group.periodEnd

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {!ended && (
        <Card className="border-amber-300/40 bg-amber-300/10 text-sm text-amber-100">
          The challenge is still running. These are the standings so far.
        </Card>
      )}

      {winner && (
        <Card className="relative overflow-hidden text-center">
          {CONFETTI.flatMap((c, i) =>
            [0, 1].map((j) => (
              <motion.span
                key={`${i}-${j}`}
                className="pointer-events-none absolute text-2xl"
                style={{ left: `${8 + (i * 2 + j) * 9}%`, top: '-10%' }}
                animate={{ y: ['0%', '900%'], rotate: [0, 360], opacity: [1, 1, 0] }}
                transition={{ duration: 2.6, delay: (i + j) * 0.25, repeat: Infinity }}
              >
                {c}
              </motion.span>
            )),
          )}
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 12 }}
            className="flex flex-col items-center gap-2 py-4"
          >
            <Mascot size={96} />
            <p className="text-sm uppercase tracking-widest text-white/50">Lowest screen time</p>
            <p className="text-4xl font-extrabold">👑 {winner.displayName}</p>
            <p className="text-white/60">{winner.blockedMinutes} blocked minutes</p>
          </motion.div>
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-white/50">
            <tr className="border-b border-white/10">
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Staked</th>
              <th className="px-4 py-3">Paid in penalties</th>
              <th className="px-4 py-3">Received</th>
              <th className="px-4 py-3">Refund (withdrawable)</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.wallet} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3">
                  <p className="font-semibold">{m.displayName}</p>
                  <p className="font-mono text-xs text-white/40">{shortAddr(m.wallet)}</p>
                </td>
                <td className="px-4 py-3">{fmtSol(m.stakedLamports)}</td>
                <td className="px-4 py-3 text-red-300">-{fmtSol(m.slashedLamports)}</td>
                <td className="px-4 py-3 text-emerald-300">+{fmtSol(m.receivedLamports)}</td>
                <td className="px-4 py-3 font-semibold">
                  {fmtSol(m.remainingLamports)}
                  {m.withdrawn && <span className="ml-1 text-xs text-white/40">(withdrawn)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex flex-wrap gap-2">
        <button className={btnGhost} disabled title="Withdraw arrives at CP3 (needs the Anchor program)">
          Withdraw remaining stake (CP3)
        </button>
        <Link className={btnGhost} to={`/group/${groupId}`}>
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
