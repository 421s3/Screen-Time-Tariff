import { AnimatePresence, motion } from 'framer-motion'
import { Coins, ExternalLink } from 'lucide-react'
import type { Penalty } from '../types'
import { explorerTx, fmtDuration, fmtSol } from '../lib/format'
import { cn } from '@/lib/utils'
import { EmptyState } from './kit'

const statusStyle: Record<Penalty['status'], string> = {
  pending: 'bg-lemon text-warn',
  sent: 'bg-sky text-ink',
  confirmed: 'bg-mint text-good',
  failed: 'bg-coral text-bad',
}

/** Winner-takes-pool: each penalty moves the charge from the member's stake into the pool. */
export function PenaltyFeed({ penalties }: { penalties: Penalty[] }) {
  if (penalties.length === 0) {
    return (
      <EmptyState
        title="No penalties yet"
        body="When someone goes over the allowance, the extra time is charged into the pool every few seconds."
      />
    )
  }
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      <AnimatePresence initial={false}>
        {penalties.map((p) => {
          const link = p.explorerUrl ?? (p.signature && !p.signature.startsWith('mock_') ? explorerTx(p.signature) : null)
          return (
            <motion.li
              key={p.penaltyId}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-start gap-3 px-4 py-3"
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-lemon">
                <Coins className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-semibold">{p.displayName}</span> paid{' '}
                  <span className="font-semibold">{fmtSol(p.lamports)}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {p.seconds !== undefined && p.seconds % 60 !== 0 ? fmtDuration(p.seconds) : `${p.minutes} min`} of {p.app}
                  </span>
                </p>
                <p className="mt-0.5 text-xs">
                  {link ? (
                    <a
                      className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Solana Explorer <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground">
                      {p.status === 'confirmed'
                        ? 'No Explorer link (demo or mock chain)'
                        : p.status === 'failed'
                          ? 'Transaction failed'
                          : 'Waiting for the transaction…'}
                    </span>
                  )}
                </p>
              </div>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', statusStyle[p.status])}>
                {p.status}
              </span>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ul>
  )
}
