import { AnimatePresence, motion } from 'framer-motion'
import type { RankEvent } from '../types'
import { ordinal } from '../lib/format'
import { Card, EmptyState } from './ui'

function describe(e: RankEvent): { icon: string; text: string } {
  switch (e.kind) {
    case 'session_started':
      return { icon: '🏁', text: 'Session started. Joining is closed. Lowest screen time wins the pot.' }
    case 'session_ended':
      return { icon: '⏱️', text: 'Session over. Settling the pot…' }
    case 'took_lead':
      return {
        icon: '👑',
        text: e.otherDisplayName
          ? `${e.displayName} took 1st place from ${e.otherDisplayName}`
          : `${e.displayName} took 1st place`,
      }
    case 'passed':
      return {
        icon: '⬆️',
        text: e.otherDisplayName
          ? `${e.displayName} passed ${e.otherDisplayName} for ${ordinal(e.newRank ?? 0)}`
          : `${e.displayName} moved up to ${ordinal(e.newRank ?? 0)}`,
      }
  }
}

export function RankFeed({ events }: { events: RankEvent[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        title="No rank changes yet"
        body="Lead changes and passes show up here once the session starts."
      />
    )
  }
  return (
    <ul className="space-y-3">
      <AnimatePresence initial={false}>
        {events.map((e) => {
          const { icon, text } = describe(e)
          return (
            <motion.li
              key={e.eventId}
              layout
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <Card className={`p-4 ${e.kind === 'took_lead' ? 'border-violet-400/40' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold">
                    <span className="mr-2">{icon}</span>
                    {text}
                  </p>
                  <span className="shrink-0 text-xs text-white/40">
                    {new Date(e.createdAt).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
                {e.roast && <p className="mt-2 text-sm italic text-violet-200">“{e.roast}”</p>}
              </Card>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ul>
  )
}
