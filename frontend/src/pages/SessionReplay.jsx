import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSessionReplay } from '../api/client'

const LEVEL_COLOR = {
  L1: 'text-yellow-400', L2: 'text-blue-400',
  L3: 'text-green-400',  L4: 'text-purple-400', L5: 'text-yellow-300',
}

const SCORE_CFG = (score) => {
  if (score === null || score === undefined) return { label: '—',      color: 'text-[#8892B0]', bg: 'bg-[#2D2B5A]/50',      ring: 'border-[#2D2B5A]' }
  if (score >= 80)  return { label: `${score}`,  color: 'text-[#00CC88]', bg: 'bg-[#00CC88]/10',    ring: 'border-[#00CC88]/40' }
  if (score >= 50)  return { label: `${score}`,  color: 'text-[#FFD700]', bg: 'bg-[#FFD700]/10',    ring: 'border-[#FFD700]/40' }
  return               { label: `${score}`,  color: 'text-[#FF6B6B]', bg: 'bg-[#FF6B6B]/10',    ring: 'border-[#FF6B6B]/40' }
}

const HINT_LABEL = ['No hint', '1st hint', '2nd hint', '3rd hint']

const ANSWER_FORMAT_LABEL = {
  number: 'Number', yes_no: 'Yes / No',
  rule: 'State the rule', explanation: 'Explanation', working: 'Show working',
}

function TurnCard({ turn, index }) {
  const [open, setOpen] = useState(false)
  const s = SCORE_CFG(turn.score)
  const correct = turn.score >= 80

  return (
    <div className={`rounded-2xl border ${s.ring} ${s.bg} overflow-hidden`}>
      {/* Summary row — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/5 transition-colors"
      >
        {/* Turn number */}
        <div className="w-7 h-7 rounded-full bg-[#0F0F23] flex items-center justify-center text-[10px] font-fredoka font-bold text-[#8892B0] flex-shrink-0">
          {index + 1}
        </div>

        {/* Question preview */}
        <p className="flex-1 text-sm text-white font-nunito truncate leading-snug">
          {turn.question_text}
        </p>

        {/* Score chip */}
        <div className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-fredoka font-bold ${s.color}`}>
          {correct ? '✓' : '✗'} {s.label}
        </div>

        {/* Level badge */}
        <span className={`flex-shrink-0 text-[10px] font-semibold ${LEVEL_COLOR[turn.level] || 'text-[#8892B0]'}`}>
          {turn.level}
        </span>

        <span className="text-[#8892B0] text-xs flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-[#2D2B5A]">
          {/* Full question */}
          <div className="pt-3">
            <p className="text-[10px] text-[#8892B0] font-semibold uppercase tracking-wide mb-1">Question</p>
            <p className="text-sm text-white font-nunito leading-relaxed">{turn.question_text}</p>
            {turn.answer_format && (
              <p className="text-[10px] text-[#8892B0] mt-1">
                Format: {ANSWER_FORMAT_LABEL[turn.answer_format] || turn.answer_format}
              </p>
            )}
          </div>

          {/* Student answer */}
          <div className={`rounded-xl p-3 border ${correct ? 'border-[#00CC88]/30 bg-[#00CC88]/5' : 'border-[#FF6B6B]/30 bg-[#FF6B6B]/5'}`}>
            <p className="text-[10px] text-[#8892B0] font-semibold uppercase tracking-wide mb-1">
              Your answer {correct ? '✓' : '✗'}
            </p>
            <p className="text-sm text-white font-nunito leading-relaxed whitespace-pre-wrap">
              {turn.student_answer || '—'}
            </p>
          </div>

          {/* Expected key points */}
          {turn.expected_key_points && turn.expected_key_points.length > 0 && (
            <div>
              <p className="text-[10px] text-[#00CC88] font-semibold uppercase tracking-wide mb-1.5">
                ✓ Key points needed
              </p>
              <ul className="space-y-1">
                {turn.expected_key_points.map((kp, i) => {
                  const missed = turn.missed_key_points && turn.missed_key_points.some(
                    m => m.toLowerCase().includes(kp.toLowerCase().slice(0, 15))
                  )
                  return (
                    <li key={i} className="flex items-start gap-2 text-xs font-nunito">
                      <span className={`flex-shrink-0 mt-0.5 ${missed ? 'text-[#FF6B6B]' : 'text-[#00CC88]'}`}>
                        {missed ? '✗' : '✓'}
                      </span>
                      <span className={missed ? 'text-[#FF6B6B]' : 'text-[#CCD6F6]'}>{kp}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* Missed key points (if not already shown above) */}
          {!turn.expected_key_points?.length && turn.missed_key_points?.length > 0 && (
            <div>
              <p className="text-[10px] text-[#FFB347] font-semibold uppercase tracking-wide mb-1.5">🔍 Missed</p>
              <ul className="space-y-1">
                {turn.missed_key_points.map((m, i) => (
                  <li key={i} className="text-xs text-[#FF6B6B] font-nunito flex items-start gap-2">
                    <span className="flex-shrink-0 mt-0.5">✗</span>{m}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-3 text-[10px] text-[#8892B0] pt-1">
            {turn.hint_tier_used > 0 && (
              <span className="bg-[#FFB347]/10 text-[#FFB347] border border-[#FFB347]/30 rounded-full px-2 py-0.5">
                💡 {HINT_LABEL[turn.hint_tier_used] || `Hint ${turn.hint_tier_used}`} used
              </span>
            )}
            {turn.confidence_tag && (
              <span className="capitalize">{turn.confidence_tag.replace('_', ' ')}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function SessionReplay() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    getSessionReplay(id)
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F0F23] flex flex-col items-center justify-center gap-3">
        <div className="text-4xl animate-bounce">📋</div>
        <p className="text-[#8892B0] font-nunito text-sm">Loading your session…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0F0F23] flex flex-col items-center justify-center gap-4 px-6">
        <div className="text-4xl">😕</div>
        <p className="text-white font-fredoka text-lg">Couldn't load this session</p>
        <button onClick={() => navigate(-1)} className="text-[#00A2FF] text-sm font-nunito">← Go back</button>
      </div>
    )
  }

  const { topic_title, chapter_title, turns, questions_asked, current_level, is_practice } = data
  const answered = turns.filter(t => t.student_answer)
  const correct  = answered.filter(t => t.score >= 80).length
  const avgScore = answered.length
    ? Math.round(answered.reduce((s, t) => s + (t.score || 0), 0) / answered.length)
    : 0
  const hintUsed = answered.filter(t => t.hint_tier_used > 0).length

  const scoreColor = avgScore >= 80 ? '#00CC88' : avgScore >= 50 ? '#FFD700' : '#FF6B6B'

  return (
    <div className="min-h-screen bg-[#0F0F23]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0F0F23] border-b border-[#2D2B5A] px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-[#8892B0] hover:text-white text-lg leading-none">←</button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-fredoka font-bold text-white truncate">📋 Session Review</p>
          <p className="text-[10px] text-[#8892B0] truncate">{chapter_title} · {topic_title}</p>
        </div>
        {is_practice && (
          <span className="text-[10px] text-[#8892B0] bg-[#2D2B5A] rounded-full px-2 py-0.5 flex-shrink-0">🎮 Practice</span>
        )}
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">
        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Questions',   value: answered.length,                     color: 'text-white' },
            { label: 'Correct',     value: `${correct}/${answered.length}`,     color: 'text-[#00CC88]' },
            { label: 'Avg Score',   value: avgScore,                            color: scoreColor },
            { label: 'Hints used',  value: hintUsed,                            color: 'text-[#FFB347]' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-[#16213E] rounded-xl p-2.5 text-center border border-[#2D2B5A]">
              <p className={`text-base font-fredoka font-bold ${color}`}>{value}</p>
              <p className="text-[9px] text-[#8892B0] mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Level reached */}
        <div className="flex items-center gap-2 text-xs text-[#8892B0] font-nunito">
          <span>Level reached:</span>
          <span className={`font-bold ${LEVEL_COLOR[current_level] || 'text-white'}`}>{current_level}</span>
        </div>

        {/* Turn cards */}
        {answered.length === 0 ? (
          <div className="blox-card p-8 text-center">
            <p className="text-[#8892B0] font-nunito text-sm">No answered questions found for this session.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[#8892B0] font-semibold uppercase tracking-wide">
              {answered.length} question{answered.length !== 1 ? 's' : ''} · tap to expand
            </p>
            {answered.map((t, i) => (
              <TurnCard key={t.turn_number} turn={t} index={i} />
            ))}
          </div>
        )}

        {/* Bottom action */}
        <button
          onClick={() => navigate('/home')}
          className="w-full py-3 rounded-2xl border border-[#2D2B5A] text-[#8892B0] font-nunito font-semibold text-sm hover:text-white transition-colors"
        >
          🏠 Back to Home
        </button>
      </div>
    </div>
  )
}
