import { useState, useEffect } from 'react'
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'
import { googleLogin, getCurrentUser } from './api/client'
import TasksPage from './TasksPage'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

// True when running inside the Capacitor Android/iOS shell
const isNative = () => typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()

// ── Native Google Sign-In (Android) ───────────────────────────────────────────
async function nativeGoogleLogin() {
  const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
  await GoogleAuth.initialize({
    clientId: GOOGLE_CLIENT_ID,
    scopes: ['profile', 'email'],
    grantOfflineAccess: true,
  })
  const googleUser = await GoogleAuth.signIn()
  // idToken is what our backend expects (same as the web credential)
  return googleUser.authentication.idToken
}

// ── Login screen ──────────────────────────────────────────────────────────────
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

  // Native (Android) — single button, no Google SDK iFrame
  if (isNative()) {
    return (
      <div className="min-h-screen bg-[#0F0F23] flex flex-col items-center justify-center gap-6 p-4">
        <div className="text-center space-y-2">
          <div className="text-5xl">🌱</div>
          <h1 className="text-2xl font-bold text-white">Polyhouse Tracker</h1>
          <p className="text-[#8892B0] text-sm">Sign in with your admin account</p>
        </div>
        <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl p-8 flex flex-col items-center gap-4 w-full max-w-sm">
          {loading ? (
            <p className="text-[#8892B0] text-sm">Signing in…</p>
          ) : (
            <button
              onClick={async () => {
                try {
                  const idToken = await nativeGoogleLogin()
                  await handleCredential(idToken)
                } catch (e) {
                  setError('Google sign-in failed')
                  setLoading(false)
                }
              }}
              className="flex items-center gap-3 bg-white text-gray-800 font-semibold px-6 py-3 rounded-xl shadow-md active:scale-95 transition-all w-full justify-center"
            >
              <svg width="20" height="20" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Sign in with Google
            </button>
          )}
          {error && <p className="text-[#FF3333] text-xs text-center">{error}</p>}
        </div>
      </div>
    )
  }

  // Web — original Google OAuth iFrame button
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

  // GoogleOAuthProvider is only needed for the web flow; harmless on native
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      {user
        ? <TasksPage onLogout={() => { localStorage.removeItem('tutorsnap_token'); setUser(null) }} />
        : <LoginScreen onLogin={setUser} />
      }
    </GoogleOAuthProvider>
  )
}
