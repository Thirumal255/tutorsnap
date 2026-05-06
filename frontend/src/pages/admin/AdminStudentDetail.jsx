import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getAdminStudent, updateStudentGrade, resetStudentMastery } from '../../api/client'
import ProgressBadge from '../../components/ProgressBadge'

export default function AdminStudentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [student, setStudent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetMsg, setResetMsg] = useState('')

  useEffect(() => {
    getAdminStudent(id).then(r => setStudent(r.data)).finally(() => setLoading(false))
  }, [id])

  async function handleGrade(grade) {
    try {
      const r = await updateStudentGrade(id, parseInt(grade))
      setStudent(s => ({ ...s, grade: r.data.grade }))
    } catch {}
  }

  async function handleReset() {
    if (!confirmReset) { setConfirmReset(true); return }
    try {
      const r = await resetStudentMastery(id)
      setResetMsg(r.data.message)
      setStudent(s => ({ ...s, topic_mastery: [] }))
      setConfirmReset(false)
    } catch {}
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>
  if (!student) return <div className="p-8 text-gray-500">Student not found.</div>

  return (
    <div className="p-8 space-y-8 max-w-4xl">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/admin/students')}
          className="text-sm text-gray-400 hover:text-gray-600">← Back</button>
        <h2 className="text-xl font-bold text-gray-800">{student.name}</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          student.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>{student.is_active ? 'Active' : 'Inactive'}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 bg-white rounded-xl border border-gray-100 p-5">
        <div><p className="text-xs text-gray-400">Email</p><p className="text-sm text-gray-700">{student.email}</p></div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Grade</p>
          <select value={student.grade || ''} onChange={e => handleGrade(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1 text-sm">
            <option value="">Not set</option>
            {[5,6,7,8,9,10].map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        {student.parent_names?.length > 0 && (
          <div className="col-span-2">
            <p className="text-xs text-gray-400 mb-1">Parents</p>
            <div className="flex gap-2 flex-wrap">
              {student.parent_names.map((n, i) => (
                <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{n}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-700 mb-3">Topic Mastery</h3>
        {student.topic_mastery?.length === 0
          ? <p className="text-sm text-gray-400">No topics practised yet.</p>
          : (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Topic</th>
                    <th className="px-4 py-3 text-left">Chapter</th>
                    <th className="px-4 py-3 text-left">Level</th>
                    <th className="px-4 py-3 text-left">Sessions</th>
                    <th className="px-4 py-3 text-left">Max Hint</th>
                    <th className="px-4 py-3 text-left">Flagged</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {student.topic_mastery.map((m, i) => (
                    <tr key={i} className={m.flagged_for_review ? 'bg-amber-50' : ''}>
                      <td className="px-4 py-3 text-gray-800 font-medium">{m.topic_title}</td>
                      <td className="px-4 py-3 text-gray-500">{m.chapter_title}</td>
                      <td className="px-4 py-3"><ProgressBadge level={m.mastery_level} /></td>
                      <td className="px-4 py-3 text-gray-600">{m.total_sessions}</td>
                      <td className="px-4 py-3 text-gray-600">{m.last_hint_tier_needed}</td>
                      <td className="px-4 py-3">
                        {m.flagged_for_review
                          ? <span className="text-xs text-red-600 font-medium">⚑ Flagged</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-700 mb-3">Recent Sessions</h3>
        {student.recent_sessions?.length === 0
          ? <p className="text-sm text-gray-400">No sessions yet.</p>
          : (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Topic</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Level</th>
                    <th className="px-4 py-3 text-left">Questions</th>
                    <th className="px-4 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {student.recent_sessions.map((s, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3 text-gray-800">{s.topic_title}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {s.started_at ? new Date(s.started_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3"><ProgressBadge level={s.current_level} /></td>
                      <td className="px-4 py-3 text-gray-600">{s.questions_asked}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          s.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>{s.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>

      <div className="border border-red-100 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-red-600 mb-2">Danger Zone</h3>
        {resetMsg && <p className="text-xs text-green-600 mb-2">{resetMsg}</p>}
        <button
          onClick={handleReset}
          className="text-sm px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
        >
          {confirmReset ? 'Click again to confirm reset' : 'Reset all mastery'}
        </button>
        {confirmReset && (
          <button onClick={() => setConfirmReset(false)}
            className="ml-3 text-sm text-gray-400 hover:text-gray-600">Cancel</button>
        )}
      </div>
    </div>
  )
}
