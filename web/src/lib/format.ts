export const LAMPORTS_PER_SOL = 1_000_000_000

/** Format lamports for display only. Everywhere else amounts stay as integer lamports. */
export function fmtSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL
  return `${sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`
}

/** Parse a user-typed SOL amount into integer lamports. Returns null if invalid. */
export function parseSolToLamports(input: string): number | null {
  const n = Number(input)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * LAMPORTS_PER_SOL)
}

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`
}

export function shortAddr(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr
}

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
