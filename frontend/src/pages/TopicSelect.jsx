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
      <div className="min-h-screen bg-green-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm text-center">
          <p className="text-gray-600 mb-2 font-medium">Almost there, {user?.name}!</p>
          <p className="text-gray-500 text-sm">
            Your grade hasn't been set up yet. Please ask your teacher to set it up for you.
          </p>
          <button onClick={logout}
            className="mt-6 text-xs text-gray-400 hover:text-gray-600">
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-green-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-green-700">TutorSnap</h1>
            <p className="text-gray-500 text-sm mt-1">Hi, {user?.name}! Choose a topic to practise 📚</p>
          </div>
          <button onClick={logout}
            className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5">
            Sign out
          </button>
        </div>

        {loading && <div className="text-center text-gray-400 py-10">Loading topics…</div>}

        {!loading && !book && (
          <div className="bg-white rounded-2xl p-6 text-center text-gray-500 border border-gray-100 shadow-sm">
            No textbook uploaded yet. Ask your teacher to upload the PDF.
          </div>
        )}

        {!loading && book && chapters.length > 0 && (
          <div className="space-y-3">
            {chapters.map((ch) => (
              <div key={ch.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <button
                  onClick={() => toggle(ch.id)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <span className="font-semibold text-gray-800">
                    Chapter {ch.chapter_number}: {ch.title}
                  </span>
                  <span className="text-xs text-gray-400 flex items-center gap-2">
                    {ch.topics.length} topics
                    <span>{expanded[ch.id] ? '▲' : '▼'}</span>
                  </span>
                </button>

                {expanded[ch.id] && (
                  <ul className="border-t border-gray-100 divide-y divide-gray-50">
                    {ch.topics.map((t) => (
                      <li key={t.id} className="px-5 py-4 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-gray-800 text-sm">{t.topic_number} {t.title}</p>
                          <div className="mt-1"><ProgressBadge level={t.difficulty_ceiling} /></div>
                        </div>
                        <button
                          onClick={() => handleStart(t.id, t.title, ch.title)}
                          disabled={starting === t.id}
                          className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                        >
                          {starting === t.id ? 'Starting…' : 'Start Practice'}
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
