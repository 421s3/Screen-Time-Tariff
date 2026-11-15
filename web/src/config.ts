// VITE_USE_MOCK=true|false. Defaults to true so the app always runs without a backend.
export const USE_MOCK: boolean = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false'

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export const RPC_URL: string =
  import.meta.env.VITE_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'

export const PROGRAM_ID: string = import.meta.env.VITE_PROGRAM_ID ?? ''

// The group that mockApi serves (same id as docs/mock-state.json).
export const DEMO_GROUP_ID = '6734f0c2a1b2c3d4e5f60718'

// Polling interval for dashboard data (poll the backend, not the public devnet RPC).
export const POLL_MS = 2000

// Where the Windows tracker .exe is downloaded from (Dev 3 publishes it as a GitHub Release asset).
export const TRACKER_DOWNLOAD_URL: string =
  import.meta.env.VITE_TRACKER_URL || 'https://github.com/421s3/SunHacks9.0/releases/latest'

// The tracker's .exe name, used in the copy-paste command on the Pair tracker page.
export const TRACKER_EXE = 'ScreenTimeTariffTracker.exe'
