import { useMatch } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { DEMO_GROUP_ID, USE_MOCK } from '../config'

// The backend has no "my groups" endpoint, so remember the last group each wallet created or joined.
const key = (wallet: string) => `stt:lastGroup:${wallet}`

export function rememberGroup(wallet: string, groupId: string): void {
  try {
    localStorage.setItem(key(wallet), groupId)
  } catch {
    // storage disabled (private window): navigation falls back to the URL
  }
}

export function rememberedGroup(wallet: string): string | null {
  try {
    return localStorage.getItem(key(wallet))
  } catch {
    return null
  }
}

/** Drop a remembered group that no longer exists (e.g. the database was reset). */
export function forgetGroup(wallet: string, groupId: string): void {
  if (rememberedGroup(wallet) === groupId) {
    try {
      localStorage.removeItem(key(wallet))
    } catch {
      // ignore
    }
  }
}

/**
 * The group the nav links point at. Mock mode: the demo group. Real mode: the group in the URL,
 * else the connected wallet's last created/joined group, else null (not in a group yet).
 */
export function useCurrentGroupId(): string | null {
  const match = useMatch('/group/:groupId/*')
  const { publicKey } = useWallet()
  if (USE_MOCK) return DEMO_GROUP_ID
  if (match?.params.groupId) return match.params.groupId
  return publicKey ? rememberedGroup(publicKey.toBase58()) : null
}
