import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ? `${import.meta.env.VITE_API_BASE}/api` : '/api',
  timeout: 30000,
})

const MOBILE_API_KEY = import.meta.env.VITE_MOBILE_API_KEY || ''
const isNative = () => typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()

api.interceptors.request.use(config => {
  const token = localStorage.getItem('tutorsnap_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  } else if (isNative() && MOBILE_API_KEY) {
    config.headers.Authorization = `Bearer ${MOBILE_API_KEY}`
  }
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

// Finance
export const getFinanceSummary     = (period)       => api.get('/finance/summary', { params: period ? { period } : {} })
export const getFinanceAccounts    = ()             => api.get('/finance/accounts')
export const getFinanceReceipts    = (period)       => api.get('/finance/receipts', { params: period ? { period } : {} })
export const createFinanceReceipt  = (data)         => api.post('/finance/receipts', data)
export const deleteFinanceReceipt  = (id)           => api.delete(`/finance/receipts/${id}`)
export const getBudgetItems        = ()             => api.get('/finance/budget-items')
export const createBudgetItem      = (data)         => api.post('/finance/budget-items', data)
export const updateBudgetItem      = (id, data)     => api.put(`/finance/budget-items/${id}`, data)
export const deleteBudgetItem      = (id)           => api.delete(`/finance/budget-items/${id}`)
export const createFinanceAccount  = (data)         => api.post('/finance/accounts', data)
export const updateFinanceAccount  = (id, data)     => api.put(`/finance/accounts/${id}`, data)
export const deleteFinanceAccount  = (id)           => api.delete(`/finance/accounts/${id}`)
export const getFinanceSources     = ()             => api.get('/finance/sources')
export const createFinanceSource   = (data)         => api.post('/finance/sources', data)
export const updateFinanceSource   = (id, data)     => api.put(`/finance/sources/${id}`, data)
export const deleteFinanceSource   = (id)           => api.delete(`/finance/sources/${id}`)
export const getFinanceAllocations      = (period)              => api.get('/finance/allocations', { params: period ? { period } : {} })
export const upsertFinanceAllocation    = (data)                => api.post('/finance/allocations', data)
export const deleteFinanceAllocation    = (id)                  => api.delete(`/finance/allocations/${id}`)
export const unlinkFinanceAllocation    = (category, account_id) =>
  api.delete('/finance/allocations/by-account', { params: { category, account_id } })
export const getFinanceTransfers       = ()           => api.get('/finance/transfers')
export const createFinanceTransfer     = (data)       => api.post('/finance/transfers', data)
export const deleteFinanceTransfer     = (id)         => api.delete(`/finance/transfers/${id}`)
export const getCategoryAccounts       = (category)   => api.get('/finance/category-accounts', { params: { category } })
export const getAccountBreakdown       = (id)         => api.get(`/finance/accounts/${id}/breakdown`)
