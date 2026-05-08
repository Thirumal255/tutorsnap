import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { getStudentDashboard, startSession } from '../../api/client'
import { SUBJECT_COLOR } from './StudentLayout'

const SUBJECT_EMOJI = {
  Mathematics: '🔢', Science: '🔬', English: '📖', 'Social Studies': '🌍',
  History: '🏛️', Geography: '🗺️', Physics: '⚡', Chemistry: '🧪',
  Biology: '🌿', 'Computer Science': '💻', Tamil: '🔤', Hindi: '🔤', Other: '📚',
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function MasteryBar({ attempted, mastered, total }) {
  const pctAttempted = total ? Math.round((attempted / total) * 100) : 0
  const pctMastered  = total ? Math.round((mastered / total) * 100) : 0
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-[#8892B0] mb-1">
        <span>{pctMastered}% mastered</span>
        <span>{attempted}/{total} tried</span>
      </div>
      <div className="h-2 bg-[#2D2B5A] rounded-full overflow-hidden">
        <div className="h-full bg-[#2D2B5A] rounded-full relative">
          {/* attempted (lighter) */}
          <div
            className="absolute inset-y-0 left-0 bg-[#00A2FF]/40 rounded-full transition-all duration-700"
            style={{ width: `${pctAttempted}%` }}
          />
          {/* mastered (solid) */}
          <div
            className="absolute inset-y-0 left-0 bg-[#00CC88] rounded-full transition-all duration-700"
            style={{ width: `${pctMastered}%` }}
          />
        </div>
      </div>
    </div>
  )
}

export default function StudentHome() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [resuming, setResuming] = useState(false)

  useEffect(() => {
    getStudentDashboard()
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  async function handleContinue(topicId) {
    setResuming(true)
    try {
      const res = await startSession(user.name, topicId)
      const d = res.data
      sessionStorage.setItem(
        `session_${d.session_id}`,
        JSON.stringify({
          sessionId: d.session_id, studentName: d.student_name,
          topicTitle: d.topic_title, chapterTitle: d.chapter_title,
          initialMessage: d.message, currentLevel: d.current_level,
          levelLabel: d.level_label, topicId,
        })
      )
      navigate(`/session/${d.session_id}`)
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to start session')
    } finally {
      setResuming(false)
    }
  }

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  if (!user?.grade) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="blox-card p-8 max-w-sm text-center">
          <div className="text-5xl mb-4">⏳</div>
          <h2 className="text-xl font-fredoka font-bold text-white mb-2">Almost ready!</h2>
          <p className="text-[#8892B0] text-sm">Ask your admin to assign your grade.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* ── Greeting bar ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-fredoka font-bold text-white">
            {greeting()}, <span className="text-[#FFD700]">{user?.name?.split(' ')[0]}</span>! 👋
          </h1>
          <p className="text-[#8892B0] text-sm mt-0.5">Grade {user.grade} · Let's level up today!</p>
        </div>
        {data && (
          <div className="flex gap-4 text-center">
            <div className="blox-card px-4 py-2">
              <p className="text-2xl font-fredoka font-bold text-[#FFD700]">
                {data.streak_days > 0 ? `🔥 ${data.streak_days}` : '—'}
              </p>
              <p className="text-xs text-[#8892B0]">day streak</p>
            </div>
            <div className="blox-card px-4 py-2">
              <p className="text-2xl font-fredoka font-bold text-[#00A2FF]">{data.total_sessions}</p>
              <p className="text-xs text-[#8892B0]">sessions</p>
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div className="text-center py-16">
          <div className="text-4xl animate-bounce mb-3">🎮</div>
          <p className="text-[#8892B0]">Loading your dashboard…</p>
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── Continue card ─────────────────────────────────────── */}
          {data.last_practiced && (
            <div className="blox-card-glow p-4 flex items-center gap-4 animate-bounce-in">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FF6B9D] to-[#FF3333] flex items-center justify-center text-2xl flex-shrink-0">
                ▶
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#8892B0] font-semibold uppercase tracking-widest">Continue where you left off</p>
                <p className="font-fredoka font-bold text-white mt-0.5 truncate">{data.last_practiced.topic_title}</p>
                <p className="text-xs text-[#8892B0] mt-0.5">
                  {data.last_practiced.subject} · {data.last_practiced.chapter_title}
                </p>
              </div>
              <button
                onClick={() => handleContinue(data.last_practiced.topic_id)}
                disabled={resuming}
                className="btn-blox-primary flex-shrink-0 text-sm py-2 px-5 disabled:opacity-50"
              >
                {resuming ? '⚡…' : 'Resume ⚔️'}
              </button>
            </div>
          )}

          {/* ── Weekly activity bar chart ──────────────────────────── */}
          <div className="blox-card p-4 animate-bounce-in">
            <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-3">
              📅 This week's activity
            </p>
            <div className="flex items-end gap-2 h-16">
              {data.weekly_activity.map(({ date, sessions }) => {
                const maxSess = Math.max(...data.weekly_activity.map(d => d.sessions), 1)
                const pct = sessions / maxSess
                const dayLabel = DAYS[new Date(date + 'T00:00:00').getDay()]
                const isToday = date === new Date().toISOString().slice(0, 10)
                return (
                  <div key={date} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col justify-end" style={{ height: '48px' }}>
                      <div
                        className={`w-full rounded-t transition-all duration-700 ${
                          sessions > 0
                            ? isToday ? 'bg-[#FFD700]' : 'bg-[#00A2FF]'
                            : 'bg-[#2D2B5A]'
                        }`}
                        style={{ height: sessions > 0 ? `${Math.max(pct * 100, 20)}%` : '20%', minHeight: '4px' }}
                        title={`${sessions} session${sessions !== 1 ? 's' : ''}`}
                      />
                    </div>
                    <span className={`text-xs font-semibold ${isToday ? 'text-[#FFD700]' : 'text-[#8892B0]'}`}>
                      {dayLabel}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Subject progress grid ──────────────────────────────── */}
          <div>
            <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-3 px-1">
              📚 Subject progress
            </p>
            {data.subject_stats.length === 0 ? (
              <div className="blox-card p-6 text-center">
                <p className="text-[#8892B0]">No books assigned for Grade {user.grade} yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.subject_stats.map((s, i) => {
                  const gradient = SUBJECT_COLOR[s.subject] || SUBJECT_COLOR.Other
                  return (
                    <div
                      key={s.subject}
                      className="blox-card p-4 animate-bounce-in blox-hover cursor-pointer"
                      style={{ animationDelay: `${i * 0.05}s` }}
                      onClick={() => navigate('/practice', { state: { subject: s.subject } })}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-xl flex-shrink-0`}>
                          {SUBJECT_EMOJI[s.subject] || '📚'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-fredoka font-bold text-white">{s.subject}</p>
                          <p className="text-xs text-[#8892B0]">
                            {s.mastered} mastered · {s.flagged > 0 ? <span className="text-[#FF6B6B]">{s.flagged} flagged</span> : `${s.attempted} tried`}
                          </p>
                        </div>
                        {s.flagged > 0 && (
                          <span className="text-xs bg-[#FF3333]/20 text-[#FF6B6B] border border-[#FF3333]/30 px-2 py-0.5 rounded-full">
                            🚩 {s.flagged}
                          </span>
                        )}
                      </div>
                      <MasteryBar attempted={s.attempted} mastered={s.mastered} total={s.total_topics} />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
