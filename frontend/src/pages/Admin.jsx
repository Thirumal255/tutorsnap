import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { uploadPDF, getIngestionStatus, getTopics } from '../api/client'

const LEVEL_COLORS = {
  L3: 'bg-green-100 text-green-700',
  L4: 'bg-blue-100 text-blue-700',
  L5: 'bg-purple-100 text-purple-700',
  L1: 'bg-gray-100 text-gray-600',
  L2: 'bg-yellow-100 text-yellow-700',
}

export default function Admin() {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [bookId, setBookId] = useState(null)
  const [status, setStatus] = useState(null)
  const [bookData, setBookData] = useState(null)
  const [topicsData, setTopicsData] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  function handleFileChange(e) {
    setFile(e.target.files[0] || null)
  }

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError(null)
    setTopicsData(null)
    setBookData(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await uploadPDF(formData)
      setBookId(res.data.book_id)
      setStatus('processing')
      startPolling(res.data.book_id)
    } catch (e) {
      setError(e.response?.data?.detail || 'Upload failed')
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
        setStatus(s)
        setBookData(res.data)
        if (s === 'done' || s === 'failed') {
          clearInterval(pollRef.current)
          if (s === 'done') loadTopics(id)
        }
      } catch {
        clearInterval(pollRef.current)
      }
    }, 3000)
  }

  async function loadTopics(id) {
    try {
      const res = await getTopics(id)
      setTopicsData(res.data)
      const exp = {}
      res.data.chapters.forEach((ch) => { exp[ch.id] = true })
      setExpanded(exp)
    } catch {
      setError('Failed to load topics')
    }
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  function toggleChapter(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="min-h-screen bg-green-50 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-green-700">TutorSnap</h1>
            <p className="text-gray-500 mt-1">Admin — Upload Textbook PDF</p>
          </div>
          <Link to="/" className="text-sm text-green-600 hover:underline">← Student view</Link>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Cambridge Mathematics Grade 6
          </label>
          <div className="flex flex-col sm:flex-row gap-3 items-start">
            <div className="flex-1">
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
              />
              {file && <p className="mt-2 text-xs text-gray-500">Selected: {file.name}</p>}
            </div>
            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="px-5 py-2 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {uploading ? 'Uploading…' : 'Upload & Extract'}
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>

        {status && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
            {status === 'processing' && (
              <div className="flex items-center gap-3 text-gray-600">
                <svg className="animate-spin h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span>Extracting chapters and topics…</span>
              </div>
            )}
            {status === 'done' && bookData && (
              <div className="flex items-center gap-2 text-green-700">
                <span className="text-2xl">✅</span>
                <span className="font-medium">
                  Success! {bookData.chapter_count} chapters and {bookData.topic_count} topics extracted.
                </span>
              </div>
            )}
            {status === 'failed' && (
              <div className="text-red-600">
                <p className="font-medium">Ingestion failed</p>
                {bookData?.error && <p className="text-sm mt-1">{bookData.error}</p>}
              </div>
            )}
          </div>
        )}

        {topicsData && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-700">Extracted Topics</h2>
            {topicsData.chapters.map((ch) => (
              <div key={ch.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <button
                  onClick={() => toggleChapter(ch.id)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <span className="font-semibold text-gray-800">
                    Chapter {ch.chapter_number}: {ch.title}
                  </span>
                  <span className="text-xs text-gray-400 flex items-center gap-2">
                    {ch.topics.length} topics
                    <span>{expanded[ch.id] ? '▲' : '▼'}</span>
                  </span>
                </button>
                {expanded[ch.id] && (
                  <ul className="border-t border-gray-100 divide-y divide-gray-50">
                    {ch.topics.map((t) => (
                      <li key={t.id} className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-700">
                            {t.topic_number} {t.title}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LEVEL_COLORS[t.difficulty_ceiling] || 'bg-gray-100 text-gray-600'}`}>
                            {t.difficulty_ceiling}
                          </span>
                        </div>
                        {t.key_concepts?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {t.key_concepts.map((c, i) => (
                              <span key={i} className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{c}</span>
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
    </div>
  )
}
