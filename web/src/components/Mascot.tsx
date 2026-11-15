import { motion, useReducedMotion } from 'framer-motion'

export type TomMood = 'happy' | 'angry' | 'worried' | 'sleepy' | 'celebrate'

const SKIN = '#f2c9a0'
const INK = '#1c1c2e'
const RIM = '#a78bfa'

/**
 * "Tariff Tom": an original tax-collector mascot, drawn as inline SVG (120x120 viewBox).
 * The desktop app draws the same figure (tracker/tom_art.py), so both show one character.
 * Moods: happy (default), angry (on a tracked app), worried (offline/errors), sleepy (idle),
 * celebrate (results).
 */
export function Mascot({
  size = 96,
  className = '',
  mood = 'happy',
  animated = true,
}: {
  size?: number
  className?: string
  mood?: TomMood
  animated?: boolean
}) {
  const reduce = useReducedMotion()
  const move = animated && !reduce
  const angry = mood === 'angry'
  const label = {
    happy: 'Tariff Tom, smiling',
    angry: 'Tariff Tom, angry: someone is on a tracked app',
    worried: 'Tariff Tom, worried',
    sleepy: 'Tariff Tom, sleepy',
    celebrate: 'Tariff Tom, celebrating',
  }[mood]

  const float = move
    ? mood === 'celebrate'
      ? { y: [0, -14, 0], rotate: [0, -6, 6, 0] }
      : angry
        ? { x: [0, -3, 3, -2, 2, 0], y: [0, -2, 0] }
        : { y: [0, -5, 0] }
    : undefined

  return (
    <motion.div
      key={mood} // re-run the entrance pop on every mood change
      className={`inline-block ${className}`}
      style={{ width: size, height: size }}
      initial={move ? { scale: 0.85, rotate: angry ? -6 : 0 } : false}
      animate={{ scale: 1, rotate: 0, ...(float ?? {}) }}
      transition={{
        scale: { type: 'spring', stiffness: 380, damping: 14 },
        rotate: { duration: mood === 'celebrate' ? 1.2 : 0.4, repeat: mood === 'celebrate' ? 2 : 0 },
        x: { duration: 0.6, repeat: 3, repeatDelay: 1.8 },
        y: { duration: mood === 'celebrate' ? 1.2 : angry ? 0.6 : 3, repeat: 3, ease: 'easeInOut' },
      }}
    >
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={label}>
        {/* steam when angry */}
        {angry &&
          [
            [22, 30, -1],
            [98, 30, 1],
          ].map(([x, y, dir]) => (
            <g key={x} fill="#d9d2f7">
              {[5, 4, 3].map((r, i) => (
                <motion.circle
                  key={r}
                  cx={x + dir * i * 3}
                  cy={y - i * 8}
                  r={r}
                  animate={move ? { opacity: [0.2, 1, 0.2], cy: [y - i * 8, y - i * 8 - 4, y - i * 8] } : undefined}
                  transition={{ duration: 1.1, repeat: 3, delay: i * 0.15 }}
                />
              ))}
            </g>
          ))}

        {/* top hat */}
        <rect x="34" y="8" width="52" height="38" rx="4" fill={INK} stroke={RIM} strokeOpacity="0.7" strokeWidth="1.4" />
        <rect x="35.5" y="34" width="49" height="8" fill="#7c3aed" />
        <line x1="39" y1="12" x2="39" y2="31" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="2.5" />
        <rect x="20" y="44" width="80" height="8" rx="4" fill={INK} stroke={RIM} strokeOpacity="0.7" strokeWidth="1.4" />

        {/* face */}
        <circle cx="60" cy="72" r="32" fill={angry ? '#f4a78c' : SKIN} />
        {angry && (
          <>
            <circle cx="41" cy="82" r="6" fill="#ef4444" fillOpacity="0.35" />
            <circle cx="79" cy="82" r="6" fill="#ef4444" fillOpacity="0.35" />
          </>
        )}
        {mood === 'celebrate' && (
          <>
            <circle cx="40" cy="80" r="5" fill="#f472b6" fillOpacity="0.35" />
            <circle cx="80" cy="80" r="5" fill="#f472b6" fillOpacity="0.35" />
          </>
        )}

        {/* eyes + brows */}
        {mood === 'sleepy' ? (
          <g fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round">
            <path d="M43 66 Q48 70 53 66" />
            <path d="M67 66 Q72 70 77 66" />
          </g>
        ) : mood === 'celebrate' ? (
          <g fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round">
            <path d="M43 68 Q48 62 53 68" />
            <path d="M67 68 Q72 62 77 68" />
          </g>
        ) : (
          <>
            <motion.g
              animate={move && mood === 'happy' ? { scaleY: [1, 1, 0.1, 1] } : undefined}
              transition={{ duration: 4, repeat: 3, times: [0, 0.92, 0.96, 1] }}
              style={{ originY: '66px' }}
            >
              <circle cx="48" cy="66" r={angry ? 3.5 : 4} fill={INK} />
              <circle cx="72" cy="66" r={angry ? 3.5 : 4} fill={INK} />
              {!angry && (
                <>
                  <circle cx="49.3" cy="64.7" r="1.1" fill="#fff" />
                  <circle cx="73.3" cy="64.7" r="1.1" fill="#fff" />
                </>
              )}
            </motion.g>
            {angry && (
              <g stroke={INK} strokeWidth="3.2" strokeLinecap="round">
                <line x1="40" y1="55" x2="53" y2="60" />
                <line x1="80" y1="55" x2="67" y2="60" />
              </g>
            )}
            {mood === 'worried' && (
              <g stroke={INK} strokeWidth="2.4" strokeLinecap="round">
                <line x1="41" y1="59" x2="53" y2="56" />
                <line x1="79" y1="59" x2="67" y2="56" />
              </g>
            )}
          </>
        )}

        {/* monocle */}
        <circle cx="72" cy="66" r="9" fill="none" stroke="#d4a017" strokeWidth="2.5" />
        <path d="M81 70 Q92 82 88 96" fill="none" stroke="#d4a017" strokeWidth="1.5" />

        {/* mustache */}
        <path d="M36 82 Q48 74 60 82 Q72 74 84 82 Q72 92 60 86 Q48 92 36 82 Z" fill="#3b2a20" />
        {angry && (
          <g stroke="#3b2a20" strokeWidth="2.2" strokeLinecap="round">
            <line x1="36" y1="82" x2="31" y2="78" />
            <line x1="84" y1="82" x2="89" y2="78" />
          </g>
        )}

        {/* mouth */}
        {mood === 'happy' && <path d="M50 94 Q60 102 70 94" fill="none" stroke="#7a3b2e" strokeWidth="3" strokeLinecap="round" />}
        {mood === 'celebrate' && <path d="M48 92 Q60 106 72 92 Z" fill="#7a3b2e" />}
        {angry && <path d="M50 99 Q60 92 70 99" fill="none" stroke="#7a3b2e" strokeWidth="3.2" strokeLinecap="round" />}
        {mood === 'worried' && (
          <path d="M51 97 L55 95 L60 97 L65 95 L69 97" fill="none" stroke="#7a3b2e" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {mood === 'sleepy' && <circle cx="60" cy="96" r="2.6" fill="#7a3b2e" />}

        {/* extras */}
        {mood === 'worried' && (
          <motion.path
            d="M90 52 L86 61 A4 4 0 1 0 94 61 Z"
            fill="#7dd3fc"
            animate={move ? { y: [0, 4, 0], opacity: [1, 0.6, 1] } : undefined}
            transition={{ duration: 1.6, repeat: 3 }}
          />
        )}
        {mood === 'sleepy' &&
          [
            [90, 40, 7],
            [99, 28, 5],
            [106, 19, 4],
          ].map(([x, y, s], i) => (
            <motion.path
              key={i}
              d={`M${x} ${y} h${s} l-${s} ${s} h${s}`}
              fill="none"
              stroke="#c4b5fd"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              animate={move ? { opacity: [0, 1, 0], y: [2, -2, -4] } : undefined}
              transition={{ duration: 2.4, repeat: 3, delay: i * 0.5 }}
            />
          ))}

        {/* coin (the tariff) */}
        <motion.g
          animate={move && (angry || mood === 'celebrate') ? { y: [0, -4, 0] } : undefined}
          transition={{ duration: 0.5, repeat: 3, repeatDelay: angry ? 0.6 : 0.2 }}
        >
          <circle cx="100" cy="100" r="14" fill="#facc15" stroke="#b45309" strokeWidth="3" />
          <circle cx="100" cy="100" r="6" fill="none" stroke="#b45309" strokeWidth="2.4" />
        </motion.g>
      </svg>
    </motion.div>
  )
}
