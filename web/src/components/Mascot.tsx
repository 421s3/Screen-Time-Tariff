/** "Tariff Tom": an original tax-collector mascot, drawn as inline SVG. */
export function Mascot({ size = 96, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Tariff Tom, the tax collector mascot"
      className={className}
    >
      {/* top hat */}
      <rect x="34" y="8" width="52" height="38" rx="4" fill="#1c1c2e" />
      <rect x="34" y="34" width="52" height="8" fill="#7c3aed" />
      <rect x="20" y="44" width="80" height="8" rx="4" fill="#1c1c2e" />
      {/* face */}
      <circle cx="60" cy="72" r="32" fill="#f2c9a0" />
      {/* eyes */}
      <circle cx="48" cy="66" r="4" fill="#1c1c2e" />
      <circle cx="72" cy="66" r="4" fill="#1c1c2e" />
      {/* monocle */}
      <circle cx="72" cy="66" r="9" fill="none" stroke="#d4a017" strokeWidth="2.5" />
      <path d="M81 70 Q92 82 88 96" fill="none" stroke="#d4a017" strokeWidth="1.5" />
      {/* mustache */}
      <path
        d="M36 82 Q48 74 60 82 Q72 74 84 82 Q72 92 60 86 Q48 92 36 82 Z"
        fill="#3b2a20"
      />
      {/* grin */}
      <path d="M50 94 Q60 102 70 94" fill="none" stroke="#7a3b2e" strokeWidth="3" strokeLinecap="round" />
      {/* coin */}
      <circle cx="100" cy="100" r="14" fill="#facc15" stroke="#b45309" strokeWidth="3" />
      <text x="100" y="106" textAnchor="middle" fontSize="16" fontWeight="700" fill="#b45309">
        ◎
      </text>
    </svg>
  )
}
