import { useEffect, useState } from 'react'
import { getParentNotifications, markNotificationRead, markAllNotificationsRead } from '../../api/client'

function groupByDate(notifications) {
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()
  const groups = {}
  for (const n of notifications) {
    const d = n.created_at ? new Date(n.created_at).toDateString() : 'Earlier'
    let label
    if (d === today) label = 'Today'
    else if (d === yesterday) label = 'Yesterday'
    else label = new Date(n.created_at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    if (!groups[label]) groups[label] = []
    groups[label].push(n)
  }
  return groups
}

const TYPE_STYLE = {
  flagged:      { border: 'border-l-[#FF3333]', icon: '🚩', unreadBg: 'bg-[#FF3333]/10' },
  progress:     { border: 'border-l-[#00CC88]', icon: '📈', unreadBg: 'bg-[#00CC88]/10' },
  session_tip:  { border: 'border-l-[#FFD700]', icon: '💡', unreadBg: 'bg-[#FFD700]/10' },  // #49 AI parent tip
  parent_cheer: { border: 'border-l-[#FF6B9D]', icon: '💌', unreadBg: 'bg-[#FF6B9D]/10' },
  default:      { border: 'border-l-[#00A2FF]', icon: '🔔', unreadBg: 'bg-[#00A2FF]/10' },
}

function getStyle(n) {
  if (n.type === 'flagged' || n.title?.toLowerCase().includes('flag')) return TYPE_STYLE.flagged
  if (n.type === 'session_tip')  return TYPE_STYLE.session_tip
  if (n.type === 'parent_cheer') return TYPE_STYLE.parent_cheer
  if (n.type === 'progress') return TYPE_STYLE.progress
  return TYPE_STYLE.default
}

function timeStamp(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

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

  async function handleMarkAll() {
    try {
      await markAllNotificationsRead()
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    } catch {}
  }

  const unreadCount = notifications.filter(n => !n.is_read).length
  const groups = groupByDate(notifications)

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-fredoka font-bold text-white">🔔 Alerts</h1>
          <p className="text-[#8892B0] text-sm mt-0.5">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAll}
            className="text-xs text-[#00A2FF] hover:text-white border border-[#00A2FF]/40 hover:border-[#00A2FF] rounded-xl px-3 py-1.5 transition-all font-nunito font-semibold"
          >
            Mark all read
          </button>
        )}
      </div>

      {loading && (
        <div className="text-center py-16">
          <div className="text-4xl animate-bounce mb-3">🔔</div>
          <p className="text-[#8892B0]">Loading alerts…</p>
        </div>
      )}

      {!loading && notifications.length === 0 && (
        <div className="blox-card p-12 text-center">
          <div className="text-5xl mb-3">✅</div>
          <p className="font-fredoka font-bold text-white text-lg">All caught up!</p>
          <p className="text-sm text-[#8892B0] mt-1">No notifications yet. Check back after your children have studied.</p>
        </div>
      )}

      {!loading && notifications.length > 0 && (
        <div className="space-y-5">
          {Object.entries(groups).map(([label, items]) => (
            <div key={label}>
              {/* Date group header */}
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold">{label}</span>
                <div className="flex-1 h-px bg-[#2D2B5A]" />
              </div>

              <div className="space-y-2">
                {items.map(n => {
                  const style = getStyle(n)
                  return (
                    <div
                      key={n.id}
                      className={`blox-card border-l-4 ${style.border} px-4 py-3 flex items-start gap-3 transition-all ${
                        !n.is_read ? style.unreadBg : 'opacity-60'
                      }`}
                    >
                      <span className="text-xl flex-shrink-0 mt-0.5">{style.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm font-nunito font-semibold ${n.is_read ? 'text-[#8892B0]' : 'text-white'}`}>
                            {n.title}
                          </p>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[10px] text-[#8892B0]">{timeStamp(n.created_at)}</span>
                            {!n.is_read && (
                              <div className="w-2 h-2 rounded-full bg-[#00A2FF] flex-shrink-0" />
                            )}
                          </div>
                        </div>
                        <p className={`text-xs mt-1 leading-relaxed ${n.is_read ? 'text-[#4A5568]' : 'text-[#8892B0]'}`}>
                          {n.body}
                        </p>
                      </div>
                      {!n.is_read && (
                        <button
                          onClick={() => handleRead(n.id)}
                          className="text-xs text-[#8892B0] hover:text-[#00A2FF] flex-shrink-0 transition-colors mt-0.5 font-nunito"
                          title="Mark as read"
                        >
                          ✓
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
