import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { submitAnswer, requestHint, requestSubQuestion, endSession } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import ChatBubble from '../components/ChatBubble'
import HintButton from '../components/HintButton'
import ProgressBadge from '../components/ProgressBadge'
import WritingCanvas from '../components/WritingCanvas'

// ── Give-up detection ──────────────────────────────────────────────────────
const GIVEUP_PHRASES = new Set([
  "i don't know", "i dont know", "idk", "i give up", "no idea", "no clue",
  "help", "stuck", "skip", "pass", "can't", "cant", "don't know", "dont know",
  "?", "??", "???", "i have no idea", "no", "nope", "clueless", "i'm lost",
  "im lost", "lost", "confused", "i'm confused", "im confused", "i don't get it",
  "i dont get it",
])

function isGivingUp(text) {
  const t = text.trim().toLowerCase().replace(/[!.?…]+$/, '')
  return GIVEUP_PHRASES.has(t) || t.length < 4 && /^[?!]+$/.test(t)
}

// ── Give-up stages ─────────────────────────────────────────────────────────
// 0 = normal  1 = encourage guess  2 = confusion picker  3 = sub-question  4 = hint
const CONFUSION_OPTIONS = [
  { key: 'formula', label: "I can't remember the rule / formula", icon: '📐' },
  { key: 'apply',   label: "I know the concept but can't apply it", icon: '🔧' },
  { key: 'concept', label: "I don't understand the concept at all", icon: '🧠' },
]

export default function Chat() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const sessionId = parseInt(id)
  const buddyAvatar = user?.buddy_avatar || 'robot'
  const buddyName   = user?.buddy_name  || 'Buddy'

  const [session, setSession] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [slowLoading, setSlowLoading] = useState(false)
  const [hintLoading, setHintLoading] = useState(false)
  const [showHintButton, setShowHintButton] = useState(false)
  const [hintTier, setHintTier] = useState(0)
  const [currentLevel, setCurrentLevel] = useState('L1')
  const [showEndModal, setShowEndModal] = useState(false)
  const [ending, setEnding] = useState(false)
  const [xpGained, setXpGained] = useState(null)
  const [levelUpBanner, setLevelUpBanner] = useState(null)
  const [answerFormat, setAnswerFormat] = useState(null)

  // Diagnostic pre-assessment state
  const [diagnosticPhase, setDiagnosticPhase] = useState(false)
  const [diagnosticTurn, setDiagnosticTurn] = useState(0)
  const DIAGNOSTIC_TOTAL = 3

  // Give-up scaffolding
  const [giveUpStage, setGiveUpStage] = useState(0)  // 0-4
  const [subQLoading, setSubQLoading] = useState(false)

  // Canvas (handwriting) mode
  const [canvasMode, setCanvasMode] = useState(false)
  const [canvasExpanded, setCanvasExpanded] = useState(false)
  const canvasRef = useRef(null)

  // Worked example (#30), transcription (#11), break reminder (#12)
  const [workedExample, setWorkedExample] = useState(null)
  const [showWorkedExample, setShowWorkedExample] = useState(false)
  const [transcription, setTranscription] = useState(null)
  const [suggestBreak, setSuggestBreak] = useState(false)

  // Frustration detection (task #41) — 3 consecutive non-confident answers
  const [consecutiveWrong, setConsecutiveWrong] = useState(0)
  const [showFrustrationCard, setShowFrustrationCard] = useState(false)

  const bottomRef = useRef(null)
  const slowTimerRef = useRef(null)

  useEffect(() => {
    const stored = sessionStorage.getItem(`session_${sessionId}`)
    if (!stored) { navigate('/practice'); return }
    const data = JSON.parse(stored)
    setSession(data)
    setCurrentLevel(data.currentLevel)
    setAnswerFormat(data.answerFormat || null)
    setMessages([{ sender: 'buddy', text: data.initialMessage }])
    if (data.diagnostic) {
      setDiagnosticPhase(true)
      setDiagnosticTurn(1)
    }
    if (data.workedExample) {
      setWorkedExample(data.workedExample)
    }
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, showHintButton, giveUpStage])

  useEffect(() => () => clearTimeout(slowTimerRef.current), [])

  function addMessage(sender, text) {
    setMessages((prev) => [...prev, { sender, text }])
  }

  function showXP(amount) {
    setXpGained(amount)
    setTimeout(() => setXpGained(null), 1500)
  }

  function startSlowTimer() {
    clearTimeout(slowTimerRef.current)
    slowTimerRef.current = setTimeout(() => setSlowLoading(true), 8000)
  }

  function clearSlowTimer() {
    clearTimeout(slowTimerRef.current)
    setSlowLoading(false)
  }

  // Reset give-up stage when a new question arrives
  function resetGiveUp() {
    setGiveUpStage(0)
  }

  function handleGiveUp() {
    if (giveUpStage === 0) {
      // Stage 1 — encourage a guess (no API call)
      setGiveUpStage(1)
      addMessage('buddy',
        "🤔 It's okay to feel stuck! Before we get help, give it your best guess — " +
        "even if you think you're wrong. Trying is how you learn! What would you say?"
      )
    } else if (giveUpStage === 1) {
      // Stage 2 — confusion picker (no API call)
      setGiveUpStage(2)
      addMessage('buddy',
        "No worries! Let's figure out exactly where you're stuck so I can help better. " +
        "Which of these matches how you feel?"
      )
    }
    // Stages 3+ are handled by handleConfusionPick / handleHint
  }

  async function handleConfusionPick(key) {
    setGiveUpStage(3)
    setSubQLoading(true)
    addMessage('student', CONFUSION_OPTIONS.find(o => o.key === key)?.label || key)
    addMessage('buddy', null)  // loading bubble
    try {
      const res = await requestSubQuestion(sessionId, key)
      const subQ = res.data.sub_question
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = {
          sender: 'buddy',
          text: `Let's work up to it step by step! 🪜\n\n${subQ}`,
        }
        return next
      })
    } catch {
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = {
          sender: 'buddy',
          text: "Hmm, let me try a different angle. Can you recall any rule or formula related to this topic?",
        }
        return next
      })
    } finally {
      setSubQLoading(false)
      // After sub-question, show the hint button as a next safety net
      setShowHintButton(true)
    }
  }

  async function handleSend() {
    if (loading || subQLoading) return

    // Canvas mode: grab image
    let imageData = null
    let answer = ''

    if (canvasMode) {
      if (!canvasRef.current || canvasRef.current.isEmpty()) return
      imageData = canvasRef.current.getImageData()
      answer = '[handwritten answer]'
    } else {
      if (!input.trim()) return
      answer = input.trim()

      // Give-up detection — if still in early stages, escalate
      if (isGivingUp(answer) && giveUpStage < 2) {
        setInput('')
        addMessage('student', answer)
        handleGiveUp()
        return
      }
    }

    setInput('')
    if (!canvasMode) addMessage('student', answer)
    else addMessage('student', '✏️ [handwritten answer submitted]')

    setShowHintButton(false)
    setLoading(true)
    startSlowTimer()
    addMessage('buddy', null)

    try {
      const res = await submitAnswer(sessionId, answer, imageData)
      const d = res.data

      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { sender: 'buddy', text: d.feedback }
        return next
      })

      setCurrentLevel(d.current_level)
      resetGiveUp()

      // Frustration detection (task #41)
      if (d.confidence_tag === 'confident') {
        setConsecutiveWrong(0)
        setShowFrustrationCard(false)
      } else if (d.confidence_tag !== 'off_topic') {
        const newCount = consecutiveWrong + 1
        setConsecutiveWrong(newCount)
        if (newCount >= 3) setShowFrustrationCard(true)
      }

      // Show handwriting transcription so student can verify (#11)
      if (d.transcription) {
        setTranscription(d.transcription)
        setTimeout(() => setTranscription(null), 8000)
      }

      // Break reminder (#12)
      if (d.suggest_break) {
        setSuggestBreak(true)
      }

      // Clear canvas after successful submission
      if (canvasMode && canvasRef.current) canvasRef.current.clear()

      if (d.session_complete) {
        showXP(`+${d.xp_earned ?? 100} XP`)
        sessionStorage.setItem(`summary_${sessionId}`, JSON.stringify({
          summary: d.summary,
          level: d.current_level,
          levelLabel: d.level_label,
          studentName: session?.studentName,
          topicTitle: session?.topicTitle,
          topicId: session?.topicId,
          questionsAsked: d.turn_number,
          xpEarned: d.xp_earned ?? 100,
          keyConcepts: [],
        }))
        setTimeout(() => navigate(`/summary/${sessionId}`), 2000)
        return
      }

      // Diagnostic pre-assessment handling
      if (d.action === 'diagnostic_next') {
        setDiagnosticTurn(d.diagnostic_turn)
        addMessage('buddy', d.next_question)
        if (d.answer_format) setAnswerFormat(d.answer_format)
        return
      }
      if (d.action === 'diagnostic_done') {
        setDiagnosticPhase(false)
        setDiagnosticTurn(0)
        setLevelUpBanner({ level: d.placement_level, label: d.level_label, isDiag: true })
        setTimeout(() => setLevelUpBanner(null), 3500)
        addMessage('buddy', `${d.feedback}\n\nHere's your first question:\n\n${d.next_question}`)
        if (d.answer_format) setAnswerFormat(d.answer_format)
        return
      }

      if (d.action === 'advance_level') {
        showXP(`+${d.xp_earned ?? 50} XP`)
        setLevelUpBanner({ level: d.current_level, label: d.level_label })
        setTimeout(() => setLevelUpBanner(null), 2500)
        addMessage('buddy', `🚀 You levelled up to **${d.level_label}**! Here's your next challenge:\n\n${d.next_question}`)
        setHintTier(0)
        setShowHintButton(false)
        if (d.answer_format) setAnswerFormat(d.answer_format)
      } else if (d.action === 'level_cap_reset') {
        if (d.concept_explanation) {
          addMessage('buddy', `💡 Let me walk you through this concept again:\n\n${d.concept_explanation}`)
        }
        if (d.next_question) {
          setTimeout(() => {
            addMessage('buddy', d.next_question)
            if (d.answer_format) setAnswerFormat(d.answer_format)
          }, 600)
        }
        setHintTier(0)
        setShowHintButton(false)
      } else if (d.action === 'retry_question' && d.next_question) {
        addMessage('buddy', d.next_question)
        setShowHintButton(false)
      } else if (d.next_question) {
        if (d.xp_earned > 0) showXP(`+${d.xp_earned} XP`)
        addMessage('buddy', d.next_question)
        setHintTier(0)
        setShowHintButton(false)
        if (d.answer_format) setAnswerFormat(d.answer_format)
      }

      if (d.show_hint_button) setShowHintButton(true)

    } catch (err) {
      const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout')
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = {
          sender: 'buddy',
          text: isTimeout
            ? '⏱️ That took too long — please try sending your answer again.'
            : '⚠️ Something went wrong. Please try again.',
        }
        return next
      })
    } finally {
      setLoading(false)
      clearSlowTimer()
    }
  }

  async function handleHint() {
    setHintLoading(true)
    startSlowTimer()
    try {
      const res = await requestHint(sessionId)
      const d = res.data
      setHintTier(d.hint_tier)
      addMessage('buddy', d.hint_message)
      setGiveUpStage(4)  // Beyond sub-question — in hint system now

      if (d.is_concept_reset && d.fresh_question) {
        addMessage('buddy', d.fresh_question)
        setShowHintButton(false)
        setHintTier(0)
        resetGiveUp()
        if (d.answer_format) setAnswerFormat(d.answer_format)
      } else if (d.flagged) {
        setShowHintButton(false)
        setTimeout(() => navigate(`/summary/${sessionId}`), 2000)
      } else {
        setShowHintButton(!d.is_final_hint || d.hint_tier < 5)
      }
    } catch {
      addMessage('buddy', '⚠️ Could not load hint. Please try again.')
    } finally {
      setHintLoading(false)
      clearSlowTimer()
    }
  }

  async function doEndSession() {
    setEnding(true)
    try { await endSession(sessionId) } catch {}
    navigate(`/summary/${sessionId}`)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!session) return null

  const isBlocked = loading || subQLoading

  return (
    <div className="flex flex-col h-screen bg-[#0F0F23]">

      {/* ── End Session Modal ─────────────────────────────────────── */}
      {showEndModal && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4"
          onClick={() => !ending && setShowEndModal(false)}
        >
          <div
            className="blox-card p-6 max-w-sm w-full space-y-5 animate-bounce-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center space-y-2">
              <div className="text-4xl">🏁</div>
              <h3 className="font-fredoka font-bold text-white text-xl">End this session?</h3>
              <p className="text-[#8892B0] text-sm">
                Your progress is saved. You can come back to this topic any time!
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowEndModal(false)}
                disabled={ending}
                className="flex-1 border border-[#2D2B5A] text-[#8892B0] rounded-xl py-2.5 text-sm font-semibold hover:border-[#00A2FF] hover:text-white transition-all disabled:opacity-40"
              >
                💪 Keep Going
              </button>
              <button
                onClick={doEndSession}
                disabled={ending}
                className="flex-1 bg-[#FF3333] text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-[#CC0000] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {ending ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Ending…
                  </>
                ) : 'Yes, End It'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#16213E] border-b border-[#2D2B5A] flex-shrink-0 shadow-card">
        <div className="flex items-center gap-2">
          <span className="font-fredoka font-bold text-white text-lg">Study<span className="text-[#00A2FF]">Blox</span></span>
          <span className="text-xs text-[#8892B0] hidden sm:inline">· {buddyName}</span>
        </div>
        <div className="flex-1 px-4">
          <p className="text-xs text-[#8892B0] text-center truncate">{session.topicTitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <ProgressBadge level={currentLevel} grade={user?.grade} />
          <button
            onClick={() => setShowEndModal(true)}
            className="text-xs px-3 py-1.5 rounded-full font-semibold border border-[#2D2B5A] text-[#8892B0] hover:border-[#FF3333] hover:text-[#FF3333] transition-all"
          >
            End
          </button>
        </div>
      </div>

      {/* XP pop */}
      {xpGained && (
        <div className="absolute top-16 right-4 z-50 font-fredoka font-bold text-[#FFD700] text-lg animate-coin-pop pointer-events-none">
          {xpGained} ⭐
        </div>
      )}

      {/* Diagnostic progress bar */}
      {diagnosticPhase && (
        <div className="bg-[#16213E] border-b border-[#2D2B5A] px-4 py-2 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[#8892B0] font-nunito">🔍 Quick check — finding your level</span>
            <span className="text-xs text-[#00A2FF] font-semibold">{diagnosticTurn} / {DIAGNOSTIC_TOTAL}</span>
          </div>
          <div className="h-1.5 bg-[#2D2B5A] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#00A2FF] to-[#00CC88] rounded-full transition-all duration-500"
              style={{ width: `${(diagnosticTurn / DIAGNOSTIC_TOTAL) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Level-up / placement banner */}
      {levelUpBanner && (
        <div className="fixed inset-x-0 top-16 z-40 flex justify-center px-4 pointer-events-none">
          {levelUpBanner.isDiag ? (
            <div className="bg-gradient-to-r from-[#00CC88] to-[#00A2FF] text-white font-fredoka font-bold text-base px-6 py-3 rounded-2xl shadow-2xl animate-bounce-in flex items-center gap-2">
              🎯 Placed at {levelUpBanner.label}!
            </div>
          ) : (
            <div className={`font-fredoka font-bold text-base px-6 py-3 rounded-2xl shadow-2xl animate-bounce-in flex items-center gap-2 ${
              levelUpBanner.level === 'L5' ? 'bg-gradient-to-r from-[#FFD700] to-[#FF6B00] text-[#0F0F23]' :
              levelUpBanner.level === 'L4' ? 'bg-gradient-to-r from-[#A78BFA] to-[#00A2FF] text-white' :
              'bg-gradient-to-r from-[#FFD700] to-[#FF6B9D] text-[#0F0F23]'
            }`}>
              {levelUpBanner.level === 'L5' ? '👑' : levelUpBanner.level === 'L4' ? '💎' : '🚀'} LEVEL UP! &nbsp;→&nbsp; {levelUpBanner.label}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <ChatBubble key={i} sender={m.sender} message={m.text} isLoading={m.text === null} buddyAvatar={buddyAvatar} />
        ))}

        {/* Slow-loading nudge */}
        {slowLoading && (
          <div className="flex justify-start mb-3">
            <div className="bg-[#1A1A3E] border border-[#2D2B5A] rounded-2xl px-4 py-2 text-xs text-[#8892B0] italic">
              ⏳ Still thinking… Claude is working on it!
            </div>
          </div>
        )}

        {/* ── Give-up stage 2: confusion picker ─────────────────────── */}
        {giveUpStage === 2 && !isBlocked && (
          <div className="flex flex-col gap-2 mb-4 animate-bounce-in">
            {CONFUSION_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => handleConfusionPick(opt.key)}
                className="flex items-center gap-3 bg-[#16213E] border border-[#2D2B5A] hover:border-[#00A2FF] hover:bg-[#00A2FF]/10 text-left rounded-2xl px-4 py-3 text-sm text-white font-nunito transition-all"
              >
                <span className="text-xl">{opt.icon}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        )}

        {showHintButton && (
          <HintButton onHint={handleHint} hintTier={hintTier} isLoading={hintLoading} isFinalHint={hintTier >= 5} />
        )}

        {/* Worked example (#30) — stays in message flow */}
        {workedExample && (
          <div className="mb-3 animate-bounce-in">
            <button
              onClick={() => setShowWorkedExample(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 bg-[#1A1A3E] border border-[#A78BFA]/30 rounded-xl text-xs text-[#A78BFA] font-semibold hover:border-[#A78BFA]/60 transition-all"
            >
              <span>💡 See a worked example first</span>
              <span>{showWorkedExample ? '▲' : '▼'}</span>
            </button>
            {showWorkedExample && (
              <div className="mt-2 px-3 py-2 bg-[#16213E] border border-[#A78BFA]/20 rounded-xl text-xs text-[#8892B0] font-nunito whitespace-pre-line">
                {workedExample}
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Frustration card (task #41) — shown after 3 consecutive wrong answers */}
      {showFrustrationCard && (
        <div className="flex-shrink-0 mx-4 mb-2 animate-bounce-in bg-[#C084FC]/10 border border-[#C084FC]/30 rounded-xl px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="text-2xl flex-shrink-0">💜</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-fredoka font-bold text-[#C084FC]">This one's tough — that's completely okay!</p>
              <p className="text-[10px] text-[#8892B0] mt-0.5 leading-relaxed">
                Struggling is how your brain grows. Take a breath, try a hint, or ask Buddy for help.
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => { setShowFrustrationCard(false); setConsecutiveWrong(0) }}
                  className="text-xs text-[#C084FC] border border-[#C084FC]/40 rounded-lg px-3 py-1 hover:bg-[#C084FC]/10 transition-all font-nunito font-semibold"
                >
                  Keep going 💪
                </button>
                <button
                  onClick={() => { navigate('/practice'); setShowFrustrationCard(false) }}
                  className="text-xs text-[#8892B0] border border-[#2D2B5A] rounded-lg px-3 py-1 hover:text-white transition-all font-nunito"
                >
                  Take a break
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Break reminder (#12) — above input, non-scrolling */}
      {suggestBreak && (
        <div className="flex-shrink-0 mx-4 mb-2 animate-bounce-in bg-[#FFD700]/10 border border-[#FFD700]/30 rounded-xl px-3 py-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-fredoka font-bold text-[#FFD700]">☕ Nice work! Time for a quick stretch?</p>
            <p className="text-[10px] text-[#8892B0]">You've answered a bunch of questions. A short break helps the brain!</p>
          </div>
          <button onClick={() => setSuggestBreak(false)} className="text-[#8892B0] hover:text-white text-lg leading-none flex-shrink-0">×</button>
        </div>
      )}

      {/* Handwriting transcription (#11) — above input, non-scrolling */}
      {transcription && (
        <div className="flex-shrink-0 mx-4 mb-2 animate-bounce-in bg-[#00A2FF]/10 border border-[#00A2FF]/30 rounded-xl px-3 py-2">
          <p className="text-[10px] text-[#00A2FF] font-semibold uppercase tracking-wide mb-0.5">We read your handwriting as:</p>
          <p className="text-xs text-white font-nunito italic">"{transcription}"</p>
          <p className="text-[10px] text-[#8892B0] mt-0.5">If this looks wrong, try typing your answer instead.</p>
        </div>
      )}

      {/* Input area */}
      <div className="flex-shrink-0 bg-[#16213E] border-t border-[#2D2B5A] px-4 py-3">

        {/* Answer format label */}
        {answerFormat && !isBlocked && !canvasMode && (
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-[10px] text-[#2D2B5A] uppercase tracking-widest">Answer type:</span>
            <span className="text-[10px] text-[#00A2FF]/70 font-semibold">
              {answerFormat === 'number'      && '🔢 a number'}
              {answerFormat === 'yes_no'      && '✅ yes or no'}
              {answerFormat === 'rule'        && '📖 state the rule'}
              {answerFormat === 'explanation' && '💬 explain in words'}
              {answerFormat === 'working'     && '📝 show your working'}
            </span>
          </div>
        )}

        {/* Canvas mode: drawing surface + controls */}
        {canvasMode ? (
          <>
            {/* ── Expanded canvas overlay ────────────────────────────────── */}
            {canvasExpanded && (
              <div className="fixed inset-0 z-50 bg-[#0F0F23] flex flex-col">
                {/* Overlay toolbar */}
                <div className="flex items-center justify-between px-4 py-3 bg-[#16213E] border-b border-[#2D2B5A] flex-shrink-0">
                  <span className="text-sm font-fredoka font-bold text-white">✏️ Handwriting</span>
                  <div className="flex gap-2">
                    <button onClick={() => canvasRef.current?.undo()}
                      className="text-xs text-[#8892B0] hover:text-white px-3 py-1.5 rounded-lg border border-[#2D2B5A] hover:border-[#8892B0] transition-all">
                      ↩ Undo
                    </button>
                    <button onClick={() => canvasRef.current?.clear()}
                      className="text-xs text-[#8892B0] hover:text-white px-3 py-1.5 rounded-lg border border-[#2D2B5A] hover:border-[#FF3333] transition-all">
                      🗑 Clear
                    </button>
                    <button onClick={() => setCanvasExpanded(false)}
                      className="text-xs text-[#8892B0] hover:text-white px-3 py-1.5 rounded-lg border border-[#2D2B5A] hover:border-[#00A2FF] transition-all">
                      ⤓ Collapse
                    </button>
                  </div>
                </div>
                {/* Full-height canvas */}
                <div className="flex-1 p-3">
                  <WritingCanvas ref={canvasRef} className="h-full" style={{ height: '100%' }} />
                </div>
                {/* Submit row */}
                <div className="flex flex-col gap-2 px-4 py-3 bg-[#16213E] border-t border-[#2D2B5A] flex-shrink-0">
                  {/* Privacy disclosure (task #37) */}
                  <p className="text-[10px] text-[#4A5568] text-center">
                    ✏️ Handwriting is sent to AI for grading only — not stored after assessment.
                  </p>
                  <div className="flex gap-3">
                  <button onClick={() => { setCanvasMode(false); setCanvasExpanded(false) }}
                    className="flex-1 text-sm text-[#8892B0] border border-[#2D2B5A] rounded-xl py-2.5 hover:border-[#8892B0] hover:text-white transition-all font-nunito">
                    ⌨️ Type instead
                  </button>
                  <button onClick={() => { setCanvasExpanded(false); handleSend() }} disabled={isBlocked}
                    className="flex-1 btn-blox-primary text-sm py-2.5 flex items-center justify-center gap-2 disabled:opacity-50">
                    {isBlocked ? (
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                    ) : '⚡ Submit'}
                  </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Inline (compact) canvas ────────────────────────────────── */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[#8892B0] font-nunito">✏️ Draw your answer</span>
                <div className="flex gap-2">
                  <button onClick={() => canvasRef.current?.undo()}
                    className="text-xs text-[#8892B0] hover:text-white px-2 py-1 rounded-lg border border-[#2D2B5A] hover:border-[#8892B0] transition-all">
                    ↩ Undo
                  </button>
                  <button onClick={() => canvasRef.current?.clear()}
                    className="text-xs text-[#8892B0] hover:text-white px-2 py-1 rounded-lg border border-[#2D2B5A] hover:border-[#FF3333] transition-all">
                    🗑 Clear
                  </button>
                  <button onClick={() => setCanvasExpanded(true)}
                    title="Expand to full screen"
                    className="text-xs text-[#8892B0] hover:text-[#00A2FF] px-2 py-1 rounded-lg border border-[#2D2B5A] hover:border-[#00A2FF] transition-all">
                    ⤢ Expand
                  </button>
                </div>
              </div>
              <WritingCanvas ref={canvasRef} />
              {/* Privacy disclosure (task #37) */}
              <p className="text-[10px] text-[#4A5568] text-center leading-tight">
                ✏️ Handwriting is sent to AI for grading only — not stored after assessment.
              </p>
              <div className="flex gap-2 mt-1">
                <button onClick={() => setCanvasMode(false)}
                  className="flex-1 text-sm text-[#8892B0] border border-[#2D2B5A] rounded-xl py-2.5 hover:border-[#8892B0] hover:text-white transition-all font-nunito">
                  ⌨️ Type instead
                </button>
                <button onClick={handleSend} disabled={isBlocked}
                  className="flex-1 btn-blox-primary text-sm py-2.5 flex items-center justify-center gap-2 disabled:opacity-50">
                  {isBlocked ? (
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : '⚡ Submit'}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Text mode */
          <div className="flex gap-2">
            <button
              onClick={() => setCanvasMode(true)}
              title="Switch to handwriting mode"
              className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl border border-[#2D2B5A] text-[#8892B0] hover:border-[#00A2FF] hover:text-[#00A2FF] transition-all text-lg"
            >
              ✏️
            </button>
            <input
              type="text"
              placeholder="Type your answer here… 💬"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isBlocked}
              className="blox-input flex-1"
            />
            <button
              onClick={handleSend}
              disabled={isBlocked || !input.trim()}
              className="btn-blox-primary px-5 py-2.5 text-sm flex items-center gap-2"
            >
              {isBlocked ? (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              ) : '⚡ Send'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
