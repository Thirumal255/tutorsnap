import { useState, useEffect } from 'react'
import { listAssignments, getAssignment } from '../../api/client'
import { jsPDF } from 'jspdf'

function downloadPDF(paper) {
  const qs = paper.questions || []
  const totalMarks = qs.reduce((s, q) => s + (q.marks || 1), 0)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const ML = 15, MR = 15, MT = 15, MB = 15
  const CW = 210 - ML - MR
  let y = MT
  const LINE_H = 6

  function checkPage(needed = LINE_H) {
    if (y + needed > 297 - MB) { doc.addPage(); y = MT }
  }
  function writeLine(text, size = 10, bold = false, color = [0,0,0], indent = 0) {
    doc.setFontSize(size); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setTextColor(...color)
    const lines = doc.splitTextToSize(text, CW - indent)
    checkPage(lines.length * LINE_H + 2)
    lines.forEach(l => { doc.text(l, ML + indent, y); y += LINE_H })
  }

  writeLine(paper.title, 14, true)
  y += 1
  writeLine(`Subject: ${paper.subject || ''}   |   Grade: ${paper.grade || ''}   |   Total Marks: ${totalMarks}`, 9, false, [80,80,80])
  y += 2
  writeLine('Name: _______________________________   Date: ________________   Score: _____ / ' + totalMarks, 9)
  y += 3
  doc.setDrawColor(100,100,100); doc.setLineWidth(0.4); doc.line(ML, y, 210-MR, y); y += 4

  const sections = {}
  qs.forEach(q => { const s = q.section || 'A'; if (!sections[s]) sections[s] = []; sections[s].push(q) })

  Object.entries(sections).forEach(([secLabel, secQs]) => {
    const secMarks = secQs.reduce((s, q) => s + (q.marks || 1), 0)
    writeLine(`Section ${secLabel}  (${secQs.length} questions · ${secMarks} marks)`, 11, true)
    y += 2; doc.setDrawColor(200,200,200); doc.setLineWidth(0.2); doc.line(ML, y, 210-MR, y); y += 3

    secQs.forEach((q, qi) => {
      const marks = q.marks || 1
      checkPage(10)
      const numW = doc.getTextWidth(`${qi+1}. `)
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(0,0,0)
      doc.text(`${qi+1}.`, ML, y)
      doc.setFont('helvetica', 'normal')
      const qLines = doc.splitTextToSize(q.question, CW - numW - 15)
      checkPage(qLines.length * LINE_H + 2)
      qLines.forEach((l, li) => doc.text(l, ML + numW, y + li * LINE_H))
      doc.setFontSize(9); doc.setTextColor(100,100,100)
      doc.text(`[${marks} mark${marks>1?'s':''}]`, 210-MR, y, { align: 'right' })
      y += qLines.length * LINE_H + 1

      if (q.format === 'mcq' && q.options) {
        Object.entries(q.options).forEach(([opt, text]) => {
          const lines = doc.splitTextToSize(`${opt})  ${text}`, CW/2 - 8)
          checkPage(lines.length * 5 + 1)
          doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(40,40,40)
          lines.forEach((l, li) => doc.text(l, ML+8, y + li*5))
          y += lines.length * 5
        })
        y += 2
      } else {
        const ansLines = q.format === 'long_answer' ? 6 : q.format === 'short_answer' ? 3 : 1
        for (let i = 0; i < ansLines; i++) {
          checkPage(LINE_H); doc.setDrawColor(200,200,200); doc.setLineWidth(0.2)
          doc.line(ML, y + LINE_H - 2, 210-MR, y + LINE_H - 2); y += LINE_H
        }
      }
      y += 3
    })
    y += 4
  })

  if (paper.include_answers) {
    doc.addPage(); y = MT
    writeLine('ANSWER KEY / MARKING GUIDE', 12, true)
    doc.setDrawColor(100,100,100); doc.setLineWidth(0.4); doc.line(ML, y, 210-MR, y); y += 4
    Object.entries(sections).forEach(([secLabel, secQs]) => {
      writeLine(`Section ${secLabel}`, 11, true, [0,100,180])
      secQs.forEach((q, qi) => {
        const ans = q.format === 'mcq'
          ? `${q.correct_option?.toUpperCase()})  ${q.options?.[q.correct_option]||''}`
          : (q.answer||'')
        writeLine(`${qi+1}.  ${ans}`, 10)
        if (q.marking_guide?.length) q.marking_guide.forEach(g => writeLine(`     • ${g}`, 9, false, [80,80,80]))
        y += 2
      })
      y += 3
    })
  }

  doc.save(`${paper.title.replace(/\s+/g, '_')}.pdf`)
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
