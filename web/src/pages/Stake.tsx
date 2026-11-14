import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { api } from '../api'
import { useGroupState } from '../api/hooks'
import { USE_MOCK } from '../config'
import { SESSION_PRESETS } from '../types'
import { explorerTx, fmtSol } from '../lib/format'
import { Card, ErrorBox, Loading, WalletGate, btnGhost, btnPrimary } from '../components/ui'

export function Stake() {
  const { groupId = '' } = useParams()
  return (
    <WalletGate text="Connect Phantom to pay the entry stake.">
      <StakeInner groupId={groupId} />
    </WalletGate>
  )
}

function StakeInner({ groupId }: { groupId: string }) {
  const { publicKey } = useWallet()
  const wallet = publicKey!.toBase58()
  const queryClient = useQueryClient()
  const state = useGroupState(groupId)
  const [lastSig, setLastSig] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.recordStake(groupId, wallet),
    onSuccess: (res) => {
      setLastSig(res.signature)
      toast.success(USE_MOCK ? 'Entry stake recorded (demo, no transaction sent).' : 'Stake confirmed!')
      queryClient.invalidateQueries({ queryKey: ['state', groupId] })
    },
  })

  if (state.isLoading) return <Loading label="Loading group…" />
  if (state.isError)
    return <ErrorBox message={(state.error as Error).message} onRetry={() => state.refetch()} />

  const { group, members, totals } = state.data!
  const me = members.find((m) => m.wallet === wallet)
  const presetLabel =
    SESSION_PRESETS.find((p) => p.id === group.rules.sessionPreset)?.label ?? group.rules.sessionPreset
  const open = group.status === 'upcoming'

  let blockedReason: string | null = null
  if (!open) blockedReason = 'The session has started, so staking is closed.'
  else if (!me) blockedReason = 'Join this group first (use the invite code).'
  else if (me.staked) blockedReason = "You're in. Your entry stake is paid."

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-2xl font-bold">Enter “{group.name}”</h2>

      <Card className="grid gap-3 text-sm sm:grid-cols-4">
        <Info label="Entry stake" value={fmtSol(group.rules.stakeLamports)} />
        <Info label="Current pot" value={fmtSol(totals.potLamports)} />
        <Info label="Staked members" value={`${totals.stakedMembers} / ${group.rules.maxMembers}`} />
        <Info label="Session" value={presetLabel} />
      </Card>

      <Card className="space-y-3">
        <p className="text-sm text-white/70">
          Everyone pays the same stake. When the session ends, the lowest total screen time takes
          the whole pot (ties split it). Invite code{' '}
          <span className="font-mono font-semibold tracking-widest text-white">{group.joinCode}</span>
        </p>
        {mutation.isError && <ErrorBox message={(mutation.error as Error).message} />}
        {blockedReason ? (
          <p className={me?.staked ? 'text-emerald-300' : 'text-amber-200'}>{blockedReason}</p>
        ) : (
          <button
            className={`${btnPrimary} w-full`}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? 'Waiting for confirmation…'
              : `Pay entry stake (${fmtSol(group.rules.stakeLamports)})`}
          </button>
        )}
        {USE_MOCK && open && (
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-white/50">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  )
}
