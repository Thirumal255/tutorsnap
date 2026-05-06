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

  async function handleSend() {
    if (!input.trim() || loading) return
    const answer = input.trim()
    setInput('')
    addMessage('student', answer)
    setShowHintButton(false)
    setLoading(true)
    addMessage('buddy', null) // loading bubble

    try {
      const res = await submitAnswer(sessionId, answer)
      const d = res.data

      // Replace loading bubble with feedback
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { sender: 'buddy', text: d.feedback }
        return next
      })

      setCurrentLevel(d.current_level)

      if (d.session_complete) {
        // Navigate to summary after 2s
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
        addMessage('buddy', `Great job! Let's try something a bit harder 🎉\n\n${d.next_question}`)
        setHintTier(0)
        setShowHintButton(false)
      } else if (d.action === 'retry_question' && d.next_question) {
        // Off-topic answer — show playful redirect then replay the same question
        addMessage('buddy', d.next_question)
        setShowHintButton(false)
      } else if (d.next_question) {
        addMessage('buddy', d.next_question)
        setHintTier(0)
        setShowHintButton(false)
      }

      if (d.show_hint_button) {
        setShowHintButton(true)
      }
    } catch (e) {
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { sender: 'buddy', text: 'Something went wrong. Please try again.' }
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
    try {
      await endSession(sessionId)
    } catch {
      // best effort
    }
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
    <div className="flex flex-col h-screen bg-green-50">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 shadow-sm flex-shrink-0">
        <span className="font-bold text-green-700 text-sm">TutorSnap</span>
        <span className="text-xs text-gray-500 truncate max-w-[40%] text-center">{session.topicTitle}</span>
        <div className="flex items-center gap-2">
          <ProgressBadge level={currentLevel} />
          <button
            onClick={handleEnd}
            className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
          >
            {confirmEnd ? 'Sure? Click again' : 'End Session'}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <ChatBubble
            key={i}
            sender={m.sender}
            message={m.text}
            isLoading={m.text === null}
          />
        ))}
        {showHintButton && (
          <HintButton
            onHint={handleHint}
            hintTier={hintTier}
            isLoading={hintLoading}
            isFinalHint={hintTier >= 5}
          />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 bg-white border-t border-gray-100 px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Type your answer…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 disabled:bg-gray-50"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {loading ? (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
