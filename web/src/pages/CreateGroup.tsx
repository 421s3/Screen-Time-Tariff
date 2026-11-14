import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { api } from '../api'
import { USE_MOCK } from '../config'
import { SESSION_PRESETS, type Blocklist, type SessionPreset } from '../types'
import { parseSolToLamports } from '../lib/format'
import { Card, ErrorBox, WalletGate, btnPrimary, inputCls } from '../components/ui'

// Default blocklist from docs/contract.md section 5.
const DEFAULT_BLOCKLIST: Blocklist = {
  processes: [
    { match: 'VALORANT-Win64-Shipping.exe', label: 'Valorant' },
    { match: 'League of Legends.exe', label: 'League of Legends' },
    { match: 'steam.exe', label: 'Steam' },
    { match: 'Discord.exe', label: 'Discord' },
  ],
  titles: [
    { match: 'TikTok', label: 'TikTok' },
    { match: 'YouTube', label: 'YouTube' },
    { match: 'Reddit', label: 'Reddit' },
    { match: 'Instagram', label: 'Instagram' },
    { match: 'Twitch', label: 'Twitch' },
  ],
}

const ALL_ITEMS = [
  ...DEFAULT_BLOCKLIST.processes.map((p) => ({ ...p, kind: 'processes' as const })),
  ...DEFAULT_BLOCKLIST.titles.map((t) => ({ ...t, kind: 'titles' as const })),
]

export function CreateGroup() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { publicKey } = useWallet()
  const [name, setName] = useState('Finals Week Survivors')
  const [displayName, setDisplayName] = useState('')
  const [stakeSol, setStakeSol] = useState('0.5')
  const [preset, setPreset] = useState<SessionPreset>(USE_MOCK ? 'demo' : 'day')
  const [blocked, setBlocked] = useState<Set<string>>(
    () => new Set(ALL_ITEMS.map((i) => i.match)),
  )

  const mutation = useMutation({
    mutationFn: async () => {
      const stakeLamports = parseSolToLamports(stakeSol)
      if (!name.trim() || !displayName.trim()) throw new Error('Enter a group name and your name.')
      if (stakeLamports === null) throw new Error('The entry stake must be more than 0 SOL.')
      if (blocked.size === 0) throw new Error('Pick at least one app or site to block.')
      return api.createGroup(
        {
          name: name.trim(),
          displayName: displayName.trim(),
          stakeLamports,
          sessionPreset: preset,
          blocklist: {
            processes: DEFAULT_BLOCKLIST.processes.filter((p) => blocked.has(p.match)),
            titles: DEFAULT_BLOCKLIST.titles.filter((t) => blocked.has(t.match)),
          },
        },
        publicKey!.toBase58(),
      )
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['state'] })
      toast.success(`Group created. Invite code: ${res.joinCode}`)
      navigate(`/group/${res.groupId}/stake`)
    },
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate()
  }

  const toggle = (match: string) =>
    setBlocked((prev) => {
      const next = new Set(prev)
      if (next.has(match)) next.delete(match)
      else next.add(match)
      return next
    })

  return (
    <WalletGate text="Connect Phantom to create a group. Your wallet is your identity.">
      <form onSubmit={onSubmit} className="mx-auto max-w-2xl space-y-4">
        <h2 className="text-2xl font-bold">Create a group</h2>
        <Card className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 sm:col-span-2">
            <span className="text-sm text-white/70">Group name</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm text-white/70">Your display name</span>
            <input
              className={inputCls}
              placeholder="Alice"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm text-white/70">Entry stake (SOL, same for everyone)</span>
            <input
              className={inputCls}
              inputMode="decimal"
              value={stakeSol}
              onChange={(e) => setStakeSol(e.target.value)}
            />
          </label>
        </Card>

        <Card>
          <p className="mb-3 font-semibold">Session length</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
            {SESSION_PRESETS.map((p) => (
              <button
                type="button"
                key={p.id}
                role="radio"
                aria-checked={preset === p.id}
                onClick={() => setPreset(p.id)}
                className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                  preset === p.id
                    ? 'border-violet-400 bg-violet-500/30 text-white'
                    : 'border-white/15 text-white/60 hover:bg-white/10'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/40">
            The clock starts when you press Start on the dashboard. Joining closes then.
            {USE_MOCK && ' Demo mode runs every session for 90 seconds.'}
          </p>
        </Card>

        <Card>
          <p className="mb-3 font-semibold">Blocked apps and sites</p>
          <div className="flex flex-wrap gap-2">
            {ALL_ITEMS.map((item) => {
              const on = blocked.has(item.match)
              return (
                <button
                  type="button"
                  key={item.match}
                  onClick={() => toggle(item.match)}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    on
                      ? 'border-violet-400 bg-violet-500/30 text-white'
                      : 'border-white/15 text-white/50 hover:bg-white/10'
                  }`}
                >
                  {item.kind === 'processes' ? '🎮' : '🌐'} {item.label}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-white/40">
            Games match by process name; sites match by browser tab title. Time on these adds up;
            lowest total at the end wins the pot.
          </p>
        </Card>

        {mutation.isError && <ErrorBox message={(mutation.error as Error).message} />}

        <button className={`${btnPrimary} w-full`} disabled={mutation.isPending}>
          {mutation.isPending ? 'Creating…' : 'Create group'}
        </button>
      </form>
    </WalletGate>
  )
}
