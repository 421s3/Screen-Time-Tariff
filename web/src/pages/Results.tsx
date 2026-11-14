import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useGroupState } from '../api/hooks'
import { explorerTx, fmtDuration, fmtSol, shortAddr } from '../lib/format'
import { Mascot } from '../components/Mascot'
import { Card, EmptyState, ErrorBox, Loading, btnGhost } from '../components/ui'

const CONFETTI = ['🎉', '✨', '◎', '🪙', '🎊']

// Winner-takes-all: lowest total screen time wins the whole pot; ties split it evenly.
export function Results() {
  const { groupId = '' } = useParams()
  const state = useGroupState(groupId)

  if (state.isLoading) return <Loading label="Loading results…" />
  if (state.isError)
    return <ErrorBox message={(state.error as Error).message} onRetry={() => state.refetch()} />

  const { group, members, totals, result } = state.data!
  const racing = members.filter((m) => m.staked)
  if (racing.length === 0) return <EmptyState title="Nobody has staked in this group yet" />

  const payout = new Map(result?.winners.map((w) => [w.wallet, w.payoutLamports]) ?? [])
  const leaders = racing.filter((m) => m.rank === 1)
  const link = result?.explorerUrl ?? (result?.signature ? explorerTx(result.signature) : null)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {group.status === 'upcoming' && (
        <Card className="border-amber-300/40 bg-amber-300/10 text-sm text-amber-100">
          The session hasn't started yet.
        </Card>
      )}
      {group.status === 'active' && (
        <Card className="border-amber-300/40 bg-amber-300/10 text-sm text-amber-100">
          The session is still running. These are the standings so far; nothing is paid until it
          ends.
        </Card>
      )}
      {group.status === 'ended' && (
        <Card className="border-sky-300/40 bg-sky-300/10 text-sm text-sky-100">
          Session over. Settling the pot on-chain…
        </Card>
      )}

      {result ? (
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
            <p className="text-sm uppercase tracking-widest text-white/50">
              {result.winners.length > 1 ? 'Tied for lowest screen time' : 'Lowest screen time'}
            </p>
            <p className="text-4xl font-extrabold">
              👑 {result.winners.map((w) => w.displayName).join(' & ')}
            </p>
            <p className="text-lg text-emerald-300">
              {result.winners.length > 1
                ? `Split ${fmtSol(result.potLamports)} (${fmtSol(result.winners[0].payoutLamports)} each)`
                : `Wins the whole pot: ${fmtSol(result.potLamports)}`}
            </p>
            {link ? (
              <a className="text-sm text-sky-300 underline" href={link} target="_blank" rel="noreferrer">
                View payout on Solana Explorer
              </a>
            ) : (
              <p className="text-xs text-white/40">Demo data: no on-chain payout transaction</p>
            )}
          </motion.div>
        </Card>
      ) : (
        leaders.length > 0 && (
          <Card className="text-center">
            <p className="text-sm uppercase tracking-widest text-white/50">Leading right now</p>
            <p className="text-2xl font-bold">👑 {leaders.map((l) => l.displayName).join(' & ')}</p>
            <p className="text-sm text-white/60">Pot: {fmtSol(totals.potLamports)}</p>
          </Card>
        )
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="text-white/50">
            <tr className="border-b border-white/10">
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Screen time</th>
              <th className="px-4 py-3">Staked</th>
              <th className="px-4 py-3">Payout</th>
            </tr>
          </thead>
          <tbody>
            {racing.map((m) => (
              <tr key={m.wallet} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 font-semibold">{m.rank === 1 ? '👑 1' : (m.rank ?? '–')}</td>
                <td className="px-4 py-3">
                  <p className="font-semibold">{m.displayName}</p>
                  <p className="font-mono text-xs text-white/40">{shortAddr(m.wallet)}</p>
                </td>
                <td className="px-4 py-3">
                  {fmtDuration(m.usage.totalSeconds)}
                  {m.usage.offlineSeconds > 0 && (
                    <span className="block text-xs text-amber-200/80">
                      incl. {fmtDuration(m.usage.offlineSeconds)} offline
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">{fmtSol(m.stakedLamports)}</td>
                <td className="px-4 py-3 font-semibold">
                  {result ? (
                    payout.has(m.wallet) ? (
                      <span className="text-emerald-300">+{fmtSol(payout.get(m.wallet)!)}</span>
                    ) : (
                      <span className="text-white/40">0 SOL</span>
                    )
                  ) : (
                    <span className="text-white/40">pending</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Link className={btnGhost} to={`/group/${groupId}`}>
        Back to dashboard
      </Link>
    </div>
  )
}
