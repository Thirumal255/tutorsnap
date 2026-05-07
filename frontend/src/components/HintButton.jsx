export default function HintButton({ onHint, hintTier, isLoading, isFinalHint }) {
  const dots = [1, 2, 3, 4, 5]

  let label = '🎁 Open Hint Chest'
  let sublabel = 'Tap to unlock a clue!'
  if (hintTier >= 5 || isFinalHint) {
    label = '🔮 Full Explanation'
    sublabel = 'See the full breakdown'
  } else if (hintTier >= 1) {
    label = '🎁 Another Hint'
    sublabel = 'Keep going, you\'re close!'
  }

  return (
    <div className="flex flex-col items-center gap-2 py-3 animate-bounce-in">
      <button
        onClick={onHint}
        disabled={isLoading}
        className="btn-blox-gold btn-blox-primary flex items-center gap-2 text-sm"
        style={{ fontFamily: 'Fredoka, sans-serif', fontWeight: 600 }}
      >
        {isLoading ? (
          <span className="flex gap-1">
            <span className="w-2 h-2 bg-[#1A1A3E] rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 bg-[#1A1A3E] rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-[#1A1A3E] rounded-full animate-bounce [animation-delay:300ms]" />
          </span>
        ) : label}
      </button>
      <p className="text-[#8892B0] text-xs">{sublabel}</p>
      {hintTier > 0 && (
        <div className="flex gap-1.5 items-center">
          {dots.map(d => (
            <div key={d} className={`w-2.5 h-2.5 rounded-full transition-all ${
              d <= hintTier ? 'bg-[#FFD700] shadow-glow-gold scale-110' : 'bg-[#2D2B5A]'
            }`} />
          ))}
          <span className="text-[#8892B0] text-xs ml-1">{hintTier}/5</span>
        </div>
      )}
    </div>
  )
}
