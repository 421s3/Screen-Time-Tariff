import { Link } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { DEMO_GROUP_ID, USE_MOCK } from '../config'
import { Mascot } from '../components/Mascot'
import { Card, Disconnected, btnGhost, btnPrimary } from '../components/ui'

export function Landing() {
  const { connected } = useWallet()
  return (
    <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
      <Card className="flex flex-col justify-center gap-4 p-8">
        <h2 className="text-3xl font-extrabold leading-tight sm:text-4xl">
          Screen-time limits are free to ignore.
          <span className="block text-violet-300">We put a price on them.</span>
        </h2>
        <p className="text-white/70">
          Stake devnet SOL with your friends. Every minute over your limit on TikTok, YouTube,
          Valorant, League, or any Steam game is a tariff that goes into the group's on-chain
          pool. When the period ends, whoever spent the least time wins the whole pool.
        </p>
        <ol className="list-inside list-decimal space-y-1 text-sm text-white/60">
          <li>Connect Phantom (devnet)</li>
          <li>Create a group or join one with a code</li>
          <li>Stake SOL and pair the desktop tracker</li>
          <li>Go over the limit, pay into the pool. Lowest screen time takes it all.</li>
        </ol>
        {USE_MOCK && (
          <p className="text-sm text-amber-200">
            Demo mode is on: everything below runs on simulated data.
          </p>
        )}
      </Card>

      <div className="space-y-4">
        <Card className="flex items-center gap-4">
          <Mascot size={80} />
          <p className="text-sm text-white/70">
            Meet Tariff Tom. He shows up every time someone pays into the pool.
          </p>
        </Card>
        {connected ? (
          <Card className="flex flex-col gap-3">
            <p className="font-semibold">You're connected. What next?</p>
            <Link className={btnPrimary} to="/create">
              Create a group
            </Link>
            <Link className={btnGhost} to="/join">
              Join with a code
            </Link>
            <Link className={btnGhost} to={`/group/${DEMO_GROUP_ID}`}>
              Open the demo dashboard
            </Link>
          </Card>
        ) : (
          <Disconnected text="Connect Phantom on devnet to create or join a group." />
        )}
      </div>
    </div>
  )
}
