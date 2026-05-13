import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFlaggedStudents, resolveFlag } from '../../api/client'
import { useToast } from '../../context/ToastContext'

const LEVEL_COLOR = {
  L1: 'text-[#8892B0]', L2: 'text-blue-400', L3: 'text-green-400',
  L4: 'text-purple-400', L5: 'text-yellow-300',
}

export default function AdminFlagged() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [flagged, setFlagged] = useState([])
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState(null)

  useEffect(() => {
    getFlaggedStudents().then(r => setFlagged(r.data)).finally(() => setLoading(false))
  }, [])

  async function handleResolve(studentId, topicId, idx) {
    setResolving(`${studentId}-${topicId}`)
    try {
      await resolveFlag(studentId, topicId)
      setFlagged(f => f.filter((_, i) => i !== idx))
      toast.success('Flag resolved!')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to resolve')
    } finally {
      setResolving(null)
    }
  }

  // Group by student name
  const byStudent = flagged.reduce((acc, f, i) => {
    const key = f.student_name || 'Unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push({ ...f, _idx: i })
    return acc
  }, {})

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-fredoka font-bold text-white">🚩 Flagged Students</h1>
          <p className="text-[#8892B0] text-sm mt-0.5">
            Topics where students needed the most help
          </p>
        </div>
        {flagged.length > 0 && (
          <span className="text-sm bg-[#FF3333]/20 text-[#FF6B6B] border border-[#FF3333]/30 px-3 py-1.5 rounded-full font-semibold">
            {flagged.length} flag{flagged.length !== 1 ? 's' : ''} open
          </span>
        )}
      </div>

      {loading && (
        <div className="text-center py-16">
          <div className="text-4xl animate-bounce mb-3">🚩</div>
          <p className="text-[#8892B0]">Loading flagged students…</p>
        </div>
      )}

      {!loading && flagged.length === 0 && (
        <div className="blox-card p-12 text-center">
          <p className="text-5xl mb-3">🎉</p>
          <p className="font-fredoka font-bold text-[#00CC88] text-xl">All clear!</p>
          <p className="text-[#8892B0] text-sm mt-1">No students need extra help right now.</p>
        </div>
      )}

      {!loading && flagged.length > 0 && (
        <div className="space-y-4">
          {Object.entries(byStudent).map(([studentName, flags]) => {
            const first = flags[0]
            return (
              <div key={studentName} className="blox-card overflow-hidden border-l-4 border-l-[#FF3333] animate-bounce-in">
                {/* Student header */}
                <div className="flex items-center justify-between px-4 py-3 bg-[#1A1A3E] border-b border-[#2D2B5A]">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#FF6B9D] to-[#FF3333] flex items-center justify-center text-white font-fredoka font-bold text-sm">
                      {studentName[0]}
                    </div>
                    <div>
                      <p className="font-fredoka font-bold text-white text-sm">{studentName}</p>
                      {first.grade && <p className="text-xs text-[#8892B0]">Grade {first.grade}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-[#FF3333]/20 text-[#FF6B6B] border border-[#FF3333]/30 px-2 py-0.5 rounded-full font-semibold">
                      {flags.length} flag{flags.length !== 1 ? 's' : ''}
                    </span>
                    {first.student_id && (
                      <button
                        onClick={() => navigate(`/admin/students/${first.student_id}`)}
                        className="text-xs text-[#00A2FF] hover:text-white font-semibold transition-colors"
                      >
                        View profile →
                      </button>
                    )}
                  </div>
                </div>

                {/* Flagged topics for this student */}
                <div className="divide-y divide-[#2D2B5A]">
                  {flags.map((f, fi) => {
                    const key = `${f.student_id}-${f.topic_id}`
                    return (
                      <div key={fi} className="px-4 py-3 flex items-center gap-3 hover:bg-[#1A1A3E] transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-nunito font-semibold text-white truncate">{f.topic_title}</p>
                          <p className="text-xs text-[#8892B0]">{f.chapter_title}</p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="text-center">
                            <p className={`text-sm font-fredoka font-bold ${LEVEL_COLOR[f.mastery_level] || 'text-[#8892B0]'}`}>
                              {f.mastery_level ?? '—'}
                            </p>
                            <p className="text-[10px] text-[#8892B0]">level</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-fredoka font-bold text-white">
                              {f.total_sessions_on_topic ?? 0}
                            </p>
                            <p className="text-[10px] text-[#8892B0]">sessions</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-fredoka font-bold text-[#FFD700]">
                              {f.last_hint_tier_needed ?? 0}
                            </p>
                            <p className="text-[10px] text-[#8892B0]">max hint</p>
                          </div>
                          {f.student_id ? (
                            <button
                              onClick={() => handleResolve(f.student_id, f.topic_id, f._idx)}
                              disabled={resolving === key}
                              className="text-xs bg-[#00CC88]/20 text-[#00CC88] border border-[#00CC88]/30 px-3 py-1.5 rounded-full font-semibold hover:bg-[#00CC88]/40 transition-all disabled:opacity-50"
                            >
                              {resolving === key ? '⚡…' : '✓ Resolve'}
                            </button>
                          ) : (
                            <span className="text-xs text-[#8892B0]">No account</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
