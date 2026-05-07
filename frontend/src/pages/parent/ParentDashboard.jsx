import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMyChildren, getParentNotifications, markNotificationRead } from '../../api/client'
import ProgressBadge from '../../components/ProgressBadge'

export default function ParentDashboard() {
  const navigate = useNavigate()
  const [children, setChildren] = useState([])
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getMyChildren(), getParentNotifications()])
      .then(([c, n]) => {
        setChildren(c.data)
        setNotifications(n.data.filter(n => !n.is_read).slice(0, 5))
      }).finally(() => setLoading(false))
  }, [])

  async function dismissNotification(id) {
    try {
      await markNotificationRead(id)
      setNotifications(prev => prev.filter(n => n.id !== id))
    } catch {}
  }

  if (loading) return (
    <div className="p-8 text-center">
      <div className="text-3xl animate-bounce mb-2">⭐</div>
      <p className="text-[#8892B0] text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <div>
        <h2 className="text-2xl font-fredoka font-bold text-white">My Children 👨‍👩‍👧</h2>
        <p className="text-[#8892B0] text-sm mt-1">Track your child's learning progress</p>
      </div>

      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="space-y-2">
          {notifications.map(n => (
            <div key={n.id} className="flex items-start gap-3 bg-[#FFD700]/10 border border-[#FFD700]/30 rounded-2xl px-4 py-3 animate-bounce-in">
              <span className="text-[#FFD700] text-xl mt-0.5 flex-shrink-0">🚩</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white font-nunito">{n.title}</p>
                <p className="text-xs text-[#8892B0] mt-0.5">{n.body}</p>
              </div>
              <button onClick={() => dismissNotification(n.id)}
                className="text-[#8892B0] hover:text-[#FF3333] text-xl leading-none flex-shrink-0 transition-colors">
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Children cards */}
      {children.length === 0 ? (
        <div className="blox-card p-12 text-center">
          <p className="text-5xl mb-3">👨‍👩‍👧</p>
          <p className="font-fredoka font-bold text-white text-lg">No children linked yet</p>
          <p className="text-sm text-[#8892B0] mt-1">Ask your admin to link your children to your account.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {children.map((child, idx) => (
            <button
              key={child.id}
              onClick={() => navigate(`/parent/children/${child.id}`)}
              className="blox-card p-5 text-left blox-hover animate-bounce-in"
              style={{animationDelay:`${idx * 0.1}s`}}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FF6B9D] to-[#FF3333] flex items-center justify-center text-2xl flex-shrink-0">
                    🎮
                  </div>
                  <div>
                    <p className="font-fredoka font-bold text-white text-base">{child.name}</p>
                    {child.grade && <p className="text-xs text-[#8892B0]">Grade {child.grade}</p>}
                  </div>
                </div>
                {child.flagged_topics > 0 && (
                  <span className="text-xs bg-[#FF3333]/20 text-[#FF3333] border border-[#FF3333]/30 font-bold px-2 py-0.5 rounded-full">
                    🚩 {child.flagged_topics}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-[#0F0F23] rounded-xl p-2.5">
                  <p className="text-xl font-fredoka font-bold text-[#00A2FF]">{child.total_sessions ?? 0}</p>
                  <p className="text-xs text-[#8892B0]">Sessions</p>
                </div>
                <div className="bg-[#0F0F23] rounded-xl p-2.5">
                  <p className="text-xl font-fredoka font-bold text-[#00D68F]">{child.topics_mastered ?? 0}</p>
                  <p className="text-xs text-[#8892B0]">Mastered</p>
                </div>
                <div className="bg-[#0F0F23] rounded-xl p-2.5">
                  <p className={`text-xl font-fredoka font-bold ${child.flagged_topics > 0 ? 'text-[#FF3333]' : 'text-[#8892B0]'}`}>
                    {child.flagged_topics ?? 0}
                  </p>
                  <p className="text-xs text-[#8892B0]">Flagged</p>
                </div>
              </div>

              {child.last_session_at && (
                <p className="text-xs text-[#8892B0] mt-3">
                  Last active: {new Date(child.last_session_at).toLocaleDateString()}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
