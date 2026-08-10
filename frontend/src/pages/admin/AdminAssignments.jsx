import { useState, useEffect, useCallback } from 'react'
import { jsPDF } from 'jspdf'
import {
  getBooks, getChaptersWithExercises,
  generateAssignment, listAssignments,
  getAssignment, deleteAssignment, regenerateQuestion,
  extractExercises,
} from '../../api/client'

const LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5', 'mixed']
const LEVEL_LABELS = { L1: 'L1 – Recall', L2: 'L2 – Understanding', L3: 'L3 – Application', L4: 'L4 – Analysis', L5: 'L5 – Synthesis', mixed: 'Mixed' }
const TYPE_LABELS = { value_changed: '🔢 Value-changed (different numbers)', reformulated: '✨ Reformulated (same concept, new phrasing)' }

// ── PDF text sanitizer — jsPDF Helvetica has no Unicode math/super/subscripts ──
function san(text) {
  if (!text) return ‘’
  return String(text)
    // Vulgar fractions (must come before superscript/subscript handling)
    .replace(/½/g, ‘1/2’).replace(/⅓/g, ‘1/3’).replace(/⅔/g, ‘2/3’)
    .replace(/¼/g, ‘1/4’).replace(/¾/g, ‘3/4’).replace(/⅛/g, ‘1/8’)
    .replace(/⅜/g, ‘3/8’).replace(/⅝/g, ‘5/8’).replace(/⅞/g, ‘7/8’)
    // Unicode fraction slash (U+2044) and division slash (U+2215) → plain /
    // Must come before superscript/subscript so ³⁄₈ → ^3/_8 → 3/8
    .replace(/[⁄∕]/g, ‘/’)
    // Superscript digits → ^n
    .replace(/⁰/g, ‘^0’).replace(/¹/g, ‘^1’).replace(/²/g, ‘^2’).replace(/³/g, ‘^3’)
    .replace(/⁴/g, ‘^4’).replace(/⁵/g, ‘^5’).replace(/⁶/g, ‘^6’).replace(/⁷/g, ‘^7’)
    .replace(/⁸/g, ‘^8’).replace(/⁹/g, ‘^9’)
    // Subscript digits → _n
    .replace(/₀/g, ‘_0’).replace(/₁/g, ‘_1’).replace(/₂/g, ‘_2’).replace(/₃/g, ‘_3’)
    .replace(/₄/g, ‘_4’).replace(/₅/g, ‘_5’).replace(/₆/g, ‘_6’).replace(/₇/g, ‘_7’)
    .replace(/₈/g, ‘_8’).replace(/₉/g, ‘_9’)
    // Math operators
    .replace(/×/g, ‘x’).replace(/÷/g, ‘/’).replace(/−/g, ‘-’)
    .replace(/≤/g, ‘<=’).replace(/≥/g, ‘>=’).replace(/≠/g, ‘!=’)
    .replace(/√/g, ‘sqrt’).replace(/π/g, ‘pi’).replace(/∞/g, ‘infinity’)
    // Degree, currency, quotes
    .replace(/°/g, ‘ deg’).replace(/℃/g, ‘ deg C’).replace(/℉/g, ‘ deg F’)
    .replace(/£/g, ‘GBP ‘).replace(/€/g, ‘EUR ‘).replace(/₹/g, ‘Rs ‘)
    .replace(/[‘’]/g, “’”).replace(/[“”]/g, ‘”’)
    // Arrows and misc
    .replace(/→/g, ‘->’).replace(/←/g, ‘<-’)
    // Strip any remaining non-latin1 chars that Helvetica can’t render
    .replace(/[^\x00-\xFF]/g, ‘’)
    // Collapse super/subscript fraction notation: “2^3/_8” → “2 3/8”, “^3/_5” → “3/5”
    .replace(/(\d)\^(\d+)\/_(\d+)/g, ‘$1 $2/$3’)
    .replace(/\^(\d+)\/_(\d+)/g, ‘$1/$2’)
}

// ── PDF Download ──────────────────────────────────────────────────────────────
function downloadPDF(paper) {
  const qs = paper.questions || []
  const totalMarks = qs.reduce((s, q) => s + (q.marks || 1), 0)

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const PW = 210, PH = 297
  const ML = 15, MR = 15, MT = 15, MB = 15
  const CW = PW - ML - MR   // content width
  let y = MT

  const FONT_TITLE  = 14
  const FONT_HEAD   = 11
  const FONT_BODY   = 10
  const FONT_SMALL  = 9
  const LINE_H      = 6

  function checkPage(needed = LINE_H) {
    if (y + needed > PH - MB) { doc.addPage(); y = MT }
  }

  function writeLine(text, opts = {}) {
    const { size = FONT_BODY, bold = false, color = [0,0,0], indent = 0 } = opts
    doc.setFontSize(size)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setTextColor(...color)
    const lines = doc.splitTextToSize(san(text), CW - indent)
    checkPage(lines.length * LINE_H + 2)
    lines.forEach(l => { doc.text(l, ML + indent, y); y += LINE_H })
  }

  function drawHRule(light = false) {
    checkPage(4)
    doc.setDrawColor(...(light ? [200,200,200] : [100,100,100]))
    doc.setLineWidth(light ? 0.2 : 0.4)
    doc.line(ML, y, PW - MR, y)
    y += 3
  }

  // ── Header ────────────────────────────────────────────────────
  writeLine(paper.title, { size: FONT_TITLE, bold: true })
  y += 1
  writeLine(`Subject: ${paper.subject || ''}   |   Grade: ${paper.grade || ''}   |   Total Marks: ${totalMarks}`, { size: FONT_SMALL, color: [80,80,80] })
  if (paper.chapter_titles && paper.chapter_titles.length > 0) {
    const abbrev = t => {
      // Strip leading "Chapter N" / "Ch. N" prefix, collapse remaining words to initials if > 25 chars
      const cleaned = t.replace(/^(chapter|ch\.?)\s*\d+[\s:.\-–]*/i, '').trim() || t
      return cleaned.length > 25
        ? cleaned.split(/\s+/).map(w => w[0]?.toUpperCase()).join('') + '.'
        : cleaned
    }
    const chapLine = paper.chapter_titles.map(abbrev).join('  |  ')
    writeLine(`Chapters: ${chapLine}`, { size: FONT_SMALL - 1, color: [100, 80, 160] })
  }
  y += 2
  writeLine('Name: _______________________________   Date: ________________   Score: _____ / ' + totalMarks, { size: FONT_SMALL })
  y += 3
  drawHRule()
  y += 2

  // ── Sections ──────────────────────────────────────────────────
  const sections = {}
  qs.forEach((q, i) => {
    const sec = q.section || 'A'
    if (!sections[sec]) sections[sec] = []
    sections[sec].push({ ...q, _i: i })
  })

  Object.entries(sections).forEach(([secLabel, secQs]) => {
    const secMarks = secQs.reduce((s, q) => s + (q.marks || 1), 0)
    const fmt = FORMAT_LABELS[secQs[0]?.format]?.label || secQs[0]?.format || ''

    // Section heading
    checkPage(12)
    writeLine(`Section ${secLabel} — ${fmt}`, { size: FONT_HEAD, bold: true })
    writeLine(`(${secQs.length} question${secQs.length > 1 ? 's' : ''} · ${secMarks} marks)`, { size: FONT_SMALL, color: [100,100,100] })
    y += 2
    drawHRule(true)
    y += 1

    secQs.forEach((q, qi) => {
      const qNum = qi + 1
      const marks = q.marks || 1
      const marksText = `[${marks} mark${marks > 1 ? 's' : ''}]`

      checkPage(10)
      // Question number + text
      doc.setFontSize(FONT_BODY)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(0, 0, 0)
      const numW = doc.getTextWidth(`${qNum}. `)
      doc.text(`${qNum}.`, ML, y)

      doc.setFont('helvetica', 'normal')
      const qLines = doc.splitTextToSize(san(q.question), CW - numW - 15)
      checkPage(qLines.length * LINE_H + 2)
      qLines.forEach((l, li) => { doc.text(l, ML + numW, y + li * LINE_H) })

      // Marks badge (right-aligned)
      doc.setFontSize(FONT_SMALL)
      doc.setTextColor(100, 100, 100)
      doc.text(marksText, PW - MR, y, { align: 'right' })
      y += qLines.length * LINE_H + 1

      // MCQ options
      if (q.format === 'mcq' && q.options) {
        const opts = Object.entries(q.options)
        opts.forEach(([opt, text]) => {
          const optLines = doc.splitTextToSize(`${opt})  ${san(text)}`, (CW / 2) - 8)
          checkPage(optLines.length * (LINE_H - 1) + 1)
          doc.setFontSize(FONT_SMALL)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(40, 40, 40)
          optLines.forEach((l, li) => doc.text(l, ML + 8, y + li * (LINE_H - 1)))
          y += optLines.length * (LINE_H - 1)
        })
        y += 2
      }

      // Answer lines for non-MCQ
      if (q.format !== 'mcq') {
        const ansLines = q.format === 'long_answer' ? 6 : q.format === 'short_answer' ? 3 : 1
        for (let i = 0; i < ansLines; i++) {
          checkPage(LINE_H)
          doc.setDrawColor(200, 200, 200)
          doc.setLineWidth(0.2)
          doc.line(ML, y + LINE_H - 2, PW - MR, y + LINE_H - 2)
          y += LINE_H
        }
      }

      y += 3
    })

    y += 4
  })

  // ── Answer Key ────────────────────────────────────────────────
  if (paper.include_answers) {
    doc.addPage()
    y = MT
    drawHRule()
    writeLine('ANSWER KEY / MARKING GUIDE', { size: FONT_HEAD, bold: true })
    drawHRule()
    y += 3

    Object.entries(sections).forEach(([secLabel, secQs]) => {
      writeLine(`Section ${secLabel}`, { size: FONT_HEAD, bold: true, color: [0, 100, 180] })
      y += 1
      secQs.forEach((q, qi) => {
        const ans = q.format === 'mcq'
          ? `${q.correct_option?.toUpperCase()})  ${q.options?.[q.correct_option] || ''}`
          : (q.answer || '')
        writeLine(`${qi + 1}.  ${ans}`, { size: FONT_BODY })
        if (q.marking_guide?.length) {
          q.marking_guide.forEach(g => writeLine(`     • ${g}`, { size: FONT_SMALL, color: [80,80,80] }))
        }
        y += 2
      })
      y += 3
    })
  }

  doc.save(`${paper.title.replace(/\s+/g, '_')}.pdf`)
}

// ── Step indicator ─────────────────────────────────────────────────────────────
function Steps({ current }) {
  const steps = ['Select Book', 'Pick Chapters', 'Configure', 'Preview & Download']
  return (
    <div className="flex items-center gap-0 mb-8 overflow-x-auto">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${
            i === current ? 'bg-[#00A2FF]/20 text-[#00A2FF]' :
            i < current  ? 'text-[#00D68F]' : 'text-[#4A5568]'
          }`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              i === current ? 'bg-[#00A2FF] text-white' :
              i < current  ? 'bg-[#00D68F] text-white' : 'bg-[#2D2B5A] text-[#8892B0]'
            }`}>
              {i < current ? '✓' : i + 1}
            </span>
            {s}
          </div>
          {i < steps.length - 1 && <span className="text-[#2D2B5A] mx-1">›</span>}
        </div>
      ))}
    </div>
  )
}

// ── Assignment list item ───────────────────────────────────────────────────────
function AssignmentRow({ paper, onView, onDelete }) {
  const [deleting, setDeleting] = useState(false)
  async function handleDelete() {
    if (!confirm(`Delete "${paper.title}"?`)) return
    setDeleting(true)
    try { await deleteAssignment(paper.id); onDelete(paper.id) }
    catch { setDeleting(false) }
  }
  return (
    <div className="flex items-center justify-between p-4 bg-[#1A1A3E] border border-[#2D2B5A] rounded-xl">
      <div>
        <p className="font-semibold text-white text-sm">{paper.title}</p>
        <p className="text-xs text-[#8892B0] mt-0.5">
          {paper.subject} · Grade {paper.grade} · {paper.question_count} questions
          {paper.include_answers && ' · Answers included'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => onView(paper.id)}
          className="text-xs px-3 py-1.5 bg-[#00A2FF]/10 text-[#00A2FF] border border-[#00A2FF]/30 rounded-lg hover:bg-[#00A2FF]/20 transition-all">
          View / Download
        </button>
        <button onClick={handleDelete} disabled={deleting}
          className="text-xs px-3 py-1.5 bg-[#FF3333]/10 text-[#FF3333] border border-[#FF3333]/30 rounded-lg hover:bg-[#FF3333]/20 transition-all">
          {deleting ? '…' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

// ── Preview panel ─────────────────────────────────────────────────────────────
function PreviewPanel({ paper, onBack }) {
  const [questions, setQuestions] = useState(paper.questions)
  const [regenIdx, setRegenIdx]   = useState(null)
  const [showAnswers, setShowAnswers] = useState(paper.include_answers)

  async function handleRegen(idx) {
    setRegenIdx(idx)
    try {
      const res = await regenerateQuestion(paper.id, { question_index: idx })
      setQuestions(prev => prev.map((q, i) => i === idx ? res.data.question : q))
    } finally { setRegenIdx(null) }
  }

  const totalMarks = questions.reduce((s, q) => s + (q.marks || 1), 0)

  // Group questions by section
  const sections = {}
  questions.forEach((q, i) => {
    const sec = q.section || 'A'
    if (!sections[sec]) sections[sec] = []
    sections[sec].push({ ...q, _idx: i })
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">{paper.title}</h2>
          <p className="text-sm text-[#8892B0]">{paper.subject} · Grade {paper.grade} · {questions.length} questions · {totalMarks} marks total</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAnswers(a => !a)}
            className={`text-sm px-3 py-2 border rounded-xl transition-all ${showAnswers ? 'border-[#00D68F] text-[#00D68F] bg-[#00D68F]/10' : 'border-[#2D2B5A] text-[#8892B0] hover:text-white'}`}>
            {showAnswers ? '🔑 Hide Answers' : '🔑 Show Answers'}
          </button>
          <button onClick={onBack}
            className="text-sm px-4 py-2 border border-[#2D2B5A] text-[#8892B0] rounded-xl hover:border-[#00A2FF] hover:text-white transition-all">
            ← Back
          </button>
          <button onClick={() => downloadPDF({ ...paper, questions })}
            className="text-sm px-4 py-2 bg-[#00D68F]/10 text-[#00D68F] border border-[#00D68F]/30 rounded-xl hover:bg-[#00D68F]/20 transition-all">
            📥 Download
          </button>
        </div>
      </div>

      {/* Paper preview */}
      <div className="bg-[#1A1A3E] border border-[#2D2B5A] rounded-2xl p-6 mb-6">
        <div className="border-b border-[#2D2B5A] pb-4 mb-6">
          <p className="text-lg font-bold text-white text-center">{paper.title}</p>
          <p className="text-sm text-[#8892B0] text-center">{paper.subject} · Grade {paper.grade} · Total: {totalMarks} marks</p>
          <p className="text-xs text-[#4A5568] text-center mt-1">Name: ________________________   Date: ________________</p>
        </div>

        {Object.entries(sections).map(([secLabel, secQuestions]) => (
          <div key={secLabel} className="mb-8">
            {/* Section header */}
            <div className="flex items-center gap-3 mb-4 pb-2 border-b border-[#2D2B5A]">
              <span className="w-8 h-8 rounded-lg bg-[#00A2FF]/20 text-[#00A2FF] font-bold text-sm flex items-center justify-center flex-shrink-0">
                {secLabel}
              </span>
              <div>
                <p className="text-sm font-bold text-white">Section {secLabel}</p>
                <p className="text-xs text-[#4A5568]">
                  {FORMAT_LABELS[secQuestions[0]?.format]?.label || secQuestions[0]?.format} ·
                  {secQuestions.length} question{secQuestions.length > 1 ? 's' : ''} ·
                  {secQuestions.reduce((s, q) => s + (q.marks || 1), 0)} marks
                </p>
              </div>
            </div>

            <div className="space-y-5">
              {secQuestions.map((q) => (
                <div key={q._idx} className="group relative">
                  <div className="flex gap-3">
                    <span className="text-[#00A2FF] font-bold text-sm min-w-[24px] mt-0.5">{q.index || q._idx + 1}.</span>
                    <div className="flex-1">
                      <p className="text-white text-sm leading-relaxed">{q.question}</p>

                      {/* MCQ options */}
                      {q.format === 'mcq' && q.options && (
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          {Object.entries(q.options).map(([opt, text]) => (
                            <div key={opt} className={`flex items-start gap-2 p-2 rounded-lg border text-xs ${
                              showAnswers && q.correct_option === opt
                                ? 'bg-[#00D68F]/10 border-[#00D68F]/40 text-[#00D68F]'
                                : 'border-[#2D2B5A] text-[#8892B0]'
                            }`}>
                              <span className="font-bold flex-shrink-0">{opt})</span>
                              <span>{text}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Tags */}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#2D2B5A] text-[#8892B0]">{q.level}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#2D2B5A] text-[#8892B0]">{q.marks || 1} mark{(q.marks || 1) > 1 ? 's' : ''}</span>
                        {q.objective && <span className="text-xs text-[#4A5568] italic truncate max-w-xs">{q.objective}</span>}
                      </div>

                      {/* Answer + marking guide */}
                      {showAnswers && (
                        <div className="mt-2 p-3 bg-[#00D68F]/5 border border-[#00D68F]/20 rounded-lg space-y-1">
                          <p className="text-xs text-[#00D68F] font-semibold">
                            {q.format === 'mcq' ? `Correct: ${q.correct_option?.toUpperCase()}) ${q.options?.[q.correct_option]}` : `Answer: ${q.answer}`}
                          </p>
                          {q.marking_guide && q.marking_guide.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {q.marking_guide.map((g, i) => (
                                <p key={i} className="text-[10px] text-[#4A5568]">• {g}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRegen(q._idx)}
                      disabled={regenIdx !== null}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 bg-[#C77DFF]/10 text-[#C77DFF] border border-[#C77DFF]/30 rounded-lg hover:bg-[#C77DFF]/20 self-start flex-shrink-0"
                      title="Regenerate this question"
                    >
                      {regenIdx === q._idx ? '…' : '↺'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-[#4A5568] text-center">Hover any question and click ↺ to regenerate it individually</p>
    </div>
  )
}

const FORMAT_LABELS = {
  mcq:          { label: 'MCQ',          icon: '🔘', desc: '4-option multiple choice with mistake-based distractors' },
  fill_blank:   { label: 'Fill Blank',   icon: '✏️',  desc: 'Key term or value in a blank' },
  short_answer: { label: 'Short Answer', icon: '📝',  desc: 'Real-world context, 3–5 line answer' },
  long_answer:  { label: 'Long Answer',  icon: '📄',  desc: 'Multi-part (a)(b)(c) scaffolded question' },
}

const DEFAULT_SECTIONS = [
  { label: 'A', format: 'mcq',          count: 5,  marks_each: 1 },
  { label: 'B', format: 'short_answer',  count: 4,  marks_each: 3 },
  { label: 'C', format: 'long_answer',   count: 2,  marks_each: 5 },
]

// ── Main component ─────────────────────────────────────────────────────────────
export default function AdminAssignments() {
  const [step, setStep]               = useState(0)
  const [books, setBooks]             = useState([])
  const [selectedBook, setSelectedBook] = useState(null)
  const [chapters, setChapters]       = useState([])
  const [selectedChapters, setSelectedChapters] = useState([])
  const [config, setConfig]           = useState({
    title: '',
    include_answers: false,
    sections: DEFAULT_SECTIONS,
  })
  const [generating, setGenerating]   = useState(false)
  const [genError, setGenError]       = useState('')
  const [savedPapers, setSavedPapers] = useState([])
  const [viewingPaper, setViewingPaper] = useState(null)
  const [loadingView, setLoadingView]  = useState(false)
  const [loadingList, setLoadingList]  = useState(true)
  const [extracting, setExtracting]    = useState(false)
  const [extractMsg, setExtractMsg]    = useState('')

  useEffect(() => {
    getBooks().then(r => setBooks(r.data.filter(b => b.status === 'done'))).catch(() => {})
    listAssignments().then(r => setSavedPapers(r.data)).catch(() => {}).finally(() => setLoadingList(false))
  }, [])

  function selectBook(book) {
    setSelectedBook(book)
    setSelectedChapters([])
    setExtractMsg('')
    setConfig(c => ({ ...c, title: `${book.subject || ''} Grade ${book.grade} Assignment` }))
    const id = book.book_id ?? book.id
    getChaptersWithExercises(id).then(r => setChapters(r.data.chapters)).catch(() => {})
    setStep(1)
  }

  async function handleExtractExercises() {
    setExtracting(true)
    setExtractMsg('')
    const bookId = selectedBook.book_id ?? selectedBook.id
    try {
      const res = await extractExercises(bookId)
      setExtractMsg(`Done — ${res.data.total_exercises} exercises extracted across ${res.data.updated_topics} topics.`)
      const r = await getChaptersWithExercises(bookId)
      setChapters(r.data.chapters)
    } catch {
      setExtractMsg('Extraction failed. Please try again.')
    } finally {
      setExtracting(false)
    }
  }

  function toggleChapter(id) {
    setSelectedChapters(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function updateSection(idx, field, value) {
    setConfig(c => {
      const sections = c.sections.map((s, i) => i === idx ? { ...s, [field]: value } : s)
      return { ...c, sections }
    })
  }

  function addSection() {
    const labels = 'ABCDEFGH'
    setConfig(c => ({
      ...c,
      sections: [...c.sections, { label: labels[c.sections.length] || String(c.sections.length + 1), format: 'short_answer', count: 3, marks_each: 2 }],
    }))
  }

  function removeSection(idx) {
    setConfig(c => ({ ...c, sections: c.sections.filter((_, i) => i !== idx) }))
  }

  const totalMarks = config.sections.reduce((s, sec) => s + sec.count * sec.marks_each, 0)
  const totalQuestions = config.sections.reduce((s, sec) => s + sec.count, 0)

  async function handleGenerate() {
    if (!config.title.trim()) { setGenError('Please enter a title'); return }
    if (config.sections.length === 0) { setGenError('Add at least one section'); return }
    setGenError('')
    setGenerating(true)
    try {
      const res = await generateAssignment({
        book_id: selectedBook.book_id ?? selectedBook.id,
        chapter_ids: selectedChapters,
        title: config.title,
        sections: config.sections,
        include_answers: config.include_answers,
      })
      const paper = res.data
      setSavedPapers(prev => [
        { id: paper.assignment_id, title: paper.title, book_id: selectedBook.id,
          book_title: paper.book, subject: paper.subject, grade: paper.grade,
          question_count: paper.questions.length, include_answers: paper.include_answers,
          created_at: paper.created_at },
        ...prev,
      ])
      setViewingPaper({ id: paper.assignment_id, ...paper, questions: paper.questions })
      setStep(3)
    } catch (e) {
      setGenError(e.response?.data?.detail || 'Generation failed. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  async function viewPaper(id) {
    setLoadingView(true)
    try {
      const res = await getAssignment(id)
      setViewingPaper(res.data)
      setStep(3)
    } finally { setLoadingView(false) }
  }

  const totalExercises = selectedChapters.reduce((s, id) => {
    const ch = chapters.find(c => c.id === id)
    return s + (ch?.exercise_count || 0)
  }, 0)

  if (step === 3 && viewingPaper) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Steps current={3} />
        <PreviewPanel
          paper={viewingPaper}
          onBack={() => { setViewingPaper(null); setStep(0) }}
          onRegenQ={() => {}}
        />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Assignment Generator</h1>
          <p className="text-sm text-[#8892B0] mt-1">Create assignment papers from book exercises</p>
        </div>
        {step > 0 && (
          <button onClick={() => { setStep(0); setSelectedBook(null); setSelectedChapters([]) }}
            className="text-sm px-4 py-2 border border-[#2D2B5A] text-[#8892B0] rounded-xl hover:border-[#00A2FF] hover:text-white transition-all">
            ← Start Over
          </button>
        )}
      </div>

      <Steps current={step} />

      {/* Step 0 — Select Book */}
      {step === 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[#8892B0] uppercase tracking-wider mb-4">Select a Book</h2>
          {books.length === 0 ? (
            <div className="text-center py-16 text-[#4A5568]">
              <p className="text-4xl mb-3">📚</p>
              <p>No published books found. Books must be fully ingested first.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {books.map(b => (
                <button key={b.book_id ?? b.id} onClick={() => selectBook(b)}
                  className="text-left p-4 bg-[#1A1A3E] border border-[#2D2B5A] rounded-xl hover:border-[#00A2FF] transition-all group">
                  <p className="font-semibold text-white group-hover:text-[#00A2FF] transition-colors">{b.title || b.filename}</p>
                  <p className="text-xs text-[#8892B0] mt-1">{b.subject} · Grade {b.grade} · {b.chapter_count} chapters</p>
                </button>
              ))}
            </div>
          )}

          {/* Saved assignments */}
          {savedPapers.length > 0 && (
            <div className="mt-10">
              <h2 className="text-sm font-semibold text-[#8892B0] uppercase tracking-wider mb-4">Previously Generated</h2>
              {loadingList ? (
                <p className="text-[#4A5568] text-sm">Loading…</p>
              ) : (
                <div className="space-y-2">
                  {savedPapers.map(p => (
                    <AssignmentRow key={p.id} paper={p}
                      onView={viewPaper}
                      onDelete={id => setSavedPapers(prev => prev.filter(x => x.id !== id))}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 1 — Pick Chapters */}
      {step === 1 && (
        <div>
          <h2 className="text-sm font-semibold text-[#8892B0] uppercase tracking-wider mb-1">Pick Chapters</h2>
          <p className="text-xs text-[#4A5568] mb-4">{selectedBook?.title} · Select one or more chapters</p>
          <div className="space-y-2 mb-6">
            {chapters.map(ch => {
              const sel = selectedChapters.includes(ch.id)
              return (
                <button key={ch.id} onClick={() => toggleChapter(ch.id)}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    sel ? 'bg-[#00A2FF]/10 border-[#00A2FF] text-white' : 'bg-[#1A1A3E] border-[#2D2B5A] text-[#8892B0] hover:border-[#00A2FF]/50'
                  }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`w-5 h-5 rounded flex items-center justify-center text-xs border ${
                        sel ? 'bg-[#00A2FF] border-[#00A2FF] text-white' : 'border-[#4A5568]'
                      }`}>{sel ? '✓' : ''}</span>
                      <div>
                        <p className="font-semibold text-sm">{ch.title}</p>
                        <p className="text-xs text-[#4A5568]">{ch.topic_count} topics · {ch.exercise_count} exercises</p>
                      </div>
                    </div>
                    {ch.exercise_count === 0 && (
                      <span className="text-xs px-2 py-1 bg-[#FFD700]/10 text-[#FFD700] rounded-lg">Reformulated only</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
          {/* Extract exercises banner — shown when book has no exercises yet */}
          {chapters.length > 0 && chapters.every(ch => ch.exercise_count === 0) && (
            <div className="mb-4 p-4 bg-[#FFD700]/5 border border-[#FFD700]/30 rounded-xl">
              <p className="text-sm text-[#FFD700] font-semibold mb-1">No exercises found in this book</p>
              <p className="text-xs text-[#8892B0] mb-3">
                Click below to use AI to extract exercise questions from the book content. This takes ~30–60 seconds.
              </p>
              <button onClick={handleExtractExercises} disabled={extracting}
                className="px-4 py-2 bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/40 rounded-xl text-sm font-semibold hover:bg-[#FFD700]/30 transition-all disabled:opacity-50">
                {extracting ? '⏳ Extracting exercises…' : '✨ Extract Exercises with AI'}
              </button>
              {extractMsg && <p className="text-xs text-[#00D68F] mt-2">{extractMsg}</p>}
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-[#4A5568]">
              {selectedChapters.length} chapter{selectedChapters.length !== 1 ? 's' : ''} selected · {totalExercises} exercises available
            </p>
            <button onClick={() => setStep(2)} disabled={selectedChapters.length === 0}
              className="px-6 py-2.5 bg-[#00A2FF] text-white rounded-xl font-semibold text-sm disabled:opacity-40 hover:bg-[#0088DD] transition-all">
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Configure */}
      {step === 2 && (
        <div className="space-y-6">
          {/* Title */}
          <div>
            <label className="block text-xs text-[#8892B0] font-semibold uppercase tracking-wider mb-1.5">Paper Title</label>
            <input
              value={config.title}
              onChange={e => setConfig(c => ({ ...c, title: e.target.value }))}
              className="w-full bg-[#1A1A3E] border border-[#2D2B5A] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#00A2FF]"
              placeholder="e.g. Chapter 3 Practice Test"
            />
          </div>

          {/* Section builder */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-[#8892B0] font-semibold uppercase tracking-wider">Paper Sections</p>
                <p className="text-xs text-[#4A5568] mt-0.5">Total: {totalQuestions} questions · {totalMarks} marks</p>
              </div>
              <button onClick={addSection}
                className="text-xs px-3 py-1.5 border border-[#2D2B5A] text-[#8892B0] rounded-lg hover:border-[#00A2FF] hover:text-white transition-all">
                + Add Section
              </button>
            </div>
            <div className="space-y-3">
              {config.sections.map((sec, idx) => (
                <div key={idx} className="p-4 bg-[#1A1A3E] border border-[#2D2B5A] rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-7 h-7 rounded-lg bg-[#00A2FF]/20 text-[#00A2FF] text-xs font-bold flex items-center justify-center">
                      {sec.label}
                    </span>
                    <p className="text-sm font-semibold text-white flex-1">Section {sec.label}</p>
                    {config.sections.length > 1 && (
                      <button onClick={() => removeSection(idx)} className="text-xs text-[#FF3333]/60 hover:text-[#FF3333] transition-colors">✕</button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {/* Format */}
                    <div>
                      <label className="block text-[10px] text-[#4A5568] uppercase tracking-wider mb-1">Format</label>
                      <select value={sec.format} onChange={e => updateSection(idx, 'format', e.target.value)}
                        className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-[#00A2FF]">
                        {Object.entries(FORMAT_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v.icon} {v.label}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-[#4A5568] mt-1 leading-tight">{FORMAT_LABELS[sec.format]?.desc}</p>
                    </div>
                    {/* Count */}
                    <div>
                      <label className="block text-[10px] text-[#4A5568] uppercase tracking-wider mb-1">Questions</label>
                      <input type="number" min={1} max={20} value={sec.count}
                        onChange={e => updateSection(idx, 'count', Math.max(1, Number(e.target.value)))}
                        className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-[#00A2FF]"
                      />
                    </div>
                    {/* Marks */}
                    <div>
                      <label className="block text-[10px] text-[#4A5568] uppercase tracking-wider mb-1">Marks each</label>
                      <input type="number" min={1} max={10} value={sec.marks_each}
                        onChange={e => updateSection(idx, 'marks_each', Math.max(1, Number(e.target.value)))}
                        className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-[#00A2FF]"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-[#4A5568] mt-2">
                    Subtotal: {sec.count} × {sec.marks_each} = <span className="text-white font-semibold">{sec.count * sec.marks_each} marks</span>
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Level note */}
          <div className="p-3 bg-[#00A2FF]/5 border border-[#00A2FF]/20 rounded-xl">
            <p className="text-xs text-[#00A2FF] font-semibold">📘 Difficulty follows the book</p>
            <p className="text-xs text-[#4A5568] mt-0.5">Questions are generated at each topic's own level (L1–L5) as set in the textbook.</p>
          </div>

          {/* Include answers */}
          <div className="flex items-center justify-between p-4 bg-[#1A1A3E] border border-[#2D2B5A] rounded-xl">
            <div>
              <p className="text-sm font-semibold text-white">Include Answer Key + Marking Guide</p>
              <p className="text-xs text-[#4A5568]">Append model answers with step-by-step marking guide</p>
            </div>
            <button onClick={() => setConfig(c => ({ ...c, include_answers: !c.include_answers }))}
              className={`w-12 h-6 rounded-full transition-all relative flex-shrink-0 ${config.include_answers ? 'bg-[#00D68F]' : 'bg-[#2D2B5A]'}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.include_answers ? 'left-6' : 'left-0.5'}`} />
            </button>
          </div>

          {genError && <p className="text-sm text-[#FF3333] bg-[#FF3333]/10 border border-[#FF3333]/30 rounded-xl px-4 py-3">{genError}</p>}

          <div className="flex items-center justify-between pt-2">
            <button onClick={() => setStep(1)} className="text-sm px-4 py-2 border border-[#2D2B5A] text-[#8892B0] rounded-xl hover:text-white transition-all">← Back</button>
            <button onClick={handleGenerate} disabled={generating}
              className="px-6 py-2.5 bg-[#00A2FF] text-white rounded-xl font-semibold text-sm disabled:opacity-40 hover:bg-[#0088DD] transition-all flex items-center gap-2">
              {generating ? (
                <><span className="animate-spin inline-block">⟳</span> Generating paper…</>
              ) : (
                <>✨ Generate Paper · {totalQuestions} questions · {totalMarks} marks</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
