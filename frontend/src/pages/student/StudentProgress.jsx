import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStudentProgress, startSession } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../context/ToastContext'

const SUBJECT_EMOJI = {
  Mathematics: '🔢', Science: '🔬', English: '📖', 'Social Studies': '🌍',
  History: '🏛️', Geography: '🗺️', Physics: '⚡', Chemistry: '🧪',
  Biology: '🌿', 'Computer Science': '💻', Tamil: '🔤', Hindi: '🔤', Other: '📚',
}

const MASTERY_CFG = {
  null:  { icon: '⬜', label: 'Not started',  color: 'text-[#8892B0]',  bg: 'bg-[#2D2B5A]',  ring: 'border-[#2D2B5A]' },
  L1:    { icon: '🟡', label: 'Learning',     color: 'text-yellow-400', bg: 'bg-yellow-900/40', ring: 'border-yellow-500/50' },
  L2:    { icon: '🔵', label: 'Developing',   color: 'text-blue-400',   bg: 'bg-blue-900/40',  ring: 'border-blue-500/50' },
  L3:    { icon: '🟢', label: 'Practising',   color: 'text-green-400',  bg: 'bg-green-900/40', ring: 'border-green-500/50' },
  L4:    { icon: '🟣', label: 'Going deeper', color: 'text-purple-400', bg: 'bg-purple-900/40',ring: 'border-purple-500/50' },
  L5:    { icon: '⭐', label: 'Challenge',    color: 'text-yellow-300', bg: 'bg-yellow-800/50',ring: 'border-yellow-400/60' },
}

function MasteryBadge({ level, flagged }) {
  if (flagged) return (
    <span className="flex items-center gap-1 text-xs bg-[#FF3333]/20 text-[#FF6B6B] border border-[#FF3333]/30 px-2 py-0.5 rounded-full">
      🚩 Review
    </span>
  )
  const cfg = MASTERY_CFG[level] || MASTERY_CFG.null
  return <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.icon} {cfg.label}</span>
}

function ChapterAccordion({ chapter, onPlay, onStudy, starting }) {
  const [open, setOpen] = useState(false)
  const pctMastered = chapter.total_topics
    ? Math.round((chapter.mastered / chapter.total_topics) * 100) : 0
  return (
    <div className="blox-card overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1A1A3E] transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#00A2FF] to-[#0066CC] flex items-center justify-center text-white font-fredoka font-bold text-xs flex-shrink-0">
            {chapter.chapter_number}
          </div>
          <div className="min-w-0 text-left">
            <p className="font-fredoka font-semibold text-white text-sm truncate">{chapter.title}</p>
            <p className="text-xs text-[#8892B0]">{chapter.mastered}/{chapter.total_topics} mastered · {chapter.attempted} tried</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <p className="text-sm font-fredoka font-bold text-[#00CC88]">{pctMastered}%</p>
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
                <p className="font-nunito font-semibold text-white text-sm truncate">{t.topic_number} {t.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <MasteryBadge level={t.mastery_level} flagged={t.flagged_for_review} />
                  {t.mastery_sessions > 0 && <span className="text-xs text-[#8892B0]">· {t.mastery_sessions} session{t.mastery_sessions !== 1 ? 's' : ''}</span>}
                  {t.next_review_at && new Date(t.next_review_at) <= new Date() && (
                    <span className="text-xs text-[#FF6B9D]">· 🔁 due</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {!t.studied && (
                  <button onClick={() => onStudy(t.id)}
                    className="flex-shrink-0 text-xs py-1.5 px-3 rounded-xl font-nunito font-bold bg-[#C77DFF]/20 text-[#C77DFF] border border-[#C77DFF]/40 hover:bg-[#C77DFF]/30 transition-all">
                    📖 Study
                  </button>
                )}
                <button onClick={() => onPlay(t.id)} disabled={starting === t.id || !t.studied}
                  title={!t.studied ? 'Complete study first' : ''}
                  className="btn-blox-primary flex-shrink-0 text-xs py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed">
                  {starting === t.id ? '⚡…' : '▶ Practice'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Concept Map view ─────────────────────────────────────────────────────────
function ConceptMap({ books, onPlay, onStudy, starting }) {
  const [popup, setPopup] = useState(null)  // {id, title, concepts, mastery_level, x, y}
  const containerRef = useRef(null)

  // Flatten all topics across all books/chapters
  const allTopics = books.flatMap(b =>
    b.chapters.flatMap(ch =>
      ch.topics.map(t => ({ ...t, subject: b.subject, chapter_title: ch.title }))
    )
  )

  function handleTopicClick(e, t) {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const containerRect = containerRef.current?.getBoundingClientRect() || { left: 0, top: 0 }
    setPopup({
      id: t.id,
      title: t.title,
      concepts: t.key_concepts || [],
      mastery_level: t.mastery_level,
      flagged: t.flagged_for_review,
      studied: t.studied,
      next_review: t.next_review_at,
      subject: t.subject,
      chapter_title: t.chapter_title,
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.bottom - containerRect.top + 8,
    })
  }

  // Group by subject for the map
  const bySubject = {}
  for (const t of allTopics) {
    if (!bySubject[t.subject]) bySubject[t.subject] = []
    bySubject[t.subject].push(t)
  }

  return (
    <div ref={containerRef} className="relative" onClick={() => setPopup(null)}>
      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-4">
        {Object.entries(MASTERY_CFG).map(([level, cfg]) => (
          <span key={level} className={`text-xs px-2 py-0.5 rounded-full border ${cfg.ring} ${cfg.color} flex items-center gap-1`}>
            {cfg.icon} {cfg.label}
          </span>
        ))}
      </div>

      {Object.entries(bySubject).map(([subject, topics]) => (
        <div key={subject} className="mb-6">
          <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-2 px-1">
            {SUBJECT_EMOJI[subject] || '📚'} {subject}
          </p>
          <div className="flex flex-wrap gap-2">
            {topics.map(t => {
              const cfg = MASTERY_CFG[t.mastery_level] || MASTERY_CFG.null
              const isDue = t.next_review_at && new Date(t.next_review_at) <= new Date()
              return (
                <button
                  key={t.id}
                  onClick={(e) => handleTopicClick(e, t)}
                  className={`relative rounded-xl border px-3 py-2 text-xs font-nunito font-semibold transition-all hover:scale-105 text-left ${cfg.bg} ${cfg.ring} ${cfg.color} max-w-[140px]`}
                >
                  <span className="block truncate">{t.title}</span>
                  {isDue && <span className="absolute -top-1 -right-1 text-xs">🔁</span>}
                  {t.flagged_for_review && <span className="absolute -top-1 -right-1 text-xs">🚩</span>}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {/* Popup */}
      {popup && (
        <div
          className="absolute z-20 bg-[#16213E] border border-[#2D2B5A] rounded-2xl p-4 shadow-2xl w-64 animate-bounce-in"
          style={{ left: Math.max(0, popup.x - 128), top: popup.y }}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <p className="font-fredoka font-bold text-white text-sm">{popup.title}</p>
              <p className="text-xs text-[#8892B0]">{popup.chapter_title}</p>
            </div>
            <button onClick={() => setPopup(null)} className="text-[#8892B0] hover:text-white text-base leading-none flex-shrink-0">✕</button>
          </div>
          <div className="mb-2">
            <MasteryBadge level={popup.mastery_level} flagged={popup.flagged} />
          </div>
          {popup.concepts.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-[#8892B0] uppercase tracking-wider mb-1">Key concepts</p>
              <ul className="space-y-0.5">
                {popup.concepts.map((c, i) => (
                  <li key={i} className="text-xs text-white flex items-start gap-1.5">
                    <span className="text-[#00A2FF] mt-0.5">•</span>{c}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {!popup.studied && (
              <button
                onClick={() => { setPopup(null); onStudy(popup.id) }}
                className="w-full text-xs py-2 rounded-xl font-nunito font-bold bg-[#C77DFF]/20 text-[#C77DFF] border border-[#C77DFF]/40 hover:bg-[#C77DFF]/30 transition-all"
              >
                📖 Study this topic first
              </button>
            )}
            <button
              onClick={() => { setPopup(null); onPlay(popup.id) }}
              disabled={starting === popup.id || !popup.studied}
              title={!popup.studied ? 'Complete study first' : ''}
              className="btn-blox-primary w-full text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {starting === popup.id ? '⚡…' : '▶ Practice this topic'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function StudentProgress() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeSubject, setActiveSubject] = useState(null)
  const [starting, setStarting] = useState(null)
  const [viewMode, setViewMode] = useState('list')   // 'list' | 'map'

  useEffect(() => {
    getStudentProgress()
      .then(r => { setData(r.data); if (r.data.length > 0) setActiveSubject(r.data[0].subject) })
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [])

  function handleStudy(topicId) {
    navigate(`/study/${topicId}`)
  }

  async function handlePlay(topicId) {
    setStarting(topicId)
    try {
      const res = await startSession(user.name, topicId)
      const d = res.data
      sessionStorage.setItem(`session_${d.session_id}`, JSON.stringify({
        sessionId: d.session_id, studentName: d.student_name,
        topicTitle: d.topic_title, chapterTitle: d.chapter_title,
        initialMessage: d.message, currentLevel: d.current_level,
        levelLabel: d.level_label, topicId, answerFormat: d.answer_format || null,
      }))
      navigate(`/session/${d.session_id}`)
    } catch (e) {
      if (e.response?.status === 403 && e.response?.data?.detail === 'study_required') {
        navigate(`/study/${topicId}`)
      } else {
        toast.error(e.response?.data?.detail || 'Failed to start session')
      }
    } finally { setStarting(null) }
  }

  const bySubject = {}
  for (const book of data) {
    if (!bySubject[book.subject]) bySubject[book.subject] = []
    bySubject[book.subject].push(book)
  }
  const subjects = Object.keys(bySubject)
  const activeBooks = activeSubject ? (bySubject[activeSubject] || []) : []

  const summary = activeBooks.reduce((acc, b) => {
    for (const ch of b.chapters) {
      acc.total += ch.total_topics; acc.attempted += ch.attempted; acc.mastered += ch.mastered
    }
    return acc
  }, { total: 0, attempted: 0, mastered: 0 })

  const flaggedTopics = activeBooks.flatMap(b =>
    b.chapters.flatMap(ch => ch.topics.filter(t => t.flagged_for_review).map(t => ({ ...t, chapter_title: ch.title })))
  )

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-fredoka font-bold text-white">📈 My Progress</h1>
          <p className="text-[#8892B0] text-sm mt-0.5">Track your mastery across all topics</p>
        </div>
        {/* View toggle */}
        {!loading && data.length > 0 && (
          <div className="flex gap-1 bg-[#2D2B5A] rounded-xl p-1">
            {[['list', '☰ List'], ['map', '🗺️ Map']].map(([key, label]) => (
              <button key={key} onClick={() => setViewMode(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-nunito font-semibold transition-all ${
                  viewMode === key ? 'bg-[#00A2FF] text-white' : 'text-[#8892B0] hover:text-white'
                }`}
              >{label}</button>
            ))}
          </div>
        )}
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
          <p className="text-[#8892B0] text-sm mt-1">Start practising to see your progress here.</p>
        </div>
      )}

      {/* ── Map view ─────────────────────────────────────────────────────── */}
      {!loading && data.length > 0 && viewMode === 'map' && (
        <ConceptMap books={data} onPlay={handlePlay} onStudy={handleStudy} starting={starting} />
      )}

      {/* ── List view ────────────────────────────────────────────────────── */}
      {!loading && subjects.length > 0 && viewMode === 'list' && (
        <>
          <div className="flex gap-2 flex-wrap">
            {subjects.map(s => (
              <button key={s} onClick={() => setActiveSubject(s)}
                className={`px-3 py-1.5 rounded-full text-sm font-nunito font-semibold transition-all ${
                  activeSubject === s ? 'bg-[#00A2FF] text-white' : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
                }`}>
                {SUBJECT_EMOJI[s] || '📚'} {s}
              </button>
            ))}
          </div>

          {activeSubject && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total Topics', value: summary.total,    color: 'text-white' },
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
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!t.studied && (
                        <button onClick={() => handleStudy(t.id)}
                          className="text-xs py-1.5 px-3 rounded-xl font-nunito font-bold bg-[#C77DFF]/20 text-[#C77DFF] border border-[#C77DFF]/40 hover:bg-[#C77DFF]/30 transition-all">
                          📖 Study
                        </button>
                      )}
                      <button onClick={() => handlePlay(t.id)} disabled={starting === t.id || !t.studied}
                        title={!t.studied ? 'Complete study first' : ''}
                        className="btn-blox-primary text-xs py-1.5 px-3 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed">
                        {starting === t.id ? '⚡…' : '▶ Practice'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeBooks.map(book => (
            <div key={book.book_id} className="space-y-2">
              {activeBooks.length > 1 && (
                <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold px-1">📖 {book.title}</p>
              )}
              {book.chapters.map(ch => (
                <ChapterAccordion key={ch.id} chapter={ch} onPlay={handlePlay} onStudy={handleStudy} starting={starting} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
