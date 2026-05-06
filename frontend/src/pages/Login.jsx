import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoogleLogin } from '@react-oauth/google'
import { useAuth } from '../auth/AuthContext'
import { googleLogin } from '../api/client'
import { devLogin as devLoginApi } from '../api/client'

const IS_DEV = import.meta.env.DEV

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
    try {
      const res = await googleLogin(credentialResponse.credential)
      const { access_token, user: userData } = res.data
      login(access_token, userData)
      redirectByRole(userData.role)
    } catch (e) {
      setError(e.response?.data?.detail || 'Login failed. Please try again.')
    }
  }

  return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 w-full max-w-sm text-center">
        <h1 className="text-4xl font-bold text-green-700 mb-2">TutorSnap</h1>
        <p className="text-gray-500 text-sm mb-8">Cambridge Maths made simple 📚</p>

        <div className="border-t border-gray-100 pt-8">
          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={handleSuccess}
              onError={() => setError('Login failed. Please try again.')}
              use_fedcm_for_prompt={false}
              flow="implicit"
            />
          </div>
          {error && (
            <p className="mt-4 text-sm text-red-500">{error}</p>
          )}
        </div>

        <p className="mt-8 text-xs text-gray-400">
          Students, parents and teachers all sign in here
        </p>

        {IS_DEV && (
          <div className="mt-6 border-t border-dashed border-gray-200 pt-5">
            <p className="text-xs text-gray-400 mb-3">Dev login (localhost only)</p>
            <form onSubmit={handleDevLogin} className="flex flex-col gap-2">
              <input
                type="email"
                placeholder="email@example.com"
                value={devEmail}
                onChange={e => setDevEmail(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300 w-full"
              />
              <button type="submit"
                className="w-full py-2 bg-gray-700 text-white rounded-lg text-sm font-medium hover:bg-gray-800">
                Dev Login
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
