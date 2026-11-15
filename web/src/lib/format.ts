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

/** Screen time: "1h 05m", "12m 30s", "45s". */
export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

/** Stopwatch style, ticks every second: "0:07", "1:23", "1:02:05". */
export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** Lamports per charge: 5 s groups have the on-chain tariff = per-minute tariff / 12 (contract v0.9). */
export function tariffPerCharge(tariffLamportsPerMinute: number, chargeUnitSecs = 60): number {
  return chargeUnitSecs === 60
    ? tariffLamportsPerMinute
    : Math.max(1, Math.round((tariffLamportsPerMinute * chargeUnitSecs) / 60))
}

/** "every 5 s" / "per full minute" */
export function chargeEvery(chargeUnitSecs = 60): string {
  return chargeUnitSecs >= 60 ? 'per full minute' : `every ${chargeUnitSecs} s`
}

export function ordinal(n: number): string {
  const v = n % 100
  const suffix = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}

/** Countdown that also handles days, for 1 week / 1 month sessions. */
export function fmtCountdown(ms: number): string {
  if (ms > 24 * 60 * 60_000) {
    const d = Math.floor(ms / (24 * 60 * 60_000))
    const h = Math.floor((ms % (24 * 60 * 60_000)) / 3_600_000)
    return `${d}d ${h}h`
  }
  if (ms >= 3_600_000) {
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    return `${h}h ${String(m).padStart(2, '0')}m`
  }
  return clockFromMs(ms)
}

function clockFromMs(ms: number): string {
  if (ms <= 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
