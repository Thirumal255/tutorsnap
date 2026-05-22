import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { startExam, submitExam, getStudentProgress } from '../api/client'
import { useAuth } from '../auth/AuthContext'

const SUBJECT_EMOJI = {
  Mathematics: '🔢', Science: '🔬', English: '📖', 'Social Studies': '🌍',
  History: '🏛️', Geography: '🗺️', Physics: '⚡', Chemistry: '🧪',
  Biology: '🌿', 'Computer Science': '💻', Tamil: '🔤', Hindi: '🔤', Other: '📚',
}

function pad(n) { return String(n).padStart(2, '0') }
function fmtTime(secs) { return `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}` }

// ── SETUP ─────────────────────────────────────────────────────────────────────
function SetupScreen({ onStart, subjects, completedChaptersBySubject, loading }) {
  const navigate = useNavigate()
  const [selected, setSelected] = useState([])
  const [count, setCount] = useState(10)
  const [timeLimit, setTimeLimit] = useState(15)
  const [starting, setStarting] = useState(false)
  const [err, setErr] = useState('')

  function toggleSubject(s) {
    setSelected(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  async function handleStart() {
    if (selected.length === 0) { setErr('Pick at least one subject.'); return }
    setErr('')
    setStarting(true)
    try {
      await onStart({ subjects: selected, question_count: count, time_limit_minutes: timeLimit })
    } catch (e) {
      const detail = e.response?.data?.detail || ''
      if (detail === 'chapter_not_complete') {
        setErr('No completed chapters in the selected subject(s). Finish all topics in a chapter first.')
      } else {
        setErr(detail || 'Failed to start exam.')
      }
      setStarting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0F0F23] flex items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        {/* Title */}
        <div className="text-center">
          <div className="text-6xl mb-3">🎯</div>
          <h1 className="text-3xl font-fredoka font-bold text-white">Exam Mode</h1>
          <p className="text-[#8892B0] mt-1">Test yourself across subjects. No hints, no retries.</p>
        </div>

        {/* Subjects */}
        <div className="blox-card p-5">
          <p className="text-sm font-nunito font-semibold text-[#8892B0] uppercase tracking-wide mb-3">
            Subjects with completed chapters
          </p>

          {loading && (
            <p className="text-sm text-[#8892B0]">Loading…</p>
          )}

          {!loading && subjects.length === 0 && (
            <div className="text-center py-4 space-y-3">
              <p className="text-sm text-[#8892B0]">
                No chapters completed yet. Finish <strong className="text-white">all topics</strong> in a chapter to unlock exam mode for it.
              </p>
              <button
                onClick={() => navigate('/practice')}
                className="btn-blox-primary text-sm px-5 py-2"
              >
                ▶ Go Practice
              </button>
            </div>
          )}

          <div className="space-y-2">
            {subjects.map(s => {
              const chapters = completedChaptersBySubject[s] || []
              return (
                <button
                  key={s}
                  onClick={() => toggleSubject(s)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-nunito font-semibold transition-all border ${
                    selected.includes(s)
                      ? 'bg-[#00A2FF]/20 border-[#00A2FF] text-[#00A2FF]'
                      : 'bg-[#1A1A3E] border-[#2D2B5A] text-[#8892B0] hover:border-[#00A2FF]/50 hover:text-white'
                  }`}
                >
                  <span>{SUBJECT_EMOJI[s] || '📚'} {s}</span>
                  <span className="text-xs opacity-70">{chapters.length} chapter{chapters.length !== 1 ? 's' : ''} unlocked</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Questions + Time */}
        <div className="grid grid-cols-2 gap-4">
          <div className="blox-card p-5">
            <p className="text-sm font-nunito font-semibold text-[#8892B0] uppercase tracking-wide mb-3">Questions</p>
            <div className="flex gap-2">
              {[5, 10, 15].map(n => (
                <button
                  key={n}
                  onClick={() => setCount(n)}
                  className={`flex-1 py-2 rounded-xl text-sm font-fredoka font-bold transition-all border ${
                    count === n
                      ? 'bg-[#00A2FF] border-[#00A2FF] text-white'
                      : 'bg-[#1A1A3E] border-[#2D2B5A] text-[#8892B0] hover:border-[#00A2FF]/50'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="blox-card p-5">
            <p className="text-sm font-nunito font-semibold text-[#8892B0] uppercase tracking-wide mb-3">Time Limit</p>
            <div className="flex gap-2">
              {[10, 15, 20].map(t => (
                <button
                  key={t}
                  onClick={() => setTimeLimit(t)}
                  className={`flex-1 py-2 rounded-xl text-sm font-fredoka font-bold transition-all border ${
                    timeLimit === t
                      ? 'bg-[#00A2FF] border-[#00A2FF] text-white'
                      : 'bg-[#1A1A3E] border-[#2D2B5A] text-[#8892B0] hover:border-[#00A2FF]/50'
                  }`}
                >
                  {t}m
                </button>
              ))}
            </div>
          </div>
        </div>

        {err && <p className="text-[#FF6B6B] text-sm text-center">{err}</p>}

        <button
          onClick={handleStart}
          disabled={starting || selected.length === 0}
          className="w-full btn-blox-primary py-4 text-lg font-fredoka disabled:opacity-50"
        >
          {starting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Generating questions…
            </span>
          ) : '🚀 Start Exam'}
        </button>
      </div>
    </div>
  )
}

// ── CHECKPOINT MESSAGES (task #55) ────────────────────────────────────────────
const CHECKPOINT_MSGS = [
  { emoji: '🔥', title: 'Halfway there!',        body: "You're doing great — keep the momentum going!" },
  { emoji: '⚡', title: 'Flying through it!',    body: "Look at you go! Almost at the finish line." },
  { emoji: '🌟', title: 'On fire!',              body: "You're smashing it. Just a few more questions!" },
  { emoji: '💪', title: 'Strong work so far!',   body: "Your effort shows. Finish strong!" },
]

// ── IN PROGRESS ───────────────────────────────────────────────────────────────
function ExamScreen({ exam, onSubmit }) {
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState(Array(exam.questions.length).fill(''))
  const [timeLeft, setTimeLeft] = useState(exam.time_limit_seconds)
  const [submitting, setSubmitting] = useState(false)
  const timerRef = useRef(null)
  const [checkpoint, setCheckpoint] = useState(null)   // #55: { emoji, title, body }
  const checkpointTimerRef = useRef(null)
  const answeredCountRef = useRef(0)  // track how many answers have been filled

  const handleSubmit = useCallback(async (force = false) => {
    if (submitting) return
    setSubmitting(true)
    clearInterval(timerRef.current)
    await onSubmit(answers)
  }, [answers, onSubmit, submitting])

  // Countdown
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); handleSubmit(true); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [handleSubmit])

  const q = exam.questions[current]
  const progress = ((current + 1) / exam.questions.length) * 100
  const timerColor = timeLeft < 60 ? 'text-[#FF3333]' : timeLeft < 180 ? 'text-[#FFB347]' : 'text-[#00CC88]'

  return (
    <div className="min-h-screen bg-[#0F0F23] flex flex-col">
      {/* Top bar */}
      <div className="bg-[#16213E] border-b border-[#2D2B5A] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-fredoka font-bold text-white">🎯 Exam</span>
          <span className="text-sm text-[#8892B0]">Q{current + 1} / {exam.questions.length}</span>
        </div>
        <span className={`font-fredoka font-bold text-xl ${timerColor}`}>
          ⏱ {fmtTime(timeLeft)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-[#2D2B5A]">
        <div
          className="h-full bg-[#00A2FF] transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* #55 Checkpoint banner */}
      {checkpoint && (
        <div className="fixed inset-0 pointer-events-none z-40 flex items-center justify-center">
          <div className="bg-[#16213E] border border-[#00A2FF]/40 shadow-glow-blue rounded-3xl px-8 py-5 text-center animate-bounce-in">
            <div className="text-5xl mb-2">{checkpoint.emoji}</div>
            <p className="font-fredoka font-bold text-white text-xl">{checkpoint.title}</p>
            <p className="text-[#8892B0] text-sm mt-1">{checkpoint.body}</p>
          </div>
        </div>
      )}

      {/* Question area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-2xl space-y-6">
          {/* Subject tag */}
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-[#1A1A3E] rounded-full text-xs font-nunito font-semibold text-[#8892B0]">
              {SUBJECT_EMOJI[q.subject] || '📚'} {q.subject}
            </span>
            <span className="text-xs text-[#4A5568]">{q.topic_title}</span>
          </div>

          {/* Question */}
          <div className="blox-card p-6">
            <p className="text-white font-nunito text-lg leading-relaxed">{q.question}</p>
          </div>

          {/* Answer input */}
          <textarea
            value={answers[current]}
            onChange={e => {
              const prev = answers[current]
              const next = [...answers]
              next[current] = e.target.value
              setAnswers(next)
              // #55: detect when student finishes typing into a previously-blank answer
              const wasBlank = !prev.trim()
              const nowFilled = !!e.target.value.trim()
              if (wasBlank && nowFilled) {
                const newAnswered = next.filter(a => a.trim()).length
                if (newAnswered > 0 && newAnswered % 5 === 0 && newAnswered < exam.questions.length) {
                  const msg = CHECKPOINT_MSGS[Math.floor(newAnswered / 5 - 1) % CHECKPOINT_MSGS.length]
                  setCheckpoint(msg)
                  clearTimeout(checkpointTimerRef.current)
                  checkpointTimerRef.current = setTimeout(() => setCheckpoint(null), 2500)
                }
              }
            }}
            placeholder="Type your answer here…"
            rows={4}
            className="w-full bg-[#16213E] border border-[#2D2B5A] rounded-xl px-4 py-3 text-white font-nunito text-sm resize-none focus:outline-none focus:border-[#00A2FF] placeholder-[#4A5568]"
          />

          {/* Navigation */}
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setCurrent(c => Math.max(0, c - 1))}
              disabled={current === 0}
              className="px-6 py-3 rounded-xl bg-[#2D2B5A] text-[#8892B0] font-nunito font-semibold text-sm disabled:opacity-40 hover:bg-[#1A1A3E] transition-all"
            >
              ← Prev
            </button>

            {/* Dot nav */}
            <div className="flex gap-1.5 flex-wrap justify-center">
              {exam.questions.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrent(i)}
                  className={`w-2.5 h-2.5 rounded-full transition-all ${
                    i === current ? 'bg-[#00A2FF] scale-125' :
                    answers[i] ? 'bg-[#00CC88]' : 'bg-[#2D2B5A]'
                  }`}
                />
              ))}
            </div>

            {current < exam.questions.length - 1 ? (
              <button
                onClick={() => setCurrent(c => c + 1)}
                className="px-6 py-3 rounded-xl bg-[#00A2FF] text-white font-nunito font-semibold text-sm hover:bg-[#0090E0] transition-all"
              >
                Next →
              </button>
            ) : (
              <button
                onClick={() => handleSubmit(false)}
                disabled={submitting}
                className="px-6 py-3 rounded-xl bg-[#00CC88] text-white font-nunito font-semibold text-sm disabled:opacity-50 hover:bg-[#00BB77] transition-all"
              >
                {submitting ? '⚡ Submitting…' : '✅ Submit'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── RESULTS ───────────────────────────────────────────────────────────────────
function ResultsScreen({ results, onDone }) {
  const [activeTab, setActiveTab] = useState('overview') // 'overview' | 'detail'

  const { total_score, xp_earned, results: qs = [] } = results

  const gradeColor =
    total_score >= 80 ? 'text-[#00CC88]' :
    total_score >= 60 ? 'text-[#FFB347]' : 'text-[#FF6B6B]'

  const gradeEmoji =
    total_score >= 80 ? '🌟' : total_score >= 60 ? '👍' : '💪'

  return (
    <div className="min-h-screen bg-[#0F0F23] flex flex-col">
      {/* Header */}
      <div className="bg-[#16213E] border-b border-[#2D2B5A] px-6 py-4 flex items-center justify-between">
        <span className="font-fredoka font-bold text-white text-lg">🎯 Exam Results</span>
        <button onClick={onDone} className="text-[#8892B0] hover:text-white text-sm font-nunito">Done</button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full space-y-6">

        {/* Score card */}
        <div className="blox-card p-8 text-center">
          <div className="text-6xl mb-2">{gradeEmoji}</div>
          <p className={`text-6xl font-fredoka font-bold ${gradeColor}`}>{total_score}%</p>
          <p className="text-[#8892B0] mt-2 font-nunito">Overall Score</p>
          <div className="mt-4 inline-flex items-center gap-2 bg-[#1A1A3E] px-4 py-2 rounded-full">
            <span className="text-yellow-400">⭐</span>
            <span className="text-white font-fredoka font-bold">+{xp_earned} XP earned</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {['overview', 'detail'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-nunito font-semibold transition-all ${
                activeTab === tab
                  ? 'bg-[#00A2FF] text-white'
                  : 'bg-[#1A1A3E] text-[#8892B0] hover:text-white'
              }`}
            >
              {tab === 'overview' ? '📊 Overview' : '📋 Question Detail'}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-3">
            {/* Subject breakdown */}
            {(() => {
              const bySubject = {}
              qs.forEach(q => {
                const s = q.subject || 'Other'
                if (!bySubject[s]) bySubject[s] = { total: 0, count: 0 }
                bySubject[s].total += q.score
                bySubject[s].count++
              })
              return Object.entries(bySubject).map(([subj, data]) => {
                const avg = Math.round(data.total / data.count)
                return (
                  <div key={subj} className="blox-card p-4 flex items-center gap-4">
                    <span className="text-2xl">{SUBJECT_EMOJI[subj] || '📚'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-fredoka font-bold text-white">{subj}</p>
                      <div className="h-1.5 bg-[#2D2B5A] rounded-full mt-1.5">
                        <div
                          className={`h-full rounded-full ${avg >= 80 ? 'bg-[#00CC88]' : avg >= 60 ? 'bg-[#FFB347]' : 'bg-[#FF6B6B]'}`}
                          style={{ width: `${avg}%` }}
                        />
                      </div>
                    </div>
                    <span className={`text-lg font-fredoka font-bold ${avg >= 80 ? 'text-[#00CC88]' : avg >= 60 ? 'text-[#FFB347]' : 'text-[#FF6B6B]'}`}>
                      {avg}%
                    </span>
                  </div>
                )
              })
            })()}
          </div>
        )}

        {activeTab === 'detail' && (
          <div className="space-y-3">
            {qs.map((q, i) => (
              <div key={i} className="blox-card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-nunito text-white leading-snug flex-1">{q.question}</p>
                  <span className={`text-sm font-fredoka font-bold flex-shrink-0 ${
                    q.score >= 80 ? 'text-[#00CC88]' : q.score >= 60 ? 'text-[#FFB347]' : 'text-[#FF6B6B]'
                  }`}>
                    {q.score}%
                  </span>
                </div>
                {q.student_answer && (
                  <p className="text-xs text-[#8892B0] italic">Your answer: {q.student_answer}</p>
                )}
                {q.feedback && (
                  <p className="text-xs text-[#4A5568]">{q.feedback}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={onDone}
          className="w-full btn-blox-primary py-4 text-base font-fredoka"
        >
          🏠 Back to Practice
        </button>
      </div>
    </div>
  )
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function ExamMode() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [phase, setPhase] = useState('setup') // 'setup' | 'exam' | 'results'
  const [exam, setExam] = useState(null)
  const [results, setResults] = useState(null)
  const [subjects, setSubjects] = useState([])
  const [completedChaptersBySubject, setCompletedChaptersBySubject] = useState({})
  const [loadingSubjects, setLoadingSubjects] = useState(true)

  // Load subjects that have at least one fully-completed chapter
  useEffect(() => {
    getStudentProgress()
      .then(res => {
        const bySubject = {}
        for (const book of res.data) {
          for (const ch of book.chapters) {
            // Chapter is complete when every topic has been practiced (mastery_level set)
            const isComplete = ch.total_topics > 0 && ch.attempted === ch.total_topics
            if (isComplete) {
              if (!bySubject[book.subject]) bySubject[book.subject] = []
              bySubject[book.subject].push({ id: ch.id, title: ch.title })
            }
          }
        }
        setCompletedChaptersBySubject(bySubject)
        setSubjects(Object.keys(bySubject))
      })
      .catch(() => { setSubjects([]); setCompletedChaptersBySubject({}) })
      .finally(() => setLoadingSubjects(false))
  }, [])

  async function handleStart(config) {
    const res = await startExam(config)
    setExam(res.data)
    setPhase('exam')
  }

  async function handleSubmit(answers) {
    const res = await submitExam({
      exam_id: exam.exam_id,
      answers,
    })
    setResults(res.data)
    setPhase('results')
  }

  if (phase === 'setup') return <SetupScreen onStart={handleStart} subjects={subjects} completedChaptersBySubject={completedChaptersBySubject} loading={loadingSubjects} />
  if (phase === 'exam') return <ExamScreen exam={exam} onSubmit={handleSubmit} />
  if (phase === 'results') return <ResultsScreen results={results} onDone={() => navigate('/practice')} />
  return null
}
