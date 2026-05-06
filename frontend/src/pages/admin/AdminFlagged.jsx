import { useEffect, useState } from 'react'
import { getFlaggedStudents, resolveFlag } from '../../api/client'

export default function AdminFlagged() {
  const [flagged, setFlagged] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getFlaggedStudents().then(r => setFlagged(r.data)).finally(() => setLoading(false))
  }, [])

  async function handleResolve(studentId, topicId, idx) {
    try {
      await resolveFlag(studentId, topicId)
      setFlagged(f => f.filter((_, i) => i !== idx))
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to resolve')
    }
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="p-8">
      <h2 className="text-xl font-bold text-gray-800 mb-6">Flagged Students</h2>

      {flagged.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-4xl mb-3">🎉</p>
          <p className="font-medium">No flagged students!</p>
          <p className="text-sm text-gray-400 mt-1">Everyone's doing great.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-4 py-3 text-left">Student</th>
                <th className="px-4 py-3 text-left">Grade</th>
                <th className="px-4 py-3 text-left">Topic</th>
                <th className="px-4 py-3 text-left">Chapter</th>
                <th className="px-4 py-3 text-left">Sessions</th>
                <th className="px-4 py-3 text-left">Max Hint</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {flagged.map((f, i) => (
                <tr key={i} className="bg-amber-50/40 hover:bg-amber-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{f.student_name}</td>
                  <td className="px-4 py-3 text-gray-500">{f.grade ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{f.topic_title}</td>
                  <td className="px-4 py-3 text-gray-500">{f.chapter_title}</td>
                  <td className="px-4 py-3 text-gray-600">{f.total_sessions_on_topic}</td>
                  <td className="px-4 py-3 text-gray-600">{f.last_hint_tier_needed}</td>
                  <td className="px-4 py-3">
                    {f.student_id ? (
                      <button
                        onClick={() => handleResolve(f.student_id, f.topic_id, i)}
                        className="text-xs px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
                      >
                        Mark Resolved
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">No account</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
