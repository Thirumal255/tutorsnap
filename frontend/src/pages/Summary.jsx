import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { endSession } from '../api/client'
import ProgressBadge from '../components/ProgressBadge'
import { useAuth } from '../auth/AuthContext'

const CONFETTI_COLORS = ['#FF3333','#00A2FF','#FFD700','#00D68F','#FF6B9D','#A78BFA']

// Big milestone = L3+ reached
const MILESTONE_LEVELS = { L3: true, L4: true, L5: true }

function Confetti({ count = 28 }) {
  const pieces = Array.from({ length: count }, (_, i) => ({
    id: i,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 1.2}s`,
    size: `${6 + Math.random() * 10}px`,
  }))
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {pieces.map(p => (
        <div key={p.id} className="confetti-piece" style={{
          left: p.left, top: '-10px',
          width: p.size, height: p.size,
          background: p.color,
          animationDelay: p.delay,
        }} />
      ))}
    </div>
  )
}

export default function Summary() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const sessionId = parseInt(id)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const stored = sessionStorage.getItem(`summary_${sessionId}`)
      if (stored) {
        const parsed = JSON.parse(stored)
        try {
          const res = await endSession(sessionId)
          setData({ ...parsed, ...res.data, level: res.data.level_reached })
        } catch {
          setData(parsed)
        }
        setLoading(false)
        return
      }
      try {
        const res = await endSession(sessionId)
        setData({ ...res.data, level: res.data.level_reached })
      } catch {
        setData({ summary: 'Session ended.', level: 'L1', studentName: '', topicTitle: '' })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [sessionId])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F0F23] flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl animate-bounce mb-4">⭐</div>
          <p className="text-[#8892B0] font-nunito">Calculating your XP…</p>
        </div>
      </div>
    )
  }

  const topicId = data?.topicId || data?.topic_id
  const studentName = data?.studentName || data?.student_name || ''
  const topicTitle = data?.topicTitle || data?.topic_title || ''
  const level = data?.level || data?.level_reached || 'L1'
  const levelLabel = data?.levelLabel || data?.level_label || ''
  const summary = data?.summary || ''
  const questionsAsked = data?.questionsAsked || data?.questions_asked || 0
  const flagged = data?.flagged_for_review || false
  const keyConcepts = data?.keyConcepts || []

  // Use actual XP from backend/session; never show XP if nothing was answered
  const xp = questionsAsked > 0
    ? (data?.xpEarned ?? data?.xp_earned ?? questionsAsked * 10)
    : 0
  const xpBreakdown = data?.xpBreakdown || data?.xp_breakdown || []

  const earlyExit = questionsAsked === 0
  const isMilestone = MILESTONE_LEVELS[level] && !earlyExit && !flagged
  const confettiCount = level === 'L5' ? 60 : level === 'L4' ? 45 : 28
  const isPrimary = (user?.grade || 0) <= 5 && (user?.grade || 0) > 0

  return (
    <div className="min-h-screen bg-[#0F0F23] flex items-center justify-center px-4 py-10 relative overflow-hidden">
      {!earlyExit && <Confetti count={confettiCount} />}

      {/* BG glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-[#00A2FF] opacity-5 blur-3xl" />
      </div>

      <div className="max-w-lg w-full blox-card p-8 text-center relative z-10 animate-bounce-in">

        {/* Trophy / icon */}
        <div className="text-7xl mb-4 animate-float">
          {earlyExit ? '🌱' : flagged ? '💪' : '🏆'}
        </div>

        <h1 className="text-3xl font-fredoka font-bold text-white mb-1">
          {earlyExit ? 'See You Next Time!' : flagged ? 'Keep Pushing!' : 'Quest Complete!'}
        </h1>

        {studentName && (
          <p className="text-lg font-nunito font-semibold text-[#FFD700] mb-1">
            {earlyExit ? `Good start, ${studentName}!` : `Amazing work, ${studentName}! ⭐`}
          </p>
        )}
        {topicTitle && <p className="text-sm text-[#8892B0] mb-5">{topicTitle}</p>}

        {/* XP earned */}
        {xp > 0 ? (
          <div className="bg-gradient-to-r from-[#FFD700]/20 to-[#FFA500]/20 border border-[#FFD700]/40 rounded-2xl p-4 mb-5 shadow-glow-gold">
            <p className="text-4xl font-fredoka font-bold text-[#FFD700]">+{xp} XP ⭐</p>
            {xpBreakdown.length > 0 ? (
              <div className="mt-2 space-y-1">
                {xpBreakdown.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs font-nunito text-[#8892B0]">
                    <span>{item.label}</span>
                    <span className="text-[#FFD700] font-semibold">+{item.xp}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[#8892B0] text-sm mt-1">{questionsAsked} question{questionsAsked !== 1 ? 's' : ''} answered</p>
            )}
          </div>
        ) : (
          <div className="bg-[#2D2B5A]/40 border border-[#2D2B5A] rounded-2xl p-4 mb-5">
            <p className="text-2xl font-fredoka font-bold text-[#8892B0]">0 XP this time</p>
            <p className="text-[#8892B0] text-sm mt-1">Answer questions to earn XP ⭐</p>
          </div>
        )}

        {/* Milestone celebration card */}
        {isMilestone && (
          <div className="bg-gradient-to-r from-[#FFD700]/20 to-[#FF6B9D]/20 border border-[#FFD700]/40 rounded-2xl p-3 mb-4 animate-bounce-in">
            <p className="text-[#FFD700] font-fredoka font-bold text-sm">
              {isPrimary
                ? (level === 'L5' ? '✨ AMAZING! You\'re a Legend!' :
                   level === 'L4' ? '🏆 WOW! You\'re a Champion!' :
                                    '🌟 GREAT JOB! You\'re a Hero!')
                : (level === 'L5' ? '👑 LEGENDARY! You reached Gold rank!' :
                   level === 'L4' ? '💎 AMAZING! You reached Diamond rank!' :
                                    '⚔️ GREAT! You reached Iron rank!')}
            </p>
            <p className="text-[#8892B0] text-xs mt-0.5">
              {level === 'L5' ? 'You\'ve mastered this topic — incredible!' :
               level === 'L4' ? (isPrimary ? 'One more step to Legend!' : 'Only Gold rank left!') :
                                (isPrimary ? 'Keep going — Champion awaits!' : 'Keep pushing — Diamond awaits!')}
            </p>
          </div>
        )}

        {/* Rank */}
        <div className="flex justify-center mb-5">
          <ProgressBadge level={level} large grade={user?.grade} />
        </div>

        <p className="text-[#8892B0] text-sm leading-relaxed mb-5 font-nunito">{summary}</p>

        {flagged && (
          <div className="mb-4 p-3 bg-[#FFD700]/10 border border-[#FFD700]/30 rounded-xl text-sm text-[#FFD700]">
            🚩 This topic has been flagged. Talk to your teacher about it!
          </div>
        )}

        {keyConcepts.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-semibold text-[#8892B0] mb-2 uppercase tracking-widest">Concepts unlocked</p>
            <div className="flex flex-wrap justify-center gap-2">
              {keyConcepts.map((c, i) => (
                <span key={i} className="text-xs bg-[#00A2FF]/20 text-[#00A2FF] border border-[#00A2FF]/40 px-3 py-1 rounded-full">
                  🔓 {c}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-[#2D2B5A] pt-5 flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => navigate('/practice', { state: { topicId } })}
            className="btn-blox-primary flex-1 py-3"
          >
            🔄 Play Again
          </button>
          <button
            onClick={() => navigate('/home')}
            className="flex-1 py-3 rounded-full font-fredoka font-semibold text-[#8892B0] border border-[#2D2B5A] hover:border-[#00A2FF] hover:text-white transition-all"
          >
            🏠 Home
          </button>
        </div>
      </div>
    </div>
  )
}
