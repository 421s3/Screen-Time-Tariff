import { API_URL } from '../config'
import type { GroupState } from '../types'
import { ApiError, type Api } from './base'
import {
  createGroupOnChain,
  hasStakedOnChain,
  joinAndStakeOnChain,
  withdrawOnChain,
} from '../chain/program'
import { getChainSigner } from '../chain/signer'
import { tariffPerCharge } from '../lib/format'

/** New groups are charged for every 5 s over the allowance (contract v0.9). */
const CHARGE_UNIT_SECS = 5

// Endpoints and bodies follow docs/contract.md v0.5 section 4 and backend/src/routes.
// CHAIN_MODE=off/mock: the backend does everything. CHAIN_MODE=devnet: Phantom signs
// create_group / join_and_stake / withdraw first, then the backend is told about it.

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

type BackendConfig = {
  chainMode: 'off' | 'mock' | 'devnet'
  programId: string | null
  oraclePubkey: string | null
}

let configPromise: Promise<BackendConfig> | null = null
function backendConfig(): Promise<BackendConfig> {
  configPromise ??= request<BackendConfig>('/config', null).catch((e) => {
    configPromise = null // retry next time
    throw e
  })
  return configPromise
}

/** In devnet mode, returns what's needed to sign; otherwise null. */
async function devnet(wallet: string) {
  const cfg = await backendConfig()
  if (cfg.chainMode !== 'devnet') return null
  if (!cfg.programId) throw new ApiError('NO_PROGRAM', 'The backend has no PROGRAM_ID configured.')
  const signer = getChainSigner()
  if (!signer || signer.wallet.publicKey.toBase58() !== wallet) {
    throw new ApiError('WALLET_REQUIRED', 'Connect Phantom to sign this transaction.')
  }
  return { cfg, signer, programId: cfg.programId }
}

/** Turns Phantom / Anchor errors into a readable ApiError. */
function chainError(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e)
  if (/reject|declin|cancel/i.test(msg)) throw new ApiError('TX_REJECTED', 'You rejected the transaction in Phantom.')
  if (/insufficient|0x1/i.test(msg)) throw new ApiError('INSUFFICIENT_FUNDS', 'Not enough devnet SOL. Use faucet.solana.com.')
  const anchor = /Error Message: ([^.]+)/.exec(msg)?.[1]
  throw new ApiError('TX_FAILED', anchor ?? msg)
}

async function groupPdaOf(groupId: string, wallet: string): Promise<string> {
  const state = await request<GroupState>(`/groups/${groupId}/state`, wallet)
  if (!state.group.groupPda) throw new ApiError('GROUP_NOT_ON_CHAIN', 'This group has no on-chain address.')
  return state.group.groupPda
}

export const realApi: Api = {
  getState: (groupId, wallet) => request<GroupState>(`/groups/${groupId}/state`, wallet),

  createGroup: async (input, wallet) => {
    const periodStart = Date.now()
    const periodEnd = periodStart + input.periodMs
    const chain = await devnet(wallet)
    let onchain: { groupPda: string; groupSeed: string; createSignature: string } | null = null
    if (chain) {
      if (!chain.cfg.oraclePubkey) throw new ApiError('NO_ORACLE', 'The backend has no oracle key loaded.')
      try {
        const r = await createGroupOnChain(chain.signer, chain.programId, {
          oracle: chain.cfg.oraclePubkey,
          allowanceMinutes: input.allowanceMinutes,
          // Charged every 5 s: the program's tariff is per unit, so store the per-5 s amount
          tariffLamportsPerUnit: tariffPerCharge(input.tariffLamportsPerMinute, CHARGE_UNIT_SECS),
          periodEndMs: periodEnd,
        })
        onchain = { groupPda: r.groupPda, groupSeed: r.groupSeed, createSignature: r.signature }
      } catch (e) {
        chainError(e)
      }
    }
    return post<{ groupId: string; joinCode: string }>('/groups', wallet, {
      name: input.name,
      displayName: input.displayName,
      rules: {
        allowanceMinutes: input.allowanceMinutes,
        tariffLamportsPerMinute: input.tariffLamportsPerMinute,
        periodStart,
        periodEnd,
        demoMode: input.demoMode,
      },
      blocklist: input.blocklist,
      chargeUnitSecs: CHARGE_UNIT_SECS,
      ...(onchain ?? {}),
    })
  },

  joinGroup: (joinCode, displayName, wallet) =>
    post<{ groupId: string }>('/groups/join', wallet, { joinCode, displayName }),

  recordStake: async (groupId, lamports, wallet) => {
    const chain = await devnet(wallet)
    if (!chain) {
      // Off/mock mode: the backend records it (mock: stakes on the fake chain for us).
      await post(`/groups/${groupId}/stakes`, wallet, { lamports, signature: `dashboard-${Date.now()}` })
      return { ok: true, signature: null }
    }
    const groupPda = await groupPdaOf(groupId, wallet)
    if (await hasStakedOnChain(chain.signer, chain.programId, groupPda)) {
      throw new ApiError('ALREADY_STAKED', 'You already staked in this group. The program allows one stake per wallet.')
    }
    let signature: string
    try {
      signature = await joinAndStakeOnChain(chain.signer, chain.programId, groupPda, lamports)
    } catch (e) {
      chainError(e)
    }
    await post(`/groups/${groupId}/stakes`, wallet, { lamports, signature })
    return { ok: true, signature }
  },

  withdraw: async (groupId, wallet) => {
    const chain = await devnet(wallet)
    if (!chain) {
      throw new ApiError('NOT_ON_CHAIN', 'Withdraw is a Phantom transaction; it only works with CHAIN_MODE=devnet.')
    }
    const groupPda = await groupPdaOf(groupId, wallet)
    try {
      return { ok: true, signature: await withdrawOnChain(chain.signer, chain.programId, groupPda) }
    } catch (e) {
      chainError(e)
    }
  },

  startPairing: (groupId, wallet) =>
    post<{ code: string; expiresAt: number }>('/pair/start', wallet, { groupId }),
}
