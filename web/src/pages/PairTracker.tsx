import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Copy, KeyRound, LayoutDashboard, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '../api'
import { fmtCountdown } from '../lib/format'
import { ErrorBox, PageHeader, Panel, WalletGate } from '../components/kit'

export function PairTracker() {
  const { groupId = '' } = useParams()
  return (
    <WalletGate text="Connect Phantom to pair the desktop tracker with your wallet.">
      <PairInner groupId={groupId} />
    </WalletGate>
  )
}

const STEPS = [
  { t: 'Open the app', b: 'Start Screen Time Tariff on your Windows PC.' },
  { t: 'Get a code', b: 'Click the button here for a one-time code.' },
  { t: 'Pair', b: 'Type it into the app and click Pair. Codes last 10 minutes.' },
]

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
  const live = !!data && !expired

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
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Pair your tracker"
        subtitle="Link the Windows app to your wallet so your screen time counts for this group."
        mood={live ? 'celebrate' : 'happy'}
        say={live ? 'Type this into the app!' : "Let's get you connected."}
      />

      <ol className="mb-6 grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.t} className="rounded-xl border bg-card p-4">
            <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-[#6a47f0] to-[#7b3fd4] text-sm font-semibold text-white">
              {i + 1}
            </span>
            <p className="mt-3 font-semibold">{s.t}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{s.b}</p>
          </li>
        ))}
      </ol>

      {mutation.isError && (
        <div className="mb-4">
          <ErrorBox message={(mutation.error as Error).message} onRetry={() => mutation.mutate()} />
        </div>
      )}

      <Panel className="flex flex-col items-center gap-4 border-[#d9cffc] bg-gradient-to-br from-[#ece6ff] via-[#f3eaff] to-[#fde8f2] py-8 text-center">
        {live ? (
          <>
            <p className="text-sm font-medium text-ink/80">Your pairing code</p>
            <div className="flex justify-center gap-1.5 sm:gap-2" aria-label={`Pairing code ${data.code}`}>
              {data.code.split('').map((d, i) => (
                <motion.span
                  key={`${data.code}-${i}`}
                  initial={{ y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: i * 0.05, type: 'spring', stiffness: 380, damping: 20 }}
                  className="code-digit h-14 w-10 text-3xl sm:h-16 sm:w-12 sm:text-4xl"
                >
                  {d}
                </motion.span>
              ))}
            </div>
            <p className="text-sm text-ink/80">
              Expires in <span className="font-mono font-semibold">{fmtCountdown(remaining)}</span>
            </p>
            <Button variant="outline" onClick={copy}>
              <Copy /> Copy code
            </Button>
          </>
        ) : (
          <>
            <p className="max-w-sm text-sm text-ink/80">
              {expired ? 'That code expired. Get a fresh one.' : 'Ready when you are. The code works once.'}
            </p>
            <Button size="lg" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {expired ? <RefreshCw /> : <KeyRound />}
              {mutation.isPending ? 'Getting code…' : expired ? 'Get a new code' : 'Get pairing code'}
            </Button>
          </>
        )}
      </Panel>

      <div className="mt-6">
        <Button asChild variant="outline">
          <Link to={`/group/${groupId}`}>
            <LayoutDashboard /> Go to dashboard
          </Link>
        </Button>
      </div>
    </div>
  )
}
