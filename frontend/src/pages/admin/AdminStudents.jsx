import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAdminStudents, createStudent, deactivateStudent, activateStudent, updateStudentGrade } from '../../api/client'

export default function AdminStudents() {
  const navigate = useNavigate()
  const [students, setStudents] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  useEffect(() => { reload() }, [])

  function reload() {
    setLoading(true)
    getAdminStudents().then(r => setStudents(r.data)).finally(() => setLoading(false))
  }

  async function handleAdd() {
    if (!email.trim() || !name.trim()) return
    setAdding(true); setAddError('')
    try {
      await createStudent(email.trim(), name.trim(), grade ? parseInt(grade) : null)
      setEmail(''); setName(''); setGrade('')
      reload()
    } catch (e) {
      setAddError(e.response?.data?.detail || 'Failed to add student')
    } finally { setAdding(false) }
  }

  async function toggleActive(s) {
    try {
      if (s.is_active) await deactivateStudent(s.id)
      else await activateStudent(s.id)
      setStudents(prev => prev.map(x => x.id === s.id ? { ...x, is_active: !x.is_active } : x))
    } catch {}
  }

  async function handleGrade(id, g) {
    try {
      await updateStudentGrade(id, parseInt(g))
      setStudents(prev => prev.map(x => x.id === id ? { ...x, grade: parseInt(g) } : x))
    } catch {}
  }

  const filtered = students.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-fredoka font-bold text-white">Students 🎮</h2>
        <p className="text-[#8892B0] text-sm mt-1">Manage your players</p>
      </div>

      {/* Add student */}
      <div className="blox-card p-5">
        <h3 className="text-sm font-fredoka font-bold text-[#00A2FF] mb-4">➕ Add New Student</h3>
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8892B0] font-semibold">Email</label>
            <input placeholder="student@gmail.com" value={email} onChange={e => setEmail(e.target.value)}
              className="blox-input w-56" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8892B0] font-semibold">Name</label>
            <input placeholder="Student Name" value={name} onChange={e => setName(e.target.value)}
              className="blox-input w-44" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8892B0] font-semibold">Grade</label>
            <select value={grade} onChange={e => setGrade(e.target.value)}
              className="blox-input">
              <option value="">Optional</option>
              {[5,6,7,8,9,10].map(g => <option key={g} value={g}>Grade {g}</option>)}
            </select>
          </div>
          <button onClick={handleAdd} disabled={adding || !email.trim() || !name.trim()}
            className="btn-blox-primary text-sm py-2.5 px-5">
            {adding ? '⚡ Adding…' : '+ Add Player'}
          </button>
        </div>
        {addError && <p className="text-[#FF3333] text-xs mt-3">{addError}</p>}
      </div>

      {/* Search + count */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-[#8892B0]">{students.length} player{students.length !== 1 ? 's' : ''}</span>
        <input placeholder="🔍 Search players…" value={search} onChange={e => setSearch(e.target.value)}
          className="blox-input w-60" />
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="text-3xl animate-bounce mb-2">🎮</div>
          <p className="text-[#8892B0] text-sm">Loading players…</p>
        </div>
      ) : (
        <div className="blox-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#1A1A3E] text-[#8892B0] text-xs font-nunito uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Grade</th>
                <th className="px-4 py-3 text-left">Sessions</th>
                <th className="px-4 py-3 text-left">Mastered</th>
                <th className="px-4 py-3 text-left">Flags</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2D2B5A]">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-[#1A1A3E] transition-colors">
                  <td className="px-4 py-3 font-semibold text-white font-nunito">🎮 {s.name}</td>
                  <td className="px-4 py-3 text-[#8892B0] text-xs">{s.email}</td>
                  <td className="px-4 py-3">
                    <select value={s.grade || ''} onChange={e => handleGrade(s.id, e.target.value)}
                      className="bg-[#2D2B5A] border border-[#2D2B5A] text-white text-xs rounded-lg px-2 py-1">
                      <option value="">—</option>
                      {[5,6,7,8,9,10].map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-[#00A2FF] font-fredoka font-bold">{s.total_sessions}</td>
                  <td className="px-4 py-3 text-[#00D68F] font-fredoka font-bold">{s.topics_mastered}</td>
                  <td className="px-4 py-3">
                    {s.flagged_topics > 0
                      ? <span className="text-[#FF3333] font-fredoka font-bold">{s.flagged_topics} 🚩</span>
                      : <span className="text-[#8892B0]">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                      s.is_active
                        ? 'bg-[#00D68F]/20 text-[#00D68F] border border-[#00D68F]/30'
                        : 'bg-[#2D2B5A] text-[#8892B0]'
                    }`}>
                      {s.is_active ? '● Active' : '○ Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 flex gap-2">
                    <button onClick={() => navigate(`/admin/students/${s.id}`)}
                      className="text-xs text-[#00A2FF] hover:underline font-semibold">View</button>
                    <button onClick={() => toggleActive(s)}
                      className="text-xs text-[#8892B0] hover:text-white transition-colors">
                      {s.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[#8892B0] text-sm">
                  No players found 👀
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
