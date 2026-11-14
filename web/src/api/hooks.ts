import { useQuery } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { POLL_MS } from '../config'
import { api } from './index'

/**
 * Group state, polled every few seconds so the dashboard always mirrors the backend.
 * Keeps polling when the tab is in the background (the projector tab is often unfocused),
 * and keeps showing the last good data if one poll fails.
 */
export function useGroupState(groupId: string) {
  const { publicKey } = useWallet()
  const wallet = publicKey?.toBase58() ?? null
  return useQuery({
    queryKey: ['state', groupId],
    queryFn: () => api.getState(groupId, wallet),
    enabled: groupId.length > 0,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
    retry: 1,
  })
}
