import { API_URL } from '../config'
import type { GroupState } from '../types'
import { ApiError, type Api } from './base'

// Endpoints and bodies follow docs/contract.md v0.3 section 4 and backend/src/routes.
// Works against a backend in CHAIN_MODE=off or mock today. CHAIN_MODE=devnet also needs the
// dashboard to send create_group / join_and_stake / withdraw with Phantom first (CP3).

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

const post = <T>(path: string, wallet: string, body: unknown) =>
  request<T>(path, wallet, { method: 'POST', body: JSON.stringify(body) })

export const realApi: Api = {
  getState: (groupId, wallet) => request<GroupState>(`/groups/${groupId}/state`, wallet),

  createGroup: (input, wallet) => {
    const periodStart = Date.now()
    return post<{ groupId: string; joinCode: string }>('/groups', wallet, {
      name: input.name,
      displayName: input.displayName,
      rules: {
        allowanceMinutes: input.allowanceMinutes,
        tariffLamportsPerMinute: input.tariffLamportsPerMinute,
        periodStart,
        periodEnd: periodStart + input.periodMs,
        demoMode: input.demoMode,
      },
      blocklist: input.blocklist,
      // groupPda / groupSeed / createSignature: required in devnet mode, sent at CP3.
    })
  },

  joinGroup: (joinCode, displayName, wallet) =>
    post<{ groupId: string }>('/groups/join', wallet, { joinCode, displayName }),

  recordStake: async (groupId, lamports, wallet) => {
    // Off/mock mode: the backend records (mock: stakes on-chain for us). Devnet mode needs a
    // real join_and_stake signature from Phantom first (CP3); until then it returns STAKE_NOT_FOUND.
    const signature = `dashboard-${Date.now()}`
    await post(`/groups/${groupId}/stakes`, wallet, { lamports, signature })
    return { ok: true, signature: null }
  },

  withdraw: () =>
    Promise.reject(
      new ApiError('NOT_IMPLEMENTED', 'Withdraw is a Phantom transaction; it arrives at CP3.'),
    ),

  startPairing: (groupId, wallet) =>
    post<{ code: string; expiresAt: number }>('/pair/start', wallet, { groupId }),
}
