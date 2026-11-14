import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { api } from '../api'
import { USE_MOCK } from '../config'
import { Card, ErrorBox, WalletGate, btnPrimary, inputCls } from '../components/ui'

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
      <form onSubmit={onSubmit} className="mx-auto max-w-md space-y-4">
        <h2 className="text-2xl font-bold">Join a group</h2>
        <Card className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm text-white/70">Invite code</span>
            <input
              className={`${inputCls} font-mono text-lg tracking-[0.3em] uppercase`}
              maxLength={6}
              placeholder="TAX42Z"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-white/70">Your display name</span>
            <input
              className={inputCls}
              placeholder="Bob"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <p className="text-xs text-white/50">
            Groups hold up to 8 members. You can join any time before the period ends.
          </p>
          {USE_MOCK && (
            <p className="text-xs text-amber-200">Demo mode: use invite code TAX42Z.</p>
          )}
        </Card>
        {mutation.isError && <ErrorBox message={(mutation.error as Error).message} />}
        <button className={`${btnPrimary} w-full`} disabled={mutation.isPending}>
          {mutation.isPending ? 'Joining…' : 'Join group'}
        </button>
      </form>
    </WalletGate>
  )
}
