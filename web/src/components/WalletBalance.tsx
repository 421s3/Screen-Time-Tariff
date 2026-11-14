import { useQuery } from '@tanstack/react-query'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { fmtSol } from '../lib/format'

/** Devnet SOL balance of the connected wallet. Refreshes slowly to respect RPC rate limits. */
export function WalletBalance() {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const address = publicKey?.toBase58() ?? null

  const q = useQuery({
    queryKey: ['balance', address],
    queryFn: () => connection.getBalance(publicKey!),
    enabled: !!publicKey,
    refetchInterval: 30_000,
    retry: 1,
  })

  if (!address) return null
  if (q.isError) return <span className="text-sm text-red-300">Balance unavailable</span>
  if (q.isLoading) return <span className="text-sm text-white/50">Loading balance…</span>
  return (
    <span className="text-sm font-semibold text-emerald-300" title="Devnet balance">
      {fmtSol(q.data ?? 0)}
    </span>
  )
}
