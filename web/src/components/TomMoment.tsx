import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Mascot, type TomMood } from './Mascot'

/**
 * Tariff Tom in the product's key moments: the same character (Mascot) on a coloured stage with
 * one prop that tells the story. Props are drawn in a 160x140 box beside/around him.
 */
export type TomMomentName = 'join' | 'tracking' | 'over' | 'penalty' | 'win' | 'offline'

const MOMENTS: Record<TomMomentName, { mood: TomMood; stage: string; label: string }> = {
  join: { mood: 'happy', stage: 'from-[#e7e0ff] to-[#d9ccff]', label: 'Tom welcomes you to the group' },
  tracking: { mood: 'worried', stage: 'from-[#dce6ff] to-[#c9d8ff]', label: 'Tom spots a tracked app' },
  over: { mood: 'angry', stage: 'from-[#ffd6cc] to-[#f6b9d6]', label: 'Tom: allowance used up' },
  penalty: { mood: 'celebrate', stage: 'from-[#ffe39a] to-[#ffd08a]', label: 'Tom collects a tariff' },
  win: { mood: 'celebrate', stage: 'from-[#bcefe0] to-[#ffe39a]', label: 'Tom crowns the winner' },
  offline: { mood: 'sleepy', stage: 'from-[#e9e6f2] to-[#d6d1e6]', label: 'Tom lost the tracker' },
}

const INK = '#17152d'

function Prop({ name }: { name: TomMomentName }) {
  switch (name) {
    case 'join':
      // invite ticket
      return (
        <g transform="translate(104 58) rotate(12)">
          <path d="M0 0h44v8a6 6 0 0 0 0 12v8H0v-8a6 6 0 0 0 0-12Z" fill="#ffe39a" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
          <line x1="13" y1="3" x2="13" y2="25" stroke={INK} strokeWidth="1.6" strokeDasharray="3 3" />
          <path d="M22 9h14M22 15h10M22 21h12" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        </g>
      )
    case 'tracking':
      // phone with a video, under a magnifying glass
      return (
        <g>
          <rect x="108" y="40" width="34" height="58" rx="6" fill="#fff" stroke={INK} strokeWidth="2.2" />
          <rect x="113" y="47" width="24" height="38" rx="3" fill="#f6b9d6" />
          <path d="M122 60l8 5-8 5Z" fill={INK} />
          <circle cx="112" cy="84" r="14" fill="#dce6ff" fillOpacity="0.6" stroke={INK} strokeWidth="3" />
          <line x1="102" y1="94" x2="92" y2="106" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        </g>
      )
    case 'over':
      // stopwatch in the red
      return (
        <g transform="translate(124 66)">
          <rect x="-5" y="-30" width="10" height="7" rx="2" fill={INK} />
          <circle r="22" fill="#fff" stroke={INK} strokeWidth="2.4" />
          <path d="M0 0V-22A22 22 0 0 1 21 -6Z" fill="#d6364a" fillOpacity="0.85" />
          <line x1="0" y1="0" x2="12" y2="-14" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          <circle r="3" fill={INK} />
          <path d="M24 -26l6 -6M30 -18h8M18 -32l2 -8" stroke="#d6364a" strokeWidth="2.6" strokeLinecap="round" />
        </g>
      )
    case 'penalty':
      // coin dropping into a jar
      return (
        <g>
          <path d="M104 74h40l-3 42a6 6 0 0 1-6 5h-22a6 6 0 0 1-6-5Z" fill="#fff" fillOpacity="0.7" stroke={INK} strokeWidth="2.2" />
          <rect x="102" y="68" width="44" height="8" rx="3" fill={INK} />
          {[0, 1, 2].map((i) => (
            <ellipse key={i} cx="124" cy={112 - i * 7} rx="14" ry="4.5" fill="#f5b82e" stroke="#b45309" strokeWidth="1.6" />
          ))}
          <g transform="translate(124 46)">
            <circle r="10" fill="#ffd45e" stroke="#b45309" strokeWidth="2.2" />
            <circle r="4.5" fill="none" stroke="#b45309" strokeWidth="1.8" />
          </g>
          <path d="M108 36l-5-5M140 36l5-5" stroke="#b45309" strokeWidth="2" strokeLinecap="round" />
        </g>
      )
    case 'win':
      // trophy + crown sparkle
      return (
        <g>
          <path d="M108 52h32v10a16 16 0 0 1-32 0Z" fill="#ffd45e" stroke={INK} strokeWidth="2.2" />
          <path d="M108 56h-6a8 8 0 0 0 8 10M140 56h6a8 8 0 0 1-8 10" fill="none" stroke={INK} strokeWidth="2.2" />
          <rect x="120" y="77" width="8" height="12" fill="#f5b82e" stroke={INK} strokeWidth="2" />
          <rect x="111" y="89" width="26" height="8" rx="2" fill={INK} />
          <path d="M112 28l6 8 6-10 6 10 6-8-2 14h-20Z" fill="#ffd45e" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
          <path d="M98 30l3 3M150 40l4-1M146 22l2-4" stroke="#6a47f0" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      )
    case 'offline':
      // unplugged cable
      return (
        <g>
          <path d="M96 112c14 0 18-14 30-14" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
          <rect x="124" y="90" width="18" height="16" rx="3" fill="#b9a5ff" stroke={INK} strokeWidth="2.2" />
          <path d="M142 94h6M142 102h6" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
          <rect x="150" y="84" width="8" height="28" rx="2" fill="#fff" stroke={INK} strokeWidth="2" />
          <path d="M140 72l6 6M150 70v8M158 74l-4 5" stroke="#e0a400" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      )
  }
}

export function TomMoment({
  moment,
  size = 160,
  className = '',
  stage = true,
}: {
  moment: TomMomentName
  /** Width in px; height is 7/8 of it. */
  size?: number
  className?: string
  /** Draw the soft coloured disc behind him. */
  stage?: boolean
}) {
  const m = MOMENTS[moment]
  const reduce = useReducedMotion()
  const h = Math.round(size * 0.875)
  return (
    <motion.div
      key={moment}
      role="img"
      aria-label={m.label}
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: h }}
      initial={reduce ? false : { opacity: 0, scale: 0.92, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
    >
      {stage && (
        <span
          aria-hidden="true"
          className={cn('absolute inset-x-[6%] bottom-0 top-[12%] rounded-[46%_54%_48%_52%/55%_50%_50%_45%] bg-gradient-to-br', m.stage)}
        />
      )}
      <svg viewBox="0 0 160 140" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
        <Prop name={moment} />
      </svg>
      <div className="absolute" style={{ left: size * 0.04, bottom: size * 0.02 }}>
        <Mascot size={Math.round(size * 0.62)} mood={m.mood} animated={false} />
      </div>
    </motion.div>
  )
}
