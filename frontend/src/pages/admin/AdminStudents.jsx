import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAdminStudents, createStudent, deactivateStudent, activateStudent, updateStudentGrade, importStudentsCSV } from '../../api/client'
import { useToast } from '../../context/ToastContext'

function exportCSV(students) {
  const header = ['Name', 'Email', 'Grade', 'Sessions', 'Mastered', 'Flags', 'Status']
  const rows = students.map(s => [
    s.name, s.email, s.grade ?? '', s.total_sessions, s.topics_mastered,
    s.flagged_topics, s.is_active ? 'Active' : 'Inactive',
  ])
  const csv = [header, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `students_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── CSV import helpers ───────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { rows: [], error: 'CSV must have a header row and at least one data row.' }

  const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const nameIdx  = headers.findIndex(h => h === 'name')
  const emailIdx = headers.findIndex(h => h === 'email')
  const gradeIdx = headers.findIndex(h => h === 'grade')

  if (nameIdx === -1 || emailIdx === -1) {
    return { rows: [], error: 'CSV must have "name" and "email" columns. "grade" is optional.' }
  }

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const name  = cells[nameIdx]  || ''
    const email = cells[emailIdx] || ''
    const grade = gradeIdx !== -1 ? parseInt(cells[gradeIdx]) || null : null
    if (name || email) rows.push({ name, email, grade })
  }
  return { rows, error: null }
}

function CSVImportModal({ onClose, onSuccess }) {
  const { toast } = useToast()
  const fileRef = useRef(null)
  const [preview, setPreview] = useState(null)  // {rows, error}
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState(null)

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const parsed = parseCSV(ev.target.result)
      setPreview(parsed)
      setResults(null)
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    if (!preview?.rows?.length) return
    setImporting(true)
    try {
      const res = await importStudentsCSV(preview.rows)
      setResults(res.data)
      toast.success(`Import done: ${res.data.created} created, ${res.data.updated} updated`)
      onSuccess()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="blox-card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-bounce-in space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-fredoka font-bold text-white text-xl">📥 Import Students from CSV</h3>
          <button onClick={onClose} className="text-[#8892B0] hover:text-white transition-colors text-lg">✕</button>
        </div>

        {/* Template hint */}
        <div className="bg-[#1A1A3E] rounded-xl p-3 text-xs font-mono text-[#8892B0] border border-[#2D2B5A]">
          <p className="text-[#00A2FF] font-semibold mb-1">Expected CSV format:</p>
          <p>name,email,grade</p>
          <p>Alice Smith,alice@school.com,7</p>
          <p>Bob Jones,bob@school.com,8</p>
          <p className="text-[#8892B0] mt-1 italic">grade column is optional</p>
        </div>

        {/* File picker */}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-[#2D2B5A] hover:border-[#00A2FF] rounded-2xl py-6 text-sm text-[#8892B0] hover:text-white transition-all"
          >
            {preview ? '📁 Change file' : '📁 Choose a CSV file'}
          </button>
        </div>

        {/* Parse error */}
        {preview?.error && (
          <div className="bg-[#FF3333]/10 border border-[#FF3333]/30 rounded-xl p-3 text-sm text-[#FF6B6B]">
            ⚠️ {preview.error}
          </div>
        )}

        {/* Preview table */}
        {preview?.rows?.length > 0 && !results && (
          <>
            <div className="overflow-x-auto rounded-xl border border-[#2D2B5A]">
              <table className="w-full text-xs">
                <thead className="bg-[#1A1A3E] text-[#8892B0] uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Grade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2D2B5A]">
                  {preview.rows.slice(0, 10).map((r, i) => (
                    <tr key={i} className="hover:bg-[#1A1A3E]">
                      <td className="px-3 py-2 text-[#8892B0]">{i + 1}</td>
                      <td className="px-3 py-2 text-white font-semibold">{r.name || <span className="text-[#FF6B6B]">missing</span>}</td>
                      <td className="px-3 py-2 text-[#8892B0]">{r.email || <span className="text-[#FF6B6B]">missing</span>}</td>
                      <td className="px-3 py-2 text-[#8892B0]">{r.grade ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 10 && (
              <p className="text-xs text-[#8892B0] text-center">…and {preview.rows.length - 10} more rows</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleImport}
                disabled={importing}
                className="btn-blox-primary flex-1 py-3 text-sm disabled:opacity-50"
              >
                {importing ? '⚡ Importing…' : `📥 Import ${preview.rows.length} student${preview.rows.length !== 1 ? 's' : ''}`}
              </button>
              <button onClick={onClose} className="px-4 py-3 text-sm text-[#8892B0] border border-[#2D2B5A] hover:border-[#8892B0] rounded-xl transition-all">
                Cancel
              </button>
            </div>
          </>
        )}

        {/* Results */}
        {results && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="blox-card p-3 text-center">
                <p className="text-2xl font-fredoka font-bold text-[#00CC88]">{results.created}</p>
                <p className="text-xs text-[#8892B0]">Created</p>
              </div>
              <div className="blox-card p-3 text-center">
                <p className="text-2xl font-fredoka font-bold text-[#00A2FF]">{results.updated}</p>
                <p className="text-xs text-[#8892B0]">Updated</p>
              </div>
              <div className="blox-card p-3 text-center">
                <p className="text-2xl font-fredoka font-bold text-[#FF6B6B]">{results.errors}</p>
                <p className="text-xs text-[#8892B0]">Errors</p>
              </div>
            </div>
            {results.errors > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {results.results.filter(r => r.status === 'error').map((r, i) => (
                  <div key={i} className="text-xs text-[#FF6B6B] bg-[#FF3333]/10 rounded-lg px-3 py-1.5">
                    {r.email || r.name}: {r.error}
                  </div>
                ))}
              </div>
            )}
            <button onClick={onClose} className="btn-blox-primary w-full py-3">Done ✓</button>
          </>
        )}
      </div>
    </div>
  )
}


export default function AdminStudents() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [students, setStudents] = useState([])
  const [search, setSearch] = useState('')
  const [gradeFilter, setGradeFilter] = useState(null) // null = all
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [showImport, setShowImport] = useState(false)

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
      toast.success('Student added!')
    } catch (e) {
      setAddError(e.response?.data?.detail || 'Failed to add student')
    } finally { setAdding(false) }
  }

  async function toggleActive(s) {
    try {
      if (s.is_active) await deactivateStudent(s.id)
      else await activateStudent(s.id)
      setStudents(prev => prev.map(x => x.id === s.id ? { ...x, is_active: !x.is_active } : x))
      toast.success(s.is_active ? 'Student deactivated' : 'Student activated')
    } catch {
      toast.error('Failed to update student status')
    }
  }

  async function handleGrade(id, g) {
    try {
      await updateStudentGrade(id, parseInt(g))
      setStudents(prev => prev.map(x => x.id === id ? { ...x, grade: parseInt(g) } : x))
      toast.success('Grade updated')
    } catch {
      toast.error('Failed to update grade')
    }
  }

  const availableGrades = [...new Set(students.map(s => s.grade).filter(Boolean))].sort()

  const filtered = students.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase())
    const matchGrade = gradeFilter === null || s.grade === gradeFilter
    return matchSearch && matchGrade
  })

  return (
    <div className="p-8 space-y-6">
      {showImport && (
        <CSVImportModal
          onClose={() => setShowImport(false)}
          onSuccess={() => { setShowImport(false); reload() }}
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-fredoka font-bold text-white">Students 🎮</h2>
          <p className="text-[#8892B0] text-sm mt-1">Manage your players</p>
        </div>
        <button
          onClick={() => setShowImport(true)}
          className="flex-shrink-0 text-xs text-[#C77DFF] hover:text-white border border-[#C77DFF]/40 hover:border-[#C77DFF] rounded-xl px-4 py-2 transition-all font-nunito font-semibold"
        >
          📥 Import CSV
        </button>
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

      {/* Search + grade filter + export */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-[#8892B0]">{filtered.length} / {students.length} player{students.length !== 1 ? 's' : ''}</span>
        <input placeholder="🔍 Search players…" value={search} onChange={e => setSearch(e.target.value)}
          className="blox-input w-52" />
        {/* Grade filter pills */}
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setGradeFilter(null)}
            className={`px-2.5 py-1 rounded-full text-xs font-nunito font-semibold transition-all ${
              gradeFilter === null ? 'bg-[#00A2FF] text-white' : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
            }`}
          >
            All
          </button>
          {availableGrades.map(g => (
            <button
              key={g}
              onClick={() => setGradeFilter(g === gradeFilter ? null : g)}
              className={`px-2.5 py-1 rounded-full text-xs font-nunito font-semibold transition-all ${
                gradeFilter === g ? 'bg-[#00A2FF] text-white' : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
              }`}
            >
              Gr {g}
            </button>
          ))}
        </div>
        <button
          onClick={() => { exportCSV(filtered); toast.success('CSV exported!') }}
          className="ml-auto text-xs text-[#8892B0] hover:text-white border border-[#2D2B5A] hover:border-[#00CC88] rounded-xl px-3 py-1.5 transition-all font-nunito font-semibold"
        >
          ↓ Export CSV
        </button>
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
