import { useState, useEffect } from 'react'
import { getAdminAuditLog } from '../../api/client'

const ACTION_LABELS = {
  create_student:    { label: 'Create student',    color: 'text-[#00CC88]',  icon: '➕' },
  update_grade:      { label: 'Update grade',      color: 'text-[#00A2FF]',  icon: '✏️' },
  deactivate_student:{ label: 'Deactivate',        color: 'text-[#FFB347]',  icon: '🔒' },
  activate_student:  { label: 'Activate',          color: 'text-[#00CC88]',  icon: '🔓' },
  reset_mastery:     { label: 'Reset mastery',     color: 'text-[#FF6B6B]',  icon: '🗑️' },
  resolve_flag:      { label: 'Resolve flag',      color: 'text-[#00A2FF]',  icon: '✅' },
  import_students:   { label: 'Bulk import',       color: 'text-[#C77DFF]',  icon: '📥' },
}

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export default function AdminAuditLog() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('all')

  useEffect(() => {
    getAdminAuditLog(200)
      .then(r => setRows(r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  const actionTypes = [...new Set(rows.map(r => r.action))]
  const visible = filter === 'all' ? rows : rows.filter(r => r.action === filter)

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-2xl font-fredoka font-bold text-white">📋 Audit Log</h2>
        <p className="text-[#8892B0] text-sm mt-1">Recent admin actions — last 200 entries</p>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-nunito font-semibold transition-all ${
            filter === 'all' ? 'bg-[#00A2FF] text-white' : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
          }`}
        >
          All ({rows.length})
        </button>
        {actionTypes.map(a => {
          const meta = ACTION_LABELS[a] || { label: a, icon: '•', color: 'text-white' }
          const count = rows.filter(r => r.action === a).length
          return (
            <button
              key={a}
              onClick={() => setFilter(a)}
              className={`px-3 py-1.5 rounded-full text-xs font-nunito font-semibold transition-all ${
                filter === a ? 'bg-[#00A2FF] text-white' : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
              }`}
            >
              {meta.icon} {meta.label} ({count})
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="text-center py-16">
          <div className="text-3xl animate-bounce mb-3">📋</div>
          <p className="text-[#8892B0]">Loading audit log…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="blox-card p-10 text-center">
          <div className="text-5xl mb-3">🕳️</div>
          <p className="text-white font-fredoka text-lg">No actions logged yet</p>
          <p className="text-[#8892B0] text-sm mt-1">Admin actions will appear here automatically.</p>
        </div>
      ) : (
        <div className="blox-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#1A1A3E] text-[#8892B0] text-xs font-nunito uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">When</th>
                <th className="px-4 py-3 text-left">Admin</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Target</th>
                <th className="px-4 py-3 text-left">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2D2B5A]">
              {visible.map(row => {
                const meta = ACTION_LABELS[row.action] || { label: row.action, icon: '•', color: 'text-white' }
                return (
                  <tr key={row.id} className="hover:bg-[#1A1A3E] transition-colors">
                    <td className="px-4 py-3 text-[#8892B0] text-xs whitespace-nowrap" title={row.created_at}>
                      {timeAgo(row.created_at)}
                    </td>
                    <td className="px-4 py-3 text-white font-semibold font-nunito text-xs">
                      {row.admin_name || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-nunito font-semibold text-xs ${meta.color}`}>
                        {meta.icon} {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#8892B0] text-xs">
                      {row.target_name
                        ? <span className="text-white font-semibold">{row.target_name}</span>
                        : row.target_type
                          ? <span className="text-[#8892B0] italic">{row.target_type}</span>
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-[#8892B0] text-xs max-w-xs truncate">
                      {row.details || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
