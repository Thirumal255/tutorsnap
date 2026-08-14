import { useState, useEffect, Component } from 'react'
import { Capacitor } from '@capacitor/core'
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'
import { googleLogin, getCurrentUser } from './api/client'
import TasksPage from './TasksPage'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

const isNative = () => Capacitor.isNativePlatform()

// ── Error boundary — shows error text instead of blank white screen ────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'red', background: '#111', minHeight: '100vh', wordBreak: 'break-all' }}>
          <p style={{ fontWeight: 'bold', marginBottom: 8 }}>App crashed:</p>
          <pre style={{ fontSize: 12 }}>{this.state.error?.message}</pre>
          <pre style={{ fontSize: 10, marginTop: 8 }}>{this.state.error?.stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Login screen (web only) ───────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCredential(idToken) {
    setLoading(true)
    setError('')
    try {
      const res = await googleLogin(idToken)
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
        <div className="text-4xl">🌱</div>
        <h1 className="text-2xl font-bold text-white">Polyhouse Tracker</h1>
        <p className="text-[#8892B0] text-sm">Sign in with your admin account</p>
      </div>
      <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl p-8 flex flex-col items-center gap-4 w-full max-w-sm">
        {loading ? (
          <p className="text-[#8892B0] text-sm">Signing in…</p>
        ) : (
          <GoogleLogin
            onSuccess={cr => handleCredential(cr.credential)}
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

// ── Root app ──────────────────────────────────────────────────────────────────
function AppInner() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (isNative()) {
      // Skip login on Android — mobile API key handles auth in axios interceptor
      setUser({ name: 'Admin', role: 'admin' })
      setChecking(false)
      return
    }
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

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  )
}
