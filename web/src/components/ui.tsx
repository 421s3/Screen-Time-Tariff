import type { ReactNode } from 'react'
import { WalletReadyState } from '@solana/wallet-adapter-base'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'

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

/** Screen time relative to the group's highest total (shortest bar = currently winning). */
export function TimeBar({
  seconds,
  maxSeconds,
  leading,
}: {
  seconds: number
  maxSeconds: number
  leading: boolean
}) {
  const pct = maxSeconds > 0 ? Math.min(100, (seconds / maxSeconds) * 100) : 0
  return (
    <div
      className="h-2.5 overflow-hidden rounded-full bg-white/10"
      role="meter"
      aria-label="Screen time relative to the group's highest"
      aria-valuemin={0}
      aria-valuemax={maxSeconds}
      aria-valuenow={seconds}
    >
      <div
        className={`h-full rounded-full transition-all duration-700 ${
          leading ? 'bg-emerald-400' : pct > 80 ? 'bg-red-400' : 'bg-amber-300'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
