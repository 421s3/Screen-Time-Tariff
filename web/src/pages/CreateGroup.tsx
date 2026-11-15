import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { api } from '../api'
import { USE_MOCK } from '../config'
import { PERIOD_PRESETS, type Blocklist } from '../types'
import { fmtSol, parseSolToLamports, tariffPerCharge } from '../lib/format'
import { rememberGroup } from '../lib/currentGroup'
import { Card, ErrorBox, WalletGate, btnPrimary, inputCls } from '../components/ui'

// Default blocklist: docs/contract.md section 5, minus `steam.exe` (the Steam client isn't
// gameplay; Steam games are covered by `steamGames`, per Dev 3's tracker).
const DEFAULT_BLOCKLIST: Blocklist = {
  processes: [
    { match: 'VALORANT-Win64-Shipping.exe', label: 'Valorant' },
    { match: 'League of Legends.exe', label: 'League of Legends' },
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
  const [allowance, setAllowance] = useState(USE_MOCK ? '1' : '60')
  const [tariffSol, setTariffSol] = useState('0.01')
  const [presetId, setPresetId] = useState(USE_MOCK ? 'demo' : 'day')
  const [steamGames, setSteamGames] = useState(true)
  const [blocked, setBlocked] = useState<Set<string>>(
    () => new Set(ALL_ITEMS.map((i) => i.match)),
  )

  const mutation = useMutation({
    mutationFn: async () => {
      const tariff = parseSolToLamports(tariffSol)
      const allowanceMinutes = Number(allowance)
      const preset = PERIOD_PRESETS.find((p) => p.id === presetId)!
      if (!name.trim() || !displayName.trim()) throw new Error('Enter a group name and your name.')
      if (!Number.isInteger(allowanceMinutes) || allowanceMinutes < 0)
        throw new Error('Allowance must be a whole number of minutes.')
      if (tariff === null) throw new Error('Tariff must be more than 0 SOL.')
      if (blocked.size === 0 && !steamGames) throw new Error('Block at least one app, site, or Steam games.')
      return api.createGroup(
        {
          name: name.trim(),
          displayName: displayName.trim(),
          allowanceMinutes,
          tariffLamportsPerMinute: tariff,
          periodMs: preset.ms,
          demoMode: preset.demo,
          blocklist: {
            processes: DEFAULT_BLOCKLIST.processes.filter((p) => blocked.has(p.match)),
            titles: DEFAULT_BLOCKLIST.titles.filter((t) => blocked.has(t.match)),
            steamGames,
          },
        },
        publicKey!.toBase58(),
      )
    },
    onSuccess: (res) => {
      rememberGroup(publicKey!.toBase58(), res.groupId)
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
            <span className="text-sm text-white/70">Allowance (minutes per period)</span>
            <input
              className={inputCls}
              inputMode="numeric"
              value={allowance}
              onChange={(e) => setAllowance(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm text-white/70">Tariff (SOL per minute over, into the pool)</span>
            <input
              className={inputCls}
              inputMode="decimal"
              value={tariffSol}
              onChange={(e) => setTariffSol(e.target.value)}
            />
            {parseSolToLamports(tariffSol) !== null && (
              <span className="text-xs text-white/50">
                Charged every 5 s over: ≈ {fmtSol(tariffPerCharge(parseSolToLamports(tariffSol)!, 5))} each
              </span>
            )}
          </label>
        </Card>

        <Card>
          <p className="mb-3 font-semibold">Period length</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
            {PERIOD_PRESETS.map((p) => (
              <button
                type="button"
                key={p.id}
                role="radio"
                aria-checked={presetId === p.id}
                onClick={() => setPresetId(p.id)}
                className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                  presetId === p.id
                    ? 'border-violet-400 bg-violet-500/30 text-white'
                    : 'border-white/15 text-white/60 hover:bg-white/10'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/40">
            The period starts now. When it ends, the staked member with the least blocked time wins
            the whole pool.
            {USE_MOCK && ' Demo mode runs every period for 90 seconds.'}
          </p>
        </Card>

        <Card className="space-y-4">
          <div>
            <p className="font-semibold">What counts as screen time</p>
            <p className="text-xs text-white/40">
              Games match by process name; sites match by browser tab title.
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-violet-500"
              checked={steamGames}
              onChange={(e) => setSteamGames(e.target.checked)}
            />
            <span>
              <span className="block font-medium">🎮 Count every Steam game</span>
              <span className="block text-xs text-white/50">
                Any game launched from Steam, on any drive, shows up by its real name (e.g. “Team
                Fortress 2”). The Steam client itself (store, library, friends) doesn't count.
              </span>
            </span>
          </label>

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
        </Card>

        {mutation.isError && <ErrorBox message={(mutation.error as Error).message} />}

        <button className={`${btnPrimary} w-full`} disabled={mutation.isPending}>
          {mutation.isPending ? 'Creating…' : 'Create group'}
        </button>
      </form>
    </WalletGate>
  )
}
