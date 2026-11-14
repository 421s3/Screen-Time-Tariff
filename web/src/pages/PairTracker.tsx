import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { api } from '../api'
import { fmtCountdown } from '../lib/format'
import { Card, ErrorBox, WalletGate, btnGhost, btnPrimary } from '../components/ui'

export function PairTracker() {
  const { groupId = '' } = useParams()
  return (
    <WalletGate text="Connect Phantom to pair the desktop tracker with your wallet.">
      <PairInner groupId={groupId} />
    </WalletGate>
  )
}

function PairInner({ groupId }: { groupId: string }) {
  const { publicKey } = useWallet()
  const [now, setNow] = useState(() => Date.now())
  const mutation = useMutation({
    mutationFn: () => api.startPairing(groupId, publicKey!.toBase58()),
  })

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const data = mutation.data
  const remaining = data ? data.expiresAt - now : 0
  const expired = !!data && remaining <= 0

  const copy = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.code)
      toast.success('Code copied')
    } catch {
      toast.error('Could not copy. Type the code instead.')
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h2 className="text-2xl font-bold">Pair your tracker</h2>
      <Card className="space-y-2 text-sm text-white/70">
        <p>1. Start the tracker on your Windows laptop.</p>
        <p>2. Click the button below to get a one-time code.</p>
        <p>3. Type the code into the tracker. It's valid for 10 minutes.</p>
      </Card>

      {mutation.isError && (
        <ErrorBox message={(mutation.error as Error).message} onRetry={() => mutation.mutate()} />
      )}

      {data && !expired ? (
        <Card className="space-y-3 text-center">
          <p className="text-sm text-white/60">Your pairing code</p>
          <p className="font-mono text-5xl font-bold tracking-[0.3em]">{data.code}</p>
          <p className="text-sm text-white/50">Expires in {fmtCountdown(remaining)}</p>
          <button className={btnGhost} onClick={copy}>
            Copy code
          </button>
        </Card>
      ) : (
        <button
          className={`${btnPrimary} w-full`}
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending
            ? 'Getting code…'
            : expired
              ? 'Code expired: get a new one'
              : 'Get pairing code'}
        </button>
      )}

      <Link className={btnGhost} to={`/group/${groupId}`}>
        Go to dashboard
      </Link>
    </div>
  )
}
