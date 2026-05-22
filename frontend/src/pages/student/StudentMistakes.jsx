import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMistakes, startSession } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../context/ToastContext'

const SUBJECT_EMOJI = {
  Mathematics: '🔢', Science: '🔬', English: '📖', 'Social Studies': '🌍',
  History: '🏛️', Geography: '🗺️', Physics: '⚡', Chemistry: '🧪',
  Biology: '🌿', 'Computer Science': '💻', Tamil: '🔤', Hindi: '🔤', Other: '📚',
}

function ScoreBadge({ score }) {
  if (score >= 80) return null // not a mistake to re-show
  const color = score >= 60 ? 'bg-[#FFB347]/20 text-[#FFB347]' : 'bg-[#FF3333]/20 text-[#FF3333]'
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full font-nunito ${color}`}>
      {score}%
    </span>
  )
}

function MistakeCard({ mistake, onRepractice, onStudy, starting }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="blox-card overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-3 text-left hover:bg-[#1A1A3E] transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs font-nunito font-semibold text-[#8892B0]">
                {SUBJECT_EMOJI[mistake.subject] || '📚'} {mistake.subject}
              </span>
              <span className="text-[#2D2B5A]">·</span>
              <span className="text-xs text-[#8892B0] truncate">{mistake.chapter_title}</span>
            </div>
            <p className="font-fredoka font-bold text-white text-sm">{mistake.topic_title}</p>
            <p className="text-xs text-[#8892B0] mt-0.5 line-clamp-2">{mistake.question}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <ScoreBadge score={mistake.score} />
            <span className="text-[#00A2FF] text-xs">{expanded ? '▲' : '▼'}</span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#2D2B5A] px-4 py-3 space-y-3">
          {/* Question */}
          <div>
            <p className="text-xs font-semibold text-[#8892B0] uppercase tracking-wide mb-1">Question</p>
            <p className="text-sm text-white font-nunito">{mistake.question}</p>
          </div>

          {/* Your answer */}
          <div>
            <p className="text-xs font-semibold text-[#FF6B6B] uppercase tracking-wide mb-1">Your Answer</p>
            <p className="text-sm text-[#FF6B6B]/80 font-nunito italic">
              {mistake.student_answer || '(no answer given)'}
            </p>
          </div>

          {/* Feedback */}
          {mistake.feedback && (
            <div>
              <p className="text-xs font-semibold text-[#00CC88] uppercase tracking-wide mb-1">Feedback</p>
              <p className="text-sm text-[#8892B0] font-nunito">{mistake.feedback}</p>
            </div>
          )}

          {/* Date + Re-practice */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-[#4A5568]">
              {mistake.practiced_at ? new Date(mistake.practiced_at).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric'
              }) : ''}
            </p>
            <div className="flex items-center gap-2">
              {mistake.studied === false && (
                <button
                  onClick={() => onStudy(mistake.topic_id)}
                  className="text-xs py-2 px-3 rounded-xl font-nunito font-bold bg-[#C77DFF]/20 text-[#C77DFF] border border-[#C77DFF]/40 hover:bg-[#C77DFF]/30 transition-all"
                >
                  📖 Study
                </button>
              )}
              <button
                onClick={() => onRepractice(mistake.topic_id)}
                disabled={starting === mistake.topic_id}
                className="btn-blox-primary text-xs py-2 px-4 disabled:opacity-50"
              >
                {starting === mistake.topic_id ? '⚡…' : '▶ Re-practice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function StudentMistakes() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()

  const [mistakes, setMistakes] = useState([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(null)
  const [filter, setFilter] = useState('all') // 'all' | subject name
  const [sort, setSort] = useState('recent')  // 'recent' | 'score'

  useEffect(() => {
    getMistakes()
      .then(res => setMistakes(res.data.mistakes || []))
      .catch(() => setMistakes([]))
      .finally(() => setLoading(false))
  }, [])

  function handleStudy(topicId) {
    navigate(`/study/${topicId}`)
  }

  async function handleRepractice(topicId) {
    setStarting(topicId)
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
      setStarting(null)
    }
  }

  // subjects present
  const subjects = [...new Set(mistakes.map(m => m.subject).filter(Boolean))]

  // filter + sort
  const visible = mistakes
    .filter(m => filter === 'all' || m.subject === filter)
    .sort((a, b) => {
      if (sort === 'score') return (a.score ?? 100) - (b.score ?? 100)
      return new Date(b.practiced_at || 0) - new Date(a.practiced_at || 0)
    })

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-fredoka font-bold text-white">💪 Strengthen</h1>
        <p className="text-[#8892B0] text-sm mt-0.5">These are your growth areas — revisiting them is how champions level up!</p>
      </div>

      {loading && (
        <div className="text-center py-16">
          <div className="text-4xl animate-bounce mb-3">💪</div>
          <p className="text-[#8892B0]">Loading your growth areas…</p>
        </div>
      )}

      {!loading && mistakes.length === 0 && (
        <div className="blox-card p-10 text-center">
          <div className="text-5xl mb-3">🌟</div>
          <p className="text-white font-fredoka text-xl">Nothing to strengthen yet!</p>
          <p className="text-[#8892B0] text-sm mt-1">Keep practising — topics that need a little extra love will appear here.</p>
        </div>
      )}

      {!loading && mistakes.length > 0 && (
        <>
          {/* Stats bar */}
          <div className="grid grid-cols-3 gap-3">
            <div className="blox-card p-3 text-center">
              <p className="text-2xl font-fredoka font-bold text-white">{mistakes.length}</p>
              <p className="text-xs text-[#8892B0]">To Strengthen</p>
            </div>
            <div className="blox-card p-3 text-center">
              <p className="text-2xl font-fredoka font-bold text-[#FF6B6B]">
                {mistakes.filter(m => m.score < 60).length}
              </p>
              <p className="text-xs text-[#8892B0]">Need Work</p>
            </div>
            <div className="blox-card p-3 text-center">
              <p className="text-2xl font-fredoka font-bold text-[#FFB347]">
                {subjects.length}
              </p>
              <p className="text-xs text-[#8892B0]">Subjects</p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2 flex-wrap items-center justify-between">
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 rounded-full text-xs font-nunito font-semibold transition-all ${
                  filter === 'all' ? 'bg-[#00A2FF] text-white' : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
                }`}
              >
                All
              </button>
              {subjects.map(s => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-nunito font-semibold transition-all ${
                    filter === s ? 'bg-[#00A2FF] text-white' : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
                  }`}
                >
                  {SUBJECT_EMOJI[s] || '📚'} {s}
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={e => setSort(e.target.value)}
              className="bg-[#2D2B5A] text-[#8892B0] text-xs rounded-lg px-2 py-1.5 border border-[#2D2B5A] focus:outline-none"
            >
              <option value="recent">Most Recent</option>
              <option value="score">Lowest Score</option>
            </select>
          </div>

          {/* Mistake list */}
          <div className="space-y-2">
            {visible.length === 0 && (
              <div className="blox-card p-6 text-center">
                <p className="text-[#8892B0]">Nothing to strengthen in this subject.</p>
              </div>
            )}
            {visible.map((m, i) => (
              <MistakeCard
                key={`${m.topic_id}-${i}`}
                mistake={m}
                onRepractice={handleRepractice}
                onStudy={handleStudy}
                starting={starting}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
