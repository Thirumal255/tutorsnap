import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { getMyChildren, getFamilyActivity, getParentNotifications, markNotificationRead } from '../../api/client'

// Subject-specific support tips (task #33)
const SUBJECT_TIP = {
  Mathematics:      "Try working through a similar problem together, asking them to explain each step.",
  Science:          "Watch a short video on the concept together and discuss what you both notice.",
  English:          "Read a short passage together and take turns asking each other questions.",
  History:          "Look at a timeline together — ask them to tell you the story in their own words.",
  Geography:        "Use a map or globe to make the concept visual and tangible.",
  Physics:          "Try a simple at-home experiment that demonstrates the principle.",
  Chemistry:        "Everyday cooking, cleaning, and rusting are chemistry — connect the topic to real life!",
  Biology:          "Talk about how the concept relates to their own body or local environment.",
  'Social Studies': "Discuss a current news story that connects to what they're studying.",
  'Computer Science': "Ask them to teach the concept to you — explaining it reveals what they know.",
  Tamil:            "Read a passage aloud together and discuss the meaning of unfamiliar words.",
  Hindi:            "Read a passage aloud together and discuss the meaning of unfamiliar words.",
  Other:            "Ask them to explain the topic in their own words — it shows you where the gaps are.",
}

const CHILD_COLORS = [
  'from-[#FF6B9D] to-[#FF3333]',
  'from-[#00A2FF] to-[#0066CC]',
  'from-[#00CC88] to-[#007755]',
  'from-[#C084FC] to-[#7E22CE]',
  'from-[#FFB347] to-[#CC7700]',
]

const CHART_COLORS = ['#00A2FF', '#FF6B9D', '#00CC88', '#C084FC', '#FFB347']

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function timeAgo(isoStr) {
  if (!isoStr) return 'Never'
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000)
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 2) return 'Yesterday'
  return new Date(isoStr).toLocaleDateString()
}

function ChildCard({ child, idx, onClick }) {
  const gradient = CHILD_COLORS[idx % CHILD_COLORS.length]
  const hasFlag = child.flagged_topics > 0

  return (
    <button
      onClick={onClick}
      className={`blox-card p-5 text-left blox-hover animate-bounce-in w-full ${
        hasFlag ? 'border-[#FF3333]/40' : ''
      }`}
      style={{ animationDelay: `${idx * 0.08}s` }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-2xl font-fredoka font-bold flex-shrink-0`}>
            {child.avatar_url
              ? <img src={child.avatar_url} className="w-full h-full rounded-2xl object-cover" alt="" />
              : child.name[0]
            }
          </div>
          <div>
            <p className="font-fredoka font-bold text-white text-base">{child.name}</p>
            <p className="text-xs text-[#8892B0]">Grade {child.grade}</p>
          </div>
        </div>
        <div className="text-right">
          {child.streak_days > 0
            ? <p className="text-sm font-fredoka font-bold text-[#FFD700]">🔥 {child.streak_days}d</p>
            : <p className="text-xs text-[#8892B0]">No streak</p>
          }
          <p className="text-[10px] text-[#8892B0] mt-0.5">
            {timeAgo(child.last_active)}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-center mb-4">
        <div className="bg-[#0F0F23] rounded-xl p-2.5">
          <p className="text-xl font-fredoka font-bold text-[#00A2FF]">{child.total_sessions ?? 0}</p>
          <p className="text-[10px] text-[#8892B0] mt-0.5">Sessions</p>
        </div>
        <div className="bg-[#0F0F23] rounded-xl p-2.5">
          <p className="text-xl font-fredoka font-bold text-[#00CC88]">{child.topics_mastered ?? 0}</p>
          <p className="text-[10px] text-[#8892B0] mt-0.5">Mastered</p>
        </div>
        <div className={`rounded-xl p-2.5 ${hasFlag ? 'bg-[#FF3333]/10' : 'bg-[#0F0F23]'}`}>
          <p className={`text-xl font-fredoka font-bold ${hasFlag ? 'text-[#FF6B6B]' : 'text-[#8892B0]'}`}>
            {child.flagged_topics ?? 0}
          </p>
          <p className="text-[10px] text-[#8892B0] mt-0.5">
            {hasFlag ? '🚩 Flagged' : 'Flagged'}
          </p>
        </div>
      </div>

      {/* Today's goal progress */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-[#8892B0] flex-shrink-0">Today</span>
        <div className="flex-1 h-1.5 bg-[#2D2B5A] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              (child.sessions_today ?? 0) >= (child.daily_goal_sessions ?? 1) ? 'bg-[#00CC88]' : 'bg-[#00A2FF]'
            }`}
            style={{ width: `${Math.min(((child.sessions_today ?? 0) / (child.daily_goal_sessions ?? 1)) * 100, 100)}%` }}
          />
        </div>
        <span className="text-[10px] text-[#8892B0] flex-shrink-0">
          {child.sessions_today ?? 0}/{child.daily_goal_sessions ?? 1}
          {(child.sessions_today ?? 0) >= (child.daily_goal_sessions ?? 1) && ' ✓'}
        </span>
      </div>

      {/* This week mini-bar */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#8892B0] flex-shrink-0">This week</span>
        <div className="flex-1 h-1.5 bg-[#2D2B5A] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${gradient}`}
            style={{ width: `${Math.min((child.sessions_this_week / 7) * 100, 100)}%` }}
          />
        </div>
        <span className="text-[10px] text-[#8892B0] flex-shrink-0">
          {child.sessions_this_week ?? 0} session{child.sessions_this_week !== 1 ? 's' : ''}
        </span>
      </div>

      <p className="text-xs text-[#00A2FF] mt-3 text-right font-semibold">View details →</p>
    </button>
  )
}

function FamilyChart({ activity, children }) {
  if (!activity.length) return null

  const dates = activity[0]?.activity?.map(a => a.date) ?? []
  const maxSessions = Math.max(
    ...activity.flatMap(c => c.activity.map(a => a.sessions)),
    1
  )

  return (
    <div className="blox-card p-5 animate-bounce-in">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold">
          📅 Family activity — last 7 days
        </p>
        <div className="flex items-center gap-3">
          {activity.map((c, i) => (
            <span key={c.child_id} className="flex items-center gap-1 text-xs text-[#8892B0]">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: CHART_COLORS[i] }} />
              {c.child_name.split(' ')[0]}
            </span>
          ))}
        </div>
      </div>

      {/* Grouped bar chart */}
      <div className="flex items-end gap-3 h-24">
        {dates.map((date, di) => {
          const dayLabel = DAYS[new Date(date + 'T00:00:00').getDay()]
          const isToday = date === new Date().toISOString().slice(0, 10)
          return (
            <div key={date} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex items-end justify-center gap-0.5" style={{ height: '64px' }}>
                {activity.map((child, ci) => {
                  const s = child.activity[di]?.sessions ?? 0
                  const pct = s / maxSessions
                  return (
                    <div
                      key={child.child_id}
                      className="flex-1 rounded-t transition-all duration-700"
                      style={{
                        height: s > 0 ? `${Math.max(pct * 100, 15)}%` : '4px',
                        background: s > 0 ? CHART_COLORS[ci] : '#2D2B5A',
                        minHeight: '4px',
                        opacity: isToday ? 1 : 0.8,
                      }}
                      title={`${child.child_name}: ${s} session${s !== 1 ? 's' : ''}`}
                    />
                  )
                })}
              </div>
              <span className={`text-[10px] font-semibold ${isToday ? 'text-[#FFD700]' : 'text-[#8892B0]'}`}>
                {dayLabel}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ParentDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [children, setChildren] = useState([])
  const [activity, setActivity] = useState([])
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      getMyChildren(),
      getFamilyActivity(),
      getParentNotifications(),
    ]).then(([c, a, n]) => {
      setChildren(c.data)
      setActivity(a.data)
      setAlerts(n.data.filter(n => !n.is_read).slice(0, 4))
    }).finally(() => setLoading(false))
  }, [])

  async function dismissAlert(id) {
    try {
      await markNotificationRead(id)
      setAlerts(prev => prev.filter(n => n.id !== id))
    } catch {}
  }

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-fredoka font-bold text-white">
          {greeting()}, <span className="text-[#FFD700]">{user?.name?.split(' ')[0]}</span>! 👋
        </h1>
        <p className="text-[#8892B0] text-sm mt-0.5">Here's how your children are doing today</p>
      </div>

      {loading && (
        <div className="text-center py-16">
          <div className="text-4xl animate-bounce mb-3">👨‍👩‍👧</div>
          <p className="text-[#8892B0]">Loading family dashboard…</p>
        </div>
      )}

      {!loading && (
        <>
          {/* Alert banner(s) */}
          {alerts.length > 0 && (
            <div className="space-y-2">
              {alerts.map(n => (
                <div key={n.id}
                  className="flex items-start gap-3 bg-[#FF3333]/10 border border-[#FF3333]/30 rounded-2xl px-4 py-3 animate-bounce-in">
                  <span className="text-[#FF6B6B] text-xl mt-0.5 flex-shrink-0">🚩</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white font-nunito">{n.title}</p>
                    <p className="text-xs text-[#8892B0] mt-0.5 line-clamp-1">{n.body}</p>
                  </div>
                  <button onClick={() => dismissAlert(n.id)}
                    className="text-[#8892B0] hover:text-[#FF3333] text-xl leading-none flex-shrink-0 transition-colors">
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* No children */}
          {children.length === 0 ? (
            <div className="blox-card p-12 text-center">
              <p className="text-5xl mb-3">👨‍👩‍👧</p>
              <p className="font-fredoka font-bold text-white text-lg">No children linked yet</p>
              <p className="text-sm text-[#8892B0] mt-1">Ask your admin to link your children to your account.</p>
            </div>
          ) : (
            <>
              {/* Child cards grid */}
              <div>
                <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-3 px-1">
                  👨‍👩‍👧 My children
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {children.map((child, idx) => (
                    <ChildCard
                      key={child.id}
                      child={child}
                      idx={idx}
                      onClick={() => navigate(`/parent/children/${child.id}`)}
                    />
                  ))}
                </div>
              </div>

              {/* Support tips for flagged topics (task #33) */}
              {children.some(c => c.flagged_topics > 0) && (
                <div className="blox-card p-4 border-[#FFB347]/30 animate-bounce-in">
                  <p className="text-xs text-[#FFB347] font-semibold uppercase tracking-widest mb-3">
                    💡 How to help at home
                  </p>
                  <div className="space-y-3">
                    {alerts.map(n => {
                      // Try to extract subject from notification body or title (heuristic)
                      const subject = Object.keys(SUBJECT_TIP).find(s =>
                        n.title?.includes(s) || n.body?.includes(s)
                      )
                      const tip = SUBJECT_TIP[subject] || SUBJECT_TIP.Other
                      return (
                        <div key={n.id} className="flex items-start gap-3">
                          <span className="text-lg flex-shrink-0">🚩</span>
                          <div>
                            <p className="text-xs text-white font-semibold font-nunito">{n.title}</p>
                            <p className="text-xs text-[#8892B0] mt-1 leading-relaxed">💡 {tip}</p>
                          </div>
                        </div>
                      )
                    })}
                    {alerts.length === 0 && (
                      <p className="text-xs text-[#8892B0] italic">
                        Open your child's detail page to see support tips for specific flagged topics.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Family activity chart */}
              {activity.length > 0 && (
                <FamilyChart activity={activity} children={children} />
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
