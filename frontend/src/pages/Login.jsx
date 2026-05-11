import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoogleLogin } from '@react-oauth/google'
import { Capacitor } from '@capacitor/core'
import { useAuth } from '../auth/AuthContext'
import { googleLogin, devLogin as devLoginApi } from '../api/client'

const IS_DEV = import.meta.env.DEV
const isNative = Capacitor.isNativePlatform()

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [devEmail, setDevEmail] = useState('')

  useEffect(() => {
    if (user) redirectByRole(user.role)
  }, [user])

  function redirectByRole(role) {
    if (role === 'admin') navigate('/admin', { replace: true })
    else if (role === 'parent') navigate('/parent', { replace: true })
    else navigate('/', { replace: true })
  }

  async function handleDevLogin(e) {
    e.preventDefault()
    if (!devEmail.trim()) return
    setError('')
    try {
      const res = await devLoginApi(devEmail.trim())
      const { access_token, user: userData } = res.data
      login(access_token, userData)
      redirectByRole(userData.role)
    } catch (e) {
      setError(e.response?.data?.detail || 'Dev login failed')
    }
  }

  async function handleSuccess(credentialResponse) {
    setError('')
    const credential = credentialResponse.credential
    if (!credential) {
      setError('No credential received from Google. Please try again.')
      return
    }
    try {
      const res = await googleLogin(credential)
      const { access_token, user: userData } = res.data
      login(access_token, userData)
      redirectByRole(userData.role)
    } catch (e) {
      setError(e.response?.data?.detail || 'Login failed. Please try again.')
    }
  }

  async function handleNativeGoogleLogin() {
    setError('')
    try {
      const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
      await GoogleAuth.initialize({
        clientId: '322472504855-1fsal4q80mm9dgijvutqdrnboprjkr27.apps.googleusercontent.com',
        scopes: ['profile', 'email'],
      })
      const result = await GoogleAuth.signIn()
      const idToken = result?.authentication?.idToken
      if (!idToken) {
        setError('Sign-in failed. Please try again.')
        return
      }
      const res = await googleLogin(idToken)
      const { access_token, user: userData } = res.data
      login(access_token, userData)
      redirectByRole(userData.role)
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Sign-in failed. Please try again.')
    }
  }

  return (
    <div className="min-h-screen bg-[#0F0F23] flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 text-6xl opacity-10 animate-float">🎮</div>
        <div className="absolute top-40 right-16 text-5xl opacity-10 animate-float" style={{animationDelay:'1s'}}>⭐</div>
        <div className="absolute bottom-32 left-20 text-5xl opacity-10 animate-float" style={{animationDelay:'2s'}}>📚</div>
        <div className="absolute bottom-20 right-10 text-6xl opacity-10 animate-float" style={{animationDelay:'0.5s'}}>🏆</div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#00A2FF] opacity-5 blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <div className="text-center mb-8 animate-bounce-in">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-[#00A2FF] to-[#0066CC] shadow-glow-blue mb-4 animate-float">
            <span className="text-4xl">🎮</span>
          </div>
          <h1 className="text-5xl font-fredoka font-bold text-white tracking-wide">
            Study<span className="text-[#00A2FF]">Blox</span>
          </h1>
          <p className="text-[#8892B0] text-sm mt-2 font-nunito">Level up your learning! 🚀</p>
        </div>

        {/* Card */}
        <div className="blox-card p-7 animate-bounce-in" style={{animationDelay:'0.1s'}}>
          <p className="text-center text-[#8892B0] text-sm mb-6 font-nunito">
            Sign in to start your quest
          </p>

          <div className="flex justify-center">
            {isNative ? (
              <button
                onClick={handleNativeGoogleLogin}
                className="w-full flex items-center justify-center gap-3 bg-white text-gray-700 font-nunito font-semibold rounded-2xl px-6 py-3 hover:bg-gray-50 transition-all hover:scale-105 shadow-lg"
              >
                <img src="https://developers.google.com/identity/images/g-logo.png" className="w-5 h-5" alt="Google" />
                Sign in with Google
              </button>
            ) : (
              <GoogleLogin
                onSuccess={handleSuccess}
                onError={() => setError('Login failed. Please try again.')}
                theme="filled_black"
                shape="pill"
                size="large"
              />
            )}
          </div>

          {error && (
            <div className="mt-4 bg-[#FF3333]/10 border border-[#FF3333]/30 rounded-xl px-4 py-3 animate-bounce-in">
              <p className="text-sm text-[#FF6B6B] font-medium text-center">{error}</p>
              {error.includes('not registered') && (
                <p className="text-xs text-[#8892B0] mt-1 text-center">
                  Ask your admin to add you to StudyBlox 🎮
                </p>
              )}
            </div>
          )}

          <p className="mt-5 text-center text-xs text-[#8892B0]">
            🔒 Invite only — contact your admin to join
          </p>
        </div>

        {/* Dev login */}
        {IS_DEV && (
          <div className="mt-4 blox-card p-4 animate-bounce-in" style={{animationDelay:'0.2s'}}>
            <p className="text-xs text-[#8892B0] mb-3 text-center font-mono">⚡ Dev login</p>
            <form onSubmit={handleDevLogin} className="flex flex-col gap-2">
              <input
                type="email"
                placeholder="email@example.com"
                value={devEmail}
                onChange={e => setDevEmail(e.target.value)}
                className="blox-input w-full"
              />
              <button type="submit" className="btn-blox-primary w-full text-sm py-2">
                Dev Login
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
