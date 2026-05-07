import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { submitAnswer, requestHint, endSession } from '../api/client'
import ChatBubble from '../components/ChatBubble'
import HintButton from '../components/HintButton'
import ProgressBadge from '../components/ProgressBadge'

export default function Chat() {
  const { id } = useParams()
  const navigate = useNavigate()
  const sessionId = parseInt(id)

  const [session, setSession] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [hintLoading, setHintLoading] = useState(false)
  const [showHintButton, setShowHintButton] = useState(false)
  const [hintTier, setHintTier] = useState(0)
  const [currentLevel, setCurrentLevel] = useState('L1')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [xpGained, setXpGained] = useState(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    const stored = sessionStorage.getItem(`session_${sessionId}`)
    if (!stored) { navigate('/'); return }
    const data = JSON.parse(stored)
    setSession(data)
    setCurrentLevel(data.currentLevel)
    setMessages([{ sender: 'buddy', text: data.initialMessage }])
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, showHintButton])

  function addMessage(sender, text) {
    setMessages((prev) => [...prev, { sender, text }])
  }

  function showXP(amount) {
    setXpGained(amount)
    setTimeout(() => setXpGained(null), 1500)
  }

  async function handleSend() {
    if (!input.trim() || loading) return
    const answer = input.trim()
    setInput('')
    addMessage('student', answer)
    setShowHintButton(false)
    setLoading(true)
    addMessage('buddy', null)

    try {
      const res = await submitAnswer(sessionId, answer)
      const d = res.data

      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { sender: 'buddy', text: d.feedback }
        return next
      })

      setCurrentLevel(d.current_level)

      if (d.session_complete) {
        showXP('+100 XP')
        sessionStorage.setItem(`summary_${sessionId}`, JSON.stringify({
          summary: d.summary,
          level: d.current_level,
          levelLabel: d.level_label,
          studentName: session?.studentName,
          topicTitle: session?.topicTitle,
          topicId: session?.topicId,
          questionsAsked: d.turn_number,
          keyConcepts: [],
        }))
        setTimeout(() => navigate(`/summary/${sessionId}`), 2000)
        return
      }

      if (d.action === 'advance_level') {
        showXP('+50 XP')
        addMessage('buddy', `🎉 Level Up! Let's try something harder!\n\n${d.next_question}`)
        setHintTier(0)
        setShowHintButton(false)
      } else if (d.action === 'retry_question' && d.next_question) {
        addMessage('buddy', d.next_question)
        setShowHintButton(false)
      } else if (d.next_question) {
        showXP('+10 XP')
        addMessage('buddy', d.next_question)
        setHintTier(0)
        setShowHintButton(false)
      }

      if (d.show_hint_button) setShowHintButton(true)

    } catch {
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { sender: 'buddy', text: '⚠️ Something went wrong. Please try again.' }
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleHint() {
    setHintLoading(true)
    try {
      const res = await requestHint(sessionId)
      const d = res.data
      setHintTier(d.hint_tier)
      addMessage('buddy', d.hint_message)

      if (d.is_concept_reset && d.fresh_question) {
        addMessage('buddy', d.fresh_question)
        setShowHintButton(false)
        setHintTier(0)
      } else if (d.flagged) {
        setShowHintButton(false)
        setTimeout(() => navigate(`/summary/${sessionId}`), 2000)
      } else {
        setShowHintButton(!d.is_final_hint || d.hint_tier < 5)
      }
    } catch {
      addMessage('buddy', 'Could not load hint. Please try again.')
    } finally {
      setHintLoading(false)
    }
  }

  async function handleEnd() {
    if (!confirmEnd) { setConfirmEnd(true); return }
    setConfirmEnd(false)
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

  return (
    <div className="flex flex-col h-screen bg-[#0F0F23]">

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#16213E] border-b border-[#2D2B5A] flex-shrink-0 shadow-card">
        <div className="flex items-center gap-2">
          <span className="font-fredoka font-bold text-white text-lg">Study<span className="text-[#00A2FF]">Blox</span></span>
        </div>
        <div className="flex-1 px-4">
          <p className="text-xs text-[#8892B0] text-center truncate">{session.topicTitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <ProgressBadge level={currentLevel} />
          <button
            onClick={handleEnd}
            className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-all ${
              confirmEnd
                ? 'bg-[#FF3333] text-white shadow-glow-red'
                : 'border border-[#2D2B5A] text-[#8892B0] hover:border-[#FF3333] hover:text-[#FF3333]'
            }`}
          >
            {confirmEnd ? 'Sure? ✓' : 'End'}
          </button>
        </div>
      </div>

      {/* XP pop */}
      {xpGained && (
        <div className="absolute top-16 right-4 z-50 font-fredoka font-bold text-[#FFD700] text-lg animate-coin-pop pointer-events-none">
          {xpGained} ⭐
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <ChatBubble key={i} sender={m.sender} message={m.text} isLoading={m.text === null} />
        ))}
        {showHintButton && (
          <HintButton onHint={handleHint} hintTier={hintTier} isLoading={hintLoading} isFinalHint={hintTier >= 5} />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 bg-[#16213E] border-t border-[#2D2B5A] px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Type your answer here… 💬"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            className="blox-input flex-1"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="btn-blox-primary px-5 py-2.5 text-sm flex items-center gap-2"
          >
            {loading ? (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : '⚡ Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
