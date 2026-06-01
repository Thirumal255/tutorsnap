import { useState, useEffect } from 'react'
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'
import { googleLogin, getCurrentUser } from './api/client'
import TasksPage from './TasksPage'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

function LoginScreen({ onLogin }) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCredential(credentialResponse) {
    setLoading(true)
    setError('')
    try {
      const res = await googleLogin(credentialResponse.credential)
      localStorage.setItem('tutorsnap_token', res.data.access_token)
      onLogin(res.data.user)
    } catch (e) {
      setError(e.response?.data?.detail || 'Login failed. Make sure you have admin access.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0F0F23] flex flex-col items-center justify-center gap-6 p-4">
      <div className="text-center space-y-2">
        <div className="text-4xl">📋</div>
        <h1 className="text-2xl font-bold text-white">Task Tracker</h1>
        <p className="text-[#8892B0] text-sm">Sign in with your admin account</p>
      </div>
      <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl p-8 flex flex-col items-center gap-4 w-full max-w-sm">
        {loading ? (
          <p className="text-[#8892B0] text-sm">Signing in…</p>
        ) : (
          <GoogleLogin
            onSuccess={handleCredential}
            onError={() => setError('Google sign-in failed')}
            theme="filled_blue"
            shape="rectangular"
            width="280"
          />
        )}
        {error && <p className="text-[#FF3333] text-xs text-center">{error}</p>}
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('tutorsnap_token')
    if (!token) { setChecking(false); return }
    getCurrentUser()
      .then(res => setUser(res.data))
      .catch(() => localStorage.removeItem('tutorsnap_token'))
      .finally(() => setChecking(false))
  }, [])

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0F0F23] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#00A2FF] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      {user
        ? <TasksPage onLogout={() => { localStorage.removeItem('tutorsnap_token'); setUser(null) }} />
        : <LoginScreen onLogin={setUser} />
      }
    </GoogleOAuthProvider>
  )
}
