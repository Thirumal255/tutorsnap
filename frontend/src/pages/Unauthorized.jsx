import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

function roleHome(role) {
  if (role === 'admin')  return '/admin'
  if (role === 'parent') return '/parent'
  return '/home'
}

export default function Unauthorized() {
  const { user } = useAuth()
  const navigate = useNavigate()

  function goHome() {
    navigate(user ? roleHome(user.role) : '/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-[#0F0F23] flex items-center justify-center p-6">
      <div className="text-center space-y-4">
        <div className="text-6xl">🚫</div>
        <h1 className="text-2xl font-fredoka font-bold text-white">Access Denied</h1>
        <p className="text-[#8892B0] text-sm font-nunito">You don't have permission to view this page.</p>
        <button
          onClick={goHome}
          className="mt-4 px-6 py-2.5 rounded-xl bg-[#00A2FF]/20 text-[#00A2FF] border border-[#00A2FF]/40 hover:bg-[#00A2FF]/30 transition-all font-nunito font-semibold text-sm"
        >
          ← Go to my home
        </button>
      </div>
    </div>
  )
}
