import { useState } from 'react'
import { completeOnboarding } from '../api/client'
import { useAuth } from '../auth/AuthContext'

const BUDDY_OPTIONS = [
  { key: 'robot',   emoji: '🤖', name: 'Bloxy'  },
  { key: 'fox',     emoji: '🦊', name: 'Foxy'   },
  { key: 'panda',   emoji: '🐼', name: 'Panda'  },
  { key: 'lion',    emoji: '🦁', name: 'Leo'    },
  { key: 'dolphin', emoji: '🐬', name: 'Finn'   },
  { key: 'owl',     emoji: '🦉', name: 'Hoot'   },
  { key: 'dragon',  emoji: '🐉', name: 'Blaze'  },
  { key: 'wizard',  emoji: '🧙', name: 'Merlin' },
]

const GOAL_OPTIONS = [1, 2, 3, 4, 5]

const GOAL_TAGLINES = [
  'Just one a day keeps the rust away!',
  'A solid, sustainable pace!',
  "You're serious about levelling up!",
  "You're going to fly through topics!",
  'Champion mode! 🏆',
]

function StepDots({ current, total }) {
  return (
    <div className="flex items-center gap-1.5 justify-center mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all duration-300 ${
            i < current ? 'w-4 h-1.5 bg-[#00A2FF]' :
            i === current ? 'w-6 h-1.5 bg-[#00A2FF]' :
            'w-1.5 h-1.5 bg-[#2D2B5A]'
          }`}
        />
      ))}
    </div>
  )
}

export default function OnboardingModal({ onDone }) {
  const { refreshUser } = useAuth()
  const [step, setStep]           = useState(0)   // 0=welcome, 1=buddy, 2=goal, 3=done
  const [buddy, setBuddy]         = useState('robot')
  const [buddyName, setBuddyName] = useState('')
  const [goal, setGoal]           = useState(1)
  const [saving, setSaving]       = useState(false)

  const selectedBuddy = BUDDY_OPTIONS.find(b => b.key === buddy)

  async function handleFinish() {
    setSaving(true)
    try {
      const finalName = buddyName.trim() || selectedBuddy?.name || 'Buddy'
      await completeOnboarding(buddy, finalName, goal)
      await refreshUser()
      setStep(3)
    } catch {
      // best-effort; still advance to done
      setStep(3)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <div className="max-w-sm w-full blox-card p-7 text-center animate-bounce-in relative overflow-hidden">

        {/* ── Step 0: Welcome ─────────────────────────────────────────── */}
        {step === 0 && (
          <>
            <div className="text-6xl mb-4 animate-float">🎮</div>
            <h1 className="text-3xl font-fredoka font-bold text-white mb-2">
              Welcome to <span className="text-[#00A2FF]">StudyBlox!</span>
            </h1>
            <p className="text-[#8892B0] text-sm mb-6 leading-relaxed">
              Let's get you set up in 2 quick steps so your learning adventure can begin!
            </p>
            <StepDots current={0} total={3} />
            <button onClick={() => setStep(1)} className="btn-blox-primary w-full py-3 text-base">
              Let's go! 🚀
            </button>
          </>
        )}

        {/* ── Step 1: Choose buddy ─────────────────────────────────────── */}
        {step === 1 && (
          <>
            <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-1">Step 1 of 2</p>
            <h2 className="text-2xl font-fredoka font-bold text-white mb-1">Pick your buddy</h2>
            <p className="text-[#8892B0] text-sm mb-4">They'll guide you through every topic!</p>

            <div className="grid grid-cols-4 gap-2 mb-4">
              {BUDDY_OPTIONS.map(b => (
                <button
                  key={b.key}
                  onClick={() => setBuddy(b.key)}
                  className={`rounded-2xl p-2 flex flex-col items-center gap-1 transition-all border-2 ${
                    buddy === b.key
                      ? 'border-[#00A2FF] bg-[#00A2FF]/10 shadow-glow-blue scale-105'
                      : 'border-[#2D2B5A] hover:border-[#8892B0]'
                  }`}
                >
                  <span className="text-3xl">{b.emoji}</span>
                  <span className="text-[10px] text-[#8892B0] font-nunito leading-none">{b.name}</span>
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder={`Name your buddy (default: ${selectedBuddy?.name})`}
              value={buddyName}
              onChange={e => setBuddyName(e.target.value)}
              maxLength={20}
              className="blox-input w-full text-sm text-center mb-4"
            />

            <StepDots current={1} total={3} />
            <button onClick={() => setStep(2)} className="btn-blox-primary w-full py-3">
              Next → Set my daily goal
            </button>
          </>
        )}

        {/* ── Step 2: Daily goal ───────────────────────────────────────── */}
        {step === 2 && (
          <>
            <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-1">Step 2 of 2</p>
            <div className="text-5xl mb-2">{selectedBuddy?.emoji}</div>
            <h2 className="text-2xl font-fredoka font-bold text-white mb-1">Daily goal</h2>
            <p className="text-[#8892B0] text-sm mb-5">
              How many sessions do you want to complete each day?
            </p>

            <div className="flex gap-2 justify-center mb-3">
              {GOAL_OPTIONS.map(g => (
                <button
                  key={g}
                  onClick={() => setGoal(g)}
                  className={`w-12 h-12 rounded-2xl font-fredoka font-bold text-xl transition-all border-2 ${
                    goal === g
                      ? 'border-[#00A2FF] bg-[#00A2FF] text-white shadow-glow-blue scale-110'
                      : 'border-[#2D2B5A] text-[#8892B0] hover:border-[#8892B0] hover:text-white'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>

            <p className="text-xs text-[#8892B0] italic mb-5 min-h-[16px]">
              {GOAL_TAGLINES[goal - 1]}
            </p>

            <StepDots current={2} total={3} />
            <button
              onClick={handleFinish}
              disabled={saving}
              className="btn-blox-primary w-full py-3 disabled:opacity-50"
            >
              {saving ? '⚡ Saving…' : "Let's start! 🎮"}
            </button>
          </>
        )}

        {/* ── Step 3: All done ─────────────────────────────────────────── */}
        {step === 3 && (
          <>
            <div className="text-6xl mb-4">🎉</div>
            <h2 className="text-2xl font-fredoka font-bold text-white mb-2">You're all set!</h2>
            <div className="blox-card p-4 mb-5 space-y-2 text-left">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{selectedBuddy?.emoji}</span>
                <div>
                  <p className="text-xs text-[#8892B0]">Your buddy</p>
                  <p className="font-fredoka font-bold text-white">
                    {buddyName.trim() || selectedBuddy?.name}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl">🎯</span>
                <div>
                  <p className="text-xs text-[#8892B0]">Daily goal</p>
                  <p className="font-fredoka font-bold text-[#00CC88]">
                    {goal} session{goal !== 1 ? 's' : ''} per day
                  </p>
                </div>
              </div>
            </div>
            <StepDots current={3} total={3} />
            <button onClick={onDone} className="btn-blox-primary w-full py-3">
              Go to Dashboard 🏠
            </button>
          </>
        )}
      </div>
    </div>
  )
}
