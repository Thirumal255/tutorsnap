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
    Promise.all([
      getMyChildren(),
      getParentNotifications(),
    ]).then(([c, n]) => {
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

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="p-8 max-w-4xl space-y-8">
      <h2 className="text-xl font-bold text-gray-800">My Children</h2>

      {notifications.length > 0 && (
        <div className="space-y-2">
          {notifications.map(n => (
            <div key={n.id} className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <span className="text-amber-500 text-lg mt-0.5">⚑</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-900">{n.title}</p>
                <p className="text-xs text-amber-700 mt-0.5">{n.body}</p>
              </div>
              <button
                onClick={() => dismissNotification(n.id)}
                className="text-amber-400 hover:text-amber-600 text-lg leading-none flex-shrink-0"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {children.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-4xl mb-3">👨‍👩‍👧</p>
          <p className="font-medium">No children linked yet</p>
          <p className="text-sm text-gray-400 mt-1">Ask your admin to link your children to your account.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {children.map(child => (
            <button
              key={child.id}
              onClick={() => navigate(`/parent/children/${child.id}`)}
              className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-left hover:shadow-md hover:border-green-200 transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-gray-800">{child.name}</p>
                  {child.grade && (
                    <p className="text-xs text-gray-400 mt-0.5">Grade {child.grade}</p>
                  )}
                </div>
                {child.flagged_topics > 0 && (
                  <span className="text-xs bg-red-100 text-red-600 font-medium px-2 py-0.5 rounded-full">
                    {child.flagged_topics} flagged
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-lg font-bold text-gray-800">{child.total_sessions ?? 0}</p>
                  <p className="text-xs text-gray-400">Sessions</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-lg font-bold text-gray-800">{child.topics_mastered ?? 0}</p>
                  <p className="text-xs text-gray-400">Mastered</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className={`text-lg font-bold ${child.flagged_topics > 0 ? 'text-red-500' : 'text-gray-800'}`}>
                    {child.flagged_topics ?? 0}
                  </p>
                  <p className="text-xs text-gray-400">Flagged</p>
                </div>
              </div>

              {child.last_session_at && (
                <p className="text-xs text-gray-400 mt-3">
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
