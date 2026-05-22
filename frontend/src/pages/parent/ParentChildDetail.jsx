import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getChildDetail, getChildSessions, getChildWeeklyReport, setChildGoal } from '../../api/client'

// ── Support tips per subject (task #33) ─────────────────────────────────────
const SUPPORT_TIPS = {
  Mathematics:      "Work through a similar problem step-by-step together, asking them to explain each step aloud.",
  Science:          "Watch a short video on the concept together and discuss what they observed.",
  English:          "Read a short passage together and ask them to retell it in their own words.",
  History:          "Look at a timeline together — ask them to tell you the story of the events.",
  Geography:        "Use a map or globe to make the concept visual and concrete.",
  Physics:          "Try a simple at-home experiment that demonstrates the principle.",
  Chemistry:        "Connect it to everyday life — cooking, cleaning products, and rusting all involve chemistry!",
  Biology:          "Talk about how the concept relates to their own body or the local environment.",
  'Social Studies': "Discuss a current news story that connects to what they're learning.",
  'Computer Science': "Ask them to explain the concept to you — teaching is the best way to master something.",
  Tamil:            "Read a passage aloud together and discuss the meaning of unfamiliar words.",
  Hindi:            "Read a passage aloud together and discuss the meaning of unfamiliar words.",
  Other:            "Ask them to explain the topic in their own words — this reveals where the gaps are.",
}

const SUBJECT_EMOJI = {
  Mathematics: '🔢', Science: '🔬', English: '📖', 'Social Studies': '🌍',
  History: '🏛️', Geography: '🗺️', Physics: '⚡', Chemistry: '🧪',
  Biology: '🌿', 'Computer Science': '💻', Tamil: '🔤', Hindi: '🔤', Other: '📚',
}

const LEVEL_COLOR = {
  L1: 'text-[#8892B0]', L2: 'text-blue-400', L3: 'text-green-400',
  L4: 'text-purple-400', L5: 'text-yellow-300',
}

const MASTERY_ICON = {
  null:  '⬜',
  L1:    '🟡',
  L2:    '🔵',
  L3:    '🟢',
  L4:    '🟣',
  L5:    '⭐',
}

function timeAgo(isoStr) {
  if (!isoStr) return '—'
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000)
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 2) return 'Yesterday'
  return new Date(isoStr).toLocaleDateString()
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function WeekBar({ weekly }) {
  if (!weekly?.length) return null
  const max = Math.max(...weekly.map(d => d.sessions), 1)
  return (
    <div className="flex items-end gap-2 h-10">
      {weekly.map(({ date, sessions }) => {
        const dayLabel = DAYS[new Date(date + 'T00:00:00').getDay()]
        const isToday = date === new Date().toISOString().slice(0, 10)
        return (
          <div key={date} className="flex-1 flex flex-col items-center gap-0.5">
            <div className="w-full flex items-end justify-center" style={{ height: '32px' }}>
              <div
                className={`w-full rounded-t ${sessions > 0 ? (isToday ? 'bg-[#FFD700]' : 'bg-[#00A2FF]') : 'bg-[#2D2B5A]'}`}
                style={{ height: sessions > 0 ? `${Math.max((sessions / max) * 100, 20)}%` : '6px', minHeight: '4px' }}
                title={`${sessions} session${sessions !== 1 ? 's' : ''}`}
              />
            </div>
            <span className={`text-[9px] ${isToday ? 'text-[#FFD700]' : 'text-[#8892B0]'}`}>{dayLabel}</span>
          </div>
        )
      })}
    </div>
  )
}

function SubjectBar({ subj, mastered, attempted }) {
  const pct = attempted > 0 ? Math.round((mastered / attempted) * 100) : 0
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-white font-semibold">
          {SUBJECT_EMOJI[subj] || '📚'} {subj}
        </span>
        <span className="text-[#8892B0]">{mastered}/{attempted} mastered</span>
      </div>
      <div className="h-2 bg-[#2D2B5A] rounded-full overflow-hidden">
        <div className="h-full bg-[#00CC88] rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

const PAGE = 10

function WeeklyReportCard({ report }) {
  if (!report) return null
  const { this_week, last_week, delta_sessions, new_masteries } = report
  const deltaColor = delta_sessions > 0 ? 'text-[#00CC88]' : delta_sessions < 0 ? 'text-[#FF6B6B]' : 'text-[#8892B0]'
  const deltaIcon = delta_sessions > 0 ? '↑' : delta_sessions < 0 ? '↓' : '→'

  return (
    <div className="blox-card p-5">
      <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-3">
        📅 This week vs last week
      </p>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[#0F0F23] rounded-xl p-3 text-center">
          <p className="text-xl font-fredoka font-bold text-[#00A2FF]">{this_week.sessions}</p>
          <p className="text-[10px] text-[#8892B0]">Sessions</p>
          <p className={`text-xs font-bold ${deltaColor}`}>
            {deltaIcon} {Math.abs(delta_sessions)} vs last
          </p>
        </div>
        <div className="bg-[#0F0F23] rounded-xl p-3 text-center">
          <p className="text-xl font-fredoka font-bold text-[#00CC88]">{this_week.topics_count}</p>
          <p className="text-[10px] text-[#8892B0]">Topics</p>
          <p className="text-xs text-[#4A5568]">{last_week.topics_count} last wk</p>
        </div>
        <div className="bg-[#0F0F23] rounded-xl p-3 text-center">
          <p className="text-xl font-fredoka font-bold text-[#FFD700]">⭐{this_week.xp_earned}</p>
          <p className="text-[10px] text-[#8892B0]">XP this week</p>
          <p className="text-xs text-[#4A5568]">{this_week.total_xp} total</p>
        </div>
      </div>
      {new_masteries?.length > 0 && (
        <div>
          <p className="text-xs text-[#00CC88] font-semibold mb-2">🏆 New levels this week</p>
          <div className="flex flex-wrap gap-2">
            {new_masteries.map((m, i) => (
              <span key={i} className="text-xs bg-[#00CC88]/10 text-[#00CC88] border border-[#00CC88]/20 px-2 py-1 rounded-full">
                {m.level} · {m.topic_title}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ParentChildDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [child, setChild] = useState(null)
  const [sessions, setSessions] = useState([])
  const [weeklyReport, setWeeklyReport] = useState(null)
  const [loading, setLoading]           = useState(true)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [offset, setOffset]             = useState(0)
  const [hasMore, setHasMore]           = useState(false)
  const [activeTab, setActiveTab]       = useState('overview')
  const [goalEditing, setGoalEditing]   = useState(false)
  const [goalValue, setGoalValue]       = useState(1)
  const [goalSaving, setGoalSaving]     = useState(false)

  useEffect(() => {
    Promise.all([
      getChildDetail(id),
      getChildWeeklyReport(id).catch(() => null),
    ]).then(([r, w]) => {
      setChild(r.data)
      setGoalValue(r.data?.student?.daily_goal_sessions || 1)
      if (w) setWeeklyReport(w.data)
    }).finally(() => setLoading(false))
    loadSessions(0)
  }, [id])

  async function loadSessions(off) {
    setSessionsLoading(true)
    try {
      const r = await getChildSessions(id, PAGE, off)
      if (off === 0) setSessions(r.data)
      else setSessions(prev => [...prev, ...r.data])
      setHasMore(r.data.length === PAGE)
      setOffset(off + PAGE)
    } catch {}
    finally { setSessionsLoading(false) }
  }

  async function saveGoal() {
    setGoalSaving(true)
    try {
      await setChildGoal(id, goalValue)
      setChild(prev => prev ? {
        ...prev,
        student: { ...prev.student, daily_goal_sessions: goalValue }
      } : prev)
      setGoalEditing(false)
    } catch {}
    finally { setGoalSaving(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="text-4xl animate-bounce mb-3">⭐</div>
        <p className="text-[#8892B0]">Loading…</p>
      </div>
    </div>
  )

  if (!child) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-[#8892B0]">Student not found.</p>
    </div>
  )

  const { student, summary, subject_summary = [], topic_mastery = [],
          flagged_topics = [], recent_sessions = [], weekly_activity } = child
  const flagged = topic_mastery.filter(m => m.flagged_for_review)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/parent')}
          className="text-[#8892B0] hover:text-white text-sm font-nunito transition-colors"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF6B9D] to-[#FF3333] flex items-center justify-center text-white font-fredoka font-bold text-lg">
            {student.name[0]}
          </div>
          <div>
            <h1 className="text-xl font-fredoka font-bold text-white">{student.name}</h1>
            <p className="text-xs text-[#8892B0]">Grade {student.grade}</p>
          </div>
        </div>
        {flagged.length > 0 && (
          <span className="ml-auto text-xs bg-[#FF3333]/20 text-[#FF6B6B] border border-[#FF3333]/30 px-3 py-1 rounded-full font-semibold">
            🚩 {flagged.length} need{flagged.length === 1 ? 's' : ''} attention
          </span>
        )}
      </div>

      {/* ── Stat strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Sessions',  value: summary.total_sessions,      color: 'text-[#00A2FF]' },
          { label: 'Mastered',  value: summary.topics_at_l3_or_above, color: 'text-[#00CC88]' },
          { label: 'Streak',    value: summary.streak_days > 0 ? `🔥 ${summary.streak_days}d` : '—',
            color: 'text-[#FFD700]' },
          { label: 'This week', value: `${summary.sessions_this_week ?? 0} sess`,
            color: 'text-[#8892B0]' },
        ].map(({ label, value, color }) => (
          <div key={label} className="blox-card p-3 text-center">
            <p className={`text-xl font-fredoka font-bold ${color}`}>{value}</p>
            <p className="text-xs text-[#8892B0] mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Weekly activity ──────────────────────────────────── */}
      {weekly_activity && (
        <div className="blox-card p-4">
          <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-3">
            📅 This week
          </p>
          <WeekBar weekly={weekly_activity} />
        </div>
      )}

      {/* ── Daily goal card (task #15) ───────────────────────── */}
      <div className="blox-card p-4 flex items-center gap-4 animate-bounce-in">
        <div className="flex-shrink-0 text-center">
          <p className="text-2xl font-fredoka font-bold text-[#00A2FF]">
            {student.sessions_today ?? 0}/{student.daily_goal_sessions ?? 1}
          </p>
          <p className="text-[10px] text-[#8892B0]">today's sessions</p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="h-2 bg-[#2D2B5A] rounded-full overflow-hidden mb-1">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                (student.sessions_today ?? 0) >= (student.daily_goal_sessions ?? 1)
                  ? 'bg-[#00CC88]' : 'bg-[#00A2FF]'
              }`}
              style={{ width: `${Math.min(((student.sessions_today ?? 0) / (student.daily_goal_sessions ?? 1)) * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-white font-semibold">
            {(student.sessions_today ?? 0) >= (student.daily_goal_sessions ?? 1)
              ? '🎉 Goal reached today!'
              : `Daily goal: ${student.daily_goal_sessions ?? 1} session${(student.daily_goal_sessions ?? 1) !== 1 ? 's' : ''}/day`}
          </p>
        </div>
        <button
          onClick={() => setGoalEditing(e => !e)}
          className="flex-shrink-0 text-xs text-[#00A2FF] hover:text-white border border-[#00A2FF]/40 hover:border-[#00A2FF] rounded-xl px-3 py-1.5 transition-all font-nunito"
        >
          Set goal
        </button>
      </div>

      {goalEditing && (
        <div className="blox-card p-4 space-y-3 animate-bounce-in">
          <p className="text-xs text-[#8892B0] font-semibold uppercase tracking-widest">
            🎯 Set daily goal for {student.name}
          </p>
          <div className="flex gap-2 justify-center">
            {[1, 2, 3, 4, 5].map(g => (
              <button
                key={g}
                onClick={() => setGoalValue(g)}
                className={`w-11 h-11 rounded-xl font-fredoka font-bold text-lg transition-all border-2 ${
                  goalValue === g
                    ? 'border-[#00A2FF] bg-[#00A2FF] text-white'
                    : 'border-[#2D2B5A] text-[#8892B0] hover:border-[#8892B0] hover:text-white'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveGoal}
              disabled={goalSaving}
              className="btn-blox-primary flex-1 py-2.5 text-sm disabled:opacity-50"
            >
              {goalSaving ? 'Saving…' : `Set to ${goalValue} session${goalValue !== 1 ? 's' : ''}/day`}
            </button>
            <button
              onClick={() => setGoalEditing(false)}
              className="px-4 py-2.5 text-sm text-[#8892B0] border border-[#2D2B5A] hover:border-[#8892B0] rounded-xl transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Needs attention + support tips (tasks #15, #33) ─── */}
      {flagged.length > 0 && (
        <div className="blox-card p-4 border-[#FF3333]/40">
          <p className="text-sm font-fredoka font-bold text-[#FF6B6B] mb-3">
            🚩 Needs attention ({flagged.length})
          </p>
          <div className="space-y-3">
            {flagged_topics.map((m, i) => {
              const tip = SUPPORT_TIPS[m.subject] || SUPPORT_TIPS.Other
              return (
                <div key={i} className="py-2 border-b border-[#2D2B5A] last:border-0">
                  <div className="flex items-start gap-3">
                    <span className="text-lg">{MASTERY_ICON[m.mastery_level] || '🚩'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{m.topic_title}</p>
                      <p className="text-xs text-[#8892B0]">{m.chapter_title}</p>
                    </div>
                  </div>
                  {/* Support tip (task #33) */}
                  <div className="mt-2 bg-[#00A2FF]/5 border border-[#00A2FF]/20 rounded-xl px-3 py-2 flex items-start gap-2">
                    <span className="text-sm flex-shrink-0">💡</span>
                    <p className="text-xs text-[#8892B0] leading-relaxed">{tip}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Weekly report ───────────────────────────────────── */}
      <WeeklyReportCard report={weeklyReport} />

      {/* ── Tabs ────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {[
          { id: 'overview',  label: '📊 Overview' },
          { id: 'mastery',   label: '🏆 Topic Mastery' },
          { id: 'sessions',  label: '📋 Sessions' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-nunito font-semibold transition-all ${
              activeTab === t.id
                ? 'bg-[#00A2FF] text-white'
                : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-3">
          {subject_summary.length === 0 ? (
            <div className="blox-card p-6 text-center">
              <p className="text-[#8892B0]">No topics practised yet.</p>
            </div>
          ) : (
            <div className="blox-card p-5 space-y-4">
              <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold">
                📚 Subject progress
              </p>
              {subject_summary
                .sort((a, b) => b.attempted - a.attempted)
                .map(s => (
                  <SubjectBar key={s.subject} subj={s.subject} mastered={s.mastered} attempted={s.attempted} />
                ))
              }
            </div>
          )}
        </div>
      )}

      {/* ── Topic Mastery tab ───────────────────────────────── */}
      {activeTab === 'mastery' && (
        <div className="space-y-2">
          {topic_mastery.length === 0 ? (
            <div className="blox-card p-6 text-center">
              <p className="text-[#8892B0]">No topics practised yet.</p>
            </div>
          ) : (
            topic_mastery.map((m, i) => (
              <div
                key={i}
                className={`blox-card px-4 py-3 flex items-center gap-3 ${
                  m.flagged_for_review ? 'border-[#FF3333]/40' : ''
                }`}
              >
                <span className="text-lg flex-shrink-0">{MASTERY_ICON[m.mastery_level] || '⬜'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-nunito font-semibold text-white truncate">{m.topic_title}</p>
                  <p className="text-xs text-[#8892B0]">
                    {m.chapter_title}
                    {m.subject && ` · ${SUBJECT_EMOJI[m.subject] || ''} ${m.subject}`}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-fredoka font-bold ${LEVEL_COLOR[m.mastery_level] || 'text-[#8892B0]'}`}>
                    {m.mastery_level ?? '—'}
                  </p>
                  <p className="text-[10px] text-[#8892B0]">
                    {m.sessions_on_topic} sess
                    {m.last_practiced_at && ` · ${timeAgo(m.last_practiced_at)}`}
                  </p>
                </div>
                {m.flagged_for_review && (
                  <span className="text-[#FF6B6B] text-sm flex-shrink-0">🚩</span>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Sessions tab ────────────────────────────────────── */}
      {activeTab === 'sessions' && (
        <div className="space-y-2">
          {sessions.length === 0 && !sessionsLoading ? (
            <div className="blox-card p-6 text-center">
              <p className="text-[#8892B0]">No sessions yet.</p>
            </div>
          ) : (
            <>
              {sessions.map((s, i) => (
                <div key={i} className="blox-card px-4 py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#2D2B5A] flex items-center justify-center text-base flex-shrink-0">
                    📝
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-nunito font-semibold text-white truncate">{s.topic_title}</p>
                    <p className="text-xs text-[#8892B0]">
                      {s.questions_asked} questions
                      {s.duration_minutes > 0 && ` · ${s.duration_minutes}m`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-fredoka font-bold ${LEVEL_COLOR[s.level_reached] || 'text-white'}`}>
                      {s.level_reached}
                    </p>
                    <p className="text-[10px] text-[#8892B0]">{timeAgo(s.started_at)}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                    s.status === 'completed'
                      ? 'bg-[#00CC88]/20 text-[#00CC88]'
                      : 'bg-[#FFD700]/20 text-[#FFD700]'
                  }`}>
                    {s.status}
                  </span>
                </div>
              ))}
              {hasMore && (
                <button
                  onClick={() => loadSessions(offset)}
                  disabled={sessionsLoading}
                  className="w-full blox-card py-3 text-sm text-[#00A2FF] hover:text-white font-nunito font-semibold transition-colors disabled:opacity-50"
                >
                  {sessionsLoading ? 'Loading…' : '↓ Load more'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
