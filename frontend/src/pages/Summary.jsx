import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { endSession } from '../api/client'
import ProgressBadge from '../components/ProgressBadge'

export default function Summary() {
  const { id } = useParams()
  const navigate = useNavigate()
  const sessionId = parseInt(id)

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      // Try stored summary first (from session_complete flow)
      const stored = sessionStorage.getItem(`summary_${sessionId}`)
      if (stored) {
        const parsed = JSON.parse(stored)
        // Still call endSession to get full summary text if not already complete
        try {
          const res = await endSession(sessionId)
          setData({ ...parsed, ...res.data, level: res.data.level_reached })
        } catch {
          setData(parsed)
        }
        setLoading(false)
        return
      }

      try {
        const res = await endSession(sessionId)
        setData({ ...res.data, level: res.data.level_reached })
      } catch {
        setData({ summary: 'Session ended.', level: 'L1', studentName: '', topicTitle: '' })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [sessionId])

  if (loading) {
    return (
      <div className="min-h-screen bg-green-50 flex items-center justify-center">
        <p className="text-gray-400">Loading summary…</p>
      </div>
    )
  }

  const topicId = data?.topicId || data?.topic_id
  const studentName = data?.studentName || data?.student_name || ''
  const topicTitle = data?.topicTitle || data?.topic_title || ''
  const level = data?.level || data?.level_reached || 'L1'
  const levelLabel = data?.levelLabel || data?.level_label || ''
  const summary = data?.summary || ''
  const questionsAsked = data?.questionsAsked || data?.questions_asked || 0
  const flagged = data?.flagged_for_review || false
  const keyConcepts = data?.keyConcepts || []

  return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center px-4 py-10">
      <div className="max-w-lg w-full bg-white rounded-3xl shadow-sm border border-gray-100 p-8 text-center">
        <div className="text-5xl mb-4">{flagged ? '💪' : '⭐'}</div>
        <h1 className="text-2xl font-bold text-green-700 mb-1">Session Complete!</h1>
        {studentName && <p className="text-lg font-medium text-gray-700 mb-1">Great work, {studentName}!</p>}
        {topicTitle && <p className="text-sm text-gray-400 mb-4">{topicTitle}</p>}

        <div className="flex justify-center mb-4">
          <ProgressBadge level={level} />
        </div>

        <p className="text-gray-600 text-sm leading-relaxed mb-6">{summary}</p>

        {flagged && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
            This topic has been flagged for review. Talk to your teacher about it!
          </div>
        )}

        {keyConcepts.length > 0 && (
          <div className="mb-6">
            <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Concepts you practised today</p>
            <div className="flex flex-wrap justify-center gap-2">
              {keyConcepts.map((c, i) => (
                <span key={i} className="text-xs bg-green-50 text-green-700 border border-green-200 px-3 py-1 rounded-full">{c}</span>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-gray-100 pt-6 flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => navigate('/', { state: { topicId } })}
            className="px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 transition-colors"
          >
            Practice this topic again
          </button>
          <button
            onClick={() => navigate('/')}
            className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            Choose another topic
          </button>
        </div>
      </div>
    </div>
  )
}
