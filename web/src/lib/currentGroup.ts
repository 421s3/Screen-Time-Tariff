import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { DEMO_GROUP_ID, USE_MOCK } from '../config'

// The nav's Stake / Pair / Dashboard / Results links need a group id. Use the group in the URL,
// else the last group this browser visited, else (mock only) the scripted demo group.
const KEY = 'stt.lastGroupId'

function readLast(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function writeLast(id: string) {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* private window: just don't remember */
  }
}

/** The group the nav should link to, or null when there isn't one yet (real backend, nothing visited). */
export function useCurrentGroupId(): string | null {
  const { pathname } = useLocation()
  const fromUrl = /^\/group\/([^/]+)/.exec(pathname)?.[1] ?? null
  useEffect(() => {
    if (fromUrl && !USE_MOCK) writeLast(fromUrl)
  }, [fromUrl])
  if (USE_MOCK) return fromUrl ?? DEMO_GROUP_ID
  return fromUrl ?? readLast()
}
