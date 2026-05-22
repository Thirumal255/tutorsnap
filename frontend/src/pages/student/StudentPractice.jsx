import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getBooks, getTopics, startSession, getActiveSessions } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../context/ToastContext'

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
  const { toast } = useToast()

  const [books, setBooks] = useState([])
  const [subjects, setSubjects] = useState([])
  const [activeSubject, setActiveSubject] = useState(location.state?.subject || null)
  const [selectedBook, setSelectedBook] = useState(null)
  const [chapters, setChapters] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadingTopics, setLoadingTopics] = useState(false)
  const [starting, setStarting] = useState(null)
  const [activeSessions, setActiveSessions] = useState([])  // #62

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
        const [booksRes, activeRes] = await Promise.allSettled([
          getBooks(user.grade),
          getActiveSessions(),  // #62
        ])
        if (booksRes.status === 'fulfilled') {
          const done = booksRes.value.data.filter(b => b.status === 'done')
          setBooks(done)
          const uniq = [...new Set(done.map(b => b.subject || 'Other'))]
          setSubjects(uniq)
          if (!activeSubject && uniq.length > 0) setActiveSubject(uniq[0])
        }
        if (activeRes.status === 'fulfilled') {
          setActiveSessions(activeRes.value.data || [])
        }
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

  function handleStudy(topic, chapterTitle) {
    navigate(`/study/${topic.id}`, {
      state: { topicTitle: topic.title, chapterTitle, studiedBefore: topic.studied }
    })
  }

  async function handleStart(topicId, topicTitle, chapterTitle, studied, practiceMode = false) {
    if (!studied && !practiceMode) {
      toast.info('📖 Study this topic first to unlock Practice!')
      return
    }
    setStarting(topicId)
    try {
      const res = await startSession(user.name, topicId, practiceMode)
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
          isPractice: !!d.is_practice,  // #58
        })
      )
      navigate(`/session/${d.session_id}`)
    } catch (e) {
      const detail = e.response?.data?.detail
      if (detail === 'study_required') {
        toast.info('📖 Study this topic first to unlock Practice!')
        navigate(`/study/${topicId}`, { state: { topicTitle, chapterTitle } })
      } else {
        toast.error(detail || 'Failed to start session')
      }
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

      {/* #62 Resume active sessions */}
      {activeSessions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-[#FFB347] font-semibold uppercase tracking-widest">
            🔄 Resume where you left off
          </p>
          {activeSessions.map(s => (
            <button
              key={s.session_id}
              onClick={() => navigate(`/session/${s.session_id}`)}
              className="w-full blox-card px-4 py-3 text-left flex items-center gap-3 hover:border-[#FFB347]/50 transition-all group"
            >
              <div className="w-9 h-9 rounded-xl bg-[#FFB347]/20 flex items-center justify-center text-xl flex-shrink-0">
                📖
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-fredoka font-bold text-white truncate">{s.topic_title}</p>
                <p className="text-xs text-[#8892B0]">{s.chapter_title} · {s.questions_asked} question{s.questions_asked !== 1 ? 's' : ''} answered · {s.current_level}</p>
              </div>
              <span className="text-[#FFB347] text-sm flex-shrink-0 group-hover:translate-x-1 transition-transform">▶</span>
            </button>
          ))}
        </div>
      )}

      {/* Quick-access: Exam Mode + Flashcards + Mixed Practice */}
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => navigate('/exam')}
          className="blox-card p-4 text-left hover:border-[#FF6B9D]/60 transition-all blox-hover group"
        >
          <div className="text-3xl mb-2">🎯</div>
          <p className="font-fredoka font-bold text-white text-sm">Exam Mode</p>
          <p className="text-xs text-[#8892B0] mt-0.5">Timed · No hints</p>
        </button>
        <button
          onClick={() => navigate('/flashcard')}
          className="blox-card p-4 text-left hover:border-[#00CC88]/60 transition-all blox-hover group"
        >
          <div className="text-3xl mb-2">⚡</div>
          <p className="font-fredoka font-bold text-white text-sm">Flashcards</p>
          <p className="text-xs text-[#8892B0] mt-0.5">Quick review</p>
        </button>
        {/* #27 Mixed practice */}
        <button
          onClick={() => navigate('/interleaved')}
          className="blox-card p-4 text-left hover:border-[#A78BFA]/60 transition-all blox-hover group"
        >
          <div className="text-3xl mb-2">🔀</div>
          <p className="font-fredoka font-bold text-white text-sm">Mix It Up</p>
          <p className="text-xs text-[#8892B0] mt-0.5">Multiple topics</p>
        </button>
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
                                          <div className="flex items-center gap-2 mt-0.5">
                                            {t.studied && (
                                              <span className="text-xs text-[#00CC88]">✓ Studied</span>
                                            )}
                                            {t.mastery_sessions > 0 && (
                                              <span className="text-xs text-[#8892B0]">
                                                {t.mastery_sessions} session{t.mastery_sessions !== 1 ? 's' : ''}
                                                {t.last_practiced_at && ` · ${new Date(t.last_practiced_at).toLocaleDateString()}`}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 flex-shrink-0">
                                        {/* Study button — always available */}
                                        <button
                                          onClick={() => handleStudy(t, ch.title)}
                                          className="text-sm py-1.5 px-3 rounded-lg border border-[#00A2FF]/40 text-[#00A2FF] hover:bg-[#00A2FF]/10 transition-all font-nunito font-semibold"
                                          title="Study this topic with Buddy"
                                        >
                                          📖 Study
                                        </button>
                                        {/* Practice button — locked until studied */}
                                        <button
                                          onClick={() => handleStart(t.id, t.title, ch.title, t.studied)}
                                          disabled={starting === t.id}
                                          className={`text-sm py-1.5 px-3 rounded-lg font-nunito font-semibold transition-all disabled:opacity-50 ${
                                            t.studied
                                              ? 'btn-blox-primary'
                                              : 'border border-[#2D2B5A] text-[#4A5568] cursor-not-allowed'
                                          }`}
                                          title={t.studied ? 'Start practising' : 'Study first to unlock Practice'}
                                        >
                                          {starting === t.id ? '⚡…' : t.studied ? '▶ Play' : '🔒 Play'}
                                        </button>
                                        {/* #58: No-pressure practice (bypasses mastery/XP) */}
                                        {t.studied && (
                                          <button
                                            onClick={() => handleStart(t.id, t.title, ch.title, true, true)}
                                            disabled={starting === t.id}
                                            title="Practice without affecting your progress or XP"
                                            className="text-[9px] py-1 px-2 rounded-lg border border-[#2D2B5A] text-[#4A5568] hover:border-[#8892B0] hover:text-[#8892B0] transition-all disabled:opacity-40"
                                          >
                                            🎮 No-pressure
                                          </button>
                                        )}
                                      </div>
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
