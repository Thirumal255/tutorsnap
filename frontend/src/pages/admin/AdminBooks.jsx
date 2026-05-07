import { useState, useEffect } from 'react'
import { initUpload, completeUpload, uploadPDF, getTopics, getBooks, deleteBook } from '../../api/client'
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

export default function AdminBooks() {
  const { job, startJob, updateProgress, switchToPolling, failJob } = useUpload()
  const [books, setBooks] = useState([])
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('Mathematics')
  const [grade, setGrade] = useState(6)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [viewTopics, setViewTopics] = useState(null)   // { chapters } for a done book

  useEffect(() => { loadBooks() }, [])

  // Refresh book list when the active upload job finishes
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
      // ── Step 1: Init — create Book record + get signed URL ──────────────
      const initRes = await initUpload({
        title: bookTitle,
        subject,
        grade,
        filename: file.name,
        content_type: 'application/pdf',
      })
      const { book_id, upload_url, use_signed_url } = initRes.data

      if (use_signed_url && upload_url) {
        // ── Step 2: Register job immediately so widget shows up ──────────
        startJob(book_id, bookTitle)
        setFile(null)
        setTitle('')
        setUploading(false)

        // ── Step 3: Upload file directly to GCS via XHR ─────────────────
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('PUT', upload_url)
          xhr.setRequestHeader('Content-Type', 'application/pdf')

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              // XHR phase = 0-30% of overall progress
              const pct = Math.round((e.loaded / e.total) * 30)
              updateProgress(pct)
            }
          }

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve()
            else reject(new Error(`GCS upload failed (HTTP ${xhr.status})`))
          }
          xhr.onerror = () => reject(new Error('Network error during file upload'))
          xhr.onabort = () => reject(new Error('Upload cancelled'))
          xhr.send(file)
        })

        // ── Step 4: Notify backend → triggers ingestion ──────────────────
        await completeUpload(book_id)
        switchToPolling()   // hand off to DB-poll for reading/analysing/saving stages

      } else {
        // ── Fallback: local dev — regular multipart upload ───────────────
        const formData = new FormData()
        formData.append('file', file)
        formData.append('title', bookTitle)
        formData.append('subject', subject)
        formData.append('grade', String(grade))
        const res = await uploadPDF(formData)
        startJob(res.data.book_id, bookTitle)
        switchToPolling()
        setFile(null)
        setTitle('')
        setUploading(false)
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

        {/* Metadata row */}
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

        {/* File picker */}
        <div>
          <label className="text-xs text-[#8892B0] font-semibold mb-1 block">PDF File *</label>
          <div className="flex flex-col sm:flex-row gap-3 items-start">
            <label className="flex-1 flex items-center gap-3 blox-input cursor-pointer hover:border-[#00A2FF] transition-colors">
              <span className="text-2xl">📄</span>
              <span className="text-sm text-[#8892B0] truncate">
                {file ? file.name : 'Click to choose PDF…'}
              </span>
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={e => setFile(e.target.files[0] || null)}
              />
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

      {/* Active upload hint — widget is in the bottom-right corner */}
      {job && job.stage !== 'done' && job.stage !== 'failed' && (
        <div className="blox-card p-4 flex items-center gap-3 border-[#00A2FF]/30">
          <div className="w-4 h-4 border-2 border-[#00A2FF] border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <p className="text-sm text-[#8892B0] font-nunito">
            Processing <span className="text-white font-semibold">{job.title}</span> — see progress widget ↘
          </p>
        </div>
      )}

      {/* Inline topics viewer for any book */}
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

      {/* Existing books list */}
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
