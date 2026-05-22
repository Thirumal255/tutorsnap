import { useState } from 'react'
import { updateBuddySettings } from '../api/client'

const BUDDY_PRESETS = [
  { key: 'robot',   emoji: '🤖', label: 'Robot' },
  { key: 'fox',     emoji: '🦊', label: 'Fox' },
  { key: 'panda',   emoji: '🐼', label: 'Panda' },
  { key: 'lion',    emoji: '🦁', label: 'Lion' },
  { key: 'dolphin', emoji: '🐬', label: 'Dolphin' },
  { key: 'owl',     emoji: '🦉', label: 'Owl' },
  { key: 'dragon',  emoji: '🐉', label: 'Dragon' },
  { key: 'wizard',  emoji: '🧙', label: 'Wizard' },
]

/**
 * BuddyCustomizer — slide-up modal for buddy avatar + nickname + goals.
 * Props:
 *   currentAvatar       (string)  — current avatar key
 *   currentName         (string)  — current buddy name
 *   currentMasteryGoal  (number)  — current weekly mastery goal (0 = none)
 *   onClose             (fn)      — close the modal
 *   onSave              (fn({buddy_name, buddy_avatar})) — called after successful save
 */
export default function BuddyCustomizer({
  currentAvatar = 'robot', currentName = 'Buddy',
  currentMasteryGoal = 0,
  onClose, onSave,
}) {
  const [avatar, setAvatar]           = useState(currentAvatar)
  const [name, setName]               = useState(currentName === 'Buddy' ? '' : currentName)
  const [masteryGoal, setMasteryGoal] = useState(currentMasteryGoal)  // #59
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  const selectedEmoji = BUDDY_PRESETS.find(p => p.key === avatar)?.emoji || '🤖'

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const res = await updateBuddySettings({
        buddy_name:          name.trim() || 'Buddy',
        buddy_avatar:        avatar,
        weekly_mastery_goal: masteryGoal,
      })
      onSave?.(res.data)
      onClose?.()
    } catch {
      setError('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-[#16213E] border border-[#2D2B5A] rounded-t-3xl sm:rounded-3xl p-6 space-y-5 animate-bounce-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="font-fredoka font-bold text-white text-xl">Customise Your Buddy</h2>
          <button onClick={onClose} className="text-[#8892B0] hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* Preview */}
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#00A2FF] to-[#0066CC] flex items-center justify-center text-5xl shadow-glow-blue animate-float">
            {selectedEmoji}
          </div>
          <p className="font-fredoka font-bold text-white text-lg">
            {name.trim() || 'Buddy'}
          </p>
        </div>

        {/* Name input */}
        <div>
          <label className="text-xs text-[#8892B0] font-semibold uppercase tracking-widest">Buddy's name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value.slice(0, 20))}
            placeholder="Buddy"
            className="blox-input w-full mt-2"
          />
          <p className="text-xs text-[#2D2B5A] mt-1 text-right">{name.length}/20</p>
        </div>

        {/* Avatar picker */}
        <div>
          <label className="text-xs text-[#8892B0] font-semibold uppercase tracking-widest">Choose avatar</label>
          <div className="grid grid-cols-4 gap-2 mt-2">
            {BUDDY_PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => setAvatar(p.key)}
                className={`flex flex-col items-center gap-1 p-2 rounded-2xl border transition-all ${
                  avatar === p.key
                    ? 'border-[#00A2FF] bg-[#00A2FF]/15 shadow-glow-blue'
                    : 'border-[#2D2B5A] hover:border-[#00A2FF]/50'
                }`}
              >
                <span className="text-2xl">{p.emoji}</span>
                <span className="text-[9px] text-[#8892B0] font-nunito">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Weekly mastery goal (#59) */}
        <div>
          <label className="text-xs text-[#8892B0] font-semibold uppercase tracking-widest">
            Weekly mastery goal
          </label>
          <p className="text-xs text-[#4A5568] mt-0.5 mb-2">Topics to master per week (0 = no goal)</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMasteryGoal(g => Math.max(0, g - 1))}
              className="w-9 h-9 rounded-xl bg-[#2D2B5A] text-white font-bold text-lg hover:bg-[#3D3B6A] transition-all"
            >−</button>
            <span className="flex-1 text-center font-fredoka font-bold text-white text-xl">
              {masteryGoal === 0 ? '—' : masteryGoal}
            </span>
            <button
              onClick={() => setMasteryGoal(g => Math.min(20, g + 1))}
              className="w-9 h-9 rounded-xl bg-[#2D2B5A] text-white font-bold text-lg hover:bg-[#3D3B6A] transition-all"
            >+</button>
          </div>
        </div>

        {error && <p className="text-sm text-[#FF6B6B] text-center">{error}</p>}

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-blox-primary w-full py-3 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Saving…
            </>
          ) : '💾 Save Buddy'}
        </button>
      </div>
    </div>
  )
}
