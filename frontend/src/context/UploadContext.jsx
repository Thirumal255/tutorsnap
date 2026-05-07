import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { getIngestionStatus } from '../api/client'

const UploadCtx = createContext(null)

const STORAGE_KEY = 'studyblox_upload_job'

export function UploadProvider({ children }) {
  const [job, setJob] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })
  const pollRef = useRef(null)

  // Persist job to localStorage whenever it changes
  useEffect(() => {
    if (job) {
      if (job.stage === 'done' || job.stage === 'failed') {
        // Keep in state for display, but clear storage so it doesn't restore on refresh
        localStorage.removeItem(STORAGE_KEY)
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(job))
      }
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [job])

  // Auto-poll whenever there's an active job
  useEffect(() => {
    if (!job || job.stage === 'done' || job.stage === 'failed') {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }

    pollRef.current = setInterval(async () => {
      try {
        const res = await getIngestionStatus(job.bookId)
        const { stage, progress, status, chapter_count, topic_count, error } = res.data
        setJob(prev => prev ? {
          ...prev,
          stage: stage || (status === 'done' ? 'done' : status === 'failed' ? 'failed' : prev.stage),
          progress: progress ?? prev.progress,
          chapterCount: chapter_count,
          topicCount: topic_count,
          error: error || null,
        } : prev)
        if (status === 'done' || status === 'failed') {
          clearInterval(pollRef.current)
        }
      } catch {
        // silently ignore network errors during polling
      }
    }, 3000)

    return () => clearInterval(pollRef.current)
  }, [job?.bookId, job?.stage])

  const startJob = useCallback((bookId, title) => {
    const j = { bookId, title, stage: 'uploading', progress: 0, chapterCount: 0, topicCount: 0 }
    setJob(j)
  }, [])

  const clearJob = useCallback(() => {
    setJob(null)
  }, [])

  return (
    <UploadCtx.Provider value={{ job, startJob, clearJob }}>
      {children}
    </UploadCtx.Provider>
  )
}

export const useUpload = () => useContext(UploadCtx)
