/**
 * UserAvatar — renders the right avatar for a user.
 *
 * Priority:
 *   1. avatar_preset set  → emoji from AVATAR_PRESETS
 *   2. avatar_url set     → <img> (Google photo or custom upload)
 *   3. fallback           → coloured circle with first initial
 *
 * Props:
 *   user      — user object from AuthContext / API
 *   className — Tailwind classes for size + shape (default: w-8 h-8 rounded-xl)
 *   textSize  — Tailwind text size for initials fallback (default: text-sm)
 */

export const AVATAR_PRESETS = {
  // Animals
  cat:       '🐱',
  dog:       '🐶',
  fox:       '🦊',
  panda:     '🐼',
  lion:      '🦁',
  dolphin:   '🐬',
  owl:       '🦉',
  frog:      '🐸',
  tiger:     '🐯',
  butterfly: '🦋',
  penguin:   '🐧',
  unicorn:   '🦄',
  // Fantasy & Cool
  dragon:    '🐉',
  wizard:    '🧙',
  eagle:     '🦅',
  robot:     '🤖',
  star:      '🌟',
  rocket:    '🚀',
  palette:   '🎨',
  theatre:   '🎭',
}

const ROLE_GRADIENT = {
  student: 'from-[#FF6B9D] to-[#FF3333]',
  parent:  'from-[#00CC88] to-[#007755]',
  admin:   'from-[#00A2FF] to-[#0066CC]',
}

export default function UserAvatar({
  user,
  className = 'w-8 h-8 rounded-xl',
  textSize = 'text-sm',
}) {
  if (user?.avatar_preset && AVATAR_PRESETS[user.avatar_preset]) {
    return (
      <div className={`${className} bg-[#1A1A3E] border border-[#2D2B5A] flex items-center justify-center text-xl leading-none`}>
        {AVATAR_PRESETS[user.avatar_preset]}
      </div>
    )
  }

  if (user?.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        className={`${className} object-cover border border-[#2D2B5A]`}
        alt=""
      />
    )
  }

  const gradient = ROLE_GRADIENT[user?.role] || ROLE_GRADIENT.student
  return (
    <div className={`${className} bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-fredoka font-bold ${textSize}`}>
      {user?.name?.[0]?.toUpperCase() || '?'}
    </div>
  )
}
