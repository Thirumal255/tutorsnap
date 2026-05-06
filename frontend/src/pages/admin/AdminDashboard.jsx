import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAdminOverview, getFlaggedStudents, resolveFlag } from '../../api/client'

function StatCard({ label, value, red }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${red && value > 0 ? 'text-red-600' : 'text-gray-800'}`}>{value}</p>
    </div>
  )
}

export default function AdminDashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [flagged, setFlagged] = useState([])

  useEffect(() => {
    getAdminOverview().then(r => setStats(r.data)).catch(() => {})
    getFlaggedStudents().then(r => setFlagged(r.data)).catch(() => {})
  }, [])

  async function handleResolve(studentId, topicId) {
    try {
      await resolveFlag(studentId, topicId)
      setFlagged(f => f.filter(x => !(x.student_id === studentId && x.topic_id === topicId)))
    } catch {}
  }

  return (
    <div className="p-8">
      <h2 className="text-xl font-bold text-gray-800 mb-6">Dashboard</h2>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          <StatCard label="Total Students" value={stats.total_students} />
          <StatCard label="Active This Week" value={stats.active_this_week} />
          <StatCard label="Sessions This Week" value={stats.total_sessions_this_week} />
          <StatCard label="Flagged Students" value={stats.flagged_students} red />
          <StatCard label="Books Uploaded" value={stats.books_uploaded} />
          <StatCard label="Topics Available" value={stats.topics_available} />
        </div>
      )}

      <h3 className="text-base font-semibold text-gray-700 mb-3">Recent Flags</h3>
      {flagged.length === 0
        ? <p className="text-sm text-gray-400">No flagged students 🎉 Everyone's doing great!</p>
        : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Student</th>
                  <th className="px-4 py-3 text-left">Topic</th>
                  <th className="px-4 py-3 text-left">Chapter</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {flagged.slice(0, 5).map((f, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3 font-medium text-gray-800">{f.student_name}</td>
                    <td className="px-4 py-3 text-gray-600">{f.topic_title}</td>
                    <td className="px-4 py-3 text-gray-500">{f.chapter_title}</td>
                    <td className="px-4 py-3">
                      {f.student_id && (
                        <button
                          onClick={() => handleResolve(f.student_id, f.topic_id)}
                          className="text-xs text-green-600 hover:text-green-800 font-medium"
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  )
}
