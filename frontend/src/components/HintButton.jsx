export default function HintButton({ onHint, hintTier, isLoading, isFinalHint }) {
  let label = 'Need a hint? 💡'
  if (hintTier >= 5 || isFinalHint) {
    label = 'Get full explanation'
  } else if (hintTier >= 1) {
    label = 'Get another hint'
  }

  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <button
        onClick={onHint}
        disabled={isLoading}
        className="px-4 py-2 rounded-lg border-2 border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? 'Loading...' : label}
      </button>
      {hintTier > 0 && hintTier <= 5 && (
        <span className="text-xs text-gray-400">Hint {hintTier}/5</span>
      )}
    </div>
  )
}
