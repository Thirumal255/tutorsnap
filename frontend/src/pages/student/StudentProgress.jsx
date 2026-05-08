import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStudentProgress, startSession } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
const SUBJECT_EMOJI = {
  Mathematics: '🔢', Science: '🔬', English: '📖', 'Social Studies': '🌍',
  History: '🏛️', Geography: '🗺️', Physics: '⚡', Chemistry: '🧪',
  Biology: '🌿', 'Computer Science': '💻', Tamil: '🔤', Hindi: '🔤', Other: '📚',
}

const MASTERY_CFG = {
  null:  { icon: '⬜', label: 'Not started',   color: 'text-[#8892B0]' },
  L1:    { icon: '🟡', label: 'Learning',      color: 'text-yellow-400' },
  L2:    { icon: '🔵', label: 'Developing',    color: 'text-blue-400' },
  L3:    { icon: '🟢', label: 'Practising',    color: 'text-green-400' },
  L4:    { icon: '🟣', label: 'Going deeper',  color: 'text-purple-400' },
  L5:    { icon: '⭐', label: 'Challenge',     color: 'text-yellow-300' },
}

function MasteryBadge({ level, flagged }) {
  if (flagged) return (
    <span className="flex items-center gap-1 text-xs bg-[#FF3333]/20 text-[#FF6B6B] border border-[#FF3333]/30 px-2 py-0.5 rounded-full">
      🚩 Review
    </span>
  )
  const cfg = MASTERY_CFG[level] || MASTERY_CFG.null
  return (
    <span className={`text-xs font-semibold ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  )
}

function ChapterAccordion({ chapter, onPlay, starting }) {
  const [open, setOpen] = useState(false)
  const pctMastered = chapter.total_topics
    ? Math.round((chapter.mastered / chapter.total_topics) * 100)
    : 0

  return (
    <div className="blox-card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1A1A3E] transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#00A2FF] to-[#0066CC] flex items-center justify-center text-white font-fredoka font-bold text-xs flex-shrink-0">
            {chapter.chapter_number}
          </div>
          <div className="min-w-0 text-left">
            <p className="font-fredoka font-semibold text-white text-sm truncate">{chapter.title}</p>
            <p className="text-xs text-[#8892B0]">
              {chapter.mastered}/{chapter.total_topics} mastered · {chapter.attempted} tried
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <div className="text-right">
            <p className="text-sm font-fredoka font-bold text-[#00CC88]">{pctMastered}%</p>
          </div>
          <div className="w-16 h-1.5 bg-[#2D2B5A] rounded-full overflow-hidden">
            <div className="h-full bg-[#00CC88] rounded-full" style={{ width: `${pctMastered}%` }} />
          </div>
          <span className="text-[#00A2FF] text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <ul className="border-t border-[#2D2B5A] divide-y divide-[#2D2B5A]">
          {chapter.topics.map(t => (
            <li key={t.id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#1A1A3E] transition-colors">
              <div className="min-w-0">
                <p className="font-nunito font-semibold text-white text-sm truncate">
                  {t.topic_number} {t.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <MasteryBadge level={t.mastery_level} flagged={t.flagged_for_review} />
                  {t.mastery_sessions > 0 && (
                    <span className="text-xs text-[#8892B0]">
                      · {t.mastery_sessions} session{t.mastery_sessions !== 1 ? 's' : ''}
                    </span>
                  )}
                  {t.last_practiced_at && (
                    <span className="text-xs text-[#8892B0]">
                      · {new Date(t.last_practiced_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => onPlay(t.id)}
                disabled={starting === t.id}
                className="btn-blox-primary flex-shrink-0 text-xs py-1.5 px-3 disabled:opacity-50"
              >
                {starting === t.id ? '⚡…' : '▶ Practice'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function StudentProgress() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeSubject, setActiveSubject] = useState(null)
  const [starting, setStarting] = useState(null)

  useEffect(() => {
    getStudentProgress()
      .then(r => {
        setData(r.data)
        if (r.data.length > 0) setActiveSubject(r.data[0].subject)
      })
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [])

  async function handlePlay(topicId) {
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
        })
      )
      navigate(`/session/${d.session_id}`)
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to start session')
    } finally {
      setStarting(null)
    }
  }

  // Group by subject (books per subject)
  const bySubject = {}
  for (const book of data) {
    if (!bySubject[book.subject]) bySubject[book.subject] = []
    bySubject[book.subject].push(book)
  }
  const subjects = Object.keys(bySubject)

  const activeBooks = activeSubject ? (bySubject[activeSubject] || []) : []

  // Compute summary for active subject
  const summary = activeBooks.reduce((acc, b) => {
    for (const ch of b.chapters) {
      acc.total += ch.total_topics
      acc.attempted += ch.attempted
      acc.mastered += ch.mastered
    }
    return acc
  }, { total: 0, attempted: 0, mastered: 0 })

  // Flagged topics across active subject
  const flaggedTopics = activeBooks.flatMap(b =>
    b.chapters.flatMap(ch =>
      ch.topics.filter(t => t.flagged_for_review).map(t => ({
        ...t,
        chapter_title: ch.title,
        book_title: b.title,
      }))
    )
  )

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-fredoka font-bold text-white">📈 My Progress</h1>
        <p className="text-[#8892B0] text-sm mt-0.5">Track your mastery across all topics</p>
      </div>

      {loading && (
        <div className="text-center py-16">
          <div className="text-4xl animate-bounce mb-3">📊</div>
          <p className="text-[#8892B0]">Loading your progress…</p>
        </div>
      )}

      {!loading && data.length === 0 && (
        <div className="blox-card p-8 text-center">
          <div className="text-5xl mb-3">📚</div>
          <p className="text-white font-fredoka text-lg">No progress yet</p>
          <p className="text-[#8892B0] text-sm mt-1">Start practicing to see your progress here.</p>
        </div>
      )}

      {!loading && subjects.length > 0 && (
        <>
          {/* Subject tabs */}
          <div className="flex gap-2 flex-wrap">
            {subjects.map(s => {
              return (
                <button
                  key={s}
                  onClick={() => setActiveSubject(s)}
                  className={`px-3 py-1.5 rounded-full text-sm font-nunito font-semibold transition-all ${
                    activeSubject === s
                      ? 'bg-[#00A2FF] text-white'
                      : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
                  }`}
                >
                  {SUBJECT_EMOJI[s] || '📚'} {s}
                </button>
              )
            })}
          </div>

          {/* Subject summary cards */}
          {activeSubject && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total Topics', value: summary.total, color: 'text-white' },
                { label: 'Tried',        value: summary.attempted, color: 'text-[#00A2FF]' },
                { label: 'Mastered',     value: summary.mastered,  color: 'text-[#00CC88]' },
              ].map(({ label, value, color }) => (
                <div key={label} className="blox-card p-3 text-center">
                  <p className={`text-2xl font-fredoka font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-[#8892B0] mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Flagged topics */}
          {flaggedTopics.length > 0 && (
            <div className="blox-card p-4 border-[#FF3333]/40">
              <p className="text-sm font-fredoka font-bold text-[#FF6B6B] mb-3">🚩 Needs review ({flaggedTopics.length})</p>
              <div className="space-y-2">
                {flaggedTopics.map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-3 py-1">
                    <div className="min-w-0">
                      <p className="text-sm text-white font-semibold truncate">{t.title}</p>
                      <p className="text-xs text-[#8892B0]">{t.chapter_title}</p>
                    </div>
                    <button
                      onClick={() => handlePlay(t.id)}
                      disabled={starting === t.id}
                      className="btn-blox-primary text-xs py-1.5 px-3 flex-shrink-0 disabled:opacity-50"
                    >
                      {starting === t.id ? '⚡…' : '▶ Practice'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chapters accordion per book */}
          {activeBooks.map(book => (
            <div key={book.book_id} className="space-y-2">
              {activeBooks.length > 1 && (
                <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold px-1">
                  📖 {book.title}
                </p>
              )}
              {book.chapters.map(ch => (
                <ChapterAccordion
                  key={ch.id}
                  chapter={ch}
                  onPlay={handlePlay}
                  starting={starting}
                />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
