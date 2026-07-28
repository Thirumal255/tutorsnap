import { useState, useEffect } from 'react'
import { listAssignments, getAssignment } from '../../api/client'

function downloadPDF(paper) {
  const lines = []
  lines.push(paper.title)
  lines.push(`Subject: ${paper.subject}  |  Grade: ${paper.grade}  |  Total Marks: ${paper.questions.reduce((s, q) => s + (q.marks || 1), 0)}`)
  lines.push('Name: ________________________   Date: ________________')
  lines.push('')
  paper.questions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.question}   [${q.marks || 1} mark${(q.marks || 1) > 1 ? 's' : ''}]`)
    lines.push('')
  })
  if (paper.include_answers) {
    lines.push('─── ANSWER KEY ───────────────────────────────────')
    paper.questions.forEach((q, i) => {
      lines.push(`${i + 1}. ${q.answer}`)
    })
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${paper.title.replace(/\s+/g, '_')}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

export default function ParentAssignments() {
  const [papers, setPapers]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [viewing, setViewing]     = useState(null)
  const [loadingId, setLoadingId] = useState(null)

  useEffect(() => {
    listAssignments()
      .then(r => setPapers(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function viewPaper(id) {
    setLoadingId(id)
    try {
      const res = await getAssignment(id)
      setViewing(res.data)
    } finally { setLoadingId(null) }
  }

  if (viewing) {
    const totalMarks = viewing.questions.reduce((s, q) => s + (q.marks || 1), 0)
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-white">{viewing.title}</h1>
            <p className="text-sm text-[#8892B0]">{viewing.subject} · Grade {viewing.grade} · {viewing.questions.length} questions · {totalMarks} marks</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setViewing(null)}
              className="text-sm px-4 py-2 border border-[#2D2B5A] text-[#8892B0] rounded-xl hover:text-white transition-all">
              ← Back
            </button>
            <button onClick={() => downloadPDF(viewing)}
              className="text-sm px-4 py-2 bg-[#00D68F]/10 text-[#00D68F] border border-[#00D68F]/30 rounded-xl hover:bg-[#00D68F]/20 transition-all">
              📥 Download
            </button>
          </div>
        </div>

        <div className="bg-[#1A1A3E] border border-[#2D2B5A] rounded-2xl p-6">
          <div className="border-b border-[#2D2B5A] pb-4 mb-6 text-center">
            <p className="text-lg font-bold text-white">{viewing.title}</p>
            <p className="text-sm text-[#8892B0]">{viewing.subject} · Grade {viewing.grade}</p>
            <p className="text-xs text-[#4A5568] mt-1">Name: ________________________   Date: ________________</p>
          </div>
          <div className="space-y-5">
            {viewing.questions.map((q, idx) => (
              <div key={idx} className="flex gap-3">
                <span className="text-[#00A2FF] font-bold text-sm min-w-[24px] mt-0.5">{q.index || idx + 1}.</span>
                <div className="flex-1">
                  <p className="text-white text-sm leading-relaxed">{q.question}</p>
                  <p className="text-xs text-[#4A5568] mt-1">[{q.marks || 1} mark{(q.marks || 1) > 1 ? 's' : ''}]</p>
                  {viewing.include_answers && (
                    <div className="mt-2 p-2 bg-[#00D68F]/5 border border-[#00D68F]/20 rounded-lg">
                      <p className="text-xs text-[#00D68F]">Answer: {q.answer}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Assignments</h1>
        <p className="text-sm text-[#8892B0] mt-1">Download assignment papers for your child</p>
      </div>

      {loading ? (
        <div className="text-center py-16 text-[#4A5568]">Loading…</div>
      ) : papers.length === 0 ? (
        <div className="text-center py-16 text-[#4A5568]">
          <p className="text-4xl mb-3">📝</p>
          <p>No assignments available yet. Ask your admin to generate one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {papers.map(p => (
            <div key={p.id} className="flex items-center justify-between p-4 bg-[#1A1A3E] border border-[#2D2B5A] rounded-xl">
              <div>
                <p className="font-semibold text-white text-sm">{p.title}</p>
                <p className="text-xs text-[#8892B0] mt-0.5">
                  {p.subject} · Grade {p.grade} · {p.question_count} questions
                  {p.include_answers && ' · Answers included'}
                </p>
              </div>
              <button onClick={() => viewPaper(p.id)} disabled={loadingId === p.id}
                className="text-xs px-3 py-1.5 bg-[#00A2FF]/10 text-[#00A2FF] border border-[#00A2FF]/30 rounded-lg hover:bg-[#00A2FF]/20 transition-all">
                {loadingId === p.id ? '…' : 'View / Download'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
