// VITE_USE_MOCK=true|false. Defaults to true so the app always runs without a backend.
export const USE_MOCK: boolean = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false'

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export const RPC_URL: string =
  import.meta.env.VITE_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'

export const PROGRAM_ID: string = import.meta.env.VITE_PROGRAM_ID ?? ''

// The group that mockApi serves (same id as docs/mock-state.json).
export const DEMO_GROUP_ID = '6734f0c2a1b2c3d4e5f60718'

// Polling interval for dashboard data (poll the backend, not the public devnet RPC).
export const POLL_MS = 1000
