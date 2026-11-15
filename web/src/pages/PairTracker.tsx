import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { api } from '../api'
import { useGroupState } from '../api/hooks'
import { API_URL, TRACKER_DOWNLOAD_URL, TRACKER_EXE, USE_MOCK } from '../config'
import { fmtCountdown } from '../lib/format'
import { Card, ErrorBox, Spinner, WalletGate, btnGhost, btnPrimary } from '../components/ui'

// Pairing codes live 10 minutes (backend config.pairCodeTtlMs). Used to work out, in server
// time, when the code was issued, so an older tracker's check-ins don't count as "connected".
const PAIR_TTL_MS = 10 * 60_000

export function PairTracker() {
  const { groupId = '' } = useParams()
  return (
    <WalletGate text="Connect Phantom to pair the desktop tracker with your wallet.">
      <PairInner groupId={groupId} />
    </WalletGate>
  )
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error('Could not copy. Select it and copy by hand.')
  }
}

function PairInner({ groupId }: { groupId: string }) {
  const { publicKey } = useWallet()
  const wallet = publicKey!.toBase58()
  const [now, setNow] = useState(() => Date.now())
  const state = useGroupState(groupId)
  const mutation = useMutation({
    mutationFn: () => api.startPairing(groupId, wallet),
  })

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const data = mutation.data
  const remaining = data ? data.expiresAt - now : 0
  const expired = !!data && remaining <= 0

  const me = state.data?.members.find((m) => m.wallet === wallet)
  const issuedAt = data ? data.expiresAt - PAIR_TTL_MS : null
  const lastSeen = me?.tracker.lastSeenAt ?? null
  const connected = issuedAt !== null && lastSeen !== null && lastSeen >= issuedAt
  const alreadyOnline = !data && !!me?.tracker.online

  const exeCommand = data ? `${TRACKER_EXE} --api-url ${API_URL} --pair ${data.code}` : ''
  const pyCommand = data ? `python tracker.py --api-url ${API_URL} --pair ${data.code}` : ''
  const localOnly = /localhost|127\.0\.0\.1/.test(API_URL)

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-2xl font-bold">Pair your tracker</h2>
      <p className="text-sm text-white/60">
        The tracker is a small Windows program that reports which app or site is in front of you.
        Pair it once and it charges your time to this wallet.
      </p>

      {state.isError && !state.data && (
        <ErrorBox message={(state.error as Error).message} onRetry={() => state.refetch()} />
      )}
      {state.data && !me && (
        <Card className="border-amber-300/40 bg-amber-300/10 text-sm text-amber-100">
          This wallet isn't in the group yet. <Link className="underline" to="/join">Join with the invite code</Link>{' '}
          first, then pair.
        </Card>
      )}
      {alreadyOnline && (
        <Card className="border-emerald-400/30 bg-emerald-500/10 text-sm text-emerald-100">
          ✅ A tracker is already reporting for this wallet. Pair again only if you're switching laptops.
        </Card>
      )}

      <Card className="space-y-3">
        <p className="font-semibold">1. Get the tracker</p>
        <a className={`${btnPrimary} inline-flex`} href={TRACKER_DOWNLOAD_URL} target="_blank" rel="noreferrer">
          ⬇ Download for Windows
        </a>
        <p className="text-xs text-white/50">
          Windows may warn that the app is unrecognized (it isn't code-signed): click <b>More info</b> →{' '}
          <b>Run anyway</b>. Running from source instead? Use the Python command below.
        </p>
      </Card>

      <Card className="space-y-3">
        <p className="font-semibold">2. Get a one-time code</p>
        {mutation.isError && (
          <ErrorBox message={(mutation.error as Error).message} onRetry={() => mutation.mutate()} />
        )}
        {data && !expired ? (
          <div className="space-y-2 text-center">
            <p className="font-mono text-5xl font-bold tracking-[0.3em]">{data.code}</p>
            <p className="text-sm text-white/50">Expires in {fmtCountdown(remaining)}</p>
            <button className={btnGhost} onClick={() => copyText(data.code, 'Code')}>
              Copy code
            </button>
          </div>
        ) : (
          <button
            className={`${btnPrimary} w-full`}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || (!!state.data && !me)}
          >
            {mutation.isPending ? 'Getting code…' : expired ? 'Code expired: get a new one' : 'Get pairing code'}
          </button>
        )}
      </Card>

      {data && !expired && (
        <Card className="space-y-3">
          <p className="font-semibold">3. Run this in the tracker's folder</p>
          <CommandLine label="Windows app" command={exeCommand} />
          <CommandLine label="From source (tracker/ folder)" command={pyCommand} />
          <p className="text-xs text-white/50">
            Or just start the tracker and type the code when it asks.
            {localOnly && (
              <>
                {' '}
                This backend address is <span className="font-mono">{API_URL}</span>, which only works on
                this laptop. Other laptops need the hosted backend's URL.
              </>
            )}
          </p>
        </Card>
      )}

      {data && (
        <Card
          className={`flex items-center gap-3 text-sm ${
            connected ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100' : 'text-white/70'
          }`}
        >
          {connected ? (
            <span>✅ Tracker connected. Your screen time now counts in this group.</span>
          ) : USE_MOCK ? (
            <span>Demo mode: no real tracker connects here.</span>
          ) : (
            <>
              <Spinner />
              <span>Waiting for your tracker's first check-in (it reports every 30 seconds)…</span>
            </>
          )}
        </Card>
      )}

      <Card className="space-y-1 text-xs text-white/50">
        <p>
          <b className="text-white/70">Only the window in front counts.</b> A YouTube tab behind the
          dashboard isn't tracked; keep the dashboard in a separate window to watch it live.
        </p>
        <p>
          <b className="text-white/70">Keep it running.</b> If the tracker stops checking in during the
          period, that time can count against you.
        </p>
      </Card>

      <Link className={btnGhost} to={`/group/${groupId}`}>
        Go to dashboard
      </Link>
    </div>
  )
}

function CommandLine({ label, command }: { label: string; command: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-white/50">{label}</p>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-black/40 px-3 py-2 font-mono text-xs">
          {command}
        </code>
        <button className={`${btnGhost} shrink-0`} onClick={() => copyText(command, 'Command')}>
          Copy
        </button>
      </div>
    </div>
  )
}
