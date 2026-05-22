// Secondary (Grade 6+): gaming rank theme
const RANKS = {
  L1: { label: 'Wood',    emoji: '🪵', cls: 'rank-wood' },
  L2: { label: 'Stone',   emoji: '🪨', cls: 'rank-stone' },
  L3: { label: 'Iron',    emoji: '⚔️',  cls: 'rank-iron' },
  L4: { label: 'Diamond', emoji: '💎', cls: 'rank-diamond' },
  L5: { label: 'Gold',    emoji: '👑', cls: 'rank-gold' },
}

// Primary (Grades 1–5): friendlier star theme
const PRIMARY_RANKS = {
  L1: { label: 'Explorer',  emoji: '🌱', cls: 'rank-wood' },
  L2: { label: 'Adventurer',emoji: '⭐', cls: 'rank-stone' },
  L3: { label: 'Hero',      emoji: '🌟', cls: 'rank-iron' },
  L4: { label: 'Champion',  emoji: '🏆', cls: 'rank-diamond' },
  L5: { label: 'Legend',    emoji: '✨', cls: 'rank-gold' },
}

export default function ProgressBadge({ level, large, grade }) {
  const usePrimary = grade != null && grade <= 5
  const rankMap = usePrimary ? PRIMARY_RANKS : RANKS
  const rank = rankMap[level] || rankMap.L1
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-fredoka font-semibold ${rank.cls} ${
      large ? 'px-4 py-2 text-base' : 'px-2.5 py-1 text-xs'
    }`}>
      {rank.emoji} {rank.label}
    </span>
  )
}
