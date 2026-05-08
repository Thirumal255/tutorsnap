import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getBooks, getTopics, startSession } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'

const SUBJECT_EMOJI = {
  Mathematics: '🔢', Science: '🔬', English: '📖', 'Social Studies': '🌍',
  History: '🏛️', Geography: '🗺️', Physics: '⚡', Chemistry: '🧪',
  Biology: '🌿', 'Computer Science': '💻', Tamil: '🔤', Hindi: '🔤', Other: '📚',
}

// Mastery indicator
function MasteryIcon({ level, flagged }) {
  if (flagged) return <span title="Flagged for review" className="text-base">🚩</span>
  if (!level) return <span title="Not started" className="w-4 h-4 rounded-full border-2 border-[#2D2B5A] inline-block" />
  const cfg = {
    L1: { emoji: '🟡', label: 'Learning' },
    L2: { emoji: '🔵', label: 'Developing' },
    L3: { emoji: '🟢', label: 'Practising' },
    L4: { emoji: '🟣', label: 'Going deeper' },
    L5: { emoji: '⭐', label: 'Challenge mode' },
  }
  const c = cfg[level] || cfg.L1
  return <span title={c.label} className="text-base">{c.emoji}</span>
}

function chapterProgress(topics) {
  const total = topics.length
  const mastered = topics.filter(t => ['L3','L4','L5'].includes(t.mastery_level)).length
  const attempted = topics.filter(t => t.mastery_level != null).length
  return { total, mastered, attempted }
}

export default function StudentPractice() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()

  const [books, setBooks] = useState([])
  const [subjects, setSubjects] = useState([])
  const [activeSubject, setActiveSubject] = useState(location.state?.subject || null)
  const [selectedBook, setSelectedBook] = useState(null)
  const [chapters, setChapters] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadingTopics, setLoadingTopics] = useState(false)
  const [starting, setStarting] = useState(null)

  const bySubject = books.reduce((acc, b) => {
    const s = b.subject || 'Other'
    if (!acc[s]) acc[s] = []
    acc[s].push(b)
    return acc
  }, {})

  const filteredSubjects = activeSubject ? [activeSubject] : subjects

  useEffect(() => {
    async function load() {
      if (!user?.grade) { setLoading(false); return }
      try {
        const res = await getBooks(user.grade)
        const done = res.data.filter(b => b.status === 'done')
        setBooks(done)
        const uniq = [...new Set(done.map(b => b.subject || 'Other'))]
        setSubjects(uniq)
        if (!activeSubject && uniq.length > 0) setActiveSubject(uniq[0])
      } catch {
        setBooks([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user])

  // Restore scroll to topic from session summary back-nav
  useEffect(() => {
    if (location.state?.topicId && chapters.length) {
      const ch = chapters.find(c => c.topics.some(t => t.id === location.state.topicId))
      if (ch) setExpanded(prev => ({ ...prev, [ch.id]: true }))
    }
  }, [location.state, chapters])

  async function selectBook(book) {
    if (selectedBook?.book_id === book.book_id) {
      setSelectedBook(null); setChapters([]); return
    }
    setSelectedBook(book)
    setChapters([])
    setExpanded({})
    setLoadingTopics(true)
    try {
      const res = await getTopics(book.book_id)
      setChapters(res.data.chapters)
    } catch {}
    finally { setLoadingTopics(false) }
  }

  function toggle(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  async function handleStart(topicId, topicTitle, chapterTitle) {
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
        })
      )
      navigate(`/session/${d.session_id}`)
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to start session')
    } finally {
      setStarting(null)
    }
  }

  if (!user?.grade) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="blox-card p-8 max-w-sm text-center">
          <div className="text-5xl mb-4">⏳</div>
          <h2 className="text-xl font-fredoka font-bold text-white mb-2">Grade not set</h2>
          <p className="text-[#8892B0] text-sm">Ask your admin to assign your grade.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-fredoka font-bold text-white">⚔️ Practice</h1>
        <p className="text-[#8892B0] text-sm mt-0.5">Pick a topic and battle it out!</p>
      </div>

      {loading && (
        <div className="text-center py-16">
          <div className="text-4xl animate-bounce mb-3">🎮</div>
          <p className="text-[#8892B0]">Loading quest map…</p>
        </div>
      )}

      {!loading && books.length === 0 && (
        <div className="blox-card p-8 text-center">
          <div className="text-5xl mb-3">📚</div>
          <p className="text-white font-fredoka text-lg">No books for Grade {user.grade} yet</p>
          <p className="text-[#8892B0] text-sm mt-1">Ask your admin to upload textbooks for your grade.</p>
        </div>
      )}

      {!loading && books.length > 0 && (
        <>
          {/* Subject tabs */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setActiveSubject(null)}
              className={`px-3 py-1.5 rounded-full text-sm font-nunito font-semibold transition-all ${
                !activeSubject
                  ? 'bg-[#00A2FF] text-white'
                  : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
              }`}
            >
              All
            </button>
            {subjects.map(s => (
              <button
                key={s}
                onClick={() => { setActiveSubject(s); setSelectedBook(null); setChapters([]) }}
                className={`px-3 py-1.5 rounded-full text-sm font-nunito font-semibold transition-all ${
                  activeSubject === s
                    ? 'bg-[#00A2FF] text-white'
                    : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
                }`}
              >
                {SUBJECT_EMOJI[s] || '📚'} {s}
              </button>
            ))}
          </div>

          {/* Books per subject */}
          <div className="space-y-6">
            {filteredSubjects.map(subject => (
              <div key={subject} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-xl">{SUBJECT_EMOJI[subject] || '📚'}</span>
                  <span className="font-fredoka font-bold text-white">{subject}</span>
                  <div className="flex-1 h-px bg-[#2D2B5A] ml-2" />
                </div>

                {(bySubject[subject] || []).map((book, idx) => (
                  <div key={book.book_id} className="animate-bounce-in" style={{ animationDelay: `${idx * 0.05}s` }}>
                    {/* Book row */}
                    <button
                      onClick={() => selectBook(book)}
                      className={`w-full blox-card p-4 text-left transition-all blox-hover ${
                        selectedBook?.book_id === book.book_id ? 'border-[#00A2FF] shadow-glow-blue' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00A2FF] to-[#0066CC] flex items-center justify-center text-xl flex-shrink-0">
                            📖
                          </div>
                          <div>
                            <p className="font-fredoka font-bold text-white">{book.title || book.filename}</p>
                            <p className="text-xs text-[#8892B0]">{book.chapter_count} chapters · {book.topic_count} topics</p>
                          </div>
                        </div>
                        <span className="text-[#00A2FF] text-sm ml-2">
                          {selectedBook?.book_id === book.book_id ? '▲' : '▼'}
                        </span>
                      </div>
                    </button>

                    {/* Chapters for selected book */}
                    {selectedBook?.book_id === book.book_id && (
                      <div className="mt-2 space-y-2 pl-4">
                        {loadingTopics && (
                          <div className="blox-card p-4 flex items-center gap-3">
                            <div className="w-4 h-4 border-2 border-[#00A2FF] border-t-transparent rounded-full animate-spin" />
                            <span className="text-sm text-[#8892B0]">Loading chapters…</span>
                          </div>
                        )}
                        {!loadingTopics && chapters.map((ch, ci) => {
                          const prog = chapterProgress(ch.topics)
                          return (
                            <div key={ch.id} className="blox-card overflow-hidden animate-bounce-in"
                              style={{ animationDelay: `${ci * 0.04}s` }}>
                              <button
                                onClick={() => toggle(ch.id)}
                                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#1A1A3E] transition-colors"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#00A2FF] to-[#0066CC] flex items-center justify-center text-white font-fredoka font-bold text-xs flex-shrink-0">
                                    {ch.chapter_number}
                                  </div>
                                  <div className="min-w-0">
                                    <span className="font-fredoka font-semibold text-white text-sm block truncate">{ch.title}</span>
                                    <span className="text-xs text-[#8892B0]">
                                      {prog.mastered}/{prog.total} mastered
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  {/* mini progress pill */}
                                  <div className="w-16 h-1.5 bg-[#2D2B5A] rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-[#00CC88] rounded-full"
                                      style={{ width: prog.total ? `${(prog.mastered / prog.total) * 100}%` : '0%' }}
                                    />
                                  </div>
                                  <span className="text-[#00A2FF] text-xs">{expanded[ch.id] ? '▲' : '▼'}</span>
                                </div>
                              </button>

                              {expanded[ch.id] && (
                                <ul className="border-t border-[#2D2B5A] divide-y divide-[#2D2B5A]">
                                  {ch.topics.map(t => (
                                    <li key={t.id}
                                      className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#1A1A3E] transition-colors">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <MasteryIcon level={t.mastery_level} flagged={t.flagged_for_review} />
                                        <div className="min-w-0">
                                          <p className="font-nunito font-semibold text-white text-sm truncate">
                                            {t.topic_number} {t.title}
                                          </p>
                                          {t.mastery_sessions > 0 && (
                                            <p className="text-xs text-[#8892B0]">
                                              {t.mastery_sessions} session{t.mastery_sessions !== 1 ? 's' : ''}
                                              {t.last_practiced_at && ` · ${new Date(t.last_practiced_at).toLocaleDateString()}`}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                      <button
                                        onClick={() => handleStart(t.id, t.title, ch.title)}
                                        disabled={starting === t.id}
                                        className="btn-blox-primary flex-shrink-0 text-sm py-2 px-4 disabled:opacity-50"
                                      >
                                        {starting === t.id ? '⚡…' : t.mastery_level ? '▶ Play' : '▶ Start'}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
