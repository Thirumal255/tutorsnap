import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAdminStudents, deactivateStudent, activateStudent, updateStudentGrade } from '../../api/client'

export default function AdminStudents() {
  const navigate = useNavigate()
  const [students, setStudents] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAdminStudents().then(r => setStudents(r.data)).finally(() => setLoading(false))
  }, [])

  async function toggleActive(s) {
    try {
      if (s.is_active) await deactivateStudent(s.id)
      else await activateStudent(s.id)
      setStudents(prev => prev.map(x => x.id === s.id ? { ...x, is_active: !x.is_active } : x))
    } catch {}
  }

  async function handleGrade(id, grade) {
    try {
      await updateStudentGrade(id, parseInt(grade))
      setStudents(prev => prev.map(x => x.id === id ? { ...x, grade: parseInt(grade) } : x))
    } catch {}
  }

  const filtered = students.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800">Students</h2>
        <input
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 w-60"
        />
      </div>

      {loading
        ? <p className="text-gray-400 text-sm">Loading…</p>
        : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Grade</th>
                  <th className="px-4 py-3 text-left">Sessions</th>
                  <th className="px-4 py-3 text-left">Mastered</th>
                  <th className="px-4 py-3 text-left">Flagged</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{s.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={s.grade || ''}
                        onChange={e => handleGrade(s.id, e.target.value)}
                        className="border border-gray-200 rounded px-1 py-0.5 text-xs"
                      >
                        <option value="">—</option>
                        {[5,6,7,8,9,10].map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{s.total_sessions}</td>
                    <td className="px-4 py-3 text-gray-600">{s.topics_mastered}</td>
                    <td className="px-4 py-3">
                      {s.flagged_topics > 0
                        ? <span className="text-red-500 font-medium">{s.flagged_topics}</span>
                        : <span className="text-gray-400">0</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        s.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 flex gap-2">
                      <button
                        onClick={() => navigate(`/admin/students/${s.id}`)}
                        className="text-xs text-blue-600 hover:underline"
                      >View</button>
                      <button
                        onClick={() => toggleActive(s)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >{s.is_active ? 'Deactivate' : 'Activate'}</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400 text-sm">No students found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  )
}
