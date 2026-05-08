import { useState, useEffect } from 'react'
import { getStudentSessions } from '../../api/client'

const SUBJECT_EMOJI = {
  Mathematics: '🔢', Science: '🔬', English: '📖', 'Social Studies': '🌍',
  History: '🏛️', Geography: '🗺️', Physics: '⚡', Chemistry: '🧪',
  Biology: '🌿', 'Computer Science': '💻', Tamil: '🔤', Hindi: '🔤', Other: '📚',
}

const LEVEL_COLOR = {
  L1: 'text-[#8892B0]', L2: 'text-blue-400', L3: 'text-green-400',
  L4: 'text-purple-400', L5: 'text-yellow-300',
}

function timeAgo(isoStr) {
  if (!isoStr) return ''
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(isoStr).toLocaleDateString()
}

function formatDate(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// 12-week heatmap
function Heatmap({ sessions }) {
  // Build date → session count map for last 84 days
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const counts = {}
  for (const s of sessions) {
    if (!s.started_at) continue
    const d = s.started_at.slice(0, 10)
    counts[d] = (counts[d] || 0) + 1
  }

  // Generate 84 days (12 weeks), grouped into weeks (Sun→Sat)
  const days = []
  for (let i = 83; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }

  // Pad front to Sunday
  const firstDay = new Date(days[0] + 'T00:00:00')
  const padDays = firstDay.getDay() // 0=Sun
  const grid = [...Array(padDays).fill(null), ...days]

  // Split into weeks of 7
  const weeks = []
  for (let i = 0; i < grid.length; i += 7) {
    weeks.push(grid.slice(i, i + 7))
  }

  const maxCount = Math.max(...Object.values(counts), 1)

  function cellColor(date) {
    if (!date) return 'bg-transparent'
    const c = counts[date] || 0
    if (c === 0) return 'bg-[#2D2B5A]'
    const intensity = c / maxCount
    if (intensity < 0.25) return 'bg-[#00A2FF]/30'
    if (intensity < 0.5)  return 'bg-[#00A2FF]/55'
    if (intensity < 0.75) return 'bg-[#00A2FF]/80'
    return 'bg-[#00A2FF]'
  }

  // Row labels — only show Mon, Wed, Fri to avoid crowding
  const ROW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  return (
    <div className="flex gap-1">
      {/* Day-of-week labels (left column) */}
      <div className="flex flex-col gap-1 mr-0.5">
        {ROW_LABELS.map((l, i) => (
          <span key={i} className="h-3.5 w-3 text-[9px] text-[#8892B0] flex items-center justify-end pr-0.5">
            {i % 2 !== 0 ? l : ''}
          </span>
        ))}
      </div>
      {/* Week columns */}
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-1">
          {week.map((date, di) => (
            <div
              key={di}
              className={`w-3.5 h-3.5 rounded-sm ${cellColor(date)}`}
              title={date ? `${date}: ${counts[date] || 0} session(s)` : ''}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export default function StudentStudyTime() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [subjectFilter, setSubjectFilter] = useState('All')

  useEffect(() => {
    getStudentSessions(100)
      .then(r => setSessions(r.data))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [])

  const subjects = ['All', ...new Set(sessions.map(s => s.subject).filter(Boolean))]

  const filtered = subjectFilter === 'All'
    ? sessions
    : sessions.filter(s => s.subject === subjectFilter)

  // Study time per subject (sum of durations)
  const subjectTime = {}
  for (const s of sessions) {
    if (!s.subject) continue
    subjectTime[s.subject] = (subjectTime[s.subject] || 0) + (s.duration_minutes || 0)
  }
  const maxTime = Math.max(...Object.values(subjectTime), 1)

  // Total stats
  const totalSessions = sessions.length
  const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0)
  const totalHours = Math.floor(totalMinutes / 60)
  const remMinutes = totalMinutes % 60

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-fredoka font-bold text-white">⏱️ Study Time</h1>
        <p className="text-[#8892B0] text-sm mt-0.5">See how much time you've invested</p>
      </div>

      {loading && (
        <div className="text-center py-16">
          <div className="text-4xl animate-bounce mb-3">⏱️</div>
          <p className="text-[#8892B0]">Loading your study history…</p>
        </div>
      )}

      {!loading && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="blox-card p-3 text-center">
              <p className="text-2xl font-fredoka font-bold text-[#00A2FF]">{totalSessions}</p>
              <p className="text-xs text-[#8892B0]">sessions</p>
            </div>
            <div className="blox-card p-3 text-center">
              <p className="text-2xl font-fredoka font-bold text-[#FFD700]">
                {totalHours > 0 ? `${totalHours}h` : `${remMinutes}m`}
              </p>
              <p className="text-xs text-[#8892B0]">total time</p>
            </div>
            <div className="blox-card p-3 text-center">
              <p className="text-2xl font-fredoka font-bold text-[#00CC88]">
                {totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0}m
              </p>
              <p className="text-xs text-[#8892B0]">avg / session</p>
            </div>
          </div>

          {/* Activity heatmap */}
          {sessions.length > 0 && (
            <div className="blox-card p-4 overflow-x-auto">
              <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-3">
                📅 12-week activity
              </p>
              <Heatmap sessions={sessions} />
              <div className="flex items-center gap-2 mt-3 text-xs text-[#8892B0]">
                <span>Less</span>
                <div className="w-3 h-3 rounded-sm bg-[#2D2B5A]" />
                <div className="w-3 h-3 rounded-sm bg-[#00A2FF]/30" />
                <div className="w-3 h-3 rounded-sm bg-[#00A2FF]/55" />
                <div className="w-3 h-3 rounded-sm bg-[#00A2FF]/80" />
                <div className="w-3 h-3 rounded-sm bg-[#00A2FF]" />
                <span>More</span>
              </div>
            </div>
          )}

          {/* Subject time bars */}
          {Object.keys(subjectTime).length > 0 && (
            <div className="blox-card p-4">
              <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-3">
                📚 Time by subject
              </p>
              <div className="space-y-3">
                {Object.entries(subjectTime)
                  .sort((a, b) => b[1] - a[1])
                  .map(([subj, mins]) => (
                    <div key={subj}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-white font-semibold">
                          {SUBJECT_EMOJI[subj] || '📚'} {subj}
                        </span>
                        <span className="text-[#8892B0]">
                          {mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}
                        </span>
                      </div>
                      <div className="h-2 bg-[#2D2B5A] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#00A2FF] rounded-full transition-all duration-700"
                          style={{ width: `${(mins / maxTime) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {/* Subject filter tabs */}
          {sessions.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {subjects.map(s => (
                <button
                  key={s}
                  onClick={() => setSubjectFilter(s)}
                  className={`px-3 py-1.5 rounded-full text-sm font-nunito font-semibold transition-all ${
                    subjectFilter === s
                      ? 'bg-[#00A2FF] text-white'
                      : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
                  }`}
                >
                  {s === 'All' ? '📋 All' : `${SUBJECT_EMOJI[s] || '📚'} ${s}`}
                </button>
              ))}
            </div>
          )}

          {/* Session list */}
          {filtered.length === 0 ? (
            <div className="blox-card p-8 text-center">
              <div className="text-5xl mb-3">📭</div>
              <p className="text-white font-fredoka text-lg">No sessions yet</p>
              <p className="text-[#8892B0] text-sm mt-1">Start practicing to build your study history!</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold px-1">
                📋 Recent sessions
              </p>
              {filtered.map(s => (
                <div key={s.id} className="blox-card p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#2D2B5A] flex items-center justify-center text-lg flex-shrink-0">
                    {SUBJECT_EMOJI[s.subject] || '📚'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-nunito font-semibold text-white text-sm truncate">{s.topic_title}</p>
                    <p className="text-xs text-[#8892B0] truncate">{s.chapter_title}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-fredoka font-bold ${LEVEL_COLOR[s.level_reached] || 'text-white'}`}>
                      {s.level_reached}
                    </p>
                    <p className="text-xs text-[#8892B0]">
                      {s.duration_minutes != null ? `${s.duration_minutes}m` : '—'}
                      {' · '}{timeAgo(s.started_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
