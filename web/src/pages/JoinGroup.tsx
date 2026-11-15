import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '../api'
import { USE_MOCK } from '../config'
import { rememberGroup } from '../lib/currentGroup'
import { ErrorBox, Notice, PageHeader, Panel, WalletGate } from '../components/kit'

export function JoinGroup() {
  const navigate = useNavigate()
  const { publicKey } = useWallet()
  const [code, setCode] = useState('')
  const [displayName, setDisplayName] = useState('')

  const mutation = useMutation({
    mutationFn: async () => {
      if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('Invite codes are 6 letters or digits.')
      if (!displayName.trim()) throw new Error('Enter your display name.')
      return api.joinGroup(code, displayName.trim(), publicKey!.toBase58())
    },
    onSuccess: (res) => {
      rememberGroup(publicKey!.toBase58(), res.groupId)
      toast.success('Joined! Now stake your SOL.')
      navigate(`/group/${res.groupId}/stake`)
    },
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate()
  }

  return (
    <WalletGate text="Connect Phantom to join a group.">
      <form onSubmit={onSubmit} className="mx-auto max-w-lg">
        <PageHeader
          title="Join a group"
          subtitle="Got an invite code from a friend? Enter it below."
          say="Welcome aboard! Six characters, please."
        />
        <Panel className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="invite">Invite code</Label>
            <Input
              id="invite"
              className="h-14 text-center font-mono text-2xl font-semibold tracking-[0.4em] uppercase md:text-2xl"
              maxLength={6}
              autoComplete="off"
              placeholder="TAX42Z"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="join-name">Your display name</Label>
            <Input id="join-name" placeholder="Bob" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <p className="text-sm text-muted-foreground">
            Groups hold up to 8 members. You can join any time before the period ends.
          </p>
          {USE_MOCK && <Notice tone="warn">Demo mode: use invite code TAX42Z.</Notice>}
          {mutation.isError && <ErrorBox message={(mutation.error as Error).message} />}
          <Button size="lg" className="w-full" disabled={mutation.isPending}>
            <Ticket />
            {mutation.isPending ? 'Joining…' : 'Join group'}
          </Button>
        </Panel>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          No code?{' '}
          <Link to="/create" className="font-medium text-brand hover:underline">
            Create a group
          </Link>
        </p>
      </form>
    </WalletGate>
  )
}
