import { useEffect, useState } from 'react'
import { getAdminParents, getAdminStudents, createParent, linkStudentToParent, unlinkStudentFromParent } from '../../api/client'
import { useToast } from '../../context/ToastContext'

export default function AdminParents() {
  const { toast } = useToast()
  const [parents, setParents] = useState([])
  const [students, setStudents] = useState([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [linkModal, setLinkModal] = useState(null)
  const [linkStudentId, setLinkStudentId] = useState('')

  useEffect(() => {
    reload()
    getAdminStudents().then(r => setStudents(r.data)).catch(() => {})
  }, [])

  function reload() {
    getAdminParents().then(r => setParents(r.data)).catch(() => {})
  }

  async function handleAdd() {
    if (!email.trim() || !name.trim()) return
    setAdding(true); setAddError('')
    try {
      await createParent(email.trim(), name.trim())
      setEmail(''); setName('')
      reload()
    } catch (e) {
      setAddError(e.response?.data?.detail || 'Failed')
    } finally { setAdding(false) }
  }

  async function handleLink() {
    if (!linkStudentId) return
    try {
      await linkStudentToParent(linkModal, parseInt(linkStudentId))
      setLinkModal(null); setLinkStudentId('')
      reload()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to link student')
    }
  }

  async function handleUnlink(parentId, studentId) {
    try {
      await unlinkStudentFromParent(parentId, studentId)
      reload()
    } catch {}
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-fredoka font-bold text-white">Parents 👨‍👩‍👧</h2>
        <p className="text-[#8892B0] text-sm mt-1">Manage parent accounts and link them to students</p>
      </div>

      {/* Add parent */}
      <div className="blox-card p-5">
        <h3 className="text-sm font-fredoka font-bold text-[#00A2FF] mb-4">➕ Add New Parent</h3>
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8892B0] font-semibold">Email</label>
            <input placeholder="parent@gmail.com" value={email} onChange={e => setEmail(e.target.value)}
              className="blox-input w-56" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8892B0] font-semibold">Name</label>
            <input placeholder="Parent Name" value={name} onChange={e => setName(e.target.value)}
              className="blox-input w-44" />
          </div>
          <button onClick={handleAdd} disabled={adding || !email.trim() || !name.trim()}
            className="btn-blox-primary text-sm py-2.5 px-5">
            {adding ? '⚡ Adding…' : '+ Add Parent'}
          </button>
        </div>
        {addError && <p className="text-[#FF3333] text-xs mt-3">{addError}</p>}
      </div>

      {/* Parents table */}
      <div className="blox-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#1A1A3E] text-[#8892B0] text-xs font-nunito uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Linked Children</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2D2B5A]">
            {parents.map(p => (
              <tr key={p.id} className="hover:bg-[#1A1A3E] transition-colors">
                <td className="px-4 py-3 font-semibold text-white font-nunito">👤 {p.name}</td>
                <td className="px-4 py-3 text-[#8892B0] text-xs">{p.email}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5 flex-wrap">
                    {p.children?.map(c => (
                      <span key={c.id}
                        className="inline-flex items-center gap-1 text-xs bg-[#00A2FF]/20 text-[#00A2FF] border border-[#00A2FF]/30 px-2 py-0.5 rounded-full">
                        🎮 {c.name}
                        <button onClick={() => handleUnlink(p.id, c.id)}
                          className="text-[#8892B0] hover:text-[#FF3333] font-bold leading-none transition-colors">×</button>
                      </span>
                    ))}
                    {(!p.children || p.children.length === 0) && (
                      <span className="text-[#8892B0] text-xs">None linked yet</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => { setLinkModal(p.id); setLinkStudentId('') }}
                    className="text-xs bg-[#00D68F]/20 text-[#00D68F] border border-[#00D68F]/30 px-3 py-1 rounded-full font-semibold hover:bg-[#00D68F]/40 transition-all">
                    🔗 Link Child
                  </button>
                </td>
              </tr>
            ))}
            {parents.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-[#8892B0] text-sm">
                No parents added yet 👀
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Link modal */}
      {linkModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="blox-card-glow p-6 w-80 animate-bounce-in">
            <h3 className="font-fredoka font-bold text-white text-lg mb-4">🔗 Link a Student</h3>
            <select value={linkStudentId} onChange={e => setLinkStudentId(e.target.value)}
              className="blox-input w-full mb-4">
              <option value="">Select student…</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="flex gap-3">
              <button onClick={handleLink}
                className="btn-blox-primary flex-1 py-2.5 text-sm">
                Link ✓
              </button>
              <button onClick={() => setLinkModal(null)}
                className="flex-1 py-2.5 text-sm border border-[#2D2B5A] text-[#8892B0] rounded-full hover:border-[#FF3333] hover:text-[#FF3333] transition-all font-fredoka font-semibold">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
