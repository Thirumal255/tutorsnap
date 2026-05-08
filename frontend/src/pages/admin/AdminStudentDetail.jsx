import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getAdminStudent, updateStudentGrade, resetStudentMastery } from '../../api/client'

const MASTERY_ICON = { null: '⬜', L1: '🟡', L2: '🔵', L3: '🟢', L4: '🟣', L5: '⭐' }
const LEVEL_COLOR  = {
  L1: 'text-[#8892B0]', L2: 'text-blue-400', L3: 'text-green-400',
  L4: 'text-purple-400', L5: 'text-yellow-300',
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

export default function AdminStudentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [student, setStudent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetMsg, setResetMsg] = useState('')
  const [activeTab, setActiveTab] = useState('mastery')

  useEffect(() => {
    getAdminStudent(id).then(r => setStudent(r.data)).finally(() => setLoading(false))
  }, [id])

  async function handleGrade(grade) {
    try {
      const r = await updateStudentGrade(id, parseInt(grade))
      setStudent(s => ({ ...s, grade: r.data.grade }))
    } catch {}
  }

  async function handleReset() {
    if (!confirmReset) { setConfirmReset(true); return }
    try {
      const r = await resetStudentMastery(id)
      setResetMsg(r.data.message)
      setStudent(s => ({ ...s, topic_mastery: [] }))
      setConfirmReset(false)
    } catch {}
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="text-4xl animate-bounce mb-3">🎮</div>
        <p className="text-[#8892B0]">Loading student…</p>
      </div>
    </div>
  )

  if (!student) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-[#8892B0]">Student not found.</p>
    </div>
  )

  const flagged = student.topic_mastery?.filter(m => m.flagged_for_review) ?? []

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={() => navigate('/admin/students')}
          className="text-[#8892B0] hover:text-white text-sm font-nunito transition-colors">
          ← Back
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00A2FF] to-[#0066CC] flex items-center justify-center text-white font-fredoka font-bold text-lg">
            {student.name?.[0]}
          </div>
          <div>
            <h1 className="text-xl font-fredoka font-bold text-white">{student.name}</h1>
            <p className="text-xs text-[#8892B0]">{student.email}</p>
          </div>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${
          student.is_active
            ? 'bg-[#00CC88]/20 text-[#00CC88] border-[#00CC88]/30'
            : 'bg-[#2D2B5A] text-[#8892B0] border-[#2D2B5A]'
        }`}>
          {student.is_active ? '● Active' : '○ Inactive'}
        </span>
        {flagged.length > 0 && (
          <span className="ml-auto text-xs bg-[#FF3333]/20 text-[#FF6B6B] border border-[#FF3333]/30 px-3 py-1 rounded-full font-semibold">
            🚩 {flagged.length} flagged
          </span>
        )}
      </div>

      {/* ── Info + stat strip ───────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Info card */}
        <div className="blox-card p-4 space-y-3">
          <p className="text-xs text-[#8892B0] uppercase tracking-widest font-semibold">Student info</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#8892B0]">Grade</span>
            <select
              value={student.grade || ''}
              onChange={e => handleGrade(e.target.value)}
              className="bg-[#2D2B5A] border border-[#2D2B5A] text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#00A2FF]"
            >
              <option value="">Not set</option>
              {[5,6,7,8,9,10].map(g => <option key={g} value={g}>Grade {g}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#8892B0]">Email</span>
            <span className="text-xs text-white truncate max-w-[180px]">{student.email}</span>
          </div>
          {student.parent_names?.length > 0 && (
            <div>
              <span className="text-xs text-[#8892B0] block mb-1">Parents</span>
              <div className="flex gap-1.5 flex-wrap">
                {student.parent_names.map((n, i) => (
                  <span key={i} className="text-xs bg-[#00A2FF]/20 text-[#00A2FF] border border-[#00A2FF]/30 px-2 py-0.5 rounded-full">
                    👤 {n}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Sessions',  value: student.recent_sessions?.length ?? 0, color: 'text-[#00A2FF]' },
            { label: 'Mastered',  value: student.topic_mastery?.filter(m => ['L3','L4','L5'].includes(m.mastery_level)).length ?? 0,
              color: 'text-[#00CC88]' },
            { label: 'Flagged',   value: flagged.length,
              color: flagged.length > 0 ? 'text-[#FF6B6B]' : 'text-[#8892B0]' },
          ].map(({ label, value, color }) => (
            <div key={label} className="blox-card p-3 text-center">
              <p className={`text-2xl font-fredoka font-bold ${color}`}>{value}</p>
              <p className="text-xs text-[#8892B0] mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Flagged alert ───────────────────────────────────── */}
      {flagged.length > 0 && (
        <div className="blox-card p-4 border-l-4 border-l-[#FF3333]">
          <p className="text-sm font-fredoka font-bold text-[#FF6B6B] mb-3">🚩 Flagged topics ({flagged.length})</p>
          <div className="space-y-2">
            {flagged.map((m, i) => (
              <div key={i} className="flex items-center gap-3 py-1.5 border-b border-[#2D2B5A] last:border-0">
                <span className="text-base">{MASTERY_ICON[m.mastery_level] || '⬜'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-semibold truncate">{m.topic_title}</p>
                  <p className="text-xs text-[#8892B0]">{m.chapter_title}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-fredoka font-bold ${LEVEL_COLOR[m.mastery_level] || 'text-white'}`}>
                    {m.mastery_level}
                  </p>
                  <p className="text-[10px] text-[#8892B0]">Hint {m.last_hint_tier_needed}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {[
          { id: 'mastery',  label: '🏆 Topic Mastery' },
          { id: 'sessions', label: '📋 Sessions' },
          { id: 'danger',   label: '⚠️ Danger Zone' },
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
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

      {/* ── Topic mastery tab ───────────────────────────────── */}
      {activeTab === 'mastery' && (
        <div className="space-y-2">
          {!student.topic_mastery?.length ? (
            <div className="blox-card p-8 text-center">
              <p className="text-3xl mb-2">📭</p>
              <p className="text-[#8892B0]">No topics practised yet.</p>
            </div>
          ) : (
            student.topic_mastery.map((m, i) => (
              <div key={i} className={`blox-card px-4 py-3 flex items-center gap-3 ${
                m.flagged_for_review ? 'border-l-4 border-l-[#FF3333]' : ''
              }`}>
                <span className="text-lg flex-shrink-0">{MASTERY_ICON[m.mastery_level] || '⬜'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-nunito font-semibold text-white truncate">{m.topic_title}</p>
                  <p className="text-xs text-[#8892B0]">{m.chapter_title}</p>
                </div>
                <div className="text-right flex-shrink-0 space-y-0.5">
                  <p className={`text-sm font-fredoka font-bold ${LEVEL_COLOR[m.mastery_level] || 'text-[#8892B0]'}`}>
                    {m.mastery_level ?? '—'}
                  </p>
                  <p className="text-[10px] text-[#8892B0]">
                    {m.total_sessions} sess · Hint {m.last_hint_tier_needed}
                  </p>
                  {m.last_practiced_at && (
                    <p className="text-[10px] text-[#8892B0]">{timeAgo(m.last_practiced_at)}</p>
                  )}
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
          {!student.recent_sessions?.length ? (
            <div className="blox-card p-8 text-center">
              <p className="text-3xl mb-2">📭</p>
              <p className="text-[#8892B0]">No sessions yet.</p>
            </div>
          ) : (
            student.recent_sessions.map((s, i) => (
              <div key={i} className="blox-card px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#2D2B5A] flex items-center justify-center text-base flex-shrink-0">
                  📝
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-nunito font-semibold text-white truncate">{s.topic_title}</p>
                  <p className="text-xs text-[#8892B0]">{s.questions_asked} questions</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-fredoka font-bold ${LEVEL_COLOR[s.current_level] || 'text-white'}`}>
                    {s.current_level}
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
            ))
          )}
        </div>
      )}

      {/* ── Danger zone tab ─────────────────────────────────── */}
      {activeTab === 'danger' && (
        <div className="blox-card p-5 border-[#FF3333]/30">
          <p className="text-sm font-fredoka font-bold text-[#FF6B6B] mb-1">⚠️ Danger Zone</p>
          <p className="text-xs text-[#8892B0] mb-4">
            These actions are irreversible. Be careful.
          </p>
          {resetMsg && (
            <div className="mb-4 px-3 py-2 bg-[#00CC88]/10 border border-[#00CC88]/30 rounded-xl text-xs text-[#00CC88]">
              ✓ {resetMsg}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={handleReset}
              className={`text-sm px-4 py-2.5 rounded-xl font-nunito font-semibold border transition-all ${
                confirmReset
                  ? 'bg-[#FF3333]/20 text-[#FF6B6B] border-[#FF3333]/50 hover:bg-[#FF3333]/40'
                  : 'border-[#FF3333]/40 text-[#FF6B6B] hover:bg-[#FF3333]/10'
              }`}
            >
              {confirmReset ? '⚠️ Click again to confirm' : '🗑️ Reset all mastery'}
            </button>
            {confirmReset && (
              <button onClick={() => setConfirmReset(false)}
                className="text-sm text-[#8892B0] hover:text-white transition-colors font-nunito">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
