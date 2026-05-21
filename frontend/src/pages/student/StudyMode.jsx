import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../context/ToastContext'
import { explainTopic, studyChat, completeStudy, unlockPractice, startSession } from '../../api/client'

// ─── Phases ──────────────────────────────────────────────────────────────────
// "explain"  → Buddy explains the topic
// "chat"     → Student chats with Buddy (Q&A)
// "check"    → 2 quick-check questions
// "unlocked" → Practice unlocked!

const PHASE = { EXPLAIN: 'explain', CHAT: 'chat', CHECK: 'check', UNLOCKED: 'unlocked' }

function renderMarkdown(text) {
  // Minimal markdown: bold, bullets, section headers
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^## (.+)$/gm, '<h3 class="text-[#00A2FF] font-fredoka font-bold text-base mt-4 mb-1">$1</h3>')
    .replace(/^### (.+)$/gm, '<h4 class="text-white font-semibold mt-3 mb-1">$1</h4>')
    .replace(/^[•\-] (.+)$/gm, '<li class="ml-4 list-disc text-[#CDD6F4]">$1</li>')
    .replace(/\n/g, '<br/>')
}

export default function StudyMode() {
  const { topicId } = useParams()
  const navigate    = useNavigate()
  const location    = useLocation()
  const { user }    = useAuth()
  const { toast }   = useToast()

  const topicTitle    = location.state?.topicTitle  || 'Topic'
  const chapterTitle  = location.state?.chapterTitle || ''
  const studiedBefore = location.state?.studiedBefore || false

  const [phase, setPhase]           = useState(PHASE.EXPLAIN)
  const [explanation, setExplanation] = useState('')
  const [loadingExplain, setLoadingExplain] = useState(true)

  // Chat state
  const [messages, setMessages]   = useState([])   // [{role, content}]
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [showPracticeNudge, setShowPracticeNudge] = useState(false)
  const chatBottomRef = useRef(null)

  // Quick-check state
  const [checkQuestions, setCheckQuestions] = useState([])
  const [checkAnswers, setCheckAnswers]     = useState({})
  const [checkResults, setCheckResults]     = useState({})
  const [checkLoading, setCheckLoading]     = useState(false)
  const [checkingQ, setCheckingQ]           = useState(null)
  const [allPassed, setAllPassed]           = useState(false)
  const [unlocking, setUnlocking]           = useState(false)
  const [starting, setStarting]             = useState(false)

  // Build compact study summary from explanation for injection into practice
  const studySummary = explanation
    ? explanation.replace(/\*\*/g, '').replace(/#{1,3} /g, '').slice(0, 1200)
    : ''

  // ── Load explanation on mount ─────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoadingExplain(true)
      try {
        const res = await explainTopic(topicId)
        setExplanation(res.data.explanation)
        // Prime chat with the explanation as first assistant message
        setMessages([{ role: 'assistant', content: res.data.explanation }])
      } catch (e) {
        toast.error('Could not load explanation — please try again')
      } finally {
        setLoadingExplain(false)
      }
    }
    load()
  }, [topicId])

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chatLoading])

  // ── Chat send ─────────────────────────────────────────────────────────────
  async function sendChat() {
    const text = chatInput.trim()
    if (!text || chatLoading) return
    const newMessages = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setChatInput('')
    setChatLoading(true)
    try {
      const res = await studyChat(topicId, user.name, newMessages)
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.reply }])
      if (res.data.show_nudge) setShowPracticeNudge(true)
    } catch (e) {
      toast.error('Could not get a response — try again')
    } finally {
      setChatLoading(false)
    }
  }

  // ── Start quick-check ─────────────────────────────────────────────────────
  async function startCheck() {
    setCheckLoading(true)
    try {
      const res = await completeStudy(topicId, user.name, studySummary)
      setCheckQuestions(res.data.check_questions)
      setPhase(PHASE.CHECK)
    } catch (e) {
      toast.error('Could not load check questions — try again')
    } finally {
      setCheckLoading(false)
    }
  }

  // ── Grade a quick-check answer (client-side keyword match) ────────────────
  function gradeAnswer(question, answer) {
    const keyPoints = question.expected_key_points || []
    if (!keyPoints.length) return answer.trim().length > 2  // fallback: any answer
    const ans = answer.toLowerCase()
    const hits = keyPoints.filter(kp => ans.includes(kp.toLowerCase()))
    return hits.length >= Math.ceil(keyPoints.length * 0.5)   // pass if ≥50% key points matched
  }

  function submitCheckAnswer(q) {
    const ans = (checkAnswers[q.id] || '').trim()
    if (!ans) { toast.info('Write your answer first!'); return }
    const passed = gradeAnswer(q, ans)
    const newResults = { ...checkResults, [q.id]: passed }
    setCheckResults(newResults)
    setCheckingQ(q.id)
    setTimeout(() => {
      setCheckingQ(null)
      const allDone = checkQuestions.every(cq => newResults[cq.id] !== undefined)
      if (allDone && checkQuestions.every(cq => newResults[cq.id])) {
        setAllPassed(true)
      }
    }, 600)
  }

  // ── Retry failed questions ────────────────────────────────────────────────
  function retryCheck() {
    const failedIds = checkQuestions.filter(q => checkResults[q.id] === false).map(q => q.id)
    const cleared = { ...checkResults }
    const clearedAnswers = { ...checkAnswers }
    failedIds.forEach(id => { delete cleared[id]; delete clearedAnswers[id] })
    setCheckResults(cleared)
    setCheckAnswers(clearedAnswers)
    setAllPassed(false)
  }

  // ── Unlock practice ───────────────────────────────────────────────────────
  async function handleUnlock() {
    setUnlocking(true)
    try {
      await unlockPractice(topicId, user.name, studySummary)
      setPhase(PHASE.UNLOCKED)
      toast.success('🎉 Practice unlocked! +10 XP')
    } catch (e) {
      toast.error('Could not unlock — try again')
    } finally {
      setUnlocking(false)
    }
  }

  // ── Start practice immediately ────────────────────────────────────────────
  async function handleStartPractice() {
    setStarting(true)
    try {
      const res = await startSession(user.name, parseInt(topicId))
      const d = res.data
      sessionStorage.setItem(
        `session_${d.session_id}`,
        JSON.stringify({
          sessionId: d.session_id, studentName: d.student_name,
          topicTitle: d.topic_title, chapterTitle: d.chapter_title,
          initialMessage: d.message, currentLevel: d.current_level,
          levelLabel: d.level_label, topicId: parseInt(topicId),
          answerFormat: d.answer_format || null,
        })
      )
      navigate(`/session/${d.session_id}`)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to start practice')
    } finally {
      setStarting(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4 pb-24">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-[#8892B0] hover:text-white transition-colors">
          ← Back
        </button>
        <div>
          <h1 className="text-xl font-fredoka font-bold text-white">
            📖 {topicTitle}
          </h1>
          {chapterTitle && (
            <p className="text-xs text-[#8892B0]">{chapterTitle}</p>
          )}
        </div>
      </div>

      {/* Phase pills */}
      <div className="flex gap-2 text-xs">
        {[
          { key: PHASE.EXPLAIN, label: '1. Study' },
          { key: PHASE.CHAT,    label: '2. Ask Buddy' },
          { key: PHASE.CHECK,   label: '3. Quick Check' },
          { key: PHASE.UNLOCKED,label: '4. Practice!' },
        ].map(p => (
          <span key={p.key} className={`px-2 py-1 rounded-full font-semibold ${
            phase === p.key
              ? 'bg-[#00A2FF] text-white'
              : [PHASE.EXPLAIN, PHASE.CHAT, PHASE.CHECK, PHASE.UNLOCKED].indexOf(phase) >
                [PHASE.EXPLAIN, PHASE.CHAT, PHASE.CHECK, PHASE.UNLOCKED].indexOf(p.key)
                ? 'bg-[#00CC88]/20 text-[#00CC88]'
                : 'bg-[#2D2B5A] text-[#8892B0]'
          }`}>
            {p.label}
          </span>
        ))}
      </div>

      {/* ── EXPLAIN phase ── */}
      {(phase === PHASE.EXPLAIN || phase === PHASE.CHAT) && (
        <div className="blox-card p-5 space-y-4">
          {loadingExplain ? (
            <div className="flex items-center gap-3 text-[#8892B0]">
              <span className="animate-spin text-xl">⚙️</span>
              <span>Buddy is preparing your explanation…</span>
            </div>
          ) : (
            <>
              {/* Explanation */}
              {phase === PHASE.EXPLAIN && (
                <>
                  <div
                    className="text-[#CDD6F4] text-sm leading-relaxed space-y-1"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(explanation) }}
                  />
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setPhase(PHASE.CHAT)}
                      className="flex-1 py-2.5 rounded-xl border border-[#00A2FF]/40 text-[#00A2FF] font-nunito font-semibold text-sm hover:bg-[#00A2FF]/10 transition-all"
                    >
                      💬 Ask Buddy a question
                    </button>
                    <button
                      onClick={startCheck}
                      disabled={checkLoading}
                      className="flex-1 btn-blox-primary py-2.5 text-sm disabled:opacity-60"
                    >
                      {checkLoading ? '⚙️ Loading…' : "✅ I'm ready — Quick Check!"}
                    </button>
                  </div>
                </>
              )}

              {/* Chat phase */}
              {phase === PHASE.CHAT && (
                <>
                  {/* Chat history */}
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {messages.map((m, i) => (
                      <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                          m.role === 'user'
                            ? 'bg-[#00A2FF] text-white rounded-br-sm'
                            : 'bg-[#2D2B5A] text-[#CDD6F4] rounded-bl-sm'
                        }`}>
                          {m.role === 'assistant'
                            ? <span dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                            : m.content
                          }
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-[#2D2B5A] rounded-2xl rounded-bl-sm px-4 py-2.5 text-[#8892B0] text-sm">
                          Buddy is thinking…
                        </div>
                      </div>
                    )}
                    <div ref={chatBottomRef} />
                  </div>

                  {/* Chat input */}
                  <div className="flex gap-2 pt-1">
                    <input
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                      placeholder="Ask Buddy anything about this topic…"
                      className="flex-1 bg-[#1A1A3E] border border-[#2D2B5A] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#00A2FF] placeholder-[#4A5568]"
                    />
                    <button
                      onClick={sendChat}
                      disabled={chatLoading || !chatInput.trim()}
                      className="btn-blox-primary px-4 py-2.5 text-sm disabled:opacity-50"
                    >
                      Send
                    </button>
                  </div>

                  {/* Practice nudge banner — shown after 12 messages */}
                  {showPracticeNudge && (
                    <div className="bg-[#00CC88]/10 border border-[#00CC88]/30 rounded-2xl p-4 flex items-center gap-3">
                      <span className="text-2xl">🎯</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[#00CC88] font-nunito font-bold text-sm">Ready to practise?</p>
                        <p className="text-[#8892B0] text-xs">You've been studying for a while — great effort!</p>
                      </div>
                      <button
                        onClick={startCheck}
                        disabled={checkLoading}
                        className="shrink-0 bg-[#00CC88] hover:bg-[#00AA70] text-white text-xs font-bold px-3 py-2 rounded-xl transition-all disabled:opacity-60"
                      >
                        {checkLoading ? '…' : 'Quick Check →'}
                      </button>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-3 pt-1">
                    <button
                      onClick={() => setPhase(PHASE.EXPLAIN)}
                      className="flex-1 py-2 rounded-xl border border-[#2D2B5A] text-[#8892B0] text-sm hover:border-[#00A2FF]/40 hover:text-[#00A2FF] transition-all"
                    >
                      ← Re-read explanation
                    </button>
                    <button
                      onClick={startCheck}
                      disabled={checkLoading}
                      className="flex-1 btn-blox-primary py-2 text-sm disabled:opacity-60"
                    >
                      {checkLoading ? '⚙️ Loading…' : "✅ Quick Check!"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── CHECK phase ── */}
      {phase === PHASE.CHECK && (
        <div className="space-y-4">
          <div className="blox-card p-4">
            <h2 className="font-fredoka font-bold text-white text-lg mb-1">
              ✅ Quick Check
            </h2>
            <p className="text-[#8892B0] text-sm">
              Answer both questions to unlock Practice. Buddy is checking your understanding!
            </p>
          </div>

          {checkQuestions.map((q, idx) => {
            const result  = checkResults[q.id]
            const answered = result !== undefined
            const checking = checkingQ === q.id
            return (
              <div key={q.id} className={`blox-card p-4 space-y-3 border ${
                answered
                  ? result ? 'border-[#00CC88]/40' : 'border-[#FF6B9D]/40'
                  : 'border-[#2D2B5A]'
              }`}>
                <div className="flex items-start gap-2">
                  <span className="text-[#8892B0] text-sm font-bold flex-shrink-0">Q{idx + 1}.</span>
                  <p className="text-white text-sm leading-relaxed">{q.question}</p>
                </div>

                {!answered && (
                  <>
                    <textarea
                      value={checkAnswers[q.id] || ''}
                      onChange={e => setCheckAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                      placeholder="Write your answer here…"
                      rows={3}
                      className="w-full bg-[#1A1A3E] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-[#00A2FF] placeholder-[#4A5568] resize-none"
                    />
                    <button
                      onClick={() => submitCheckAnswer(q)}
                      disabled={checking}
                      className="w-full btn-blox-primary py-2 text-sm disabled:opacity-60"
                    >
                      {checking ? 'Checking…' : 'Submit Answer'}
                    </button>
                  </>
                )}

                {answered && (
                  <div className={`flex items-center gap-2 text-sm font-semibold ${
                    result ? 'text-[#00CC88]' : 'text-[#FF6B9D]'
                  }`}>
                    {result ? '✅ Correct!' : '❌ Not quite — try again after retry'}
                    {!result && (
                      <span className="text-xs text-[#8892B0] font-normal ml-1">
                        Key ideas: {q.expected_key_points?.join(', ')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Results summary */}
          {checkQuestions.length > 0 &&
           checkQuestions.every(q => checkResults[q.id] !== undefined) && (
            <div className="blox-card p-4 text-center space-y-3">
              {allPassed ? (
                <>
                  <p className="text-2xl">🎉</p>
                  <p className="text-[#00CC88] font-fredoka font-bold text-lg">
                    Both correct — you've got it!
                  </p>
                  <p className="text-[#8892B0] text-sm">
                    +10 XP · Practice is now unlocked for this topic.
                  </p>
                  <button
                    onClick={handleUnlock}
                    disabled={unlocking}
                    className="w-full btn-blox-primary py-3 text-base font-fredoka font-bold disabled:opacity-60"
                  >
                    {unlocking ? 'Unlocking…' : '🔓 Unlock Practice'}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[#FF6B9D] font-fredoka font-bold">
                    Some answers need work — let's try again!
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setPhase(PHASE.CHAT)}
                      className="flex-1 py-2.5 rounded-xl border border-[#00A2FF]/40 text-[#00A2FF] text-sm font-semibold hover:bg-[#00A2FF]/10 transition-all"
                    >
                      💬 Ask Buddy for help
                    </button>
                    <button
                      onClick={retryCheck}
                      className="flex-1 py-2.5 rounded-xl border border-[#FF6B9D]/40 text-[#FF6B9D] text-sm font-semibold hover:bg-[#FF6B9D]/10 transition-all"
                    >
                      🔄 Retry failed questions
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── UNLOCKED phase ── */}
      {phase === PHASE.UNLOCKED && (
        <div className="blox-card p-8 text-center space-y-4">
          <div className="text-5xl">🏆</div>
          <h2 className="font-fredoka font-bold text-white text-2xl">
            Practice Unlocked!
          </h2>
          <p className="text-[#8892B0] text-sm max-w-xs mx-auto">
            You've studied <strong className="text-white">{topicTitle}</strong> and
            passed the quick check. Time to put it to the test!
          </p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => navigate('/practice')}
              className="flex-1 py-3 rounded-xl border border-[#2D2B5A] text-[#8892B0] font-semibold hover:border-[#00A2FF]/40 hover:text-[#00A2FF] transition-all"
            >
              ← Back to Topics
            </button>
            <button
              onClick={handleStartPractice}
              disabled={starting}
              className="flex-2 btn-blox-primary py-3 px-8 text-base font-fredoka font-bold disabled:opacity-60"
            >
              {starting ? '⚡ Starting…' : '▶ Start Practice Now!'}
            </button>
          </div>
        </div>
      )}

      {/* Return to study — shown during check phase */}
      {phase === PHASE.CHECK && (
        <button
          onClick={() => setPhase(PHASE.EXPLAIN)}
          className="text-sm text-[#8892B0] hover:text-[#00A2FF] transition-colors"
        >
          ← Re-read the explanation
        </button>
      )}

      {/* Re-study option for returning students */}
      {studiedBefore && phase === PHASE.EXPLAIN && (
        <div className="text-center text-xs text-[#8892B0]">
          You've studied this topic before. Want to go straight to practice?{' '}
          <button
            onClick={handleStartPractice}
            className="text-[#00A2FF] underline hover:no-underline"
          >
            Skip study
          </button>
        </div>
      )}
    </div>
  )
}
