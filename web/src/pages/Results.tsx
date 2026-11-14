import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { api } from '../api'
import { useGroupState } from '../api/hooks'
import { USE_MOCK } from '../config'
import { explorerTx, fmtDuration, fmtSol, shortAddr } from '../lib/format'
import { Mascot } from '../components/Mascot'
import { Card, EmptyState, ErrorBox, Loading, btnGhost, btnPrimary } from '../components/ui'

const CONFETTI = ['🎉', '✨', '◎', '🪙', '🎊']

// Winner-takes-pool (docs/contract.md v0.3): after the period, the staked member(s) with the
// lowest blocked time win the whole penalty pool; then everyone withdraws stake - slashed + prize.
export function Results() {
  const { groupId = '' } = useParams()
  const { publicKey } = useWallet()
  const wallet = publicKey?.toBase58() ?? null
  const queryClient = useQueryClient()
  const state = useGroupState(groupId)

  const withdraw = useMutation({
    mutationFn: () => api.withdraw(groupId, wallet!),
    onSuccess: () => {
      toast.success(USE_MOCK ? 'Withdrawn (demo, no transaction sent).' : 'Withdrawn to your wallet!')
      queryClient.invalidateQueries({ queryKey: ['state', groupId] })
    },
  })

  if (state.isLoading) return <Loading label="Loading results…" />
  if (state.isError)
    return <ErrorBox message={(state.error as Error).message} onRetry={() => state.refetch()} />

  const { group, members, leaderboard, totals } = state.data!
  if (members.length === 0) return <EmptyState title="No members in this group" />

  const settlement = group.settlement
  const settled = settlement?.status === 'confirmed'
  const leaders = leaderboard.filter((l) => l.leading)
  const byWallet = new Map(members.map((m) => [m.wallet, m]))
  const me = wallet ? byWallet.get(wallet) : undefined
  const link =
    settlement?.explorerUrl ??
    (settlement?.signature && !settlement.signature.startsWith('mock_') ? explorerTx(settlement.signature) : null)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {group.status !== 'ended' && (
        <Card className="border-amber-300/40 bg-amber-300/10 text-sm text-amber-100">
          The period is still running. These are the standings so far; the pool is paid out after
          it ends.
        </Card>
      )}
      {group.status === 'ended' && !settlement && (
        <Card className="border-sky-300/40 bg-sky-300/10 text-sm text-sky-100">
          Period over. The backend settles the pool shortly after the end…
        </Card>
      )}
      {settlement && (settlement.status === 'pending' || settlement.status === 'sent') && (
        <Card className="border-sky-300/40 bg-sky-300/10 text-sm text-sky-100">Settling the pool on-chain…</Card>
      )}
      {settlement?.status === 'failed' && (
        <ErrorBox message="Settling the pool failed. The backend will keep retrying; members can still use emergency refund." />
      )}
      {settlement?.status === 'skipped' && <EmptyState title="Nobody staked, so there was no pool to win." />}

      {settled ? (
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
              {settlement.winners.length > 1 ? 'Tied for lowest screen time' : 'Lowest screen time'}
            </p>
            <p className="text-4xl font-extrabold">👑 {settlement.winners.map((w) => w.displayName).join(' & ')}</p>
            <p className="text-lg text-emerald-300">
              {settlement.winners.length > 1
                ? `Split the ${fmtSol(settlement.poolLamports)} pool`
                : `Wins the whole pool: ${fmtSol(settlement.poolLamports)}`}
            </p>
            {link ? (
              <a className="text-sm text-sky-300 underline" href={link} target="_blank" rel="noreferrer">
                View settlement on Solana Explorer
              </a>
            ) : (
              <p className="text-xs text-white/40">No Explorer link (demo or mock chain)</p>
            )}
          </motion.div>
        </Card>
      ) : (
        leaders.length > 0 && (
          <Card className="text-center">
            <p className="text-sm uppercase tracking-widest text-white/50">Would win right now</p>
            <p className="text-2xl font-bold">👑 {leaders.map((l) => l.displayName).join(' & ')}</p>
            <p className="text-sm text-white/60">Pool so far: {fmtSol(totals.penaltyPoolLamports)}</p>
          </Card>
        )
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="text-white/50">
            <tr className="border-b border-white/10">
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Blocked time</th>
              <th className="px-4 py-3">Staked</th>
              <th className="px-4 py-3">Into pool</th>
              <th className="px-4 py-3">Prize</th>
              <th className="px-4 py-3">Withdrawable</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((l) => {
              const m = byWallet.get(l.wallet)
              if (!m) return null
              return (
                <tr key={m.wallet} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 font-semibold">{l.leading ? `👑 ${l.rank}` : l.rank}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{m.displayName}</p>
                    <p className="font-mono text-xs text-white/40">{shortAddr(m.wallet)}</p>
                  </td>
                  <td className="px-4 py-3">{fmtDuration(m.usage.blockedSeconds)}</td>
                  <td className="px-4 py-3">{m.staked ? fmtSol(m.stakedLamports) : <span className="text-white/40">not staked</span>}</td>
                  <td className="px-4 py-3 text-red-300">
                    {m.slashedLamports > 0 ? `-${fmtSol(m.slashedLamports)}` : <span className="text-white/40">—</span>}
                  </td>
                  <td className="px-4 py-3 text-emerald-300">
                    {m.receivedLamports > 0 ? `+${fmtSol(m.receivedLamports)}` : <span className="text-white/40">—</span>}
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {fmtSol(m.remainingLamports)}
                    {m.withdrawn && <span className="ml-1 text-xs text-white/40">(withdrawn)</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      {withdraw.isError && <ErrorBox message={(withdraw.error as Error).message} />}
      <div className="flex flex-wrap gap-2">
        {me?.staked && settled && !me.withdrawn && (
          <button className={btnPrimary} disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
            {withdraw.isPending ? 'Withdrawing…' : `Withdraw ${fmtSol(me.remainingLamports)}`}
          </button>
        )}
        <Link className={btnGhost} to={`/group/${groupId}`}>
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
