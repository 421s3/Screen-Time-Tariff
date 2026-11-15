import type { Member } from '../types'
import { fmtDuration } from '../lib/format'

/**
 * What a member is doing right now, from the tracker's report. `current.app` is the name the
 * tracker detected: a blocklist label ("Valorant", "TikTok") or, with steamGames on, the Steam
 * game's folder name ("Team Fortress 2").
 */
export function activityOf(m: Member, now: number): { icon: string; text: string; tone: string } {
  if (!m.tracker.paired) return { icon: '🔌', text: 'Tracker not paired', tone: 'text-muted-foreground' }
  if (!m.tracker.online) {
    return {
      icon: '📴',
      text: 'Tracker offline (missed check-ins count against them)',
      tone: 'bg-lemon text-warn',
    }
  }
  if (m.tracker.idle && !m.current) return { icon: '💤', text: 'Idle (not counted)', tone: 'bg-muted text-ink' }
  if (m.current) {
    const forHow = now > m.current.since ? ` · ${fmtDuration((now - m.current.since) / 1000)}` : ''
    return m.current.matchType === 'process'
      ? { icon: '🎮', text: `Playing ${m.current.app}${forHow}`, tone: 'bg-coral text-bad' }
      : { icon: '🌐', text: `On ${m.current.app}${forHow}`, tone: 'bg-coral text-bad' }
  }
  return { icon: '✅', text: 'Online, not on a blocked app', tone: 'text-good' }
}

export function ActivityBadge({ member, now }: { member: Member; now: number }) {
  const a = activityOf(member, now)
  const pill = a.tone.startsWith('bg-')
  return (
    <span className={pill ? `inline-block max-w-full truncate rounded-full px-2 py-0.5 align-middle ${a.tone}` : a.tone}>
      {a.icon} {a.text}
    </span>
  )
}
