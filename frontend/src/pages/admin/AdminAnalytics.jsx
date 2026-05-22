import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAdminAnalytics } from '../../api/client'

const SUBJECT_EMOJI = {
  Mathematics: '🔢', Science: '🔬', English: '📖', 'Social Studies': '🌍',
  History: '🏛️', Geography: '🗺️', Physics: '⚡', Chemistry: '🧪',
  Biology: '🌿', 'Computer Science': '💻', Tamil: '🔤', Hindi: '🔤', Other: '📚',
}

const MASTERY_COLORS = {
  L1: '#FFB347', L2: '#00A2FF', L3: '#00CC88', L4: '#C084FC', L5: '#FBBF24',
}
const MASTERY_LABELS = {
  L1: 'Learning', L2: 'Developing', L3: 'Practising', L4: 'Going Deeper', L5: 'Challenge',
}

function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ── Mini bar chart ────────────────────────────────────────────────────────────
function TrendChart({ data }) {
  if (!data?.length) return null
  const max = Math.max(...data.map(d => d.sessions), 1)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex items-end gap-1 h-24 w-full">
      {data.map(d => {
        const isToday = d.date === today
        const pct = (d.sessions / max) * 100
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${formatDate(d.date)}: ${d.sessions} sessions`}>
            <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
              <div
                className={`w-full rounded-t transition-all duration-700 ${isToday ? 'bg-[#FFD700]' : 'bg-[#00A2FF]'}`}
                style={{
                  height: d.sessions > 0 ? `${Math.max(pct, 8)}%` : '4px',
                  minHeight: '4px',
                  opacity: isToday ? 1 : 0.8,
                }}
              />
            </div>
            {/* Only show every other label to avoid clutter */}
            <span className={`text-[9px] hidden sm:block ${isToday ? 'text-[#FFD700]' : 'text-[#4A5568]'}`}>
              {formatDate(d.date).split(' ')[0]}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Donut chart (pure CSS/SVG) ────────────────────────────────────────────────
function DonutChart({ distribution }) {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0)
  if (total === 0) return (
    <div className="flex items-center justify-center h-32 text-[#8892B0] text-sm">No data yet</div>
  )

  let cumPct = 0
  const segments = Object.entries(MASTERY_COLORS).map(([level, color]) => {
    const count = distribution[level] || 0
    const pct = count / total
    const start = cumPct
    cumPct += pct
    return { level, color, pct, start, count }
  }).filter(s => s.count > 0)

  const r = 40
  const cx = 50, cy = 50
  const C = 2 * Math.PI * r

  let strokeOffset = 0
  const arcs = segments.map(s => {
    const dash = s.pct * C
    const gap = C - dash
    const arc = { ...s, dash, gap, offset: C - strokeOffset }
    strokeOffset += dash
    return arc
  })

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 100 100" className="w-28 h-28 flex-shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#2D2B5A" strokeWidth="16" />
        {arcs.map((arc, i) => (
          <circle
            key={arc.level}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={arc.color}
            strokeWidth="16"
            strokeDasharray={`${arc.dash} ${arc.gap}`}
            strokeDashoffset={arc.offset}
            transform="rotate(-90, 50, 50)"
          />
        ))}
        <text x={cx} y={cy} textAnchor="middle" dy="5" className="fill-white text-sm font-bold" style={{ fontSize: '14px', fontWeight: 'bold', fill: 'white' }}>
          {total}
        </text>
      </svg>
      <div className="space-y-1.5">
        {segments.map(s => (
          <div key={s.level} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="text-xs text-[#8892B0]">{MASTERY_LABELS[s.level]}</span>
            <span className="text-xs font-fredoka font-bold text-white ml-auto">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function AdminAnalytics() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAdminAnalytics()
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }, [])

  const totalSessions14d = data?.sessions_trend?.reduce((a, d) => a + d.sessions, 0) ?? 0

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-fredoka font-bold text-white">📊 Analytics</h1>
        <p className="text-[#8892B0] text-sm mt-0.5">Platform engagement & learning insights</p>
      </div>

      {loading && (
        <div className="text-center py-20">
          <div className="text-4xl animate-bounce mb-3">📊</div>
          <p className="text-[#8892B0]">Crunching the numbers…</p>
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── 14-day trend ─────────────────────────────────── */}
          <div className="blox-card p-5 animate-bounce-in">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold">
                  📅 Sessions — last 14 days
                </p>
                <p className="text-2xl font-fredoka font-bold text-white mt-1">{totalSessions14d}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-[#8892B0]">Today</p>
                <p className="text-xl font-fredoka font-bold text-[#FFD700]">
                  {data.sessions_trend[data.sessions_trend.length - 1]?.sessions ?? 0}
                </p>
              </div>
            </div>
            <TrendChart data={data.sessions_trend} />
          </div>

          {/* ── Two-column: Grade + Mastery ────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Grade breakdown */}
            <div className="blox-card p-5 animate-bounce-in" style={{ animationDelay: '0.1s' }}>
              <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-4">
                🎓 Grade breakdown
              </p>
              {data.grade_breakdown.length === 0 ? (
                <p className="text-[#8892B0] text-sm">No grade data yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.grade_breakdown.map(g => {
                    const maxSess = Math.max(...data.grade_breakdown.map(x => x.sessions), 1)
                    return (
                      <div key={g.grade}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="font-fredoka font-bold text-white">Grade {g.grade}</span>
                          <div className="flex items-center gap-3 text-xs text-[#8892B0]">
                            <span>{g.students} student{g.students !== 1 ? 's' : ''}</span>
                            <span className="text-[#00A2FF] font-semibold">{g.sessions} sess</span>
                          </div>
                        </div>
                        <div className="h-2 bg-[#2D2B5A] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#00A2FF] rounded-full transition-all duration-700"
                            style={{ width: `${(g.sessions / maxSess) * 100}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Mastery distribution donut */}
            <div className="blox-card p-5 animate-bounce-in" style={{ animationDelay: '0.15s' }}>
              <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-4">
                🏆 Mastery distribution
              </p>
              <DonutChart distribution={data.mastery_distribution} />
            </div>
          </div>

          {/* ── Subject breakdown ────────────────────────────────── */}
          {data.subject_breakdown.length > 0 && (
            <div className="blox-card p-5 animate-bounce-in" style={{ animationDelay: '0.2s' }}>
              <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-4">
                📚 Subject performance
              </p>
              <div className="space-y-3">
                {data.subject_breakdown.slice(0, 8).map(s => {
                  const max = Math.max(...data.subject_breakdown.map(x => x.sessions), 1)
                  return (
                    <div key={s.subject} className="flex items-center gap-4">
                      <span className="text-xl w-7 flex-shrink-0">{SUBJECT_EMOJI[s.subject] || '📚'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold text-white">{s.subject}</span>
                          <div className="flex items-center gap-3 text-[#8892B0]">
                            <span>{s.sessions} sessions</span>
                            {s.flags > 0 && (
                              <span className="text-[#FF6B6B]">🚩 {s.flags}</span>
                            )}
                          </div>
                        </div>
                        <div className="h-2 bg-[#2D2B5A] rounded-full overflow-hidden flex">
                          <div
                            className="h-full bg-[#00CC88] rounded-full transition-all duration-700"
                            style={{ width: `${(s.sessions / max) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Hardest topics (#61) ────────────────────────────── */}
          {data.hardest_topics?.length > 0 && (
            <div className="blox-card p-5 animate-bounce-in" style={{ animationDelay: '0.22s' }}>
              <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-4">
                🚩 Hardest topics (most flags)
              </p>
              <div className="space-y-2">
                {data.hardest_topics.map((t, i) => {
                  const maxFlags = Math.max(...data.hardest_topics.map(x => x.flags), 1)
                  return (
                    <div key={t.topic_id} className="flex items-center gap-3">
                      <span className="text-xs font-fredoka font-bold text-[#8892B0] w-4 flex-shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold text-white truncate block">{t.title}</span>
                            <span className="text-[#8892B0]">{SUBJECT_EMOJI[t.subject] || '📚'} {t.subject}</span>
                          </div>
                          <span className="text-[#FF6B6B] font-fredoka font-bold ml-3 flex-shrink-0">
                            🚩 {t.flags}
                          </span>
                        </div>
                        <div className="h-1.5 bg-[#2D2B5A] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#FF6B6B] rounded-full transition-all duration-700"
                            style={{ width: `${(t.flags / maxFlags) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Top students leaderboard ─────────────────────────── */}
          <div className="blox-card p-5 animate-bounce-in" style={{ animationDelay: '0.25s' }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold">
                ⭐ Top students by XP
              </p>
              <button
                onClick={() => navigate('/admin/students')}
                className="text-xs text-[#00A2FF] hover:text-white font-semibold transition-colors"
              >
                View all →
              </button>
            </div>
            {data.top_students.length === 0 ? (
              <p className="text-[#8892B0] text-sm">No XP data yet. Students earn XP by practising!</p>
            ) : (
              <div className="space-y-2">
                {data.top_students.map((s, i) => (
                  <div
                    key={s.id}
                    onClick={() => navigate(`/admin/students/${s.id}`)}
                    className="flex items-center gap-4 px-3 py-2.5 rounded-xl hover:bg-[#1A1A3E] transition-colors cursor-pointer"
                  >
                    <span className={`text-lg font-fredoka font-bold w-6 text-center flex-shrink-0 ${
                      i === 0 ? 'text-[#FFD700]' : i === 1 ? 'text-[#C0C0C0]' : i === 2 ? 'text-[#CD7F32]' : 'text-[#8892B0]'
                    }`}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                    </span>
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#00A2FF] to-[#0066CC] flex items-center justify-center text-white font-fredoka font-bold text-sm flex-shrink-0">
                      {s.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-nunito font-semibold text-white truncate">{s.name}</p>
                      <p className="text-xs text-[#8892B0]">
                        Grade {s.grade ?? '?'} · {s.topics_mastered} mastered
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-yellow-400">⭐</span>
                      <span className="text-white font-fredoka font-bold">{s.total_xp.toLocaleString()}</span>
                      <span className="text-xs text-[#8892B0]">XP</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Platform health summary ──────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: '14d Sessions', value: totalSessions14d, icon: '📊', color: 'text-[#00A2FF]',
              },
              {
                label: 'Active Grades', value: data.grade_breakdown.length, icon: '🎓', color: 'text-[#00CC88]',
              },
              {
                label: 'Subjects', value: data.subject_breakdown.length, icon: '📚', color: 'text-[#C084FC]',
              },
              {
                label: 'Total Flags', value: data.subject_breakdown.reduce((a, s) => a + s.flags, 0),
                icon: '🚩', color: 'text-[#FF6B6B]',
              },
            ].map(card => (
              <div key={card.label} className="blox-card p-4 text-center animate-bounce-in">
                <p className="text-2xl mb-1">{card.icon}</p>
                <p className={`text-2xl font-fredoka font-bold ${card.color}`}>{card.value}</p>
                <p className="text-xs text-[#8892B0] mt-0.5">{card.label}</p>
              </div>
            ))}
          </div>

          {/* ── AI metadata (#65 prompt version, #66 confidence, cost) ─── */}
          <div className="blox-card p-4 animate-bounce-in flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">🤖</span>
              <div>
                <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold">AI metadata</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 ml-auto">
              {data.prompt_version && (
                <span className="text-xs bg-[#A78BFA]/10 text-[#A78BFA] border border-[#A78BFA]/30 px-3 py-1.5 rounded-full font-fredoka font-bold">
                  Prompt v{data.prompt_version}
                </span>
              )}
              {data.ai_cost_7d !== undefined && (
                <span className="text-xs bg-[#FFD700]/10 text-[#FFD700] border border-[#FFD700]/30 px-3 py-1.5 rounded-full font-semibold font-nunito">
                  💰 ${data.ai_cost_7d.toFixed(4)} / 7d
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
