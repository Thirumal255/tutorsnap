import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getInterleavedTopics, startSession, submitAnswer } from '../api/client'
import { useAuth } from '../auth/AuthContext'

// ── Helpers ───────────────────────────────────────────────────────────────────
const SUBJECT_EMOJI = {
  Mathematics: '🔢', Science: '🔬', English: '📖', 'Social Studies': '🌍',
  History: '🏛️', Geography: '🗺️', Physics: '⚡', Chemistry: '🧪',
  Biology: '🌿', 'Computer Science': '💻', Tamil: '🔤', Hindi: '🔤', Other: '📚',
}

const MASTERY_LABEL = { L1: 'Learning', L2: 'Developing', L3: 'Practising', L4: 'Going Deeper', L5: 'Challenge' }
const LEVEL_COLOR   = { L1: 'text-[#FFB347]', L2: 'text-[#00A2FF]', L3: 'text-[#00CC88]', L4: 'text-[#C084FC]', L5: 'text-[#FBBF24]' }

const QUESTIONS_PER_TOPIC = 3  // questions answered per topic before switching

// ── TOPIC SELECT ──────────────────────────────────────────────────────────────
function TopicSelect({ onStart }) {
  const navigate = useNavigate()
  const [topics, setTopics] = useState([])
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getInterleavedTopics(8)
      .then(r => setTopics(r.data || []))
      .catch(() => setTopics([]))
      .finally(() => setLoading(false))
  }, [])

  function toggle(id) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 5 ? [...prev, id] : prev
    )
  }

  return (
    <div className="min-h-screen bg-[#0F0F23] flex flex-col">
      <div className="bg-[#16213E] border-b border-[#2D2B5A] px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-fredoka font-bold text-white text-xl">🔀 Mix It Up</h1>
          <p className="text-xs text-[#8892B0]">Interleave multiple topics for stronger recall</p>
        </div>
        <button onClick={() => navigate('/practice')} className="text-[#8892B0] hover:text-white text-sm">✕ Close</button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full space-y-5">

        {loading && (
          <div className="text-center py-16">
            <div className="text-4xl animate-bounce mb-3">🔀</div>
            <p className="text-[#8892B0]">Finding your topics…</p>
          </div>
        )}

        {!loading && topics.length === 0 && (
          <div className="blox-card p-10 text-center space-y-3">
            <div className="text-5xl">📭</div>
            <p className="text-white font-fredoka text-xl">Nothing ready to mix yet</p>
            <p className="text-[#8892B0] text-sm">Study some topics first, then come back to mix them up!</p>
            <button onClick={() => navigate('/practice')} className="btn-blox-primary px-6 py-2.5 text-sm">
              ▶ Go Practice
            </button>
          </div>
        )}

        {!loading && topics.length > 0 && (
          <>
            <div className="blox-card p-4 space-y-1">
              <p className="text-xs text-[#8892B0] font-semibold uppercase tracking-widest">
                Pick 2–5 topics to interleave ({selected.length}/5 selected)
              </p>
              <p className="text-xs text-[#4A5568]">
                You'll get {QUESTIONS_PER_TOPIC} questions per topic, cycling through them all.
              </p>
            </div>

            <div className="space-y-2">
              {topics.map(t => (
                <button
                  key={t.id}
                  onClick={() => toggle(t.id)}
                  className={`w-full blox-card p-4 text-left flex items-center gap-3 transition-all ${
                    selected.includes(t.id)
                      ? 'border-[#A78BFA] bg-[#A78BFA]/10 shadow-[0_0_12px_rgba(167,139,250,0.15)]'
                      : 'hover:border-[#A78BFA]/40'
                  } ${!selected.includes(t.id) && selected.length >= 5 ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                    selected.includes(t.id) ? 'border-[#A78BFA] bg-[#A78BFA]' : 'border-[#2D2B5A]'
                  }`}>
                    {selected.includes(t.id) && <span className="text-white text-xs font-bold">{selected.indexOf(t.id) + 1}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-fredoka font-bold text-white text-sm truncate">{t.title}</p>
                    <p className="text-xs text-[#8892B0]">
                      {SUBJECT_EMOJI[t.subject] || '📚'} {t.subject}
                      {t.mastery_level && (
                        <span className={`ml-2 font-semibold ${LEVEL_COLOR[t.mastery_level]}`}>
                          · {MASTERY_LABEL[t.mastery_level]}
                        </span>
                      )}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => selected.length >= 2 && onStart(topics.filter(t => selected.includes(t.id)))}
              disabled={selected.length < 2}
              className="w-full btn-blox-primary py-4 text-base font-fredoka font-bold disabled:opacity-40"
            >
              🔀 Start Mixed Practice ({selected.length} topic{selected.length !== 1 ? 's' : ''})
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── PRACTICE SCREEN ───────────────────────────────────────────────────────────
function PracticeScreen({ topics, studentName, onDone }) {
  const navigate = useNavigate()

  // Each topic gets its own session slot
  const [sessions, setSessions] = useState({})          // { topicId: sessionId }
  const [topicAnswers, setTopicAnswers] = useState({})   // { topicId: [{ score, level }] }
  const [currentTopicIdx, setCurrentTopicIdx] = useState(0)

  const [question, setQuestion] = useState(null)
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState(null)        // { text, score, level }
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const currentTopic = topics[currentTopicIdx]
  const inputRef = useRef(null)

  // Total questions across all topics
  const totalAnswered = Object.values(topicAnswers).reduce((a, arr) => a + arr.length, 0)
  const totalQuestions = topics.length * QUESTIONS_PER_TOPIC
  const progress = totalAnswered / totalQuestions

  // Start or reuse session for a topic
  async function ensureSession(topic) {
    if (sessions[topic.id]) {
      return sessions[topic.id]
    }
    const res = await startSession(studentName, topic.id, true /* practiceMode */)
    const sid = res.data.session_id
    setQuestion({ text: res.data.message, format: res.data.answer_format, turn: 1 })
    setSessions(prev => ({ ...prev, [topic.id]: sid }))
    return sid
  }

  // Load first topic on mount
  useEffect(() => {
    loadTopic(topics[0])
  }, [])

  async function loadTopic(topic) {
    setLoading(true)
    setFeedback(null)
    setAnswer('')
    try {
      await ensureSession(topic)
    } catch {
      // If session start fails, show error state
      setQuestion({ text: `Couldn't load ${topic.title}. Tap Next to skip.`, format: null, turn: 0 })
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  async function handleSubmit() {
    if (!answer.trim() || submitting || !currentTopic) return
    const sid = sessions[currentTopic.id]
    if (!sid) return
    setSubmitting(true)
    try {
      const res = await submitAnswer(sid, answer.trim())
      const d = res.data
      const score = d.score || 0
      const level = d.current_level || 'L1'

      // Record this answer for this topic
      setTopicAnswers(prev => ({
        ...prev,
        [currentTopic.id]: [...(prev[currentTopic.id] || []), { score, level }],
      }))

      const topicCount = (topicAnswers[currentTopic.id]?.length || 0) + 1
      const isSessionDone = d.session_complete
      const isTopicRoundDone = topicCount >= QUESTIONS_PER_TOPIC || isSessionDone

      setFeedback({
        text: d.feedback || (score >= 70 ? '✅ Well done!' : '💡 Good effort!'),
        score,
        level,
        nextQuestion: isTopicRoundDone ? null : d.next_question,
        answerFormat: d.answer_format,
        turn: d.turn_number,
      })

      if (isTopicRoundDone) {
        // Check if all topics are done
        const newTotalAnswered = totalAnswered + 1
        if (newTotalAnswered >= totalQuestions) {
          // Record last and mark done
          setTimeout(() => setDone(true), 1800)
        } else {
          // Advance to next topic
          setTimeout(() => advanceTopic(), 1800)
        }
      } else {
        // Update question for next answer within same topic
        setQuestion({ text: d.next_question, format: d.answer_format, turn: d.turn_number })
        setTimeout(() => { setFeedback(null); setAnswer(''); inputRef.current?.focus() }, 1500)
      }
    } catch {
      setFeedback({ text: '❌ Something went wrong. Try again.', score: 0, level: 'L1', nextQuestion: null })
    } finally {
      setSubmitting(false)
    }
  }

  function advanceTopic() {
    const nextIdx = (currentTopicIdx + 1) % topics.length
    // Find next topic that still needs questions
    let checked = 0
    let idx = nextIdx
    while (checked < topics.length) {
      const tid = topics[idx].id
      if ((topicAnswers[tid]?.length || 0) < QUESTIONS_PER_TOPIC) break
      idx = (idx + 1) % topics.length
      checked++
    }
    setCurrentTopicIdx(idx)
    setFeedback(null)
    setAnswer('')
    setQuestion(null)
    loadTopic(topics[idx])
  }

  if (done) {
    const avgScore = totalAnswered > 0
      ? Math.round(topics.reduce((sum, t) => {
          const arr = topicAnswers[t.id] || []
          return sum + arr.reduce((s, a) => s + a.score, 0) / Math.max(arr.length, 1)
        }, 0) / topics.length)
      : 0

    return (
      <div className="min-h-screen bg-[#0F0F23] flex items-center justify-center p-6">
        <div className="w-full max-w-md blox-card p-8 text-center space-y-5">
          <div className="text-6xl">{avgScore >= 80 ? '🌟' : avgScore >= 60 ? '👍' : '💪'}</div>
          <h2 className="text-2xl font-fredoka font-bold text-white">Mix Complete!</h2>
          <p className="text-[#8892B0] text-sm">
            {topics.length} topic{topics.length !== 1 ? 's' : ''} · {totalAnswered} questions answered
          </p>

          <div className="space-y-2">
            {topics.map(t => {
              const arr = topicAnswers[t.id] || []
              const avg = arr.length ? Math.round(arr.reduce((s, a) => s + a.score, 0) / arr.length) : 0
              return (
                <div key={t.id} className="flex items-center justify-between px-3 py-2 bg-[#0F0F23] rounded-xl">
                  <div className="text-left min-w-0 flex-1">
                    <p className="text-sm font-fredoka font-bold text-white truncate">{t.title}</p>
                    <p className="text-xs text-[#8892B0]">{arr.length} answered</p>
                  </div>
                  <div className={`text-lg font-fredoka font-bold ml-3 flex-shrink-0 ${
                    avg >= 80 ? 'text-[#00CC88]' : avg >= 60 ? 'text-[#FFB347]' : 'text-[#FF6B6B]'
                  }`}>
                    {avg}%
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => navigate('/practice')}
              className="flex-1 py-3 rounded-xl bg-[#1A1A3E] border border-[#2D2B5A] text-[#8892B0] hover:text-white font-nunito font-semibold text-sm transition-all"
            >
              ← Practice
            </button>
            <button
              onClick={onDone}
              className="flex-1 btn-blox-primary py-3"
            >
              🔀 Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0F0F23] flex flex-col">
      {/* Header */}
      <div className="bg-[#16213E] border-b border-[#2D2B5A] px-6 py-3 flex items-center justify-between">
        <div>
          <span className="font-fredoka font-bold text-white">🔀 Mix It Up</span>
          <p className="text-xs text-[#8892B0] mt-0.5">
            {currentTopic && `${SUBJECT_EMOJI[currentTopic.subject] || '📚'} ${currentTopic.title}`}
          </p>
        </div>
        <button onClick={() => navigate('/practice')} className="text-[#8892B0] hover:text-white text-sm">✕</button>
      </div>

      {/* Overall progress */}
      <div className="h-1 bg-[#2D2B5A]">
        <div className="h-full bg-[#A78BFA] transition-all duration-500" style={{ width: `${progress * 100}%` }} />
      </div>

      {/* Topic progress dots */}
      <div className="bg-[#16213E] border-b border-[#2D2B5A] px-6 py-2 flex items-center gap-2 overflow-x-auto">
        {topics.map((t, i) => {
          const count = topicAnswers[t.id]?.length || 0
          const isDone = count >= QUESTIONS_PER_TOPIC
          const isCurrent = i === currentTopicIdx
          return (
            <div key={t.id} className={`flex items-center gap-1.5 flex-shrink-0 ${isCurrent ? '' : 'opacity-60'}`}>
              <div className={`w-2.5 h-2.5 rounded-full ${
                isDone ? 'bg-[#00CC88]' : isCurrent ? 'bg-[#A78BFA]' : 'bg-[#2D2B5A]'
              }`} />
              <span className="text-[10px] text-[#8892B0] max-w-[80px] truncate">{t.title}</span>
              <span className="text-[10px] text-[#4A5568]">{count}/{QUESTIONS_PER_TOPIC}</span>
            </div>
          )
        })}
      </div>

      {/* Question area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-5">

          {(loading || !question) && (
            <div className="text-center py-10">
              <div className="text-4xl animate-bounce mb-3">🔀</div>
              <p className="text-[#8892B0]">Loading…</p>
            </div>
          )}

          {!loading && question && (
            <>
              {/* Question card */}
              <div className="blox-card p-6">
                <p className="text-xs text-[#8892B0] font-semibold uppercase tracking-wide mb-3">
                  {SUBJECT_EMOJI[currentTopic?.subject] || '📚'} {currentTopic?.title}
                </p>
                <p className="text-white font-nunito text-base leading-relaxed">{question.text}</p>
              </div>

              {/* Feedback */}
              {feedback && (
                <div className={`rounded-2xl px-4 py-3 text-sm font-nunito animate-bounce-in ${
                  feedback.score >= 80 ? 'bg-[#00CC88]/10 text-[#00CC88] border border-[#00CC88]/20'
                  : feedback.score >= 60 ? 'bg-[#FFB347]/10 text-[#FFB347] border border-[#FFB347]/20'
                  : 'bg-[#FF6B6B]/10 text-[#FF6B6B] border border-[#FF6B6B]/20'
                }`}>
                  {feedback.text}
                </div>
              )}

              {/* Answer input */}
              {!feedback && (
                <>
                  <textarea
                    ref={inputRef}
                    value={answer}
                    onChange={e => setAnswer(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit() }}
                    placeholder="Type your answer… (Ctrl+Enter to submit)"
                    rows={3}
                    className="w-full bg-[#16213E] border border-[#2D2B5A] rounded-xl px-4 py-3 text-white font-nunito text-sm resize-none focus:outline-none focus:border-[#A78BFA] placeholder-[#4A5568]"
                  />
                  <button
                    onClick={handleSubmit}
                    disabled={!answer.trim() || submitting}
                    className="w-full py-3.5 rounded-xl bg-[#A78BFA]/20 border border-[#A78BFA]/30 text-[#A78BFA] font-fredoka font-bold text-base hover:bg-[#A78BFA]/30 transition-all disabled:opacity-40"
                  >
                    {submitting ? '⚡ Checking…' : '✅ Submit Answer'}
                  </button>
                </>
              )}

              {/* Progress summary */}
              <div className="flex justify-center gap-4 text-xs font-nunito text-[#4A5568]">
                <span>{totalAnswered} of {totalQuestions} questions</span>
                <span>·</span>
                <span>🎮 Practice mode — no XP changes</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
export default function InterleavedMode() {
  const { user } = useAuth()
  const [phase, setPhase] = useState('select')   // 'select' | 'practice'
  const [selectedTopics, setSelectedTopics] = useState([])

  function handleStart(topics) {
    setSelectedTopics(topics)
    setPhase('practice')
  }

  function handleDone() {
    setPhase('select')
    setSelectedTopics([])
  }

  if (phase === 'practice') {
    return (
      <PracticeScreen
        topics={selectedTopics}
        studentName={user?.name || 'Student'}
        onDone={handleDone}
      />
    )
  }

  return <TopicSelect onStart={handleStart} />
}
