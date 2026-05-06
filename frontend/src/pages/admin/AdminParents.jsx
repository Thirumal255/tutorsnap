import { useEffect, useState } from 'react'
import { getAdminParents, getAdminStudents, createParent, linkStudentToParent, unlinkStudentFromParent } from '../../api/client'

export default function AdminParents() {
  const [parents, setParents] = useState([])
  const [students, setStudents] = useState([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [linkModal, setLinkModal] = useState(null) // parent id
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
    setAdding(true)
    try {
      await createParent(email.trim(), name.trim())
      setEmail(''); setName('')
      reload()
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed')
    } finally {
      setAdding(false)
    }
  }

  async function handleLink() {
    if (!linkStudentId) return
    try {
      await linkStudentToParent(linkModal, parseInt(linkStudentId))
      setLinkModal(null); setLinkStudentId('')
      reload()
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed')
    }
  }

  async function handleUnlink(parentId, studentId) {
    try {
      await unlinkStudentFromParent(parentId, studentId)
      reload()
    } catch {}
  }

  return (
    <div className="p-8 space-y-8">
      <h2 className="text-xl font-bold text-gray-800">Parents</h2>

      {/* Add parent form */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Add Parent</h3>
        <div className="flex gap-3 flex-wrap">
          <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 w-60" />
          <input placeholder="Name" value={name} onChange={e => setName(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 w-48" />
          <button onClick={handleAdd} disabled={adding}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>

      {/* Parents table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Children</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {parents.map(p => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium text-gray-800">{p.name}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{p.email}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {p.children?.map(c => (
                      <span key={c.id}
                        className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                        {c.name}
                        <button onClick={() => handleUnlink(p.id, c.id)}
                          className="text-blue-400 hover:text-red-500 font-bold leading-none">×</button>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => { setLinkModal(p.id); setLinkStudentId('') }}
                    className="text-xs text-green-600 hover:text-green-800 font-medium">
                    Link Child
                  </button>
                </td>
              </tr>
            ))}
            {parents.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400 text-sm">No parents added yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Link modal */}
      {linkModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-80 shadow-xl">
            <h3 className="font-semibold text-gray-800 mb-4">Link a Student</h3>
            <select value={linkStudentId} onChange={e => setLinkStudentId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4">
              <option value="">Select student…</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="flex gap-3">
              <button onClick={handleLink}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
                Link
              </button>
              <button onClick={() => setLinkModal(null)}
                className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
