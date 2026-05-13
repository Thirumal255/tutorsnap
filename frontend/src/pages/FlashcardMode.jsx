import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getStudentProgress, getFlashcardQuestion, markFlashcard } from '../api/client'

const SUBJECT_EMOJI = {
  Mathematics: '🔢', Science: '🔬', English: '📖', 'Social Studies': '🌍',
  History: '🏛️', Geography: '🗺️', Physics: '⚡', Chemistry: '🧪',
  Biology: '🌿', 'Computer Science': '💻', Tamil: '🔤', Hindi: '🔤', Other: '📚',
}

const MASTERY_LABEL = {
  L1: 'Learning', L2: 'Developing', L3: 'Practising', L4: 'Going Deeper', L5: 'Challenge',
}
const MASTERY_COLOR = {
  L1: 'text-[#FFB347]', L2: 'text-[#00A2FF]', L3: 'text-[#00CC88]',
  L4: 'text-[#C084FC]', L5: 'text-[#FBBF24]',
}

// ── TOPIC SELECT ──────────────────────────────────────────────────────────────
function TopicSelect({ onSelect }) {
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // 'all' | 'due' | subject

  useEffect(() => {
    getStudentProgress()
      .then(res => {
        const ts = (res.data.topics || []).filter(t => t.mastery_level)
        setTopics(ts)
      })
      .catch(() => setTopics([]))
      .finally(() => setLoading(false))
  }, [])

  const now = new Date()
  const subjects = [...new Set(topics.map(t => t.subject).filter(Boolean))]

  const visible = topics.filter(t => {
    if (filter === 'due') return t.next_review_at && new Date(t.next_review_at) <= now
    if (filter !== 'all') return t.subject === filter
    return true
  })

  return (
    <div className="min-h-screen bg-[#0F0F23] flex flex-col">
      {/* Header */}
      <div className="bg-[#16213E] border-b border-[#2D2B5A] px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-fredoka font-bold text-white text-xl">⚡ Flashcards</h1>
          <p className="text-xs text-[#8892B0]">Pick a topic to review</p>
        </div>
        <a href="/practice" className="text-[#8892B0] hover:text-white text-sm font-nunito">✕ Close</a>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full space-y-5">
        {loading && (
          <div className="text-center py-20">
            <div className="text-4xl animate-bounce mb-3">⚡</div>
            <p className="text-[#8892B0]">Loading topics…</p>
          </div>
        )}

        {!loading && topics.length === 0 && (
          <div className="blox-card p-10 text-center">
            <div className="text-5xl mb-3">📭</div>
            <p className="text-white font-fredoka text-xl">No topics practised yet</p>
            <p className="text-[#8892B0] text-sm mt-1">Complete some sessions first, then use flashcards to review!</p>
          </div>
        )}

        {!loading && topics.length > 0 && (
          <>
            {/* Filter tabs */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 rounded-full text-xs font-nunito font-semibold transition-all ${
                  filter === 'all' ? 'bg-[#00A2FF] text-white' : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
                }`}
              >
                All ({topics.length})
              </button>
              <button
                onClick={() => setFilter('due')}
                className={`px-3 py-1.5 rounded-full text-xs font-nunito font-semibold transition-all ${
                  filter === 'due' ? 'bg-[#FF6B9D] text-white' : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
                }`}
              >
                🔁 Due ({topics.filter(t => t.next_review_at && new Date(t.next_review_at) <= now).length})
              </button>
              {subjects.map(s => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-nunito font-semibold transition-all ${
                    filter === s ? 'bg-[#00A2FF] text-white' : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
                  }`}
                >
                  {SUBJECT_EMOJI[s] || '📚'} {s}
                </button>
              ))}
            </div>

            {/* Topic list */}
            <div className="space-y-2">
              {visible.length === 0 && (
                <div className="blox-card p-6 text-center">
                  <p className="text-[#8892B0] text-sm">No topics match this filter.</p>
                </div>
              )}
              {visible.map(t => {
                const due = t.next_review_at && new Date(t.next_review_at) <= now
                return (
                  <button
                    key={t.topic_id}
                    onClick={() => onSelect(t)}
                    className="w-full blox-card p-4 text-left hover:border-[#00A2FF]/50 transition-all blox-hover"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl">{SUBJECT_EMOJI[t.subject] || '📚'}</span>
                        <div className="min-w-0">
                          <p className="font-fredoka font-bold text-white text-sm truncate">{t.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-xs font-nunito font-semibold ${MASTERY_COLOR[t.mastery_level] || 'text-[#8892B0]'}`}>
                              {MASTERY_LABEL[t.mastery_level] || t.mastery_level}
                            </span>
                            {due && (
                              <span className="text-xs bg-[#FF6B9D]/20 text-[#FF6B9D] px-1.5 py-0.5 rounded-full">
                                🔁 Due
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className="text-[#00A2FF] text-sm flex-shrink-0">▶</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── FLASHCARD ─────────────────────────────────────────────────────────────────
function FlashCard({ topic, onDone }) {
  const [card, setCard] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState(false)
  const [stats, setStats] = useState({ known: 0, unknown: 0 })
  const [done, setDone] = useState(false)

  const MAX_CARDS = 10

  async function fetchCard() {
    setLoading(true)
    setRevealed(false)
    try {
      const res = await getFlashcardQuestion(topic.topic_id)
      setCard(res.data)
    } catch {
      setCard(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchCard() }, [topic])

  async function handleMark(known) {
    if (marking) return
    setMarking(true)
    try {
      await markFlashcard(topic.topic_id, known)
      const next = { ...stats }
      if (known) next.known++ ; else next.unknown++
      setStats(next)
      const total = next.known + next.unknown
      if (total >= MAX_CARDS) {
        setDone(true)
      } else {
        fetchCard()
      }
    } finally {
      setMarking(false)
    }
  }

  const total = stats.known + stats.unknown

  if (done) {
    return (
      <div className="min-h-screen bg-[#0F0F23] flex items-center justify-center p-6">
        <div className="w-full max-w-md blox-card p-8 text-center space-y-5">
          <div className="text-6xl">
            {stats.known >= Math.round(MAX_CARDS * 0.8) ? '🌟' : stats.known >= MAX_CARDS / 2 ? '👍' : '💪'}
          </div>
          <h2 className="text-2xl font-fredoka font-bold text-white">Round Complete!</h2>
          <p className="text-[#8892B0]">{topic.title}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#00CC88]/10 rounded-xl p-4">
              <p className="text-2xl font-fredoka font-bold text-[#00CC88]">{stats.known}</p>
              <p className="text-xs text-[#8892B0]">Know it ✓</p>
            </div>
            <div className="bg-[#FF6B6B]/10 rounded-xl p-4">
              <p className="text-2xl font-fredoka font-bold text-[#FF6B6B]">{stats.unknown}</p>
              <p className="text-xs text-[#8892B0]">Need practice</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => { setStats({ known: 0, unknown: 0 }); setDone(false); fetchCard() }}
              className="flex-1 py-3 rounded-xl bg-[#1A1A3E] border border-[#2D2B5A] text-[#8892B0] hover:text-white font-nunito font-semibold text-sm transition-all"
            >
              🔄 Again
            </button>
            <button
              onClick={onDone}
              className="flex-1 btn-blox-primary py-3"
            >
              Done
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
          <span className="font-fredoka font-bold text-white">⚡ {topic.title}</span>
          <p className="text-xs text-[#8892B0]">Card {total + 1} of {MAX_CARDS}</p>
        </div>
        <button onClick={onDone} className="text-[#8892B0] hover:text-white text-sm">✕</button>
      </div>

      {/* Progress */}
      <div className="h-1 bg-[#2D2B5A]">
        <div className="h-full bg-[#00A2FF] transition-all" style={{ width: `${(total / MAX_CARDS) * 100}%` }} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-6">

          {loading && (
            <div className="text-center py-10">
              <div className="text-4xl animate-bounce mb-3">⚡</div>
              <p className="text-[#8892B0]">Loading card…</p>
            </div>
          )}

          {!loading && card && (
            <>
              {/* Card */}
              <div
                className="blox-card p-8 min-h-[200px] flex flex-col gap-6 cursor-pointer select-none"
                onClick={() => !revealed && setRevealed(true)}
              >
                {/* Question */}
                <div>
                  <p className="text-xs font-semibold text-[#8892B0] uppercase tracking-wide mb-2">Question</p>
                  <p className="text-white font-nunito text-lg leading-relaxed">{card.question}</p>
                </div>

                {!revealed && (
                  <div className="text-center text-[#4A5568] text-sm font-nunito pt-2">
                    👆 Tap to reveal key points
                  </div>
                )}

                {/* Key concepts */}
                {revealed && card.key_concepts && (
                  <div className="border-t border-[#2D2B5A] pt-4">
                    <p className="text-xs font-semibold text-[#00CC88] uppercase tracking-wide mb-2">Key Points</p>
                    <ul className="space-y-1.5">
                      {card.key_concepts.map((kc, i) => (
                        <li key={i} className="text-[#8892B0] font-nunito text-sm flex items-start gap-2">
                          <span className="text-[#00CC88] mt-0.5">•</span>
                          <span>{kc}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Mark buttons */}
              {revealed && (
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => handleMark(false)}
                    disabled={marking}
                    className="py-4 rounded-xl bg-[#FF6B6B]/20 border border-[#FF6B6B]/30 text-[#FF6B6B] font-fredoka font-bold text-base hover:bg-[#FF6B6B]/30 transition-all disabled:opacity-50"
                  >
                    😅 Need practice
                  </button>
                  <button
                    onClick={() => handleMark(true)}
                    disabled={marking}
                    className="py-4 rounded-xl bg-[#00CC88]/20 border border-[#00CC88]/30 text-[#00CC88] font-fredoka font-bold text-base hover:bg-[#00CC88]/30 transition-all disabled:opacity-50"
                  >
                    ✅ Know it!
                  </button>
                </div>
              )}

              {!revealed && (
                <button
                  onClick={() => setRevealed(true)}
                  className="w-full btn-blox-primary py-4"
                >
                  Reveal Key Points
                </button>
              )}

              {/* Mini stats */}
              <div className="flex justify-center gap-6 text-sm font-nunito">
                <span className="text-[#00CC88]">✓ {stats.known} known</span>
                <span className="text-[#4A5568]">·</span>
                <span className="text-[#FF6B6B]">✗ {stats.unknown} to practice</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function FlashcardMode() {
  const navigate = useNavigate()
  const location = useLocation()
  const [selectedTopic, setSelectedTopic] = useState(location.state?.topic || null)

  if (!selectedTopic) {
    return <TopicSelect onSelect={setSelectedTopic} />
  }

  return (
    <FlashCard
      topic={selectedTopic}
      onDone={() => setSelectedTopic(null)}
    />
  )
}
