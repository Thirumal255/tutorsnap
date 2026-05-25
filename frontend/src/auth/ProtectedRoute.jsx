import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

function roleHome(role) {
  if (role === 'admin')  return '/admin'
  if (role === 'parent') return '/parent'
  return '/home'
}

export function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0F0F23]">
        <div className="text-[#8892B0] text-sm font-nunito">Loading…</div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />

  // Wrong role — send to the user's actual home instead of a dead-end /unauthorized
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={roleHome(user.role)} replace />
  }

  return children
}
