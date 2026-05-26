import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { teachChat } from '../../api/client'

const MAX_TURNS = 3

const BUDDY_EMOJI = {
  robot: '🤖', fox: '🦊', panda: '🐼', lion: '🦁',
  dolphin: '🐬', owl: '🦉', dragon: '🐉', wizard: '🧙',
}

function ScoreRing({ score }) {
  const color = score >= 80 ? '#00CC88' : score >= 60 ? '#FFD700' : '#FF6B6B'
  const r = 28, circ = 2 * Math.PI * r
  const dash = (score / 100) * circ
  return (
    <div className="relative w-20 h-20 flex-shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#2D2B5A" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-fredoka font-bold" style={{ color }}>{score}</span>
        <span className="text-[9px] text-[#8892B0]">/ 100</span>
      </div>
    </div>
  )
}

export default function TeachBack() {
  const { topicId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [topicTitle, setTopicTitle]   = useState('')
  const [messages, setMessages]       = useState([])   // [{role, content}]
  const [input, setInput]             = useState('')
  const [studentTurns, setStudentTurns] = useState(0)
  const [loading, setLoading]         = useState(false)
  const [result, setResult]           = useState(null) // assessment data when done
  const [phase, setPhase]             = useState('intro') // intro | chat | done

  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  const buddyAvatar = BUDDY_EMOJI[user?.buddy_avatar] || '🤖'
  const buddyName   = user?.buddy_name || 'Buddy'

  // Fetch topic title from URL state or localStorage fallback
  useEffect(() => {
    const stored = sessionStorage.getItem(`teach_topic_${topicId}`)
    if (stored) setTopicTitle(stored)
  }, [topicId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function startSession() {
    const opening = {
      role: 'assistant',
      content: `Hey! I'm ${buddyName} and I'm supposed to learn about **${topicTitle || 'this topic'}** — but I don't know anything about it yet! 😅\n\nCan you explain it to me like I've never heard of it? Take your time — I'll ask you questions as we go. 🎓`,
    }
    setMessages([opening])
    setPhase('chat')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    const newTurn = studentTurns + 1
    const updatedMessages = [...messages, { role: 'user', content: text }]
    setMessages(updatedMessages)
    setInput('')
    setStudentTurns(newTurn)
    setLoading(true)

    try {
      const res = await teachChat(topicId, updatedMessages, newTurn)
      const data = res.data

      if (data.is_done) {
        // Assessment result returned
        setResult(data)
        setPhase('done')
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
        // If this was the last student turn, next send triggers assessment
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Oops, something went wrong. Try sending again! 😅",
      }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const turnsRemaining = MAX_TURNS - studentTurns

  // ── Intro screen ─────────────────────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <div className="min-h-screen bg-[#0F0F23] flex flex-col items-center justify-center px-6 py-10 text-center gap-6">
        <div className="text-6xl animate-bounce">{buddyAvatar}</div>
        <div className="space-y-2">
          <h1 className="text-2xl font-fredoka font-bold text-white">Teach-it-Back</h1>
          <p className="text-[#8892B0] text-sm font-nunito max-w-xs">
            Explain <span className="text-white font-semibold">{topicTitle || 'this topic'}</span> to {buddyName} in your own words.
            {buddyName} will ask follow-up questions, then score your understanding.
          </p>
        </div>

        <div className="bg-[#16213E] rounded-2xl p-4 border border-[#2D2B5A] w-full max-w-sm text-left space-y-3">
          {[
            { icon: '🎤', text: `You explain the topic to ${buddyName} (3 turns)` },
            { icon: '🔍', text: `${buddyName} asks follow-up questions` },
            { icon: '🏆', text: 'Get a score + XP for your explanation' },
          ].map(({ icon, text }) => (
            <div key={text} className="flex items-center gap-3">
              <span className="text-xl w-8 text-center flex-shrink-0">{icon}</span>
              <p className="text-sm text-[#CCD6F6] font-nunito">{text}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-3 w-full max-w-sm">
          <button
            onClick={() => navigate(-1)}
            className="flex-1 py-3 rounded-2xl border border-[#2D2B5A] text-[#8892B0] font-nunito font-semibold text-sm hover:text-white transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={startSession}
            className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-[#6C63FF] to-[#00A2FF] text-white font-fredoka font-bold text-base hover:opacity-90 transition-opacity"
          >
            Start Teaching! 🎓
          </button>
        </div>
      </div>
    )
  }

  // ── Done / Result screen ──────────────────────────────────────────────────
  if (phase === 'done' && result) {
    const { score, summary, gaps, xp_earned } = result
    const grade = score >= 80 ? 'Excellent!' : score >= 60 ? 'Good effort!' : 'Keep practising!'
    const gradeColor = score >= 80 ? 'text-[#00CC88]' : score >= 60 ? 'text-[#FFD700]' : 'text-[#FF6B6B]'

    return (
      <div className="min-h-screen bg-[#0F0F23] flex flex-col items-center justify-center px-6 py-10 gap-6">
        {/* Score card */}
        <div className="w-full max-w-sm bg-[#16213E] rounded-2xl border border-[#2D2B5A] p-5 space-y-4">
          <div className="flex items-center gap-4">
            <ScoreRing score={score} />
            <div>
              <p className={`text-xl font-fredoka font-bold ${gradeColor}`}>{grade}</p>
              <p className="text-xs text-[#8892B0] font-nunito mt-0.5">+{xp_earned} XP earned ⭐</p>
            </div>
          </div>

          {/* Buddy summary */}
          <div className="bg-[#0F0F23] rounded-xl p-3 border border-[#2D2B5A] flex items-start gap-2">
            <span className="text-xl flex-shrink-0">{buddyAvatar}</span>
            <p className="text-xs text-[#CCD6F6] font-nunito leading-relaxed">{summary}</p>
          </div>

          {/* Gaps */}
          {gaps && gaps.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-[#FFB347] font-semibold uppercase tracking-wide">🔍 To improve, cover:</p>
              <ul className="space-y-1.5">
                {gaps.map((g, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#CCD6F6] font-nunito">
                    <span className="text-[#FF6B6B] flex-shrink-0 mt-0.5">✗</span>
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {gaps && gaps.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-[#00CC88] font-nunito">
              <span>✅</span> You covered all the key ideas!
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 w-full max-w-sm">
          <button
            onClick={() => navigate(-1)}
            className="flex-1 py-3 rounded-2xl border border-[#2D2B5A] text-[#8892B0] font-nunito font-semibold text-sm hover:text-white transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={() => { setPhase('intro'); setMessages([]); setStudentTurns(0); setResult(null) }}
            className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-[#6C63FF] to-[#00A2FF] text-white font-fredoka font-bold text-sm hover:opacity-90 transition-opacity"
          >
            Try Again 🔄
          </button>
        </div>
      </div>
    )
  }

  // ── Chat screen ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0F0F23] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2D2B5A] bg-[#0F0F23] sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="text-[#8892B0] hover:text-white text-lg leading-none">←</button>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#6C63FF] to-[#00A2FF] flex items-center justify-center text-base flex-shrink-0">
          {buddyAvatar}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-fredoka font-bold text-white truncate">Teaching: {topicTitle}</p>
          <p className="text-[10px] text-[#8892B0]">
            {turnsRemaining > 0
              ? `${studentTurns} / ${MAX_TURNS} turns · ${turnsRemaining} left`
              : 'Final turn — send your last answer!'}
          </p>
        </div>
        {/* Turn progress dots */}
        <div className="flex gap-1 flex-shrink-0">
          {Array.from({ length: MAX_TURNS }).map((_, i) => (
            <div key={i} className={`w-2 h-2 rounded-full transition-colors ${
              i < studentTurns ? 'bg-[#6C63FF]' : 'bg-[#2D2B5A]'
            }`} />
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            {m.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#6C63FF] to-[#00A2FF] flex items-center justify-center text-base flex-shrink-0 mt-1">
                {buddyAvatar}
              </div>
            )}
            <div className={`max-w-[80%] rounded-2xl px-3 py-2.5 ${
              m.role === 'user'
                ? 'bg-[#6C63FF] text-white rounded-tr-sm'
                : 'bg-[#16213E] text-[#CCD6F6] border border-[#2D2B5A] rounded-tl-sm'
            }`}>
              <p className="text-sm font-nunito leading-relaxed whitespace-pre-wrap">{m.content.replace(/\*\*(.*?)\*\*/g, '$1')}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#6C63FF] to-[#00A2FF] flex items-center justify-center text-base flex-shrink-0">
              {buddyAvatar}
            </div>
            <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1 items-center h-4">
                <span className="w-1.5 h-1.5 bg-[#6C63FF] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-[#6C63FF] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-[#6C63FF] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-6 pt-2 border-t border-[#2D2B5A] bg-[#0F0F23]">
        {studentTurns >= MAX_TURNS && !loading ? (
          <button
            onClick={handleSend}
            disabled={loading}
            className="w-full py-3 rounded-2xl bg-gradient-to-r from-[#6C63FF] to-[#00A2FF] text-white font-fredoka font-bold text-base disabled:opacity-50"
          >
            {loading ? 'Evaluating…' : 'Get my score! 🏆'}
          </button>
        ) : (
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={studentTurns === 0 ? "Start explaining the topic…" : "Continue your explanation…"}
              rows={3}
              disabled={loading}
              className="flex-1 bg-[#16213E] border border-[#2D2B5A] rounded-2xl px-3 py-2.5 text-sm text-white placeholder-[#8892B0] focus:outline-none focus:border-[#6C63FF]/60 resize-none font-nunito disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="w-10 h-10 rounded-xl bg-[#6C63FF] flex items-center justify-center text-white disabled:opacity-40 hover:bg-[#5B52EE] transition-colors flex-shrink-0"
            >
              ↑
            </button>
          </div>
        )}
        <p className="text-center text-[10px] text-[#8892B0] mt-2">
          {studentTurns < MAX_TURNS
            ? `Turn ${studentTurns + 1} of ${MAX_TURNS} — explain as much as you can`
            : 'You have completed all turns — tap to get your score!'}
        </p>
      </div>
    </div>
  )
}
