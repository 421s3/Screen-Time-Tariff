import { API_URL } from '../config'
import type { GroupState } from '../types'
import { ApiError, type Api } from './base'

async function request<T>(
  path: string,
  wallet: string | null | undefined,
  init?: RequestInit,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(wallet ? { 'X-Wallet': wallet } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError('NETWORK', `Cannot reach the backend at ${API_URL}.`)
  }
  if (!res.ok) {
    let code = 'HTTP_' + res.status
    let message = res.statusText
    try {
      const body = await res.json()
      code = body?.error?.code ?? code
      message = body?.error?.message ?? message
    } catch {
      /* body wasn't JSON */
    }
    throw new ApiError(code, message)
  }
  return (await res.json()) as T
}

const notYet = (what: string) =>
  new ApiError('NOT_IMPLEMENTED', `${what} is wired up at CP2/CP3 (needs backend + program).`)

// CP1: only /state is real. The rest arrive with CP2 (endpoints) and CP3 (Anchor + Phantom).
export const realApi: Api = {
  getState: (groupId, wallet) =>
    request<GroupState>(`/groups/${groupId}/state`, wallet),
  createGroup: () => Promise.reject(notYet('Creating a group')),
  joinGroup: () => Promise.reject(notYet('Joining a group')),
  recordStake: () => Promise.reject(notYet('Staking')),
  startSession: () => Promise.reject(notYet('Starting the session')),
  startPairing: () => Promise.reject(notYet('Pairing a tracker')),
}
