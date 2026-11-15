import type { TomMood } from '../components/Mascot'
import type { GroupState, Member } from '../types'

export interface TomView {
  mood: TomMood
  say: string
}

/** Tom's mood for one member card. */
export function tomForMember(m: Member): TomMood {
  if (!m.tracker.paired || !m.tracker.online) return 'worried'
  if (m.current) return 'angry'
  if (m.tracker.idle) return 'sleepy'
  return 'happy'
}

const overAllowance = (m: Member, data: GroupState) => m.usage.blockedSeconds > data.group.rules.allowanceMinutes * 60

/**
 * What Tom feels and says on the dashboard, from the polled /state.
 * Your own tracker comes first when you're a member; otherwise he reacts to the whole group.
 */
export function tomForGroup(data: GroupState, wallet: string | null, failing: boolean): TomView {
  const { group, members } = data
  if (failing) return { mood: 'worried', say: "I can't reach the backend. Retrying every second…" }
  if (group.settlement?.status === 'confirmed') {
    const names = group.settlement.winners.map((w) => w.displayName).join(' & ')
    return { mood: 'celebrate', say: names ? `${names} won the pool!` : 'The pool is settled!' }
  }
  if (group.status === 'ended') return { mood: 'happy', say: "Time's up! Settling the pool…" }
  if (group.status === 'upcoming') return { mood: 'sleepy', say: 'The period starts soon. Rest up!' }

  const me = wallet ? members.find((m) => m.wallet === wallet) : undefined
  if (me) {
    if (me.current) {
      return {
        mood: 'angry',
        say: overAllowance(me, data)
          ? `${me.current.app}? You're over the allowance. Tariff time!`
          : `I see you on ${me.current.app}. That time counts!`,
      }
    }
    if (!me.tracker.paired) return { mood: 'worried', say: "Pair your tracker so I can keep count." }
    if (!me.tracker.online) return { mood: 'worried', say: 'Your tracker is offline. Missed check-ins count!' }
    if (me.tracker.idle) return { mood: 'sleepy', say: 'Taking a break? Nice.' }
    return { mood: 'happy', say: "All clear. You're off tracked apps." }
  }

  const caught = members.find((m) => m.current)
  if (caught) return { mood: 'angry', say: `${caught.displayName} is on ${caught.current!.app}!` }
  if (members.some((m) => m.tracker.paired && !m.tracker.online)) {
    return { mood: 'worried', say: "Someone's tracker went quiet…" }
  }
  return { mood: 'happy', say: "Everyone's behaving. For now." }
}
