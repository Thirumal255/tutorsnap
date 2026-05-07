import { useState, useEffect, useRef } from 'react'
import { uploadPDF, getIngestionStatus, getTopics, getBooks } from '../../api/client'

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
  const [books, setBooks] = useState([])
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('Mathematics')
  const [grade, setGrade] = useState(6)
  const [uploading, setUploading] = useState(false)
  const [activeBook, setActiveBook] = useState(null)   // { id, status, data, topics }
  const [expanded, setExpanded] = useState({})
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    loadBooks()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

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
    setActiveBook(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('title', title.trim())
      formData.append('subject', subject)
      formData.append('grade', String(grade))
      const res = await uploadPDF(formData)
      const bookId = res.data.book_id
      setActiveBook({ id: bookId, status: 'processing', data: null, topics: null })
      startPolling(bookId)
      setFile(null)
      setTitle('')
    } catch (e) {
      setError(e.response?.data?.detail || 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  function startPolling(id) {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await getIngestionStatus(id)
        const s = res.data.status
        setActiveBook(prev => ({ ...prev, status: s, data: res.data }))
        if (s === 'done' || s === 'failed') {
          clearInterval(pollRef.current)
          loadBooks()
          if (s === 'done') loadTopicsForBook(id)
        }
      } catch {
        clearInterval(pollRef.current)
      }
    }, 3000)
  }

  async function loadTopicsForBook(id) {
    try {
      const res = await getTopics(id)
      setActiveBook(prev => ({ ...prev, topics: res.data }))
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

      {/* Ingestion progress */}
      {activeBook && (
        <div className="blox-card p-5">
          {activeBook.status === 'processing' && (
            <div className="flex items-center gap-3 text-[#8892B0]">
              <div className="w-5 h-5 border-2 border-[#00A2FF] border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span className="font-nunito text-sm">🤖 AI is reading your book and extracting topics…</span>
            </div>
          )}
          {activeBook.status === 'done' && activeBook.data && (
            <div className="flex items-center gap-2 text-[#00D68F]">
              <span className="text-xl">✅</span>
              <span className="font-fredoka font-bold">
                {activeBook.data.chapter_count} chapters · {activeBook.data.topic_count} topics extracted!
              </span>
            </div>
          )}
          {activeBook.status === 'failed' && (
            <div className="text-[#FF3333]">
              <p className="font-bold">❌ Ingestion failed</p>
              {activeBook.data?.error && <p className="text-sm mt-1 text-[#FF6B6B]">{activeBook.data.error}</p>}
            </div>
          )}

          {/* Extracted chapters/topics */}
          {activeBook.topics && (
            <div className="mt-5 space-y-3">
              <p className="text-xs font-semibold text-[#8892B0] uppercase tracking-wider">Extracted Topics</p>
              {activeBook.topics.chapters.map(ch => (
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
                        <span className="text-xs bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/30 px-2 py-0.5 rounded-full">⚡ Processing</span>
                      )}
                      {b.status === 'failed' && (
                        <span className="text-xs bg-[#FF3333]/20 text-[#FF3333] border border-[#FF3333]/30 px-2 py-0.5 rounded-full">✕ Failed</span>
                      )}
                      {b.status === 'pending' && (
                        <span className="text-xs bg-[#8892B0]/20 text-[#8892B0] border border-[#8892B0]/30 px-2 py-0.5 rounded-full">⏳ Pending</span>
                      )}
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
