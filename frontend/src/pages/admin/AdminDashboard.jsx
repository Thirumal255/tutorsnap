import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAdminOverview, getFlaggedStudents, resolveFlag } from '../../api/client'

function StatCard({ label, value, icon, color, glow }) {
  return (
    <div className={`blox-card p-5 animate-bounce-in ${glow ? 'shadow-glow-red border-[#FF3333]/40' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[#8892B0] font-nunito font-semibold uppercase tracking-wider">{label}</p>
        <span className="text-xl">{icon}</span>
      </div>
      <p className={`text-4xl font-fredoka font-bold ${color || 'text-white'}`}>{value ?? '—'}</p>
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
      <div className="mb-8">
        <h2 className="text-2xl font-fredoka font-bold text-white">Dashboard 🏠</h2>
        <p className="text-[#8892B0] text-sm mt-1">Welcome back, Admin! Here's your overview.</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          <StatCard label="Total Students" value={stats.total_students}         icon="🎮" color="text-[#00A2FF]" />
          <StatCard label="Active This Week" value={stats.active_this_week}     icon="⚡" color="text-[#00D68F]" />
          <StatCard label="Sessions This Week" value={stats.total_sessions_this_week} icon="📊" color="text-white" />
          <StatCard label="Flagged Students" value={stats.flagged_students}     icon="🚩" color="text-[#FF3333]"
            glow={stats.flagged_students > 0} />
          <StatCard label="Books Uploaded" value={stats.books_uploaded}         icon="📚" color="text-[#FFD700]" />
          <StatCard label="Topics Available" value={stats.topics_available}     icon="🗺️" color="text-[#A78BFA]" />
        </div>
      )}

      <h3 className="text-base font-fredoka font-bold text-white mb-3">🚩 Recent Flags</h3>
      {flagged.length === 0 ? (
        <div className="blox-card p-6 text-center">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-[#00D68F] font-fredoka font-semibold">All clear! No flagged students.</p>
          <p className="text-[#8892B0] text-sm mt-1">Everyone's doing great!</p>
        </div>
      ) : (
        <div className="blox-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#1A1A3E] text-[#8892B0] text-xs font-nunito">
              <tr>
                <th className="px-4 py-3 text-left">Student</th>
                <th className="px-4 py-3 text-left">Topic</th>
                <th className="px-4 py-3 text-left">Chapter</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2D2B5A]">
              {flagged.slice(0, 5).map((f, i) => (
                <tr key={i} className="hover:bg-[#1A1A3E] transition-colors">
                  <td className="px-4 py-3 font-semibold text-white font-nunito">🎮 {f.student_name}</td>
                  <td className="px-4 py-3 text-[#8892B0]">{f.topic_title}</td>
                  <td className="px-4 py-3 text-[#8892B0]">{f.chapter_title}</td>
                  <td className="px-4 py-3">
                    {f.student_id && (
                      <button
                        onClick={() => handleResolve(f.student_id, f.topic_id)}
                        className="text-xs bg-[#00D68F]/20 text-[#00D68F] border border-[#00D68F]/30 px-3 py-1 rounded-full font-semibold hover:bg-[#00D68F]/40 transition-all"
                      >
                        ✓ Resolve
                      </button>
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
