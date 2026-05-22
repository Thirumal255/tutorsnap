import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAdminOverview, getFlaggedStudents, resolveFlag, draftWeeklyChallenge, publishWeeklyChallenge } from '../../api/client'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function StatCard({ label, value, icon, color, sub, glow, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`blox-card p-5 animate-bounce-in flex flex-col gap-3
        ${glow ? 'border-[#FF3333]/50 shadow-[0_0_16px_rgba(255,51,51,0.15)]' : ''}
        ${onClick ? 'blox-hover cursor-pointer' : ''}
      `}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#8892B0] font-nunito font-semibold uppercase tracking-wider">{label}</p>
        <span className="text-2xl">{icon}</span>
      </div>
      <p className={`text-4xl font-fredoka font-bold ${color || 'text-white'}`}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-[#8892B0]">{sub}</p>}
    </div>
  )
}

export default function AdminDashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [flagged, setFlagged] = useState([])
  const [loading, setLoading] = useState(true)

  // #56 Weekly challenge draft
  const [challengeGrade, setChallengeGrade] = useState(5)
  const [draft, setDraft] = useState(null)
  const [drafting, setDrafting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishDone, setPublishDone] = useState(false)

  useEffect(() => {
    Promise.all([getAdminOverview(), getFlaggedStudents()])
      .then(([s, f]) => { setStats(s.data); setFlagged(f.data) })
      .finally(() => setLoading(false))
  }, [])

  async function handleResolve(studentId, topicId) {
    try {
      await resolveFlag(studentId, topicId)
      setFlagged(f => f.filter(x => !(x.student_id === studentId && x.topic_id === topicId)))
    } catch {}
  }

  async function handleDraft() {
    setDrafting(true)
    setDraft(null)
    setPublishDone(false)
    try {
      const r = await draftWeeklyChallenge(challengeGrade)
      setDraft(r.data)
    } catch (e) {
      setDraft({ error: e?.response?.data?.detail || 'No topics available for this grade.' })
    } finally {
      setDrafting(false)
    }
  }

  async function handlePublish() {
    if (!draft || draft.error) return
    setPublishing(true)
    try {
      await publishWeeklyChallenge({
        grade: draft.grade,
        topic_id: draft.topic_id,
        question: draft.question,
        expected_key_points: draft.expected_key_points,
        answer_format: draft.answer_format,
      })
      setPublishDone(true)
      setDraft(null)
    } catch {}
    finally { setPublishing(false) }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-fredoka font-bold text-white">Dashboard 🏠</h1>
        <p className="text-[#8892B0] text-sm mt-0.5">Welcome back, Admin! Here's your platform overview.</p>
      </div>

      {loading && (
        <div className="text-center py-16">
          <div className="text-4xl animate-bounce mb-3">📊</div>
          <p className="text-[#8892B0]">Loading overview…</p>
        </div>
      )}

      {!loading && stats && (
        <>
          {/* Stat grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard
              label="Total Students" value={stats.total_students} icon="🎮"
              color="text-[#00A2FF]"
              sub="Registered players"
              onClick={() => navigate('/admin/students')}
            />
            <StatCard
              label="Active This Week" value={stats.active_this_week} icon="⚡"
              color="text-[#00CC88]"
              sub={`of ${stats.total_students} total`}
            />
            <StatCard
              label="Sessions This Week" value={stats.total_sessions_this_week} icon="📊"
              color="text-white"
              sub="Practice battles"
            />
            <StatCard
              label="Flagged Students" value={stats.flagged_students} icon="🚩"
              color={stats.flagged_students > 0 ? 'text-[#FF3333]' : 'text-[#8892B0]'}
              glow={stats.flagged_students > 0}
              sub={stats.flagged_students > 0 ? 'Need attention' : 'All clear!'}
              onClick={() => navigate('/admin/flagged')}
            />
            <StatCard
              label="Books Uploaded" value={stats.books_uploaded} icon="📚"
              color="text-[#FFD700]"
              sub="Textbooks ingested"
              onClick={() => navigate('/admin/books')}
            />
            <StatCard
              label="Topics Available" value={stats.topics_available} icon="🗺️"
              color="text-[#A78BFA]"
              sub="Across all books"
            />
          </div>

          {/* Engagement snapshot */}
          <div className="blox-card p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold">
                ⚡ Platform engagement
              </p>
            </div>
            <div className="grid grid-cols-3 gap-6">
              {/* Activity rate */}
              <div>
                <p className="text-xs text-[#8892B0] mb-2">Active rate this week</p>
                <div className="h-2 bg-[#2D2B5A] rounded-full overflow-hidden mb-1">
                  <div
                    className="h-full bg-[#00CC88] rounded-full transition-all duration-700"
                    style={{
                      width: stats.total_students > 0
                        ? `${Math.round((stats.active_this_week / stats.total_students) * 100)}%`
                        : '0%'
                    }}
                  />
                </div>
                <p className="text-xs text-white font-semibold">
                  {stats.total_students > 0
                    ? `${Math.round((stats.active_this_week / stats.total_students) * 100)}%`
                    : '—'}
                </p>
              </div>
              {/* Avg sessions */}
              <div>
                <p className="text-xs text-[#8892B0] mb-2">Avg sessions / active student</p>
                <p className="text-2xl font-fredoka font-bold text-[#00A2FF]">
                  {stats.active_this_week > 0
                    ? (stats.total_sessions_this_week / stats.active_this_week).toFixed(1)
                    : '—'}
                </p>
                <p className="text-xs text-[#8892B0]">this week</p>
              </div>
              {/* Flag rate */}
              <div>
                <p className="text-xs text-[#8892B0] mb-2">Flag rate</p>
                <p className={`text-2xl font-fredoka font-bold ${
                  stats.flagged_students > 0 ? 'text-[#FF3333]' : 'text-[#00CC88]'
                }`}>
                  {stats.total_students > 0
                    ? `${Math.round((stats.flagged_students / stats.total_students) * 100)}%`
                    : '—'}
                </p>
                <p className="text-xs text-[#8892B0]">of students flagged</p>
              </div>
            </div>
          </div>

          {/* #56 Weekly Challenge Draft Generator */}
          <div className="blox-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-fredoka font-bold text-white">🤖 Weekly Challenge Generator</h3>
                <p className="text-xs text-[#8892B0] mt-0.5">Generate an AI draft, review it, then publish for students.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-[#8892B0] font-semibold">Grade</label>
                <select
                  value={challengeGrade}
                  onChange={e => { setChallengeGrade(Number(e.target.value)); setDraft(null); setPublishDone(false) }}
                  className="bg-[#1A1A3E] border border-[#2D2B5A] text-white text-sm rounded-xl px-3 py-1.5 focus:outline-none focus:border-[#00A2FF]"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(g => (
                    <option key={g} value={g}>Grade {g}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleDraft}
                disabled={drafting}
                className="btn-blox-primary px-5 py-2 text-sm disabled:opacity-50 flex items-center gap-2"
              >
                {drafting
                  ? <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
                  : '⚡ Generate Draft'}
              </button>
            </div>

            {publishDone && (
              <p className="text-sm text-[#00CC88] font-semibold">✅ Challenge published for Grade {challengeGrade} this week!</p>
            )}

            {draft?.error && (
              <p className="text-sm text-[#FF6B6B]">{draft.error}</p>
            )}

            {draft && !draft.error && (
              <div className="bg-[#0F0F23] rounded-2xl p-4 space-y-3 border border-[#2D2B5A]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold mb-1">
                      {draft.subject} · {draft.topic_title}
                    </p>
                    <p className="text-white font-nunito text-sm leading-relaxed">{draft.question}</p>
                  </div>
                </div>
                {draft.expected_key_points?.length > 0 && (
                  <div>
                    <p className="text-xs text-[#00CC88] font-semibold mb-1">Key points expected:</p>
                    <ul className="space-y-0.5">
                      {draft.expected_key_points.map((kp, i) => (
                        <li key={i} className="text-xs text-[#8892B0] flex gap-1.5">
                          <span className="text-[#00CC88]">•</span>{kp}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleDraft}
                    disabled={drafting}
                    className="flex-1 py-2 text-xs font-semibold text-[#8892B0] border border-[#2D2B5A] hover:border-[#8892B0] rounded-xl transition-all disabled:opacity-40"
                  >
                    🔄 Regenerate
                  </button>
                  <button
                    onClick={handlePublish}
                    disabled={publishing}
                    className="flex-1 py-2 text-xs font-semibold bg-[#00CC88]/20 text-[#00CC88] border border-[#00CC88]/30 hover:bg-[#00CC88]/30 rounded-xl transition-all disabled:opacity-40"
                  >
                    {publishing ? 'Publishing…' : '✅ Approve & Publish'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Recent flags */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-fredoka font-bold text-white">🚩 Recent Flags</h3>
              {flagged.length > 5 && (
                <button
                  onClick={() => navigate('/admin/flagged')}
                  className="text-xs text-[#00A2FF] hover:text-white font-semibold transition-colors"
                >
                  View all {flagged.length} →
                </button>
              )}
            </div>

            {flagged.length === 0 ? (
              <div className="blox-card p-8 text-center">
                <p className="text-3xl mb-2">🎉</p>
                <p className="text-[#00CC88] font-fredoka font-semibold">All clear! No flagged students.</p>
                <p className="text-[#8892B0] text-sm mt-1">Everyone's doing great!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {flagged.slice(0, 5).map((f, i) => (
                  <div key={i} className="blox-card px-4 py-3 flex items-center gap-3 border-l-4 border-l-[#FF3333] animate-bounce-in"
                    style={{ animationDelay: `${i * 0.05}s` }}>
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#FF6B9D] to-[#FF3333] flex items-center justify-center text-white font-fredoka font-bold text-sm flex-shrink-0">
                      {f.student_name?.[0] || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-nunito font-semibold text-white">{f.student_name}</p>
                      <p className="text-xs text-[#8892B0] truncate">{f.topic_title} · {f.chapter_title}</p>
                    </div>
                    {f.grade && (
                      <span className="text-xs bg-[#2D2B5A] text-[#8892B0] px-2 py-0.5 rounded-full flex-shrink-0">
                        Gr {f.grade}
                      </span>
                    )}
                    {f.student_id && (
                      <button
                        onClick={() => handleResolve(f.student_id, f.topic_id)}
                        className="text-xs bg-[#00CC88]/20 text-[#00CC88] border border-[#00CC88]/30 px-3 py-1.5 rounded-full font-semibold hover:bg-[#00CC88]/40 transition-all flex-shrink-0"
                      >
                        ✓ Resolve
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
