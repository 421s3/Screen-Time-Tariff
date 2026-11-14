import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { restartDemo } from '../api/mockApi'
import { DEMO_GROUP_ID, USE_MOCK } from '../config'
import { shortAddr } from '../lib/format'
import { Mascot } from './Mascot'
import { WalletBalance } from './WalletBalance'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/create', label: 'Create' },
  { to: '/join', label: 'Join' },
  { to: `/group/${DEMO_GROUP_ID}/stake`, label: 'Stake' },
  { to: `/group/${DEMO_GROUP_ID}/pair`, label: 'Pair tracker' },
  { to: `/group/${DEMO_GROUP_ID}`, label: 'Dashboard', end: true },
  { to: `/group/${DEMO_GROUP_ID}/results`, label: 'Results' },
]

export function Layout() {
  const { publicKey } = useWallet()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3">
          <Mascot size={44} />
          <div>
            <h1 className="text-lg font-bold leading-tight">Screen Time Tariff</h1>
            <p className="text-xs text-white/50">Solana devnet · no real money</p>
          </div>
          {USE_MOCK && (
            <>
              <span
                className="ml-2 rounded-full border border-amber-300/60 bg-amber-300/15 px-3 py-1 text-xs font-bold tracking-wide text-amber-200"
                title="Showing simulated data. No backend or real transactions."
              >
                DEMO MODE
              </span>
              <button
                className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/70 hover:bg-white/10"
                title="Restart the simulated 90-second race"
                onClick={() => {
                  restartDemo()
                  queryClient.invalidateQueries({ queryKey: ['state'] })
                  navigate(`/group/${DEMO_GROUP_ID}`)
                }}
              >
                Restart demo
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {publicKey && (
            <div className="hidden text-right sm:block">
              <p className="text-xs text-white/50">{shortAddr(publicKey.toBase58())}</p>
              <WalletBalance />
            </div>
          )}
          <WalletMultiButton />
        </div>
      </header>

      <nav className="mb-6 flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-white/5 p-1">
        {links.map((l) => (
          <NavLink
            key={l.label}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              `rounded-xl px-3 py-1.5 text-sm font-medium transition ${
                isActive ? 'bg-violet-500 text-white' : 'text-white/70 hover:bg-white/10'
              }`
            }
          >
            {l.label}
          </NavLink>
        ))}
      </nav>

      <main>
        <Outlet />
      </main>
    </div>
  )
}
