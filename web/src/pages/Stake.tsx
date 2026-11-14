import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { api } from '../api'
import { useGroupState } from '../api/hooks'
import { USE_MOCK } from '../config'
import { explorerTx, fmtSol, parseSolToLamports } from '../lib/format'
import {
  Card,
  ErrorBox,
  Loading,
  WalletGate,
  btnGhost,
  btnPrimary,
  inputCls,
} from '../components/ui'

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
  if (state.isError)
    return <ErrorBox message={(state.error as Error).message} onRetry={() => state.refetch()} />

  const { group, members, totals } = state.data!
  const me = members.find((m) => m.wallet === wallet)
  const ended = group.status === 'ended'

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-2xl font-bold">Stake into “{group.name}”</h2>

      <Card className="grid gap-3 text-sm sm:grid-cols-4">
        <Info label="Allowance" value={`${group.rules.allowanceMinutes} min`} />
        <Info label="Tariff" value={`${fmtSol(group.rules.tariffLamportsPerMinute)}/min`} />
        <Info label="Pool so far" value={fmtSol(totals.penaltyPoolLamports)} />
        <Info label="Invite code" value={group.joinCode} mono />
      </Card>

      <Card className="grid gap-3 text-sm sm:grid-cols-3">
        <Info label="You deposited" value={fmtSol(me?.stakedLamports ?? 0)} />
        <Info label="Paid into the pool" value={fmtSol(me?.slashedLamports ?? 0)} />
        <Info label="Withdrawable" value={fmtSol(me?.remainingLamports ?? 0)} />
      </Card>

      <form onSubmit={onSubmit}>
        <Card className="space-y-3">
          <p className="text-sm text-white/70">
            Your stake is what tariffs are charged from. Only members who stake can be charged, and
            only they can win the pool.
          </p>
          {!me ? (
            <p className="text-amber-200">Join this group first (use the invite code).</p>
          ) : ended ? (
            <p className="text-amber-200">The period has ended, so staking is closed.</p>
          ) : (
            <>
              <label className="block space-y-1">
                <span className="text-sm text-white/70">Amount (devnet SOL)</span>
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              {mutation.isError && <ErrorBox message={(mutation.error as Error).message} />}
              <button className={`${btnPrimary} w-full`} disabled={mutation.isPending}>
                {mutation.isPending ? 'Waiting for confirmation…' : me.staked ? 'Add to stake' : 'Stake SOL'}
              </button>
            </>
          )}
          {USE_MOCK && (
            <p className="text-xs text-amber-200">
              Demo mode: no transaction is sent. Real staking via Phantom arrives at CP3.
            </p>
          )}
          {lastSig && (
            <a className="text-sm text-sky-300 underline" href={explorerTx(lastSig)} target="_blank" rel="noreferrer">
              View on Solana Explorer
            </a>
          )}
        </Card>
      </form>

      <div className="flex flex-wrap gap-2">
        <Link className={btnGhost} to={`/group/${groupId}/pair`}>
          Next: pair your tracker
        </Link>
        <Link className={btnGhost} to={`/group/${groupId}`}>
          Go to dashboard
        </Link>
      </div>
    </div>
  )
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-white/50">{label}</p>
      <p className={`text-lg font-semibold ${mono ? 'font-mono tracking-widest' : ''}`}>{value}</p>
    </div>
  )
}
