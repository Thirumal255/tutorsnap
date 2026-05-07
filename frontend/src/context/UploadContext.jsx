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

  // Auto-poll whenever there's an active job that is past the local XHR phase
  useEffect(() => {
    const shouldPoll = job && !job.localMode && job.stage !== 'done' && job.stage !== 'failed'
    if (!shouldPoll) {
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
  }, [job?.bookId, job?.stage, job?.localMode])

  /** Called right after initUpload — shows the widget immediately, pauses DB polling. */
  const startJob = useCallback((bookId, title) => {
    const j = {
      bookId,
      title,
      stage: 'uploading',
      progress: 0,
      chapterCount: 0,
      topicCount: 0,
      localMode: true,   // XHR in progress — don't poll yet
    }
    setJob(j)
  }, [])

  /**
   * Update XHR upload progress locally (0-30%).
   * Only has effect while localMode is true.
   */
  const updateProgress = useCallback((pct) => {
    setJob(prev => prev && prev.localMode ? { ...prev, progress: pct } : prev)
  }, [])

  /**
   * Called after completeUpload succeeds — switches from local XHR tracking to DB polling.
   */
  const switchToPolling = useCallback(() => {
    setJob(prev => prev ? { ...prev, localMode: false, stage: 'reading', progress: 30 } : prev)
  }, [])

  /**
   * Mark the current job as failed (e.g. XHR network error).
   */
  const failJob = useCallback((errorMsg) => {
    setJob(prev => prev ? { ...prev, stage: 'failed', localMode: false, error: errorMsg } : prev)
  }, [])

  const clearJob = useCallback(() => {
    setJob(null)
  }, [])

  /**
   * Called after a successful retryIngestion API call.
   * Resets the job back to 'reading' so the progress card shows it running again.
   */
  const restartJob = useCallback(() => {
    setJob(prev => prev ? { ...prev, stage: 'reading', progress: 30, localMode: false, error: null } : prev)
  }, [])

  return (
    <UploadCtx.Provider value={{ job, startJob, updateProgress, switchToPolling, failJob, clearJob, restartJob }}>
      {children}
    </UploadCtx.Provider>
  )
}

export const useUpload = () => useContext(UploadCtx)
