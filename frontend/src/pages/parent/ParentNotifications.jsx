import { useEffect, useState } from 'react'
import { getParentNotifications, markNotificationRead } from '../../api/client'

export default function ParentNotifications() {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getParentNotifications()
      .then(r => setNotifications(r.data))
      .finally(() => setLoading(false))
  }, [])

  async function handleRead(id) {
    try {
      await markNotificationRead(id)
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    } catch {}
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="p-8 max-w-2xl">
      <h2 className="text-xl font-bold text-gray-800 mb-6">Notifications</h2>

      {notifications.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-4xl mb-3">🔔</p>
          <p className="font-medium">No notifications</p>
          <p className="text-sm text-gray-400 mt-1">You're all caught up.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map(n => (
            <div
              key={n.id}
              className={`rounded-xl border p-4 ${n.is_read ? 'bg-white border-gray-100' : 'bg-amber-50 border-amber-200'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className={`text-sm font-medium ${n.is_read ? 'text-gray-700' : 'text-amber-900'}`}>
                    {n.title}
                  </p>
                  <p className={`text-xs mt-1 ${n.is_read ? 'text-gray-400' : 'text-amber-700'}`}>
                    {n.body}
                  </p>
                  {n.created_at && (
                    <p className="text-xs text-gray-400 mt-2">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  )}
                </div>
                {!n.is_read && (
                  <button
                    onClick={() => handleRead(n.id)}
                    className="text-xs text-amber-600 hover:text-amber-800 font-medium flex-shrink-0"
                  >
                    Mark read
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
