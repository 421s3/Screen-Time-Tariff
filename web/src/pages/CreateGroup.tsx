import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { Gamepad2, Globe, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api } from '../api'
import { USE_MOCK } from '../config'
import { PERIOD_PRESETS, type Blocklist } from '../types'
import { fmtSol, parseSolToLamports, tariffPerCharge } from '../lib/format'
import { rememberGroup } from '../lib/currentGroup'
import { ErrorBox, PageHeader, WalletGate } from '../components/kit'

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
  const [blocked, setBlocked] = useState<Set<string>>(() => new Set(ALL_ITEMS.map((i) => i.match)))

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
      <form onSubmit={onSubmit} className="mx-auto max-w-3xl">
        <PageHeader
          title="Create a group"
          subtitle="Pick the rules everyone plays by. The period starts as soon as you create it."
          say="Set the rules. I'll collect the tariffs."
          actions={
            <Button asChild variant="link" className="px-0 sm:px-3">
              <Link to="/join">Have an invite code? Join instead</Link>
            </Button>
          }
        />

        <div className="divide-y rounded-xl border bg-card">
          <Section title="The basics" hint="Your name is how the group sees you on the dashboard.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="group-name" label="Group name" className="sm:col-span-2">
                <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field id="display-name" label="Your display name" className="sm:col-span-2">
                <Input
                  id="display-name"
                  placeholder="Alice"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </Field>
              <Field id="allowance" label="Allowance (minutes per period)">
                <Input id="allowance" inputMode="numeric" value={allowance} onChange={(e) => setAllowance(e.target.value)} />
              </Field>
              <Field id="tariff" label="Tariff (SOL per minute over)">
                <Input id="tariff" inputMode="decimal" value={tariffSol} onChange={(e) => setTariffSol(e.target.value)} />
                {parseSolToLamports(tariffSol) !== null && (
                  <p className="text-xs text-muted-foreground">
                    Charged every 5 s over: ≈ {fmtSol(tariffPerCharge(parseSolToLamports(tariffSol)!, 5))} each
                  </p>
                )}
              </Field>
            </div>
          </Section>

          <Section
            title="Period length"
            hint={`When it ends, the staked member with the least blocked time wins the whole pool.${
              USE_MOCK ? ' Demo mode runs every period for 90 seconds.' : ''
            }`}
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Period length">
              {PERIOD_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  role="radio"
                  aria-checked={presetId === p.id}
                  onClick={() => setPresetId(p.id)}
                  className="chip"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="What counts as screen time" hint="Games match by process name; sites match by browser tab title.">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4 rounded-lg bg-sky p-4">
                <div>
                  <Label htmlFor="steam" className="font-medium">
                    <Gamepad2 className="size-4" /> Count every Steam game
                  </Label>
                  <p className="mt-1 text-sm text-ink/75">
                    Any game launched from Steam shows up by its real name (e.g. “Team Fortress 2”). The Steam store
                    and library don't count.
                  </p>
                </div>
                <Switch id="steam" checked={steamGames} onCheckedChange={setSteamGames} />
              </div>
              <div className="flex flex-wrap gap-2" aria-label="Tracked apps and sites">
                {ALL_ITEMS.map((item) => (
                  <button
                    type="button"
                    key={item.match}
                    onClick={() => toggle(item.match)}
                    aria-pressed={blocked.has(item.match)}
                    className="chip"
                  >
                    {item.kind === 'processes' ? <Gamepad2 className="size-4" /> : <Globe className="size-4" />}
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </Section>
        </div>

        {mutation.isError && (
          <div className="mt-4">
            <ErrorBox message={(mutation.error as Error).message} />
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <Button size="lg" className="w-full sm:w-auto" disabled={mutation.isPending}>
            <Plus />
            {mutation.isPending ? 'Creating…' : 'Create group'}
          </Button>
        </div>
      </form>
    </WalletGate>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 p-5 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8 md:p-6">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

function Field({ id, label, className = '', children }: { id: string; label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
