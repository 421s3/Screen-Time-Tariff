import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { MotionConfig } from 'framer-motion'
import { Menu, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { restartDemo } from '../api/mockApi'
import { DEMO_GROUP_ID, USE_MOCK } from '../config'
import { useCurrentGroupId } from '../lib/currentGroup'
import { shortAddr } from '../lib/format'
import { Mascot } from './Mascot'
import { WalletBalance } from './WalletBalance'

type Link = { to: string; label: string; end?: boolean }

// Group pages need a real group id; until the user creates or joins one, they're hidden.
function navLinks(groupId: string | null): { main: Link[]; all: Link[] } {
  const start: Link[] = [
    { to: '/create', label: 'Create group' },
    { to: '/join', label: 'Join' },
  ]
  if (!groupId) return { main: start, all: start }
  const group: Link[] = [
    { to: `/group/${groupId}`, label: 'Dashboard', end: true },
    { to: `/group/${groupId}/stake`, label: 'Stake' },
    { to: `/group/${groupId}/pair`, label: 'Pair tracker' },
    { to: `/group/${groupId}/results`, label: 'Results' },
  ]
  return { main: [...group, { to: '/create', label: 'New group' }], all: [...group, ...start] }
}

const linkCls = ({ isActive }: { isActive: boolean }) =>
  cn(
    'relative rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'text-brand after:absolute after:inset-x-2.5 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-purple'
      : 'text-muted-foreground hover:bg-accent hover:text-ink',
  )

export function Layout() {
  const { publicKey } = useWallet()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const groupId = useCurrentGroupId()
  const { pathname } = useLocation()
  const home = pathname === '/'
  const [open, setOpen] = useState(false)
  const links = navLinks(groupId)

  const restart = () => {
    restartDemo()
    queryClient.invalidateQueries({ queryKey: ['state'] })
    navigate(`/group/${DEMO_GROUP_ID}`)
  }

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen overflow-x-clip">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <header className={cn('sticky top-0 z-40 border-b backdrop-blur', home ? 'bg-[#efeaff]/85' : 'bg-white/85')}>
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <NavLink to="/" className="flex shrink-0 items-center gap-2 rounded-md" aria-label="Screen Time Tariff home">
            <Mascot size={34} animated={false} />
            <span className="hidden font-display text-lg font-semibold tracking-tight min-[420px]:inline">
              Screen Time Tariff
            </span>
          </NavLink>

          <nav className="ml-4 hidden items-center gap-0.5 lg:flex" aria-label="Main">
            {links.main.map((l) => (
              <NavLink key={l.to + l.label} to={l.to} end={l.end} className={linkCls}>
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {USE_MOCK && (
              <Button
                variant="outline"
                size="sm"
                className="hidden sm:inline-flex"
                title="Demo mode: simulated data. Restart the 90-second race."
                onClick={restart}
              >
                <RotateCcw /> Demo
              </Button>
            )}
            {publicKey && (
              <div className="hidden text-right text-xs leading-tight text-muted-foreground xl:block">
                <p className="font-mono text-ink">{shortAddr(publicKey.toBase58())}</p>
                <WalletBalance />
              </div>
            )}
            <WalletMultiButton />
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 bg-background">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <Mascot size={28} animated={false} /> Screen Time Tariff
                  </SheetTitle>
                </SheetHeader>
                <nav className="flex flex-col gap-1 px-4" aria-label="Mobile">
                  {links.all.map((l) => (
                    <NavLink
                      key={l.to + l.label}
                      to={l.to}
                      end={l.end}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'rounded-md px-3 py-2.5 font-medium',
                          isActive ? 'bg-purple text-white' : 'text-ink hover:bg-accent',
                        )
                      }
                    >
                      {l.label}
                    </NavLink>
                  ))}
                </nav>
                <div className="mt-auto space-y-3 border-t p-4">
                  {publicKey && (
                    <div className="text-sm text-muted-foreground">
                      <p className="font-mono text-ink">{shortAddr(publicKey.toBase58())}</p>
                      <WalletBalance />
                    </div>
                  )}
                  {USE_MOCK && (
                    <Button variant="outline" className="w-full" onClick={restart}>
                      <RotateCcw /> Restart demo
                    </Button>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {home ? (
        <main id="main">
          <Outlet />
        </main>
      ) : (
        <main id="main" className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">
          {USE_MOCK && (
            <p className="mb-4 inline-flex rounded-full border border-[#f0dc9a] bg-lemon px-2.5 py-0.5 text-xs font-semibold text-warn">
              DEMO MODE · simulated data
            </p>
          )}
          <Outlet />
        </main>
      )}
    </div>
    </MotionConfig>
  )
}
