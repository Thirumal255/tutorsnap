const RANKS = {
  L1: { label: 'Wood',    emoji: '🪵', cls: 'rank-wood' },
  L2: { label: 'Stone',   emoji: '🪨', cls: 'rank-stone' },
  L3: { label: 'Iron',    emoji: '⚔️',  cls: 'rank-iron' },
  L4: { label: 'Diamond', emoji: '💎', cls: 'rank-diamond' },
  L5: { label: 'Gold',    emoji: '👑', cls: 'rank-gold' },
}

export default function ProgressBadge({ level, large }) {
  const rank = RANKS[level] || RANKS.L1
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-fredoka font-semibold ${rank.cls} ${
      large ? 'px-4 py-2 text-base' : 'px-2.5 py-1 text-xs'
    }`}>
      {rank.emoji} {rank.label}
    </span>
  )
}
