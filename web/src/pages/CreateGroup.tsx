import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { api } from '../api'
import type { Blocklist } from '../types'
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
  const { publicKey } = useWallet()
  const [name, setName] = useState('Finals Week Survivors')
  const [displayName, setDisplayName] = useState('')
  const [allowance, setAllowance] = useState('60')
  const [tariffSol, setTariffSol] = useState('0.01')
  const [periodMinutes, setPeriodMinutes] = useState('1440')
  const [blocked, setBlocked] = useState<Set<string>>(
    () => new Set(ALL_ITEMS.map((i) => i.match)),
  )

  const mutation = useMutation({
    mutationFn: async () => {
      const tariff = parseSolToLamports(tariffSol)
      const allowanceMinutes = Number(allowance)
      const period = Number(periodMinutes)
      if (!name.trim() || !displayName.trim()) throw new Error('Enter a group name and your name.')
      if (!Number.isInteger(allowanceMinutes) || allowanceMinutes < 0)
        throw new Error('Allowance must be a whole number of minutes.')
      if (tariff === null) throw new Error('Tariff must be more than 0 SOL.')
      if (!Number.isInteger(period) || period <= 0)
        throw new Error('Period must be a whole number of minutes.')
      return api.createGroup(
        {
          name: name.trim(),
          displayName: displayName.trim(),
          allowanceMinutes,
          tariffLamportsPerMinute: tariff,
          periodMinutes: period,
          blocklist: {
            processes: DEFAULT_BLOCKLIST.processes.filter((p) => blocked.has(p.match)),
            titles: DEFAULT_BLOCKLIST.titles.filter((t) => blocked.has(t.match)),
          },
        },
        publicKey!.toBase58(),
      )
    },
    onSuccess: (res) => {
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
          <label className="space-y-1 sm:col-span-2">
            <span className="text-sm text-white/70">Your display name</span>
            <input
              className={inputCls}
              placeholder="Alice"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm text-white/70">Daily allowance (minutes)</span>
            <input
              className={inputCls}
              inputMode="numeric"
              value={allowance}
              onChange={(e) => setAllowance(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm text-white/70">Tariff (SOL per minute over)</span>
            <input
              className={inputCls}
              inputMode="decimal"
              value={tariffSol}
              onChange={(e) => setTariffSol(e.target.value)}
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-sm text-white/70">Challenge length (minutes; 1440 = one day)</span>
            <input
              className={inputCls}
              inputMode="numeric"
              value={periodMinutes}
              onChange={(e) => setPeriodMinutes(e.target.value)}
            />
          </label>
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
            Games match by process name; sites match by browser tab title.
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
