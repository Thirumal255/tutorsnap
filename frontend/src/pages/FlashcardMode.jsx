import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getStudentProgress, getFlashcardQuestion, markFlashcard } from '../api/client'

const SUBJECT_EMOJI = {
  Mathematics: '🔢', Science: '🔬', English: '📖', 'Social Studies': '🌍',
  History: '🏛️', Geography: '🗺️', Physics: '⚡', Chemistry: '🧪',
  Biology: '🌿', 'Computer Science': '💻', Tamil: '🔤', Hindi: '🔤', Other: '📚',
}

// Shuffle an array (Fisher-Yates)
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── CHAPTER SELECT ────────────────────────────────────────────────────────────
function ChapterSelect({ onSelect }) {
  const navigate = useNavigate()
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getStudentProgress()
      .then(res => {
        // Only keep books that have at least one completed chapter
        const filtered = res.data
          .map(book => ({
            ...book,
            chapters: book.chapters.filter(ch =>
              ch.total_topics > 0 && ch.attempted === ch.total_topics
            ),
          }))
          .filter(book => book.chapters.length > 0)
        setBooks(filtered)
      })
      .catch(() => setBooks([]))
      .finally(() => setLoading(false))
  }, [])

  const totalChapters = books.reduce((n, b) => n + b.chapters.length, 0)

  return (
    <div className="min-h-screen bg-[#0F0F23] flex flex-col">
      {/* Header */}
      <div className="bg-[#16213E] border-b border-[#2D2B5A] px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-fredoka font-bold text-white text-xl">⚡ Flashcards</h1>
          <p className="text-xs text-[#8892B0]">Pick a completed chapter to review</p>
        </div>
        <button onClick={() => navigate('/practice')} className="text-[#8892B0] hover:text-white text-sm font-nunito">✕ Close</button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full space-y-5">

        {loading && (
          <div className="text-center py-20">
            <div className="text-4xl animate-bounce mb-3">⚡</div>
            <p className="text-[#8892B0]">Loading chapters…</p>
          </div>
        )}

        {!loading && totalChapters === 0 && (
          <div className="blox-card p-10 text-center space-y-4">
            <div className="text-5xl mb-3">📭</div>
            <p className="text-white font-fredoka text-xl">No chapters completed yet</p>
            <p className="text-[#8892B0] text-sm">
              Finish <strong className="text-white">all topics</strong> in a chapter to unlock flashcard review for it.
            </p>
            <button onClick={() => navigate('/practice')} className="btn-blox-primary px-6 py-2.5 text-sm">
              ▶ Go Practice
            </button>
          </div>
        )}

        {!loading && books.map(book => (
          <div key={book.book_id} className="space-y-2">
            {/* Book header */}
            <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold px-1">
              {SUBJECT_EMOJI[book.subject] || '📚'} {book.subject}
            </p>

            {book.chapters.map(ch => (
              <button
                key={ch.id}
                onClick={() => onSelect({ ...ch, subject: book.subject, topics: ch.topics })}
                className="w-full blox-card p-4 text-left hover:border-[#00A2FF]/50 transition-all group"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#00A2FF] to-[#0066CC] flex items-center justify-center text-white font-fredoka font-bold text-sm flex-shrink-0">
                      {ch.chapter_number}
                    </div>
                    <div className="min-w-0">
                      <p className="font-fredoka font-bold text-white text-sm truncate">{ch.title}</p>
                      <p className="text-xs text-[#00CC88] mt-0.5">✅ {ch.total_topics} topics completed</p>
                    </div>
                  </div>
                  <span className="text-[#00A2FF] text-sm flex-shrink-0 group-hover:translate-x-1 transition-transform">▶</span>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── FLASHCARD ─────────────────────────────────────────────────────────────────
function FlashCard({ chapter, onDone }) {
  // Build a shuffled queue cycling through all topics
  const [queue, setQueue] = useState(() => shuffle(chapter.topics.map(t => t.id)))
  const [queueIdx, setQueueIdx] = useState(0)

  const [card, setCard] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState(false)
  const [stats, setStats] = useState({ known: 0, unknown: 0 })
  const [done, setDone] = useState(false)

  // One round = one pass through all topics (min 5 cards)
  const ROUND_SIZE = Math.max(chapter.topics.length, 5)

  async function fetchCard(topicId) {
    setLoading(true)
    setRevealed(false)
    try {
      const res = await getFlashcardQuestion(topicId)
      setCard({ ...res.data, currentTopicId: topicId })
    } catch {
      setCard(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (queue.length > 0) fetchCard(queue[0])
  }, [])

  async function handleMark(known) {
    if (marking || !card) return
    setMarking(true)
    try {
      await markFlashcard(card.currentTopicId, known)
      const next = { ...stats, [known ? 'known' : 'unknown']: stats[known ? 'known' : 'unknown'] + 1 }
      setStats(next)
      const total = next.known + next.unknown
      if (total >= ROUND_SIZE) {
        setDone(true)
      } else {
        // Advance in the queue; reshuffle and loop if needed
        const nextIdx = queueIdx + 1
        let nextTopicId
        if (nextIdx < queue.length) {
          nextTopicId = queue[nextIdx]
          setQueueIdx(nextIdx)
        } else {
          // Reshuffle for next loop
          const newQueue = shuffle(chapter.topics.map(t => t.id))
          setQueue(newQueue)
          setQueueIdx(0)
          nextTopicId = newQueue[0]
        }
        fetchCard(nextTopicId)
      }
    } finally {
      setMarking(false)
    }
  }

  function handlePlayAgain() {
    const newQueue = shuffle(chapter.topics.map(t => t.id))
    setQueue(newQueue)
    setQueueIdx(0)
    setStats({ known: 0, unknown: 0 })
    setDone(false)
    fetchCard(newQueue[0])
  }

  const total = stats.known + stats.unknown
  const topicTitle = chapter.topics.find(t => t.id === card?.currentTopicId)?.title || ''

  if (done) {
    const pct = Math.round((stats.known / ROUND_SIZE) * 100)
    return (
      <div className="min-h-screen bg-[#0F0F23] flex items-center justify-center p-6">
        <div className="w-full max-w-md blox-card p-8 text-center space-y-5">
          <div className="text-6xl">
            {pct >= 80 ? '🌟' : pct >= 50 ? '👍' : '💪'}
          </div>
          <h2 className="text-2xl font-fredoka font-bold text-white">Round Complete!</h2>
          <p className="text-[#8892B0] text-sm">{chapter.title}</p>
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
            <button onClick={handlePlayAgain}
              className="flex-1 py-3 rounded-xl bg-[#1A1A3E] border border-[#2D2B5A] text-[#8892B0] hover:text-white font-nunito font-semibold text-sm transition-all">
              🔄 Again
            </button>
            <button onClick={onDone} className="flex-1 btn-blox-primary py-3">
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
          <span className="font-fredoka font-bold text-white">⚡ {chapter.title}</span>
          <p className="text-xs text-[#8892B0]">Card {total + 1} of {ROUND_SIZE}</p>
        </div>
        <button onClick={onDone} className="text-[#8892B0] hover:text-white text-sm">✕</button>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-[#2D2B5A]">
        <div className="h-full bg-[#00A2FF] transition-all" style={{ width: `${(total / ROUND_SIZE) * 100}%` }} />
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
              {/* Topic label */}
              {topicTitle && (
                <p className="text-xs text-[#8892B0] text-center uppercase tracking-widest">{topicTitle}</p>
              )}

              {/* Card */}
              <div
                className="blox-card p-8 min-h-[200px] flex flex-col gap-6 cursor-pointer select-none"
                onClick={() => !revealed && setRevealed(true)}
              >
                <div>
                  <p className="text-xs font-semibold text-[#8892B0] uppercase tracking-wide mb-2">Question</p>
                  <p className="text-white font-nunito text-lg leading-relaxed">{card.question}</p>
                </div>

                {!revealed && (
                  <div className="text-center text-[#4A5568] text-sm font-nunito pt-2">
                    👆 Tap to reveal key points
                  </div>
                )}

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
              {revealed ? (
                <div className="grid grid-cols-2 gap-4">
                  <button onClick={() => handleMark(false)} disabled={marking}
                    className="py-4 rounded-xl bg-[#FF6B6B]/20 border border-[#FF6B6B]/30 text-[#FF6B6B] font-fredoka font-bold text-base hover:bg-[#FF6B6B]/30 transition-all disabled:opacity-50">
                    😅 Need practice
                  </button>
                  <button onClick={() => handleMark(true)} disabled={marking}
                    className="py-4 rounded-xl bg-[#00CC88]/20 border border-[#00CC88]/30 text-[#00CC88] font-fredoka font-bold text-base hover:bg-[#00CC88]/30 transition-all disabled:opacity-50">
                    ✅ Know it!
                  </button>
                </div>
              ) : (
                <button onClick={() => setRevealed(true)} className="w-full btn-blox-primary py-4">
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
  const location = useLocation()
  const navigate = useNavigate()
  const [selectedChapter, setSelectedChapter] = useState(null)

  // #57: If launched from review queue with pre-selected topics, skip chapter select
  const reviewTopics = location.state?.reviewTopics  // [{ id, title }, ...]
  useEffect(() => {
    if (reviewTopics && reviewTopics.length > 0 && !selectedChapter) {
      // Build a synthetic chapter object from the review topic list
      setSelectedChapter({
        id: 'review',
        chapter_number: '🔁',
        title: 'Review Queue',
        subject: 'Review',
        topics: reviewTopics.map(t => ({ id: t.id, title: t.title })),
      })
    }
  }, []) // eslint-disable-line

  if (!selectedChapter) {
    return <ChapterSelect onSelect={setSelectedChapter} />
  }

  return (
    <FlashCard
      chapter={selectedChapter}
      onDone={() => {
        // If launched from review queue, go back to home; otherwise back to chapter select
        if (reviewTopics) navigate('/')
        else setSelectedChapter(null)
      }}
    />
  )
}
