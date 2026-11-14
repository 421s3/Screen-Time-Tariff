import type { Member } from '../types'
import { fmtDuration } from '../lib/format'

/**
 * What a member is doing right now, from the tracker's report. `current.app` is the name the
 * tracker detected: a blocklist label ("Valorant", "TikTok") or, with steamGames on, the Steam
 * game's folder name ("Team Fortress 2").
 */
export function activityOf(m: Member, now: number): { icon: string; text: string; tone: string } {
  if (!m.tracker.paired) return { icon: '🔌', text: 'Tracker not paired', tone: 'text-white/50' }
  if (!m.tracker.online) {
    return {
      icon: '📴',
      text: 'Tracker offline (missed check-ins count against them)',
      tone: 'bg-amber-400/20 text-amber-200',
    }
  }
  if (m.tracker.idle && !m.current) return { icon: '💤', text: 'Idle (not counted)', tone: 'bg-white/10 text-white/70' }
  if (m.current) {
    const forHow = now > m.current.since ? ` · ${fmtDuration((now - m.current.since) / 1000)}` : ''
    return m.current.matchType === 'process'
      ? { icon: '🎮', text: `Playing ${m.current.app}${forHow}`, tone: 'bg-red-500/20 text-red-200' }
      : { icon: '🌐', text: `On ${m.current.app}${forHow}`, tone: 'bg-red-500/20 text-red-200' }
  }
  return { icon: '✅', text: 'Online, not on a blocked app', tone: 'text-emerald-300' }
}

export function ActivityBadge({ member, now }: { member: Member; now: number }) {
  const a = activityOf(member, now)
  const pill = a.tone.startsWith('bg-')
  return (
    <span className={pill ? `inline-block rounded-full px-2 py-0.5 ${a.tone}` : a.tone}>
      {a.icon} {a.text}
    </span>
  )
}
