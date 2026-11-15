import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { WalletReadyState } from '@solana/wallet-adapter-base'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { chargeEvery, fmtClock, fmtSol } from '../lib/format'
import { Mascot, type TomMood } from './Mascot'

/* App-level building blocks on top of shadcn/ui. Pages compose these; colours come from index.css. */

/** Flat bordered surface. No heavy shadow, modest radius. */
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border bg-card p-5', className)}>{children}</div>
}

/** Page header: title + one line, with Tom (small) saying something on the side. */
export function PageHeader({
  title,
  subtitle,
  mood = 'happy',
  say,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  mood?: TomMood
  say?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start gap-x-4 gap-y-3">
      <Mascot size={56} mood={mood} className="shrink-0" />
      <div className="min-w-0 flex-1 basis-56">
        <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-muted-foreground">{subtitle}</p>}
        {say && (
          <motion.p
            key={String(say)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-lilac px-2.5 py-1 text-xs font-medium text-ink"
          >
            <span className="font-semibold">Tom:</span> {say}
          </motion.p>
        )}
      </div>
      {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div>}
    </header>
  )
}

/** Small label above a value. */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-xs font-medium text-muted-foreground', className)}>{children}</p>
}

/** Label + big value. */
export function Stat({
  label,
  value,
  tone = 'bg-card',
  hint,
  children,
}: {
  label: string
  value: ReactNode
  tone?: string
  hint?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={cn('min-w-0 rounded-xl border p-4', tone)}>
      <Eyebrow className="text-ink/75">{label}</Eyebrow>
      <div className="mt-1 truncate font-display text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <p className="mt-0.5 text-xs text-ink/70">{hint}</p>}
      {children}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-block size-5 animate-spin rounded-full border-2 border-ink/15 border-t-ink', className)}
    />
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Spinner />
        <span className="font-medium">{label}</span>
      </div>
      <Skeleton className="h-16 w-full max-w-xl" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export function EmptyState({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-5 py-8 text-center">
      <Mascot size={56} mood="sleepy" animated={false} />
      <p className="font-display text-lg font-semibold">{title}</p>
      {body && <p className="max-w-md text-sm text-muted-foreground">{body}</p>}
      {children && <div className="mt-2 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-[#f1c2c8] bg-[#fff1f2] p-4">
      <Mascot size={44} mood="worried" className="shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold text-bad">Something went wrong</p>
        <p className="mt-0.5 break-words text-sm text-[#7a1a24]">{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            <RefreshCw /> Try again
          </Button>
        )}
      </div>
    </div>
  )
}

/** Inline notice strip (info / warn / good). */
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'good'; children: ReactNode }) {
  const cls = {
    info: 'border-[#c7dcf5] bg-sky text-ink',
    warn: 'border-[#f0dc9a] bg-lemon text-ink',
    good: 'border-[#b9e3cc] bg-mint text-ink',
  }[tone]
  return <div className={cn('rounded-lg border px-4 py-3 text-sm', cls)}>{children}</div>
}

/** True when Phantom is not installed in this browser. */
export function usePhantomMissing(): boolean {
  const { wallets } = useWallet()
  const phantom = wallets.find((w) => w.adapter.name === 'Phantom')
  return !phantom || phantom.readyState === WalletReadyState.NotDetected
}

export function Disconnected({ text }: { text: string }) {
  const missing = usePhantomMissing()
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border bg-card px-6 py-10 text-center">
      <Mascot size={72} mood="happy" />
      <h1 className="text-2xl font-semibold">Connect your wallet</h1>
      <p className="text-muted-foreground">{text}</p>
      {missing ? (
        <p className="text-sm text-warn">
          Phantom isn't installed in this browser.{' '}
          <a className="font-medium underline" href="https://phantom.app/download" target="_blank" rel="noreferrer">
            Install Phantom
          </a>{' '}
          and switch it to devnet, then reload.
        </p>
      ) : (
        <WalletMultiButton />
      )}
    </div>
  )
}

/** Shows the disconnected state until a wallet is connected. */
export function WalletGate({ text, children }: { text: string; children: ReactNode }) {
  const { connected } = useWallet()
  if (!connected) return <Disconnected text={text} />
  return <>{children}</>
}

/**
 * Blocked time vs the group's allowance, ticking per second. Full and red = being charged into the pool.
 * Charges land per full charge unit over the allowance (5 s for new groups, a minute for older ones;
 * the program's `slash` takes whole units), so when over we show a countdown to the next charge.
 */
export function UsageBar({
  usedSeconds,
  allowanceSeconds,
  tariffLamports,
  chargeUnitSecs = 60,
  charging,
}: {
  usedSeconds: number
  allowanceSeconds: number
  /** Lamports per charge (per 5 s or per minute). */
  tariffLamports: number
  chargeUnitSecs?: number
  /** Staked and the period is running: show "next charge in …" when over. */
  charging: boolean
}) {
  const used = Math.max(0, Math.floor(usedSeconds))
  const limit = Math.max(1, allowanceSeconds)
  const pct = Math.min(100, (used / limit) * 100)
  const over = used > allowanceSeconds
  const overSeconds = used - allowanceSeconds
  const nextChargeIn = chargeUnitSecs - (overSeconds % chargeUnitSecs)
  return (
    <div>
      <div className="flex flex-wrap justify-between gap-x-2 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">
          {fmtClock(used)} / {fmtClock(allowanceSeconds)}
        </span>
        {over ? (
          <span className="font-mono font-semibold tabular-nums text-bad">{fmtClock(overSeconds)} over</span>
        ) : (
          <span className="font-mono tabular-nums">{fmtClock(allowanceSeconds - used)} left</span>
        )}
      </div>
      <Progress
        value={pct}
        className="mt-1.5 h-2"
        aria-label="Blocked time used of the allowance"
        aria-valuetext={`${fmtClock(used)} of ${fmtClock(allowanceSeconds)}`}
        indicatorClassName={cn(
          'duration-1000 ease-linear',
          over ? 'bg-[#d6364a]' : pct > 75 ? 'bg-gold' : 'bg-[#2fa56f]',
        )}
      />
      {over && charging && (
        <p className="mt-1.5 text-xs text-bad">
          Next −{fmtSol(tariffLamports)} in{' '}
          <span className="font-mono tabular-nums">0:{String(nextChargeIn).padStart(2, '0')}</span>
          <span className="text-ink/60"> · charged {chargeEvery(chargeUnitSecs)} over</span>
        </p>
      )}
    </div>
  )
}

/** "Live · updated 2s ago" pill; turns amber when polls are failing. */
export function LiveStatus({ updatedAt, failing, now }: { updatedAt: number; failing: boolean; now: number }) {
  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null
  const stale = failing || (ago !== null && ago > 10)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium',
        stale ? 'border-[#f0dc9a] bg-lemon text-warn' : 'border-[#b9e3cc] bg-mint text-good',
      )}
      role="status"
    >
      <span className="relative flex size-2">
        {!stale && <span className="absolute inline-flex size-full motion-safe:animate-ping rounded-full bg-[#2fa56f] opacity-60" />}
        <span className={cn('relative inline-flex size-2 rounded-full', stale ? 'bg-gold' : 'bg-[#2fa56f]')} />
      </span>
      {stale ? 'Reconnecting…' : 'Live'}
      {ago !== null && <span className="text-ink/60">· {ago}s ago</span>}
    </span>
  )
}
