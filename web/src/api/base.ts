import type { CreateGroupInput, GroupState } from '../types'

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/**
 * The only way components get data. Two implementations: mockApi and realApi,
 * chosen by VITE_USE_MOCK. Components never call fetch directly.
 */
export interface Api {
  getState(groupId: string, wallet?: string | null): Promise<GroupState>
  createGroup(
    input: CreateGroupInput,
    wallet: string,
  ): Promise<{ groupId: string; joinCode: string }>
  joinGroup(
    joinCode: string,
    displayName: string,
    wallet: string,
  ): Promise<{ groupId: string }>
  recordStake(
    groupId: string,
    lamports: number,
    wallet: string,
  ): Promise<{ ok: true; signature: string | null }>
  /** After settlement: take back remaining stake + any prize. */
  withdraw(groupId: string, wallet: string): Promise<{ ok: true; signature: string | null }>
  startPairing(
    groupId: string,
    wallet: string,
  ): Promise<{ code: string; expiresAt: number }>
}
