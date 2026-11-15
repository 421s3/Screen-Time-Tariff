import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { ArrowRight, Coins, ExternalLink, LayoutDashboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '../api'
import { useGroupState } from '../api/hooks'
import { USE_MOCK } from '../config'
import { explorerTx, fmtSol, parseSolToLamports } from '../lib/format'
import { ErrorBox, Loading, Notice, PageHeader, Panel, Stat, WalletGate } from '../components/kit'

export function Stake() {
  const { groupId = '' } = useParams()
  return (
    <WalletGate text="Connect Phantom to stake devnet SOL.">
      <StakeInner groupId={groupId} />
    </WalletGate>
  )
}

function StakeInner({ groupId }: { groupId: string }) {
  const { publicKey } = useWallet()
  const wallet = publicKey!.toBase58()
  const queryClient = useQueryClient()
  const state = useGroupState(groupId)
  const [amount, setAmount] = useState('0.5')
  const [lastSig, setLastSig] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const lamports = parseSolToLamports(amount)
      if (lamports === null) throw new Error('Enter an amount greater than 0.')
      return api.recordStake(groupId, lamports, wallet)
    },
    onSuccess: (res) => {
      setLastSig(res.signature)
      toast.success(USE_MOCK ? 'Stake recorded (demo, no transaction sent).' : 'Stake confirmed!')
      queryClient.invalidateQueries({ queryKey: ['state', groupId] })
    },
  })

  if (state.isLoading) return <Loading label="Loading group…" />
  if (state.isError && !state.data)
    return <ErrorBox message={(state.error as Error).message} onRetry={() => state.refetch()} />

  const { group, members, totals } = state.data!
  const me = members.find((m) => m.wallet === wallet)
  const ended = group.status === 'ended'

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate()
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={<>Stake into “{group.name}”</>}
        subtitle="Tariffs come out of your stake, and only staked members can win the pool."
        mood={me?.staked ? 'celebrate' : 'happy'}
        say={me?.staked ? "You're in! Add more any time." : 'Put some SOL where your screen time is.'}
      />

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
        <form onSubmit={onSubmit}>
          <Panel className="space-y-5">
            {!me ? (
              <Notice tone="warn">Join this group first (use the invite code).</Notice>
            ) : ended ? (
              <Notice tone="warn">The period has ended, so staking is closed.</Notice>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="amount">Amount (devnet SOL)</Label>
                  <div className="relative">
                    <Input
                      id="amount"
                      className="h-14 pr-14 font-display text-2xl font-semibold md:text-2xl"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                      SOL
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {['0.1', '0.25', '0.5', '1'].map((v) => (
                      <button type="button" key={v} className="chip min-h-8 px-3 py-1 text-sm" aria-pressed={amount === v} onClick={() => setAmount(v)}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                {mutation.isError && <ErrorBox message={(mutation.error as Error).message} />}
                <Button size="lg" className="w-full" disabled={mutation.isPending}>
                  <Coins />
                  {mutation.isPending ? 'Waiting for confirmation…' : me.staked ? 'Add to stake' : 'Stake SOL'}
                </Button>
              </>
            )}
            {USE_MOCK && (
              <p className="text-sm text-warn">Demo mode: no transaction is sent.</p>
            )}
            {lastSig && (
              <a
                className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
                href={explorerTx(lastSig)}
                target="_blank"
                rel="noreferrer"
              >
                View on Solana Explorer <ExternalLink className="size-3.5" />
              </a>
            )}
          </Panel>
        </form>

        <aside className="space-y-3">
          <Stat label="You deposited" value={fmtSol(me?.stakedLamports ?? 0)} />
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Paid into pool" value={fmtSol(me?.slashedLamports ?? 0)} />
            <Stat label="Withdrawable" value={fmtSol(me?.remainingLamports ?? 0)} tone="bg-mint border-[#b9e3cc]" />
          </div>
          <dl className="divide-y rounded-xl border bg-card text-sm">
            {[
              ['Allowance', `${group.rules.allowanceMinutes} min`],
              ['Tariff', `${fmtSol(group.rules.tariffLamportsPerMinute)} / min`],
              ['Pool so far', fmtSol(totals.penaltyPoolLamports)],
              ['Invite code', group.joinCode],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 px-4 py-2.5">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className={k === 'Invite code' ? 'font-mono font-semibold tracking-widest' : 'font-medium'}>{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild>
          <Link to={`/group/${groupId}/pair`}>
            Next: pair your tracker <ArrowRight />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={`/group/${groupId}`}>
            <LayoutDashboard /> Dashboard
          </Link>
        </Button>
      </div>
    </div>
  )
}
