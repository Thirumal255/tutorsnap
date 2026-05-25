import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import {
  getStudentDashboard, startSession,
  getWeeklyChallenge, submitWeeklyChallenge,
  getReviewQueue,
} from '../../api/client'
import { SUBJECT_COLOR } from './StudentLayout'
import BuddyCustomizer from '../../components/BuddyCustomizer'
import OnboardingModal from '../../components/OnboardingModal'
import WritingCanvas from '../../components/WritingCanvas'
import { useToast } from '../../context/ToastContext'

const BUDDY_EMOJI = {
  robot:'🤖', fox:'🦊', panda:'🐼', lion:'🦁',
  dolphin:'🐬', owl:'🦉', dragon:'🐉', wizard:'🧙',
}

const SUBJECT_EMOJI = {
  Mathematics: '🔢', Science: '🔬', English: '📖', 'Social Studies': '🌍',
  History: '🏛️', Geography: '🗺️', Physics: '⚡', Chemistry: '🧪',
  Biology: '🌿', 'Computer Science': '💻', Tamil: '🔤', Hindi: '🔤', Other: '📚',
}

const ANSWER_FORMAT_LABEL = {
  number: '🔢 a number', yes_no: '✅ yes or no',
  rule: '📖 state the rule', explanation: '💬 explain in words', working: '📝 show your working',
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function MasteryBar({ attempted, mastered, total }) {
  const pctAttempted = total ? Math.round((attempted / total) * 100) : 0
  const pctMastered  = total ? Math.round((mastered / total) * 100) : 0
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-[#8892B0] mb-1">
        <span>{pctMastered}% mastered</span>
        <span>{attempted}/{total} tried</span>
      </div>
      <div className="h-2 bg-[#2D2B5A] rounded-full overflow-hidden relative">
        <div className="absolute inset-y-0 left-0 bg-[#00A2FF]/40 rounded-full transition-all duration-700"
          style={{ width: `${pctAttempted}%` }} />
        <div className="absolute inset-y-0 left-0 bg-[#00CC88] rounded-full transition-all duration-700"
          style={{ width: `${pctMastered}%` }} />
      </div>
    </div>
  )
}

// ── Daily goal ring (task #17) ───────────────────────────────────────────────
function GoalRing({ done, goal, color = null, label = 'today' }) {
  const r    = 30
  const circ = 2 * Math.PI * r
  const pct  = Math.min(done / Math.max(goal, 1), 1)
  const offset = circ * (1 - pct)
  const complete = done >= goal
  const activeColor = color || (complete ? '#00CC88' : '#00A2FF')

  return (
    <svg width="72" height="72" viewBox="0 0 72 72" className="flex-shrink-0">
      {/* Background track */}
      <circle cx="36" cy="36" r={r} fill="none" stroke="#2D2B5A" strokeWidth="6" />
      {/* Progress arc */}
      <circle
        cx="36" cy="36" r={r}
        fill="none"
        stroke={complete ? '#00CC88' : activeColor}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 36 36)"
        style={{ transition: 'stroke-dashoffset 0.7s ease' }}
      />
      {/* Count label */}
      <text x="36" y="33" textAnchor="middle" dominantBaseline="middle"
        style={{ fontFamily: "'Fredoka One', cursive", fill: complete ? '#00CC88' : 'white',
                 fontSize: '13px', fontWeight: 'bold' }}>
        {done}/{goal}
      </text>
      <text x="36" y="46" textAnchor="middle" dominantBaseline="middle"
        style={{ fontFamily: 'Nunito, sans-serif', fill: '#8892B0', fontSize: '8px' }}>
        {label}
      </text>
    </svg>
  )
}

// ── Weekly Challenge sub-component ──────────────────────────────────────────
function WeeklyChallengeCard({ userId }) {
  const [wc, setWc]             = useState(null)
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [answer, setAnswer]     = useState('')
  const [canvasMode, setCanvasMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult]     = useState(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    getWeeklyChallenge()
      .then(r => setWc(r.data))
      .catch(() => setWc({ available: false }))
      .finally(() => setLoading(false))
  }, [])

  async function handleSubmit() {
    if (submitting) return
    let finalAnswer = ''
    let imageData = null

    if (canvasMode) {
      if (!canvasRef.current || canvasRef.current.isEmpty()) return
      imageData = canvasRef.current.getImageData()
      finalAnswer = '[handwritten answer]'
    } else {
      if (!answer.trim()) return
      finalAnswer = answer.trim()
    }

    setSubmitting(true)
    try {
      const res = await submitWeeklyChallenge(wc.challenge.id, finalAnswer, imageData)
      setResult(res.data)
      setWc(prev => ({ ...prev, completed: true, completion: res.data }))
    } catch {
      setResult({ error: true })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return null
  if (!wc?.available) return null

  const { challenge, completed, completion, class_attempts = 0, class_total = 0 } = wc

  return (
    <div className="blox-card border border-[#FFD700]/30 bg-gradient-to-br from-[#1A1A3E] to-[#16213E] p-4 animate-bounce-in">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#FFD700] to-[#FF6B9D] flex items-center justify-center text-xl flex-shrink-0">
          🏆
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs text-[#FFD700] font-semibold uppercase tracking-widest">Weekly Challenge</p>
            {completed && (
              <span className="text-xs bg-[#00CC88]/20 text-[#00CC88] border border-[#00CC88]/30 px-2 py-0.5 rounded-full">✓ Done</span>
            )}
          </div>
          <p className="font-fredoka font-bold text-white mt-0.5 text-sm">
            {challenge.subject} · {challenge.topic_title}
          </p>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <p className="text-xs text-[#8892B0]">Up to 200 XP ⭐ · Resets Monday</p>
            {/* #63 Collaborative class challenge participation counter */}
            {class_total > 0 && (
              <p className="text-xs text-[#6C63FF] font-semibold">
                👥 {class_attempts}/{class_total} classmates attempted
              </p>
            )}
          </div>
        </div>
        {!completed && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-[#00A2FF] font-semibold hover:text-white transition-colors flex-shrink-0"
          >
            {expanded ? 'Hide ▲' : 'Attempt ▼'}
          </button>
        )}
      </div>

      {/* Completed result */}
      {completed && completion && (
        <div className="mt-3 bg-[#0F0F23] rounded-2xl p-3 space-y-1">
          <p className="text-xs text-[#8892B0]">{completion.feedback}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-sm font-fredoka font-bold text-white">Score: {completion.score}/100</span>
            <span className="text-sm font-fredoka font-bold text-[#FFD700]">+{completion.xp_earned} XP ⭐</span>
          </div>
        </div>
      )}

      {/* Challenge input area */}
      {expanded && !completed && (
        <div className="mt-4 space-y-3 animate-bounce-in">
          {/* Question */}
          <div className="bg-[#0F0F23] rounded-2xl p-3 border border-[#2D2B5A]">
            <p className="text-xs text-[#8892B0] mb-1 uppercase tracking-widest">
              {ANSWER_FORMAT_LABEL[challenge.answer_format] || '💬 explain in words'}
            </p>
            <p className="text-sm text-white leading-relaxed">{challenge.question}</p>
          </div>

          {result?.error && (
            <p className="text-xs text-[#FF6B6B] text-center">Something went wrong. Please try again.</p>
          )}

          {/* Input mode toggle */}
          <div className="flex gap-1.5 bg-[#0F0F23] rounded-xl p-1">
            <button
              onClick={() => setCanvasMode(false)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-nunito font-semibold transition-all ${
                !canvasMode ? 'bg-[#2D2B5A] text-white' : 'text-[#8892B0] hover:text-white'
              }`}
            >
              ⌨️ Type
            </button>
            <button
              onClick={() => setCanvasMode(true)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-nunito font-semibold transition-all ${
                canvasMode ? 'bg-[#2D2B5A] text-white' : 'text-[#8892B0] hover:text-white'
              }`}
            >
              ✏️ Handwrite
            </button>
          </div>

          {/* Canvas mode */}
          {canvasMode ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#8892B0]">Draw your answer below</span>
                <div className="flex gap-2">
                  <button onClick={() => canvasRef.current?.undo()}
                    className="text-xs text-[#8892B0] hover:text-white px-2 py-1 rounded-lg border border-[#2D2B5A] hover:border-[#8892B0] transition-all">
                    ↩ Undo
                  </button>
                  <button onClick={() => canvasRef.current?.clear()}
                    className="text-xs text-[#8892B0] hover:text-white px-2 py-1 rounded-lg border border-[#2D2B5A] hover:border-[#FF3333] transition-all">
                    🗑 Clear
                  </button>
                </div>
              </div>
              <WritingCanvas ref={canvasRef} />
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full btn-blox-primary text-sm py-2.5 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : '⚡ Submit Answer'}
              </button>
            </div>
          ) : (
            /* Text mode */
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Your answer…"
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                disabled={submitting}
                className="blox-input flex-1 text-sm"
              />
              <button
                onClick={handleSubmit}
                disabled={submitting || !answer.trim()}
                className="btn-blox-primary px-4 text-sm disabled:opacity-50 flex items-center gap-1"
              >
                {submitting ? (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : '⚡ Submit'}
              </button>
            </div>
          )}

          <p className="text-xs text-[#8892B0] text-center">⚠️ One attempt only — make it count!</p>
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function StudentHome() {
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [data, setData]               = useState(null)
  const [loading, setLoading]         = useState(true)
  const [resuming, setResuming]       = useState(null)
  const [showBuddy, setShowBuddy]     = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [reviewQueue, setReviewQueue] = useState([])
  const [reviewMeta, setReviewMeta]   = useState({ completed_today: false, reviewed_today: 0 })

  useEffect(() => {
    Promise.all([
      getStudentDashboard(),
      getReviewQueue(),
    ]).then(([dashRes, reviewRes]) => {
      const dash = dashRes.data
      setData(dash)
      setReviewQueue(reviewRes.data.due || [])
      setReviewMeta({
        completed_today: reviewRes.data.completed_today || false,
        reviewed_today: reviewRes.data.reviewed_today || 0,
      })
      // Persist stats snapshot for achievement detection (task #29)
      if (user?.id) {
        localStorage.setItem(`tutorsnap_stats_${user.id}`, JSON.stringify({
          total_sessions:           dash.total_sessions           || 0,
          total_xp:                 dash.total_xp                 || 0,
          streak_days:              dash.streak_days               || 0,
          topics_mastered:          dash.topics_mastered           || 0,
          total_questions_answered: dash.total_questions_answered  || 0,  // #47
          saved_at: Date.now(),
        }))
      }
    }).catch(() => {
      getStudentDashboard().then(r => setData(r.data)).catch(() => setData(null))
    }).finally(() => setLoading(false))
  }, [user?.id])

  // Show onboarding modal for new students (task #13)
  useEffect(() => {
    if (user && user.has_onboarded === false) {
      setShowOnboarding(true)
    }
  }, [user])

  async function handleContinue(topicId) {
    setResuming(topicId)
    try {
      const res = await startSession(user.name, topicId)
      const d = res.data
      sessionStorage.setItem(
        `session_${d.session_id}`,
        JSON.stringify({
          sessionId: d.session_id, studentName: d.student_name,
          topicTitle: d.topic_title, chapterTitle: d.chapter_title,
          initialMessage: d.message, currentLevel: d.current_level,
          levelLabel: d.level_label, topicId,
          answerFormat: d.answer_format || null,
          diagnostic: d.diagnostic || false,
          workedExample: d.worked_example || null,
        })
      )
      navigate(`/session/${d.session_id}`)
    } catch (e) {
      if (e.response?.status === 403 && e.response?.data?.detail === 'study_required') {
        navigate(`/study/${topicId}`)
      } else {
        toast.error(e.response?.data?.detail || 'Failed to start session')
      }
    } finally {
      setResuming(null)
    }
  }

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const buddyEmoji = BUDDY_EMOJI[user?.buddy_avatar || 'robot'] || '🤖'
  const buddyName  = user?.buddy_name || 'Buddy'

  if (!user?.grade) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="blox-card p-8 max-w-sm text-center">
          <div className="text-5xl mb-4">⏳</div>
          <h2 className="text-xl font-fredoka font-bold text-white mb-2">Almost ready!</h2>
          <p className="text-[#8892B0] text-sm">Ask your admin to assign your grade.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {showOnboarding && (
        <OnboardingModal onDone={() => setShowOnboarding(false)} />
      )}

      {showBuddy && (
        <BuddyCustomizer
          currentAvatar={user?.buddy_avatar || 'robot'}
          currentName={user?.buddy_name || 'Buddy'}
          currentMasteryGoal={data?.weekly_mastery_goal || 0}
          onClose={() => setShowBuddy(false)}
          onSave={() => { refreshUser(); setShowBuddy(false) }}
        />
      )}

      {/* ── Greeting + stats bar ──────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Buddy avatar — tap to customise */}
          <button
            onClick={() => setShowBuddy(true)}
            title="Customise your buddy"
            className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#00A2FF] to-[#0066CC] flex items-center justify-center text-2xl flex-shrink-0 hover:scale-105 transition-transform shadow-glow-blue"
          >
            {buddyEmoji}
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-fredoka font-bold text-white leading-tight truncate">
              {greeting()}, <span className="text-[#FFD700]">{user?.name?.split(' ')[0]}</span>! 👋
            </h1>
            <p className="text-[#8892B0] text-xs">Grade {user.grade} · {buddyName} is ready!</p>
          </div>
        </div>

        {/* XP + streak stats */}
        {data && (
          <div className="flex gap-2 flex-shrink-0">
            <div className="blox-card px-3 py-2 text-center min-w-[56px]">
              <p className="text-lg font-fredoka font-bold text-[#FFD700]">⭐{data.total_xp}</p>
              <p className="text-[10px] text-[#8892B0]">total XP</p>
            </div>
            <div className="blox-card px-3 py-2 text-center min-w-[56px]">
              <p className="text-lg font-fredoka font-bold text-[#FF6B6B]">
                {data.streak_days > 0 ? `🔥${data.streak_days}` : '—'}
                {data.streak_freeze_available && (
                  <span className="ml-1 text-sm" title="Streak freeze ready!">🛡️</span>
                )}
              </p>
              <p className="text-[10px] text-[#8892B0]">streak</p>
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div className="text-center py-16">
          <div className="text-4xl animate-bounce mb-3">🎮</div>
          <p className="text-[#8892B0]">Loading your dashboard…</p>
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── Weekly challenge ───────────────────────────────────────── */}
          <WeeklyChallengeCard userId={user?.id} />

          {/* ── Daily goal ring (task #17) ────────────────────────────── */}
          {data && (
            <div className="blox-card p-4 animate-bounce-in flex items-center gap-4">
              <GoalRing
                done={data.sessions_today || 0}
                goal={user?.daily_goal_sessions || data.daily_goal_sessions || 1}
              />
              <div className="flex-1 min-w-0">
                <p className="font-fredoka font-bold text-white">
                  {(data.sessions_today || 0) >= (user?.daily_goal_sessions || data.daily_goal_sessions || 1)
                    ? "🎉 Goal smashed today!"
                    : "Today's goal"}
                </p>
                <p className="text-xs text-[#8892B0] mt-0.5">
                  {(data.sessions_today || 0) >= (user?.daily_goal_sessions || data.daily_goal_sessions || 1)
                    ? `${data.sessions_today} session${data.sessions_today !== 1 ? 's' : ''} done — you're on fire! 🔥`
                    : `${data.sessions_today || 0} of ${user?.daily_goal_sessions || data.daily_goal_sessions || 1} session${(user?.daily_goal_sessions || 1) !== 1 ? 's' : ''} done`}
                </p>
              </div>
              {(data.sessions_today || 0) < (user?.daily_goal_sessions || data.daily_goal_sessions || 1) && (
                <button
                  onClick={() => navigate('/practice')}
                  className="btn-blox-primary flex-shrink-0 text-xs py-1.5 px-3"
                >
                  ▶ Study
                </button>
              )}
            </div>
          )}

          {/* ── Weekly mastery goal ring (#59) ───────────────────────── */}
          {data && (data.weekly_mastery_goal || 0) > 0 && (
            <div className="blox-card p-4 animate-bounce-in flex items-center gap-4">
              <GoalRing
                done={data.topics_mastered_this_week || 0}
                goal={data.weekly_mastery_goal}
                color="#00CC88"
                label="this week"
              />
              <div className="flex-1 min-w-0">
                <p className="font-fredoka font-bold text-white">
                  {(data.topics_mastered_this_week || 0) >= data.weekly_mastery_goal
                    ? '🏆 Mastery goal crushed this week!'
                    : 'Weekly mastery goal'}
                </p>
                <p className="text-xs text-[#8892B0] mt-0.5">
                  {(data.topics_mastered_this_week || 0) >= data.weekly_mastery_goal
                    ? `You mastered ${data.topics_mastered_this_week} topic${data.topics_mastered_this_week !== 1 ? 's' : ''} this week!`
                    : `${data.topics_mastered_this_week || 0} of ${data.weekly_mastery_goal} topics mastered this week`}
                </p>
              </div>
            </div>
          )}

          {/* ── Smart "What's next" CTA (task #52) ───────────────────── */}
          {(() => {
            const dailyGoal = user?.daily_goal_sessions || data.daily_goal_sessions || 1
            const sessionsDone = data.sessions_today || 0
            const goalMet = sessionsDone >= dailyGoal

            // Priority 1: overdue review topics already shown below — skip if present
            if (reviewQueue.length > 0) return null

            // Priority 2: goal not met yet and no "last practiced" CTA would show
            if (!goalMet) {
              return (
                <div className="blox-card p-4 border-[#C084FC]/30 animate-bounce-in flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#C084FC] to-[#7E22CE] flex items-center justify-center text-xl flex-shrink-0">
                    🎯
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#C084FC] font-semibold uppercase tracking-widest">Next up for you</p>
                    <p className="font-fredoka font-bold text-white mt-0.5">
                      {data.last_practiced
                        ? `Keep going on ${data.last_practiced.topic_title}!`
                        : "Pick a topic and start practising!"}
                    </p>
                    <p className="text-xs text-[#8892B0] mt-0.5">
                      {sessionsDone === 0
                        ? "You haven't practised today yet — let's fix that 💪"
                        : `${dailyGoal - sessionsDone} session${dailyGoal - sessionsDone !== 1 ? 's' : ''} left to hit your goal`}
                    </p>
                  </div>
                  <button
                    onClick={() => data.last_practiced
                      ? handleContinue(data.last_practiced.topic_id)
                      : navigate('/practice')
                    }
                    disabled={data.last_practiced && resuming === data.last_practiced.topic_id}
                    className="btn-blox-primary flex-shrink-0 text-xs py-1.5 px-3 disabled:opacity-50"
                  >
                    {data.last_practiced && resuming === data.last_practiced.topic_id ? '⚡…' : '▶ Go'}
                  </button>
                </div>
              )
            }

            // Priority 3: goal met — nudge towards going deeper
            return (
              <div className="blox-card p-4 border-[#00CC88]/30 animate-bounce-in flex items-center gap-4">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#00CC88] to-[#007755] flex items-center justify-center text-xl flex-shrink-0">
                  🌟
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[#00CC88] font-semibold uppercase tracking-widest">Goal crushed!</p>
                  <p className="font-fredoka font-bold text-white mt-0.5">
                    {data.flagged_topics > 0
                      ? `Tackle a flagged topic for bonus XP 🚩`
                      : "Challenge yourself with a harder topic!"}
                  </p>
                  <p className="text-xs text-[#8892B0] mt-0.5">
                    {data.flagged_topics > 0
                      ? `${data.flagged_topics} topic${data.flagged_topics !== 1 ? 's' : ''} need extra practice`
                      : "Great students go beyond the daily goal 💪"}
                  </p>
                </div>
                <button
                  onClick={() => navigate('/strengthen')}
                  className="btn-blox-primary flex-shrink-0 text-xs py-1.5 px-3 bg-gradient-to-r from-[#00CC88] to-[#007755]"
                >
                  {data.flagged_topics > 0 ? '🚩 Fix it' : '📚 More'}
                </button>
              </div>
            )
          })()}

          {/* ── Spaced repetition review queue ────────────────────────── */}
          {reviewQueue.length > 0 ? (
            <div className="blox-card p-4 border-[#FF6B9D]/30 animate-bounce-in">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-[#FF6B9D] font-semibold uppercase tracking-widest">
                  🔁 Due for review ({reviewQueue.length})
                </p>
                {/* #57: Flash all review topics at once */}
                <button
                  onClick={() => navigate('/flashcard', { state: { reviewTopics: reviewQueue.map(q => ({ id: q.topic_id, title: q.title })) } })}
                  className="text-xs font-nunito font-semibold px-2.5 py-1 rounded-full bg-[#FFB347]/20 text-[#FFB347] border border-[#FFB347]/30 hover:bg-[#FFB347]/30 transition-all"
                >
                  ⚡ Flash all
                </button>
              </div>
              <div className="space-y-2">
                {reviewQueue.slice(0, 3).map(item => (
                  <div key={item.topic_id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-white font-semibold truncate">{item.title}</p>
                      <p className="text-xs text-[#8892B0]">
                        {item.subject} · {item.overdue_days > 0 ? `${item.overdue_days}d overdue` : 'due today'}
                      </p>
                    </div>
                    <button
                      onClick={() => handleContinue(item.topic_id)}
                      disabled={resuming === item.topic_id}
                      className="btn-blox-primary flex-shrink-0 text-xs py-1.5 px-3 disabled:opacity-50"
                    >
                      {resuming === item.topic_id ? '⚡…' : '▶ Review'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : reviewMeta.reviewed_today > 0 && (
            <div className="blox-card p-4 border-[#00CC88]/30 animate-bounce-in">
              <div className="flex items-center gap-3">
                <span className="text-2xl">✅</span>
                <div>
                  <p className="text-sm font-fredoka font-bold text-[#00CC88]">Review done for today!</p>
                  <p className="text-xs text-[#8892B0]">
                    You reviewed {reviewMeta.reviewed_today} topic{reviewMeta.reviewed_today !== 1 ? 's' : ''} today. See you tomorrow!
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Continue card ─────────────────────────────────────────── */}
          {data.last_practiced && (
            <div className="blox-card-glow p-4 flex items-center gap-4 animate-bounce-in">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FF6B9D] to-[#FF3333] flex items-center justify-center text-2xl flex-shrink-0">
                ▶
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#8892B0] font-semibold uppercase tracking-widest">Continue where you left off</p>
                <p className="font-fredoka font-bold text-white mt-0.5 truncate">{data.last_practiced.topic_title}</p>
                <p className="text-xs text-[#8892B0] mt-0.5">
                  {data.last_practiced.subject} · {data.last_practiced.chapter_title}
                </p>
              </div>
              <button
                onClick={() => handleContinue(data.last_practiced.topic_id)}
                disabled={resuming === data.last_practiced.topic_id}
                className="btn-blox-primary flex-shrink-0 text-sm py-2 px-5 disabled:opacity-50"
              >
                {resuming === data.last_practiced.topic_id ? '⚡…' : 'Resume ⚔️'}
              </button>
            </div>
          )}

          {/* ── Weekly activity bar chart ──────────────────────────────── */}
          <div className="blox-card p-4 animate-bounce-in">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold">📅 This week's activity</p>
              {data.weekly_xp > 0 && (
                <span className="text-xs text-[#FFD700] font-semibold">+{data.weekly_xp} XP this week</span>
              )}
            </div>
            <div className="flex items-end gap-2 h-16">
              {data.weekly_activity.map(({ date, sessions }) => {
                const maxSess = Math.max(...data.weekly_activity.map(d => d.sessions), 1)
                const pct = sessions / maxSess
                const dayLabel = DAYS[new Date(date + 'T00:00:00').getDay()]
                const isToday = date === new Date().toISOString().slice(0, 10)
                return (
                  <div key={date} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col justify-end" style={{ height: '48px' }}>
                      <div
                        className={`w-full rounded-t transition-all duration-700 ${
                          sessions > 0
                            ? isToday ? 'bg-[#FFD700]' : 'bg-[#00A2FF]'
                            : 'bg-[#2D2B5A]'
                        }`}
                        style={{ height: sessions > 0 ? `${Math.max(pct * 100, 20)}%` : '20%', minHeight: '4px' }}
                        title={`${sessions} session${sessions !== 1 ? 's' : ''}`}
                      />
                    </div>
                    <span className={`text-xs font-semibold ${isToday ? 'text-[#FFD700]' : 'text-[#8892B0]'}`}>
                      {dayLabel}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Subject progress grid ──────────────────────────────────── */}
          <div>
            <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-3 px-1">
              📚 Subject progress
            </p>
            {data.subject_stats.length === 0 ? (
              <div className="blox-card p-6 text-center">
                <p className="text-[#8892B0]">No books assigned for Grade {user.grade} yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.subject_stats.map((s, i) => {
                  const gradient = SUBJECT_COLOR[s.subject] || SUBJECT_COLOR.Other
                  return (
                    <div
                      key={s.subject}
                      className="blox-card p-4 animate-bounce-in blox-hover cursor-pointer"
                      style={{ animationDelay: `${i * 0.05}s` }}
                      onClick={() => navigate('/practice', { state: { subject: s.subject } })}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-xl flex-shrink-0`}>
                          {SUBJECT_EMOJI[s.subject] || '📚'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-fredoka font-bold text-white">{s.subject}</p>
                          <p className="text-xs text-[#8892B0]">
                            {s.mastered} mastered ·{' '}
                            {s.flagged > 0
                              ? <span className="text-[#FF6B6B]">{s.flagged} flagged</span>
                              : `${s.attempted} tried`
                            }
                          </p>
                        </div>
                        {s.flagged > 0 && (
                          <span className="text-xs bg-[#FF3333]/20 text-[#FF6B6B] border border-[#FF3333]/30 px-2 py-0.5 rounded-full">
                            🚩 {s.flagged}
                          </span>
                        )}
                      </div>
                      <MasteryBar attempted={s.attempted} mastered={s.mastered} total={s.total_topics} />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
