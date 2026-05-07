import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getBooks, getTopics, startSession } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import ProgressBadge from '../components/ProgressBadge'

export default function TopicSelect() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()

  const [book, setBook] = useState(null)
  const [chapters, setChapters] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await getBooks()
        const done = res.data.find((b) => b.status === 'done')
        if (!done) { setLoading(false); return }
        setBook(done)
        const topicsRes = await getTopics(done.book_id)
        setChapters(topicsRes.data.chapters)
        const exp = {}
        topicsRes.data.chapters.forEach((ch) => { exp[ch.id] = false })
        setExpanded(exp)
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    if (location.state?.topicId && chapters.length) {
      const ch = chapters.find((c) => c.topics.some((t) => t.id === location.state.topicId))
      if (ch) setExpanded((prev) => ({ ...prev, [ch.id]: true }))
    }
  }, [location.state, chapters])

  function toggle(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  async function handleStart(topicId, topicTitle, chapterTitle) {
    setStarting(topicId)
    try {
      const res = await startSession(user.name, topicId)
      const d = res.data
      sessionStorage.setItem(
        `session_${d.session_id}`,
        JSON.stringify({
          sessionId: d.session_id, studentName: d.student_name,
          topicTitle: d.topic_title, chapterTitle: d.chapter_title,
          initialMessage: d.message, currentLevel: d.current_level,
          levelLabel: d.level_label, topicId,
        })
      )
      navigate(`/session/${d.session_id}`)
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to start session')
    } finally {
      setStarting(null)
    }
  }

  if (user?.grade === null || user?.grade === undefined) {
    return (
      <div className="min-h-screen bg-[#0F0F23] flex items-center justify-center px-4">
        <div className="blox-card p-8 max-w-sm w-full text-center animate-bounce-in">
          <div className="text-5xl mb-4">⏳</div>
          <h2 className="text-xl font-fredoka font-bold text-white mb-2">Almost ready, {user?.name}!</h2>
          <p className="text-[#8892B0] text-sm">
            Your grade hasn't been set yet. Ask your admin to set it up.
          </p>
          <button onClick={logout}
            className="mt-6 text-xs text-[#8892B0] hover:text-white transition-colors">
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0F0F23] py-8 px-4">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-fredoka font-bold text-white">
              Study<span className="text-[#00A2FF]">Blox</span> <span className="text-2xl">🎮</span>
            </h1>
            <p className="text-[#8892B0] text-sm mt-1">
              Hey <span className="text-[#FFD700] font-semibold">{user?.name}</span>! Pick a topic to battle! ⚔️
            </p>
          </div>
          <button onClick={logout}
            className="text-xs text-[#8892B0] hover:text-white border border-[#2D2B5A] hover:border-[#00A2FF] rounded-full px-4 py-2 transition-all">
            Sign out
          </button>
        </div>

        {/* Player card */}
        <div className="blox-card-glow p-4 mb-6 flex items-center gap-4 animate-bounce-in">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FF6B9D] to-[#FF3333] flex items-center justify-center text-2xl flex-shrink-0">
            🎮
          </div>
          <div className="flex-1">
            <p className="font-fredoka font-bold text-white">{user?.name}</p>
            <p className="text-[#8892B0] text-xs">Grade {user?.grade} · Ready to level up!</p>
          </div>
          <div className="text-right">
            <p className="text-[#FFD700] font-fredoka font-bold text-lg">⭐ Player</p>
            <p className="text-[#8892B0] text-xs">Keep grinding!</p>
          </div>
        </div>

        {loading && (
          <div className="text-center py-16">
            <div className="text-4xl animate-bounce mb-3">🎮</div>
            <p className="text-[#8892B0]">Loading your quest map…</p>
          </div>
        )}

        {!loading && !book && (
          <div className="blox-card p-8 text-center">
            <div className="text-5xl mb-3">📚</div>
            <p className="text-white font-fredoka text-lg">No books uploaded yet</p>
            <p className="text-[#8892B0] text-sm mt-1">Ask your admin to upload the textbook PDF.</p>
          </div>
        )}

        {!loading && book && chapters.length > 0 && (
          <div className="space-y-3">
            <p className="text-[#8892B0] text-xs uppercase tracking-widest font-semibold px-1 mb-4">
              🗺️ Choose your quest
            </p>
            {chapters.map((ch, idx) => (
              <div key={ch.id} className="blox-card overflow-hidden blox-hover animate-bounce-in"
                style={{animationDelay:`${idx * 0.05}s`}}>
                <button
                  onClick={() => toggle(ch.id)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#00A2FF] to-[#0066CC] flex items-center justify-center text-white font-fredoka font-bold text-sm flex-shrink-0">
                      {ch.chapter_number}
                    </div>
                    <span className="font-fredoka font-semibold text-white">{ch.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#8892B0] bg-[#2D2B5A] px-2 py-1 rounded-full">
                      {ch.topics.length} topics
                    </span>
                    <span className="text-[#00A2FF] text-sm">{expanded[ch.id] ? '▲' : '▼'}</span>
                  </div>
                </button>

                {expanded[ch.id] && (
                  <ul className="border-t border-[#2D2B5A] divide-y divide-[#2D2B5A]">
                    {ch.topics.map((t) => (
                      <li key={t.id} className="px-5 py-4 flex items-center justify-between gap-3 hover:bg-[#1A1A3E] transition-colors">
                        <div>
                          <p className="font-nunito font-semibold text-white text-sm">{t.topic_number} {t.title}</p>
                          <div className="mt-1.5"><ProgressBadge level={t.difficulty_ceiling} /></div>
                        </div>
                        <button
                          onClick={() => handleStart(t.id, t.title, ch.title)}
                          disabled={starting === t.id}
                          className="btn-blox-primary flex-shrink-0 text-sm py-2 px-5 disabled:opacity-50"
                        >
                          {starting === t.id ? '⚡ Starting…' : '▶ Play'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
