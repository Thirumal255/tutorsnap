import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ? `${import.meta.env.VITE_API_BASE}/api` : '/api',
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
export const uploadPDF = (formData) =>
  api.post('/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
export const getIngestionStatus = (bookId) => api.get(`/ingestion/${bookId}`)
export const getBooks = () => api.get('/books')
export const getTopics = (bookId) => api.get(`/topics/${bookId}`)
export const startSession = (studentName, topicId) =>
  api.post('/session/start', { student_name: studentName, topic_id: topicId })
export const submitAnswer = (sessionId, answer) =>
  api.post('/session/answer', { session_id: sessionId, answer })
export const requestHint = (sessionId) => api.post('/session/hint', { session_id: sessionId })
export const endSession = (sessionId) => api.post('/session/end', { session_id: sessionId })

// Admin
export const getAdminStudents = () => api.get('/admin/students')
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

// Parent
export const getMyChildren = () => api.get('/parent/children')
export const getChildDetail = (id) => api.get(`/parent/children/${id}`)
export const getChildSessions = (id, limit = 20, offset = 0) =>
  api.get(`/parent/children/${id}/sessions?limit=${limit}&offset=${offset}`)
export const getParentNotifications = () => api.get('/parent/notifications')
export const markNotificationRead = (id) => api.post(`/parent/notifications/${id}/read`)
