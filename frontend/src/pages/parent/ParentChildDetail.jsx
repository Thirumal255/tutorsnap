import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getChildDetail, getChildSessions } from '../../api/client'
import ProgressBadge from '../../components/ProgressBadge'

export default function ParentChildDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [child, setChild] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const PAGE = 10

  useEffect(() => {
    getChildDetail(id)
      .then(r => setChild(r.data))
      .finally(() => setLoading(false))
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

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>
  if (!child) return <div className="p-8 text-gray-500">Not found.</div>

  const flagged = child.topic_mastery?.filter(m => m.flagged_for_review) ?? []

  return (
    <div className="p-8 max-w-4xl space-y-8">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/parent')}
          className="text-sm text-gray-400 hover:text-gray-600">← Back</button>
        <h2 className="text-xl font-bold text-gray-800">{child.name}</h2>
        {child.grade && (
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Grade {child.grade}</span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">{child.total_sessions ?? 0}</p>
          <p className="text-xs text-gray-400 mt-1">Total Sessions</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">{child.topics_mastered ?? 0}</p>
          <p className="text-xs text-gray-400 mt-1">Topics Mastered</p>
        </div>
        <div className={`rounded-xl border shadow-sm p-4 text-center ${flagged.length > 0 ? 'bg-red-50 border-red-100' : 'bg-white border-gray-100'}`}>
          <p className={`text-2xl font-bold ${flagged.length > 0 ? 'text-red-600' : 'text-gray-800'}`}>
            {flagged.length}
          </p>
          <p className="text-xs text-gray-400 mt-1">Needs Attention</p>
        </div>
      </div>

      {/* Flagged topics */}
      {flagged.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-red-600 mb-3">Needs Attention</h3>
          <div className="bg-red-50 rounded-xl border border-red-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-red-100/50 text-red-700 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Topic</th>
                  <th className="px-4 py-3 text-left">Chapter</th>
                  <th className="px-4 py-3 text-left">Level</th>
                  <th className="px-4 py-3 text-left">Sessions</th>
                  <th className="px-4 py-3 text-left">Max Hint Used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-100">
                {flagged.map((m, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3 font-medium text-gray-800">{m.topic_title}</td>
                    <td className="px-4 py-3 text-gray-500">{m.chapter_title}</td>
                    <td className="px-4 py-3"><ProgressBadge level={m.mastery_level} /></td>
                    <td className="px-4 py-3 text-gray-600">{m.total_sessions}</td>
                    <td className="px-4 py-3 text-gray-600">{m.last_hint_tier_needed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Topic mastery */}
      <div>
        <h3 className="text-base font-semibold text-gray-700 mb-3">Topic Progress</h3>
        {!child.topic_mastery?.length ? (
          <p className="text-sm text-gray-400">No topics practised yet.</p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Topic</th>
                  <th className="px-4 py-3 text-left">Chapter</th>
                  <th className="px-4 py-3 text-left">Level</th>
                  <th className="px-4 py-3 text-left">Sessions</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {child.topic_mastery.map((m, i) => (
                  <tr key={i} className={m.flagged_for_review ? 'bg-amber-50' : ''}>
                    <td className="px-4 py-3 font-medium text-gray-800">{m.topic_title}</td>
                    <td className="px-4 py-3 text-gray-500">{m.chapter_title}</td>
                    <td className="px-4 py-3"><ProgressBadge level={m.mastery_level} /></td>
                    <td className="px-4 py-3 text-gray-600">{m.total_sessions}</td>
                    <td className="px-4 py-3">
                      {m.flagged_for_review
                        ? <span className="text-xs text-red-600 font-medium">⚑ Needs help</span>
                        : <span className="text-xs text-green-600">On track</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Session history */}
      <div>
        <h3 className="text-base font-semibold text-gray-700 mb-3">Session History</h3>
        {sessions.length === 0 && !sessionsLoading ? (
          <p className="text-sm text-gray-400">No sessions yet.</p>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Topic</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Level</th>
                    <th className="px-4 py-3 text-left">Questions</th>
                    <th className="px-4 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sessions.map((s, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3 text-gray-800">{s.topic_title}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {s.started_at ? new Date(s.started_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3"><ProgressBadge level={s.current_level} /></td>
                      <td className="px-4 py-3 text-gray-600">{s.questions_asked}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          s.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>{s.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hasMore && (
              <button
                onClick={() => loadSessions(offset)}
                disabled={sessionsLoading}
                className="mt-3 text-sm text-green-600 hover:text-green-800 disabled:opacity-50"
              >
                {sessionsLoading ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
