import { useState, useEffect } from 'react'
import {
  initUpload, completeUpload, uploadPDF, getTopics, getBooks,
  deleteBook, cancelIngestion, retryIngestion,
} from '../../api/client'
import { useUpload } from '../../context/UploadContext'

const SUBJECTS = [
  'Mathematics', 'Science', 'English', 'Social Studies',
  'History', 'Geography', 'Physics', 'Chemistry', 'Biology',
  'Computer Science', 'Tamil', 'Hindi', 'Other',
]

const GRADES = Array.from({ length: 12 }, (_, i) => i + 1)

const RANK_COLORS = {
  L1: 'bg-[#8B4513]/20 text-[#CD853F] border-[#8B4513]/30',
  L2: 'bg-[#696969]/20 text-[#A9A9A9] border-[#696969]/30',
  L3: 'bg-[#2F4F4F]/20 text-[#708090] border-[#2F4F4F]/30',
  L4: 'bg-[#00A2FF]/20 text-[#00A2FF] border-[#00A2FF]/30',
  L5: 'bg-[#FFD700]/20 text-[#FFD700] border-[#FFD700]/30',
}

const STAGE_INFO = {
  uploading:  { label: '📤 Uploading to Cloud Storage', color: '#00A2FF' },
  reading:    { label: '🔍 Reading PDF structure',       color: '#FFD700' },
  analysing:  { label: '🤖 AI extracting topics',        color: '#C77DFF' },
  saving:     { label: '💾 Saving to database',          color: '#00D68F' },
  done:       { label: '✅ Ready!',                       color: '#00D68F' },
  failed:     { label: '❌ Failed / Cancelled',           color: '#FF3333' },
}

const STAGE_STEPS = [
  { key: 'uploading', short: '📤 Upload' },
  { key: 'reading',   short: '🔍 Read' },
  { key: 'analysing', short: '🤖 AI' },
  { key: 'saving',    short: '💾 Save' },
]
const STAGE_ORDER = ['uploading', 'reading', 'analysing', 'saving', 'done']


// ── Inline progress card (replaces floating widget) ───────────────────────
function IngestionProgressCard({ job, onCancel, onRetry, onDismiss }) {
  const [expanded, setExpanded] = useState(true)
  const [cancelling, setCancelling] = useState(false)
  const [retrying, setRetrying] = useState(false)

  if (!job) return null

  const info = STAGE_INFO[job.stage] || STAGE_INFO.reading
  const isDone = job.stage === 'done'
  const isFailed = job.stage === 'failed'
  const isActive = !isDone && !isFailed

  async function handleCancel() {
    setCancelling(true)
    try { await onCancel() } finally { setCancelling(false) }
  }

  async function handleRetry() {
    setRetrying(true)
    try { await onRetry() } finally { setRetrying(false) }
  }

  return (
    <div className={`blox-card overflow-hidden border ${
      isFailed ? 'border-[#FF3333]/40' : isDone ? 'border-[#00D68F]/40' : 'border-[#00A2FF]/40'
    }`}>
      {/* Header row — always visible */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#1A1A3E] transition-colors"
      >
        {isActive && (
          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 animate-pulse"
            style={{ backgroundColor: info.color }} />
        )}
        {isDone && <span className="text-sm">✅</span>}
        {isFailed && <span className="text-sm">❌</span>}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate font-nunito">{job.title}</p>
          <p className="text-xs" style={{ color: info.color }}>{info.label}</p>
        </div>

        {/* Compact progress bar */}
        {isActive && (
          <div className="w-24 flex-shrink-0">
            <div className="h-1.5 bg-[#0F0F23] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${job.progress ?? 0}%`, backgroundColor: info.color }} />
            </div>
            <p className="text-xs text-right mt-0.5 font-bold" style={{ color: info.color }}>
              {job.progress ?? 0}%
            </p>
          </div>
        )}

        <span className="text-[#8892B0] text-xs ml-1">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-[#2D2B5A] px-4 py-4 space-y-4">

          {/* Full progress bar */}
          {!isFailed && (
            <div>
              <div className="flex justify-between text-xs text-[#8892B0] mb-1.5">
                <span>Progress</span>
                <span className="font-bold" style={{ color: info.color }}>{job.progress ?? 0}%</span>
              </div>
              <div className="h-2.5 bg-[#0F0F23] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${job.progress ?? 0}%`,
                    backgroundColor: info.color,
                    boxShadow: `0 0 8px ${info.color}88`,
                  }} />
              </div>
            </div>
          )}

          {/* Stage steps */}
          <div className="grid grid-cols-4 gap-1">
            {STAGE_STEPS.map(step => {
              const curIdx = STAGE_ORDER.indexOf(job.stage)
              const stepIdx = STAGE_ORDER.indexOf(step.key)
              const done   = curIdx > stepIdx || isDone
              const active = curIdx === stepIdx
              return (
                <div key={step.key} className={`text-center p-1.5 rounded-lg text-xs transition-all ${
                  done   ? 'bg-[#00D68F]/20 text-[#00D68F]' :
                  active ? 'bg-[#00A2FF]/20 text-[#00A2FF] ring-1 ring-[#00A2FF]/40' :
                           'bg-[#0F0F23] text-[#4A5568]'
                }`}>
                  {step.short}
                </div>
              )
            })}
          </div>

          {/* Result / error messages */}
          {isDone && (
            <div className="bg-[#00D68F]/10 border border-[#00D68F]/30 rounded-xl px-3 py-2 text-center">
              <p className="text-[#00D68F] text-sm font-bold font-fredoka">
                🎉 {job.chapterCount} chapters · {job.topicCount} topics ready!
              </p>
            </div>
          )}
          {isFailed && job.error && (
            <div className="bg-[#FF3333]/10 border border-[#FF3333]/30 rounded-xl px-3 py-2 space-y-2">
              <p className="text-[#FF6B6B] text-xs">{job.error}</p>
              <p className="text-[#8892B0] text-xs">
                Progress is saved — retrying will resume from the last completed chapter.
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {isActive && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 text-xs border border-[#FF3333]/40 text-[#FF3333] rounded-xl py-2 hover:bg-[#FF3333]/10 transition-all disabled:opacity-40"
              >
                {cancelling ? 'Cancelling…' : '⏹ Cancel'}
              </button>
            )}
            {isFailed && (
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="flex-1 text-xs border border-[#00A2FF]/40 text-[#00A2FF] rounded-xl py-2 hover:bg-[#00A2FF]/10 transition-all disabled:opacity-40"
              >
                {retrying ? 'Starting…' : '▶ Resume from checkpoint'}
              </button>
            )}
            {(isDone || isFailed) && (
              <button
                onClick={onDismiss}
                className="text-xs border border-[#2D2B5A] text-[#8892B0] rounded-xl py-2 px-3 hover:text-white transition-all"
              >
                Dismiss
              </button>
            )}
          </div>

          {isActive && (
            <p className="text-[#8892B0] text-xs text-center">
              You can navigate away — processing continues in the background
            </p>
          )}
        </div>
      )}
    </div>
  )
}


// ── Main AdminBooks page ───────────────────────────────────────────────────
export default function AdminBooks() {
  const { job, startJob, updateProgress, switchToPolling, failJob, clearJob, restartJob } = useUpload()
  const [books, setBooks] = useState([])
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('Mathematics')
  const [grade, setGrade] = useState(6)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [viewTopics, setViewTopics] = useState(null)

  useEffect(() => { loadBooks() }, [])

  useEffect(() => {
    if (job?.stage === 'done') loadBooks()
  }, [job?.stage])

  async function loadBooks() {
    try {
      const res = await getBooks()
      setBooks(res.data)
    } catch {}
  }

  async function handleUpload() {
    if (!file || !title.trim()) return
    setUploading(true)
    setError(null)
    setViewTopics(null)

    const bookTitle = title.trim()

    try {
      const initRes = await initUpload({
        title: bookTitle, subject, grade,
        filename: file.name, content_type: 'application/pdf',
      })
      const { book_id, upload_url, use_signed_url } = initRes.data

      if (use_signed_url && upload_url) {
        startJob(book_id, bookTitle)
        setFile(null); setTitle(''); setUploading(false)

        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('PUT', upload_url)
          xhr.setRequestHeader('Content-Type', 'application/pdf')
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) updateProgress(Math.round((e.loaded / e.total) * 30))
          }
          xhr.onload  = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`GCS upload failed (HTTP ${xhr.status})`))
          xhr.onerror = () => reject(new Error('Network error during file upload'))
          xhr.onabort = () => reject(new Error('Upload cancelled'))
          xhr.send(file)
        })

        await completeUpload(book_id)
        switchToPolling()

      } else {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('title', bookTitle)
        formData.append('subject', subject)
        formData.append('grade', String(grade))
        const res = await uploadPDF(formData)
        startJob(res.data.book_id, bookTitle)
        switchToPolling()
        setFile(null); setTitle(''); setUploading(false)
      }

    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Upload failed. Please try again.'
      setError(msg)
      failJob(msg)
      setUploading(false)
    }
  }

  async function handleDelete(bookId, bookTitle) {
    if (!window.confirm(`Delete "${bookTitle}"? This cannot be undone.`)) return
    try {
      await deleteBook(bookId)
      setViewTopics(null)
      loadBooks()
    } catch (e) {
      setError(e.response?.data?.detail || 'Delete failed.')
    }
  }

  async function handleCancel() {
    if (!job?.bookId) return
    try {
      await cancelIngestion(job.bookId)
      // The widget will update via polling when the backend marks it failed
    } catch (e) {
      setError(e.response?.data?.detail || 'Cancel failed.')
    }
  }

  async function handleRetry() {
    if (!job?.bookId) return
    try {
      await retryIngestion(job.bookId)
      restartJob()   // reset local job state to 'reading'
    } catch (e) {
      setError(e.response?.data?.detail || 'Retry failed.')
    }
  }

  // Retry a book that failed but has no active job in context (e.g. after page refresh)
  async function handleRetryBook(book) {
    try {
      await retryIngestion(book.book_id)
      startJob(book.book_id, book.title || book.filename)
      switchToPolling()
      loadBooks()
    } catch (e) {
      setError(e.response?.data?.detail || 'Retry failed.')
    }
  }

  // Cancel a stuck-processing book that has no active job in context
  async function handleCancelBook(book) {
    if (!window.confirm(`Cancel ingestion for "${book.title || book.filename}"?\n\nProgress already saved will be kept — you can resume from the last completed chapter.`)) return
    try {
      await cancelIngestion(book.book_id)
      loadBooks()
    } catch (e) {
      setError(e.response?.data?.detail || 'Cancel failed.')
    }
  }

  async function loadTopicsForBook(bookId) {
    try {
      const res = await getTopics(bookId)
      setViewTopics(res.data)
      const exp = {}
      res.data.chapters.forEach(ch => { exp[ch.id] = true })
      setExpanded(exp)
    } catch {}
  }

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <div>
        <h2 className="text-2xl font-fredoka font-bold text-white">📚 Books</h2>
        <p className="text-[#8892B0] text-sm mt-1">Upload textbooks and let AI extract chapters &amp; topics</p>
      </div>

      {/* Upload card */}
      <div className="blox-card p-6 space-y-5">
        <h3 className="text-sm font-fredoka font-bold text-[#00A2FF]">➕ Upload New Textbook</h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-1">
            <label className="text-xs text-[#8892B0] font-semibold mb-1 block">Book Title *</label>
            <input
              placeholder="e.g. Maths Class 6 Term 1"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="blox-input w-full"
            />
          </div>
          <div>
            <label className="text-xs text-[#8892B0] font-semibold mb-1 block">Subject *</label>
            <select value={subject} onChange={e => setSubject(e.target.value)} className="blox-input w-full">
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-[#8892B0] font-semibold mb-1 block">Grade *</label>
            <select value={grade} onChange={e => setGrade(Number(e.target.value))} className="blox-input w-full">
              {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-[#8892B0] font-semibold mb-1 block">PDF File *</label>
          <div className="flex flex-col sm:flex-row gap-3 items-start">
            <label className="flex-1 flex items-center gap-3 blox-input cursor-pointer hover:border-[#00A2FF] transition-colors">
              <span className="text-2xl">📄</span>
              <span className="text-sm text-[#8892B0] truncate">
                {file ? file.name : 'Click to choose PDF…'}
              </span>
              <input type="file" accept=".pdf" className="hidden"
                onChange={e => setFile(e.target.files[0] || null)} />
            </label>
            <button
              onClick={handleUpload}
              disabled={!file || !title.trim() || uploading}
              className="btn-blox-primary px-6 py-2.5 text-sm whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading ? '⚡ Uploading…' : '🚀 Upload & Extract'}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-[#FF3333]/10 border border-[#FF3333]/30 rounded-xl px-4 py-3">
            <p className="text-sm text-[#FF6B6B]">⚠️ {error}</p>
          </div>
        )}
      </div>

      {/* Inline ingestion progress card */}
      {job && (
        <IngestionProgressCard
          job={job}
          onCancel={handleCancel}
          onRetry={handleRetry}
          onDismiss={clearJob}
        />
      )}

      {/* Inline topics viewer */}
      {viewTopics && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[#8892B0] uppercase tracking-wider">Extracted Topics</p>
            <button onClick={() => setViewTopics(null)} className="text-xs text-[#8892B0] hover:text-white">✕ Close</button>
          </div>
          {viewTopics.chapters.map(ch => (
            <div key={ch.id} className="bg-[#0F0F23] rounded-xl overflow-hidden border border-[#2D2B5A]">
              <button
                onClick={() => setExpanded(p => ({ ...p, [ch.id]: !p[ch.id] }))}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#1A1A3E] transition-colors"
              >
                <span className="font-fredoka font-bold text-white text-sm">
                  <span className="text-[#00A2FF] mr-2">Ch {ch.chapter_number}</span>{ch.title}
                </span>
                <span className="text-xs text-[#8892B0]">{ch.topics.length} topics {expanded[ch.id] ? '▲' : '▼'}</span>
              </button>
              {expanded[ch.id] && (
                <ul className="border-t border-[#2D2B5A] divide-y divide-[#2D2B5A]/50">
                  {ch.topics.map(t => (
                    <li key={t.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-white font-nunito">
                          {t.topic_number} {t.title}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold border ${RANK_COLORS[t.difficulty_ceiling] || ''}`}>
                          {t.difficulty_ceiling}
                        </span>
                      </div>
                      {t.key_concepts?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {t.key_concepts.map((c, i) => (
                            <span key={i} className="text-xs bg-[#2D2B5A] text-[#8892B0] px-2 py-0.5 rounded-full">{c}</span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Books list */}
      {books.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-[#8892B0] uppercase tracking-wider">All Books ({books.length})</p>
          <div className="blox-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#1A1A3E] text-[#8892B0] text-xs font-nunito uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Title</th>
                  <th className="px-4 py-3 text-left">Subject</th>
                  <th className="px-4 py-3 text-left">Grade</th>
                  <th className="px-4 py-3 text-left">Topics</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2D2B5A]">
                {books.map(b => (
                  <tr key={b.book_id} className="hover:bg-[#1A1A3E] transition-colors">
                    <td className="px-4 py-3 font-semibold text-white font-nunito">
                      📚 {b.title || b.filename}
                    </td>
                    <td className="px-4 py-3 text-[#8892B0] text-xs">{b.subject}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-[#00A2FF]/20 text-[#00A2FF] border border-[#00A2FF]/30 px-2 py-0.5 rounded-full font-bold">
                        G{b.grade}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#00D68F] font-bold font-fredoka">
                      {b.topic_count ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      {b.status === 'done' && (
                        <span className="text-xs bg-[#00D68F]/20 text-[#00D68F] border border-[#00D68F]/30 px-2 py-0.5 rounded-full">✓ Ready</span>
                      )}
                      {b.status === 'processing' && (
                        <span className="text-xs bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/30 px-2 py-0.5 rounded-full animate-pulse">⚡ Processing</span>
                      )}
                      {b.status === 'failed' && (
                        <span className="text-xs bg-[#FF3333]/20 text-[#FF3333] border border-[#FF3333]/30 px-2 py-0.5 rounded-full">✕ Failed</span>
                      )}
                      {b.status === 'pending' && (
                        <span className="text-xs bg-[#8892B0]/20 text-[#8892B0] border border-[#8892B0]/30 px-2 py-0.5 rounded-full">⏳ Pending</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {b.status === 'done' && (
                          <button onClick={() => loadTopicsForBook(b.book_id)}
                            className="text-xs text-[#00A2FF] hover:underline font-semibold">
                            View Topics
                          </button>
                        )}
                        {b.status === 'processing' && !job && (
                          <button onClick={() => handleCancelBook(b)}
                            className="text-xs text-[#FF6B6B] hover:underline font-semibold">
                            ⏹ Cancel
                          </button>
                        )}
                        {b.status === 'failed' && (
                          <button onClick={() => handleRetryBook(b)}
                            className="text-xs text-[#FFD700] hover:underline font-semibold">
                            ▶ Retry
                          </button>
                        )}
                        <button onClick={() => handleDelete(b.book_id, b.title || b.filename)}
                          className="text-xs text-[#8892B0] hover:text-[#FF3333] transition-colors"
                          title="Delete book">
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
