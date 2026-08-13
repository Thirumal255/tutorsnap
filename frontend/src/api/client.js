import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ? `${import.meta.env.VITE_API_BASE}/api` : '/api',
  timeout: 90000, // 90s — generous for Claude cold-start + inference time
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('tutorsnap_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('tutorsnap_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// Auth
export const googleLogin = (credential) => api.post('/auth/google', { credential })
export const getCurrentUser = () => api.get('/auth/me')
export const logout = () => api.post('/auth/logout')
export const devLogin = (email) => api.post('/auth/dev-login', { email })

// Core (unchanged)
// Let axios/browser set Content-Type with boundary automatically for multipart
export const uploadPDF = (formData) => api.post('/upload', formData)
// Signed-URL upload (bypasses Cloud Run 32MB limit)
export const initUpload = (data) => api.post('/upload/init', data)
export const completeUpload = (bookId) => api.post(`/upload/complete/${bookId}`)
export const getIngestionStatus = (bookId) => api.get(`/ingestion/${bookId}`)
export const getBooks = (grade) => api.get('/books', { params: grade ? { grade } : {} })
export const getTopics = (bookId) => api.get(`/topics/${bookId}`)
export const previewBook = (bookId) => api.get(`/admin/books/${bookId}/preview`)
export const publishBook  = (bookId) => api.post(`/admin/books/${bookId}/publish`)
export const deleteBook = (bookId) => api.delete(`/books/${bookId}`)
export const cancelIngestion = (bookId) => api.post(`/books/${bookId}/cancel`)
export const retryIngestion  = (bookId) => api.post(`/books/${bookId}/retry`)
export const startSession = (studentName, topicId, practiceMode = false) =>
  api.post('/session/start', { student_name: studentName, topic_id: topicId, practice_mode: practiceMode })
export const submitAnswer = (sessionId, answer, imageData = null) =>
  api.post('/session/answer', { session_id: sessionId, answer, ...(imageData ? { image_data: imageData } : {}) })
export const requestSubQuestion = (sessionId, confusionType = null) =>
  api.post('/session/sub-question', { session_id: sessionId, confusion_type: confusionType })
export const requestHint = (sessionId) => api.post('/session/hint', { session_id: sessionId })
export const endSession = (sessionId) => api.post('/session/end', { session_id: sessionId })

// Admin
export const getAdminStudents = () => api.get('/admin/students')
export const createStudent = (email, name, grade) => api.post('/admin/students', { email, name, grade: grade || null })
export const getAdminStudent = (id) => api.get(`/admin/students/${id}`)
export const updateStudentGrade = (id, grade) => api.post(`/admin/students/${id}/grade`, { grade })
export const deactivateStudent = (id) => api.post(`/admin/students/${id}/deactivate`)
export const activateStudent = (id) => api.post(`/admin/students/${id}/activate`)
export const resetStudentMastery = (id) => api.post(`/admin/students/${id}/reset-mastery`, { confirm: true })
export const getAdminParents = () => api.get('/admin/parents')
export const createParent = (email, name) => api.post('/admin/parents', { email, name })
export const linkStudentToParent = (parentId, studentId) =>
  api.post(`/admin/parents/${parentId}/link-student`, { student_id: studentId })
export const unlinkStudentFromParent = (parentId, studentId) =>
  api.delete(`/admin/parents/${parentId}/unlink-student/${studentId}`)
export const getFlaggedStudents = () => api.get('/admin/flagged')
export const resolveFlag = (studentId, topicId) =>
  api.post(`/admin/flagged/${studentId}/${topicId}/resolve`)
export const getSettings = () => api.get('/admin/settings')
export const updateSettings = (settings) => api.put('/admin/settings', settings)
export const getAdminOverview = () => api.get('/admin/reports/overview')

// Student
export const getStudentDashboard  = () => api.get('/student/dashboard')
export const getBuddySettings     = () => api.get('/student/buddy')
export const updateBuddySettings  = (data) => api.put('/student/buddy', data)
export const getLeaderboard       = () => api.get('/student/leaderboard')
export const getWeeklyChallenge   = () => api.get('/student/weekly-challenge')
export const submitWeeklyChallenge = (challengeId, answer, imageData = null) =>
  api.post('/student/weekly-challenge/submit', {
    challenge_id: challengeId,
    answer,
    ...(imageData ? { image_data: imageData } : {}),
  })
export const getStudentProgress    = () => api.get('/student/progress')
export const getReviewQueue        = () => api.get('/student/review-queue')
export const getMistakes           = () => api.get('/student/mistakes')
export const startExam             = (data) => api.post('/exam/start', data)
export const submitExam            = (data) => api.post('/exam/submit', data)
export const getFlashcardQuestion  = (topicId) => api.post('/flashcard/question', { topic_id: topicId })
export const markFlashcard         = (topicId, known) => api.post('/flashcard/mark', { topic_id: topicId, known })
export const getStudentSessions = (limit = 50) => api.get('/student/sessions', { params: { limit } })

// Admin extended
export const getAdminAnalytics = () => api.get('/admin/analytics')
export const importStudentsCSV = (students) => api.post('/admin/students/import', { students })
export const getAdminAuditLog = (limit = 100) => api.get('/admin/audit-log', { params: { limit } })

// Parent
export const getMyChildren = () => api.get('/parent/children')
export const getChildDetail = (id) => api.get(`/parent/children/${id}`)
export const getChildSessions = (id, limit = 20, offset = 0) =>
  api.get(`/parent/children/${id}/sessions?limit=${limit}&offset=${offset}`)
export const getChildWeeklyReport = (id) => api.get(`/parent/children/${id}/weekly-report`)
export const setChildGoal = (id, sessions) =>
  api.post(`/parent/children/${id}/set-goal`, { daily_goal_sessions: sessions })
export const getFamilyActivity = () => api.get('/parent/family-activity')
export const getChildDigest = (id) => api.get(`/parent/children/${id}/digest`)

// Onboarding & daily goal
export const completeOnboarding = (buddyAvatar, buddyName, dailyGoalSessions) =>
  api.post('/student/complete-onboarding', {
    buddy_avatar: buddyAvatar,
    buddy_name: buddyName,
    daily_goal_sessions: dailyGoalSessions,
  })
export const updateDailyGoal = (sessions) =>
  api.put('/student/buddy', { daily_goal_sessions: sessions })

// Study Mode
export const explainTopic     = (topicId) => api.post(`/topics/${topicId}/explain`)
export const studyChat        = (topicId, studentName, messages) =>
  api.post(`/topics/${topicId}/study-chat`, { student_name: studentName, messages })
export const completeStudy    = (topicId, studentName, studySummary) =>
  api.post(`/topics/${topicId}/study-complete`, { student_name: studentName, study_summary: studySummary })
export const unlockPractice   = (topicId, studentName, studySummary) =>
  api.post(`/topics/${topicId}/study-unlock`, { student_name: studentName, study_summary: studySummary })
// Profile (student + parent)
export const getProfile          = () => api.get('/profile')
export const updateProfile       = (data) => api.put('/profile', data)
export const uploadProfileAvatar = (formData) => api.post('/profile/avatar', formData)

export const getParentNotifications = () => api.get('/parent/notifications')
export const markNotificationRead = (id) => api.post(`/parent/notifications/${id}/read`)
export const markAllNotificationsRead = () => api.post('/parent/notifications/mark-all-read')

// #62 Session recovery
export const getActiveSessions  = () => api.get('/student/active-sessions')
export const getSessionInfo     = (id) => api.get(`/session/${id}/info`)
export const getSessionReplay   = (id) => api.get(`/session/${id}/replay`)

// #27 Interleaved practice
export const getInterleavedTopics = (limit = 6) => api.get('/student/interleaved-topics', { params: { limit } })

// #60 Transfer tasks
export const getTransferQuestion = () => api.get('/student/transfer-question')

// #50 Parent encouragement
export const encourageChild = (childId, message) =>
  api.post(`/parent/children/${childId}/encourage`, { message })

// #56 Admin weekly challenge draft
export const draftWeeklyChallenge = (grade) => api.get('/admin/weekly-challenge/draft', { params: { grade } })
export const publishWeeklyChallenge = (data) => api.post('/admin/weekly-challenge/publish', data)

// Daily 3-minute challenge
export const getDailyChallenge    = ()     => api.get('/student/daily-challenge')
export const submitDailyChallenge = (data) => api.post('/student/daily-challenge/submit', data)

// Parent topic explainer
export const explainTopicForParent = (topicId) => api.get(`/parent/topics/${topicId}/explain`)

// Teach-it-back (Feynman mode)
export const teachChat = (topicId, messages, turnNumber) =>
  api.post(`/topics/${topicId}/teach-chat`, { messages, turn_number: turnNumber })

// Student Goal Journal
export const getCurrentGoal = ()     => api.get('/student/goals/current')
export const setWeeklyGoal  = (data) => api.post('/student/goals', data)

// Assignment Paper Generator
export const getChaptersWithExercises = (bookId)       => api.get(`/books/${bookId}/chapters-with-exercises`)
export const generateAssignment        = (data)         => api.post('/assignment/generate', data)
export const listAssignments           = (bookId)       => api.get('/assignment/list', { params: bookId ? { book_id: bookId } : {} })
export const getAssignment             = (id)           => api.get(`/assignment/${id}`)
export const deleteAssignment          = (id)           => api.delete(`/assignment/${id}`)
export const regenerateQuestion        = (id, data)     => api.post(`/assignment/${id}/regenerate-question`, data)
export const extractExercises          = (bookId)        => api.post(`/admin/books/${bookId}/extract-exercises`)

// Admin Task Tracker
export const getAdminTasks         = (params = {}) => api.get('/admin/tasks', { params })
export const getAdminTasksSummary  = ()             => api.get('/admin/tasks/summary')
export const getAdminTaskCategories = ()            => api.get('/admin/tasks/categories')
export const getAdminTask          = (id)           => api.get(`/admin/tasks/${id}`)
export const createAdminTask       = (data)         => api.post('/admin/tasks', data)
export const updateAdminTask       = (id, data)     => api.put(`/admin/tasks/${id}`, data)
export const deleteAdminTask       = (id)           => api.delete(`/admin/tasks/${id}`)
export const addTaskExpense        = (id, data)     => api.post(`/admin/tasks/${id}/expenses`, data)
export const deleteTaskExpense     = (taskId, expId) => api.delete(`/admin/tasks/${taskId}/expenses/${expId}`)

// Finance — accounts, budget line items
export const getFinanceAccounts    = ()             => api.get('/finance/accounts')
export const getBudgetItems        = ()             => api.get('/finance/budget-items')
export const createBudgetItem      = (data)         => api.post('/finance/budget-items', data)
export const updateBudgetItem      = (id, data)     => api.put(`/finance/budget-items/${id}`, data)
export const deleteBudgetItem      = (id)           => api.delete(`/finance/budget-items/${id}`)
