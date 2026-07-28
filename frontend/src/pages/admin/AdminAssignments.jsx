import { useState, useEffect, useCallback } from 'react'
import {
  getBooks, getChaptersWithExercises,
  generateAssignment, listAssignments,
  getAssignment, deleteAssignment, regenerateQuestion,
} from '../../api/client'

const LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5', 'mixed']
const LEVEL_LABELS = { L1: 'L1 – Recall', L2: 'L2 – Understanding', L3: 'L3 – Application', L4: 'L4 – Analysis', L5: 'L5 – Synthesis', mixed: 'Mixed' }
const TYPE_LABELS = { verbatim: '📖 Verbatim (exact book question)', value_changed: '🔢 Value-changed (different numbers)', reformulated: '✨ Reformulated (same concept, new phrasing)' }

// ── PDF Download ──────────────────────────────────────────────────────────────
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
function PreviewPanel({ paper, onBack, onRegenQ }) {
  const [regenIdx, setRegenIdx] = useState(null)
  const [questions, setQuestions] = useState(paper.questions)

  async function handleRegen(idx) {
    setRegenIdx(idx)
    try {
      const res = await regenerateQuestion(paper.id, { question_index: idx })
      setQuestions(prev => prev.map((q, i) => i === idx ? res.data.question : q))
    } finally { setRegenIdx(null) }
  }

  const totalMarks = questions.reduce((s, q) => s + (q.marks || 1), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">{paper.title}</h2>
          <p className="text-sm text-[#8892B0]">{paper.subject} · Grade {paper.grade} · {questions.length} questions · {totalMarks} marks total</p>
        </div>
        <div className="flex gap-2">
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
          <p className="text-sm text-[#8892B0] text-center">{paper.subject} · Grade {paper.grade}</p>
          <p className="text-xs text-[#4A5568] text-center mt-1">Name: ________________________   Date: ________________</p>
        </div>

        <div className="space-y-4">
          {questions.map((q, idx) => (
            <div key={idx} className="group relative">
              <div className="flex gap-3">
                <span className="text-[#00A2FF] font-bold text-sm min-w-[24px] mt-0.5">{q.index || idx + 1}.</span>
                <div className="flex-1">
                  <p className="text-white text-sm leading-relaxed">{q.question}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#2D2B5A] text-[#8892B0]">{q.type?.replace('_', ' ')}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#2D2B5A] text-[#8892B0]">{q.level}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#2D2B5A] text-[#8892B0]">{q.marks || 1} mark{(q.marks || 1) > 1 ? 's' : ''}</span>
                    <span className="text-xs text-[#4A5568]">{q.source_topic}</span>
                  </div>
                  {paper.include_answers && (
                    <div className="mt-2 p-2 bg-[#00D68F]/5 border border-[#00D68F]/20 rounded-lg">
                      <p className="text-xs text-[#00D68F]">Answer: {q.answer}</p>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleRegen(idx)}
                  disabled={regenIdx !== null}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 bg-[#C77DFF]/10 text-[#C77DFF] border border-[#C77DFF]/30 rounded-lg hover:bg-[#C77DFF]/20 self-start flex-shrink-0"
                  title="Regenerate this question"
                >
                  {regenIdx === idx ? '…' : '↺'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-[#4A5568] text-center">Hover any question and click ↺ to regenerate it individually</p>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function AdminAssignments() {
  const [step, setStep]               = useState(0)   // 0–3
  const [books, setBooks]             = useState([])
  const [selectedBook, setSelectedBook] = useState(null)
  const [chapters, setChapters]       = useState([])
  const [selectedChapters, setSelectedChapters] = useState([])
  const [config, setConfig]           = useState({
    title: '', question_count: 10, types: ['verbatim', 'value_changed', 'reformulated'],
    level: 'mixed', include_answers: false,
  })
  const [generating, setGenerating]   = useState(false)
  const [genError, setGenError]       = useState('')
  const [savedPapers, setSavedPapers] = useState([])
  const [viewingPaper, setViewingPaper] = useState(null)
  const [loadingView, setLoadingView]  = useState(false)
  const [loadingList, setLoadingList]  = useState(true)

  useEffect(() => {
    getBooks().then(r => setBooks(r.data.filter(b => b.status === 'done'))).catch(() => {})
    listAssignments().then(r => setSavedPapers(r.data)).catch(() => {}).finally(() => setLoadingList(false))
  }, [])

  function selectBook(book) {
    setSelectedBook(book)
    setSelectedChapters([])
    setConfig(c => ({ ...c, title: `${book.subject || ''} Grade ${book.grade} Assignment` }))
    getChaptersWithExercises(book.id).then(r => setChapters(r.data.chapters)).catch(() => {})
    setStep(1)
  }

  function toggleChapter(id) {
    setSelectedChapters(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function toggleType(t) {
    setConfig(c => ({
      ...c,
      types: c.types.includes(t) ? c.types.filter(x => x !== t) : [...c.types, t],
    }))
  }

  async function handleGenerate() {
    if (!config.title.trim()) { setGenError('Please enter a title'); return }
    if (config.types.length === 0) { setGenError('Select at least one question type'); return }
    setGenError('')
    setGenerating(true)
    try {
      const res = await generateAssignment({
        book_id: selectedBook.id,
        chapter_ids: selectedChapters,
        title: config.title,
        question_count: config.question_count,
        types: config.types,
        level: config.level,
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
                <button key={b.id} onClick={() => selectBook(b)}
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
        <div>
          <h2 className="text-sm font-semibold text-[#8892B0] uppercase tracking-wider mb-4">Configure Assignment</h2>
          <div className="space-y-5">
            {/* Title */}
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold uppercase tracking-wider mb-1.5">Title</label>
              <input
                value={config.title}
                onChange={e => setConfig(c => ({ ...c, title: e.target.value }))}
                className="w-full bg-[#1A1A3E] border border-[#2D2B5A] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#00A2FF]"
                placeholder="e.g. Chapter 3 Practice Test"
              />
            </div>

            {/* Question count */}
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold uppercase tracking-wider mb-1.5">
                Number of Questions: <span className="text-white">{config.question_count}</span>
              </label>
              <input type="range" min={3} max={30} value={config.question_count}
                onChange={e => setConfig(c => ({ ...c, question_count: Number(e.target.value) }))}
                className="w-full accent-[#00A2FF]"
              />
              <div className="flex justify-between text-xs text-[#4A5568] mt-1"><span>3</span><span>30</span></div>
            </div>

            {/* Question types */}
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold uppercase tracking-wider mb-2">Question Types</label>
              <div className="space-y-2">
                {Object.entries(TYPE_LABELS).map(([t, label]) => {
                  const needsExercises = t !== 'reformulated'
                  const unavailable = needsExercises && totalExercises === 0
                  return (
                    <button key={t} onClick={() => !unavailable && toggleType(t)} disabled={unavailable}
                      className={`w-full text-left p-3 rounded-xl border transition-all flex items-center gap-3 ${
                        unavailable ? 'opacity-40 cursor-not-allowed border-[#2D2B5A] bg-[#1A1A3E]' :
                        config.types.includes(t) ? 'bg-[#00A2FF]/10 border-[#00A2FF]' : 'bg-[#1A1A3E] border-[#2D2B5A] hover:border-[#00A2FF]/50'
                      }`}>
                      <span className={`w-5 h-5 rounded flex items-center justify-center text-xs border flex-shrink-0 ${
                        config.types.includes(t) ? 'bg-[#00A2FF] border-[#00A2FF] text-white' : 'border-[#4A5568]'
                      }`}>{config.types.includes(t) ? '✓' : ''}</span>
                      <span className={`text-sm ${config.types.includes(t) ? 'text-white' : 'text-[#8892B0]'}`}>{label}</span>
                      {unavailable && <span className="ml-auto text-xs text-[#FFD700]">No exercises in selection</span>}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Difficulty */}
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold uppercase tracking-wider mb-2">Difficulty Level</label>
              <div className="flex flex-wrap gap-2">
                {LEVELS.map(l => (
                  <button key={l} onClick={() => setConfig(c => ({ ...c, level: l }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      config.level === l ? 'bg-[#C77DFF]/20 border-[#C77DFF] text-[#C77DFF]' : 'border-[#2D2B5A] text-[#8892B0] hover:border-[#C77DFF]/50'
                    }`}>
                    {LEVEL_LABELS[l]}
                  </button>
                ))}
              </div>
            </div>

            {/* Include answers */}
            <div className="flex items-center justify-between p-4 bg-[#1A1A3E] border border-[#2D2B5A] rounded-xl">
              <div>
                <p className="text-sm font-semibold text-white">Include Answer Key</p>
                <p className="text-xs text-[#4A5568]">Append model answers at the end of the paper</p>
              </div>
              <button onClick={() => setConfig(c => ({ ...c, include_answers: !c.include_answers }))}
                className={`w-12 h-6 rounded-full transition-all relative ${config.include_answers ? 'bg-[#00D68F]' : 'bg-[#2D2B5A]'}`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.include_answers ? 'left-6' : 'left-0.5'}`} />
              </button>
            </div>

            {genError && <p className="text-sm text-[#FF3333] bg-[#FF3333]/10 border border-[#FF3333]/30 rounded-xl px-4 py-3">{genError}</p>}

            <div className="flex items-center justify-between pt-2">
              <button onClick={() => setStep(1)} className="text-sm px-4 py-2 border border-[#2D2B5A] text-[#8892B0] rounded-xl hover:text-white transition-all">← Back</button>
              <button onClick={handleGenerate} disabled={generating || config.types.length === 0}
                className="px-6 py-2.5 bg-[#00A2FF] text-white rounded-xl font-semibold text-sm disabled:opacity-40 hover:bg-[#0088DD] transition-all flex items-center gap-2">
                {generating ? (
                  <><span className="animate-spin">⟳</span> Generating…</>
                ) : (
                  <>✨ Generate {config.question_count} Questions</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
