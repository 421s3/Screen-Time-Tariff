import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { ArrowLeft, Crown, ExternalLink, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { api } from '../api'
import { useGroupState } from '../api/hooks'
import { USE_MOCK } from '../config'
import { explorerTx, fmtDuration, fmtSol, shortAddr } from '../lib/format'
import { TomMoment } from '../components/TomMoment'
import { EmptyState, ErrorBox, Loading, Notice, PageHeader } from '../components/kit'

const CONFETTI = ['#f2b524', '#5cc79a', '#ff8a7a', '#8fc3ff', '#b7a8ff']

// Winner-takes-pool (docs/contract.md v0.5): after the period, the staked member(s) with the
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
  if (state.isError && !state.data)
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
  const canWithdraw = !!me?.staked && settled && !me.withdrawn

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Results"
        subtitle={`${group.name} · pool ${fmtSol(settled ? settlement!.poolLamports : totals.penaltyPoolLamports)}`}
        mood={settled ? 'celebrate' : group.status === 'ended' ? 'happy' : 'sleepy'}
        say={
          settled
            ? 'Pay day! Withdraw your balance below.'
            : group.status === 'ended'
              ? 'Counting the coins…'
              : 'Still running. Standings so far.'
        }
      />

      {group.status !== 'ended' && (
        <Notice tone="warn">
          The period is still running. These are the standings so far; the pool is paid out after it ends.
        </Notice>
      )}
      {group.status === 'ended' && !settlement && (
        <Notice tone="info">Period over. The backend settles the pool shortly after the end…</Notice>
      )}
      {settlement && (settlement.status === 'pending' || settlement.status === 'sent') && (
        <Notice tone="info">Settling the pool on-chain…</Notice>
      )}
      {settlement?.status === 'failed' && (
        <ErrorBox message="Settling the pool failed. The backend will keep retrying; members can still use emergency refund." />
      )}
      {settlement?.status === 'skipped' && <EmptyState title="Nobody staked, so there was no pool to win." />}

      {settled ? (
        <section className="relative overflow-hidden rounded-xl bg-lemon px-5 py-8 sm:px-8">
          {CONFETTI.flatMap((c, i) =>
            [0, 1].map((j) => (
              <motion.span
                key={`${i}-${j}`}
                aria-hidden="true"
                className="pointer-events-none absolute top-0 size-2 rounded-[2px]"
                style={{ left: `${6 + (i * 2 + j) * 9.5}%`, background: c }}
                animate={{ y: [-10, 260], rotate: [0, 270], opacity: [1, 1, 0] }}
                transition={{ duration: 2.8, delay: (i + j) * 0.3, repeat: 2 }}
              />
            )),
          )}
          <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 12 }}
            >
              <TomMoment moment="win" size={150} />
            </motion.div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink/80">
                {settlement.winners.length > 1 ? 'Tied for lowest screen time' : 'Lowest screen time'}
              </p>
              <p className="mt-1 flex items-center justify-center gap-2 font-display text-3xl font-semibold sm:justify-start sm:text-4xl">
                <Crown className="size-7 shrink-0" />
                <span className="min-w-0 break-words">{settlement.winners.map((w) => w.displayName).join(' & ')}</span>
              </p>
              <p className="mt-1 font-medium text-good">
                {settlement.winners.length > 1
                  ? `Split the ${fmtSol(settlement.poolLamports)} pool`
                  : `Wins the whole pool: ${fmtSol(settlement.poolLamports)}`}
              </p>
              {link ? (
                <a
                  className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                >
                  Settlement on Solana Explorer <ExternalLink className="size-3.5" />
                </a>
              ) : (
                <p className="mt-2 text-xs text-ink/70">No Explorer link (demo or mock chain)</p>
              )}
            </div>
            {canWithdraw && (
              <Button size="lg" variant="success" className="sm:ml-auto" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
                <Wallet />
                {withdraw.isPending ? 'Withdrawing…' : `Withdraw ${fmtSol(me!.remainingLamports)}`}
              </Button>
            )}
          </div>
        </section>
      ) : (
        leaders.length > 0 && (
          <section className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-5">
            <Crown className="size-6" />
            <div>
              <p className="text-sm text-muted-foreground">Would win right now</p>
              <p className="font-display text-2xl font-semibold">{leaders.map((l) => l.displayName).join(' & ')}</p>
            </div>
            <p className="ml-auto text-sm text-muted-foreground">
              Pool so far <span className="font-semibold text-ink">{fmtSol(totals.penaltyPoolLamports)}</span>
            </p>
          </section>
        )
      )}

      {withdraw.isError && <ErrorBox message={(withdraw.error as Error).message} />}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Standings</h2>
        {/* Table from md up, stacked rows below so nothing scrolls sideways. */}
        <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Rank</th>
                <th className="px-4 py-2.5 font-medium">Member</th>
                <th className="px-4 py-2.5 font-medium">Blocked time</th>
                <th className="px-4 py-2.5 text-right font-medium">Staked</th>
                <th className="px-4 py-2.5 text-right font-medium">Into pool</th>
                <th className="px-4 py-2.5 text-right font-medium">Prize</th>
                <th className="px-4 py-2.5 text-right font-medium">Withdrawable</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {leaderboard.map((l) => {
                const m = byWallet.get(l.wallet)
                if (!m) return null
                return (
                  <tr key={m.wallet} className={cn('hover:bg-muted/50', l.leading && 'bg-mint/70')}>
                    <td className="px-4 py-3 font-semibold">
                      {l.leading ? <Crown className="inline size-4" /> : null} {l.rank}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{m.displayName}</p>
                      <p className="font-mono text-xs text-muted-foreground">{shortAddr(m.wallet)}</p>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">{fmtDuration(m.usage.blockedSeconds)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {m.staked ? fmtSol(m.stakedLamports) : <span className="text-muted-foreground">not staked</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-bad">
                      {m.slashedLamports > 0 ? `−${fmtSol(m.slashedLamports)}` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-good">
                      {m.receivedLamports > 0 ? `+${fmtSol(m.receivedLamports)}` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {fmtSol(m.remainingLamports)}
                      {m.withdrawn && <span className="ml-1 text-xs font-normal text-muted-foreground">(withdrawn)</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <ul className="divide-y overflow-hidden rounded-xl border bg-card md:hidden">
          {leaderboard.map((l) => {
            const m = byWallet.get(l.wallet)
            if (!m) return null
            return (
              <li key={m.wallet} className={cn('p-4', l.leading && 'bg-mint/70')}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-muted-foreground">#{l.rank}</span>
                  {l.leading && <Crown className="size-4" />}
                  <span className="min-w-0 flex-1 truncate font-medium">{m.displayName}</span>
                  <span className="font-mono text-sm tabular-nums">{fmtDuration(m.usage.blockedSeconds)}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs min-[400px]:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Staked</dt>
                    <dd className="font-medium">{m.staked ? fmtSol(m.stakedLamports) : 'not staked'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Into pool</dt>
                    <dd className="font-medium text-bad">{m.slashedLamports > 0 ? `−${fmtSol(m.slashedLamports)}` : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Prize</dt>
                    <dd className="font-medium text-good">{m.receivedLamports > 0 ? `+${fmtSol(m.receivedLamports)}` : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Withdrawable</dt>
                    <dd className="font-semibold">
                      {fmtSol(m.remainingLamports)}
                      {m.withdrawn && ' (withdrawn)'}
                    </dd>
                  </div>
                </dl>
              </li>
            )
          })}
        </ul>
      </section>

      <Button asChild variant="outline">
        <Link to={`/group/${groupId}`}>
          <ArrowLeft /> Back to dashboard
        </Link>
      </Button>
    </div>
  )
}
