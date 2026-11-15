import type { ReactNode } from 'react'
import { WalletReadyState } from '@solana/wallet-adapter-base'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { fmtClock, fmtSol } from '../lib/format'

export const btnPrimary =
  'inline-flex items-center justify-center rounded-xl bg-violet-500 px-4 py-2 font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50'
export const btnGhost =
  'inline-flex items-center justify-center rounded-xl border border-white/15 px-4 py-2 font-semibold text-white/90 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50'
export const inputCls =
  'w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-white outline-none placeholder:text-white/30 focus:border-violet-400'

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 p-5 ${className}`}>
      {children}
    </div>
  )
}

export function Spinner() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-violet-400"
    />
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <Card className="flex items-center gap-3 text-white/70">
      <Spinner />
      <span>{label}</span>
    </Card>
  )
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <Card className="text-center">
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 text-sm text-white/60">{body}</p>}
    </Card>
  )
}

export function ErrorBox({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <Card className="border-red-400/40 bg-red-500/10">
      <p className="font-semibold text-red-200">Something went wrong</p>
      <p className="mt-1 text-sm text-red-100/80">{message}</p>
      {onRetry && (
        <button className={`${btnGhost} mt-3`} onClick={onRetry}>
          Try again
        </button>
      )}
    </Card>
  )
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
    <Card className="flex flex-col items-center gap-3 text-center">
      <p className="text-lg font-semibold">Wallet not connected</p>
      <p className="text-sm text-white/60">{text}</p>
      {missing ? (
        <p className="text-sm text-amber-200">
          Phantom isn't installed in this browser.{' '}
          <a
            className="underline"
            href="https://phantom.app/download"
            target="_blank"
            rel="noreferrer"
          >
            Install Phantom
          </a>{' '}
          and switch it to devnet, then reload.
        </p>
      ) : (
        <WalletMultiButton />
      )}
    </Card>
  )
}

/** Shows the disconnected state until a wallet is connected. */
export function WalletGate({
  text,
  children,
}: {
  text: string
  children: ReactNode
}) {
  const { connected } = useWallet()
  if (!connected) return <Disconnected text={text} />
  return <>{children}</>
}

/**
 * Blocked time vs the group's allowance, ticking per second. Full and red = being charged into the pool.
 * Charges land per FULL minute over the allowance (the devnet program's `slash` takes whole minutes),
 * so when over we show a countdown to the next charge instead of a jumping minute count.
 */
export function UsageBar({
  usedSeconds,
  allowanceSeconds,
  tariffLamports,
  charging,
}: {
  usedSeconds: number
  allowanceSeconds: number
  tariffLamports: number
  /** Staked and the period is running: show "next charge in …" when over. */
  charging: boolean
}) {
  const used = Math.max(0, Math.floor(usedSeconds))
  const limit = Math.max(1, allowanceSeconds)
  const pct = Math.min(100, (used / limit) * 100)
  const over = used > allowanceSeconds
  const overSeconds = used - allowanceSeconds
  const nextChargeIn = 60 - (overSeconds % 60)
  return (
    <div>
      <div className="flex justify-between gap-2 text-xs text-white/60">
        <span className="font-mono tabular-nums">
          {fmtClock(used)} / {fmtClock(allowanceSeconds)} allowed
        </span>
        {over ? (
          <span className="font-mono tabular-nums text-red-300">{fmtClock(overSeconds)} over</span>
        ) : (
          <span className="font-mono tabular-nums">{fmtClock(allowanceSeconds - used)} free left</span>
        )}
      </div>
      <div
        className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label="Blocked time used of the allowance"
        aria-valuemin={0}
        aria-valuemax={allowanceSeconds}
        aria-valuenow={used}
      >
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-linear ${
            over ? 'bg-red-400' : pct > 75 ? 'bg-amber-300' : 'bg-emerald-400'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {over && charging && (
        <p className="mt-1 text-xs text-red-200/80">
          Next −{fmtSol(tariffLamports)} in <span className="font-mono tabular-nums">0:{String(nextChargeIn).padStart(2, '0')}</span>
          <span className="text-white/40"> · charged per full minute over</span>
        </p>
      )}
    </div>
  )
}

/** "Live · updated 2s ago" pill; turns amber when polls are failing. */
export function LiveStatus({
  updatedAt,
  failing,
  now,
}: {
  updatedAt: number
  failing: boolean
  now: number
}) {
  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null
  const stale = failing || (ago !== null && ago > 10)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
        stale ? 'bg-amber-500/15 text-amber-200' : 'bg-emerald-500/15 text-emerald-200'
      }`}
      role="status"
    >
      <span className={`h-2 w-2 rounded-full ${stale ? 'bg-amber-400' : 'animate-pulse bg-emerald-400'}`} />
      {stale ? 'Reconnecting to backend…' : 'Live'}
      {ago !== null && <span className="text-white/40">· updated {ago}s ago</span>}
    </span>
  )
}
