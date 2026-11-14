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
          Stake in. Log off.
          <span className="block text-violet-300">Lowest screen time takes the pot.</span>
        </h2>
        <p className="text-white/70">
          Everyone in your group puts in the same devnet SOL. Time on TikTok, YouTube, Valorant,
          League, and the rest of the blocklist adds up over the session. When the clock runs
          out, whoever spent the least time wins the whole pot, paid out on-chain.
        </p>
        <ol className="list-inside list-decimal space-y-1 text-sm text-white/60">
          <li>Connect Phantom (devnet)</li>
          <li>Create a group (pick the stake and session length) or join with a code</li>
          <li>Pay the entry stake and pair the desktop tracker</li>
          <li>The creator presses Start. Lowest total at the end wins.</li>
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
            Meet Tariff Tom. He shows up every time someone takes the lead.
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
