import { useQuery } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { POLL_MS } from '../config'
import { api } from './index'

/** Group state, polled every few seconds. */
export function useGroupState(groupId: string) {
  const { publicKey } = useWallet()
  const wallet = publicKey?.toBase58() ?? null
  return useQuery({
    queryKey: ['state', groupId, wallet],
    queryFn: () => api.getState(groupId, wallet),
    refetchInterval: POLL_MS,
    retry: 1,
  })
}
