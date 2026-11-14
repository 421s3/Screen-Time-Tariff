import { AnimatePresence, motion } from 'framer-motion'
import type { Penalty } from '../types'
import { explorerTx, fmtSol, shortAddr } from '../lib/format'
import { Card, EmptyState } from './ui'

const statusStyle: Record<Penalty['status'], string> = {
  pending: 'bg-amber-400/20 text-amber-200',
  sent: 'bg-sky-400/20 text-sky-200',
  confirmed: 'bg-emerald-400/20 text-emerald-200',
  failed: 'bg-red-400/20 text-red-200',
}

export function PenaltyFeed({ penalties }: { penalties: Penalty[] }) {
  if (penalties.length === 0) {
    return (
      <EmptyState
        title="No penalties yet"
        body="Penalties appear here the moment someone goes over their allowance."
      />
    )
  }
  return (
    <ul className="space-y-3">
      <AnimatePresence initial={false}>
        {penalties.map((p) => {
          const link = p.explorerUrl ?? (p.signature ? explorerTx(p.signature) : null)
          return (
            <motion.li
              key={p.penaltyId}
              layout
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <Card className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {p.displayName} paid {fmtSol(p.lamports)}
                    <span className="font-normal text-white/60">
                      {' '}
                      for {p.minutes} min of {p.app}
                    </span>
                  </p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusStyle[p.status]}`}
                  >
                    {p.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-white/60">
                  Sent to{' '}
                  {p.recipients.length
                    ? p.recipients
                        .map((r) => `${r.displayName} (+${fmtSol(r.lamports)})`)
                        .join(', ')
                    : shortAddr(p.wallet)}
                </p>
                {p.roast && <p className="mt-2 text-sm italic text-violet-200">“{p.roast}”</p>}
                <p className="mt-2 text-xs">
                  {link ? (
                    <a
                      className="text-sky-300 underline"
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on Solana Explorer
                    </a>
                  ) : (
                    <span className="text-white/40">
                      {p.status === 'confirmed'
                        ? 'Demo data: no on-chain transaction'
                        : 'Waiting for transaction…'}
                    </span>
                  )}
                </p>
              </Card>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ul>
  )
}
