import { createContext, useContext, useState, useEffect } from 'react'
import { getCurrentUser } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('tutorsnap_token')
    if (token) {
      getCurrentUser()
        .then(res => setUser(res.data))
        .catch(() => localStorage.removeItem('tutorsnap_token'))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = (token, userData) => {
    localStorage.setItem('tutorsnap_token', token)
    setUser(userData)
  }

  const logout = () => {
    localStorage.removeItem('tutorsnap_token')
    setUser(null)
  }

  const refreshUser = () => {
    getCurrentUser()
      .then(res => setUser(res.data))
      .catch(() => {})
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
