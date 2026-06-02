import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ? `${import.meta.env.VITE_API_BASE}/api` : '/api',
  timeout: 30000,
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
      window.location.href = '/'
    }
    return Promise.reject(err)
  }
)

// Auth
export const googleLogin       = (credential) => api.post('/auth/google', { credential })
export const getCurrentUser    = ()            => api.get('/auth/me')

// Tasks
export const getAdminTasks         = (params = {}) => api.get('/admin/tasks', { params })
export const getAdminTasksSummary  = ()             => api.get('/admin/tasks/summary')
export const getAdminTaskCategories = ()            => api.get('/admin/tasks/categories')
export const getAdminTask          = (id)           => api.get(`/admin/tasks/${id}`)
export const createAdminTask       = (data)         => api.post('/admin/tasks', data)
export const updateAdminTask       = (id, data)     => api.put(`/admin/tasks/${id}`, data)
export const deleteAdminTask       = (id)           => api.delete(`/admin/tasks/${id}`)
export const addTaskExpense        = (id, data)     => api.post(`/admin/tasks/${id}/expenses`, data)
export const updateTaskExpense     = (taskId, expId, data) => api.patch(`/admin/tasks/${taskId}/expenses/${expId}`, data)
export const deleteTaskExpense     = (taskId, expId) => api.delete(`/admin/tasks/${taskId}/expenses/${expId}`)
