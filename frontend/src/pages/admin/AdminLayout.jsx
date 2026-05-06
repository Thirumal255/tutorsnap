import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { logout as apiLogout } from '../../api/client'
import { useEffect, useState } from 'react'
import { getFlaggedStudents } from '../../api/client'

const NAV = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/students', label: 'Students' },
  { to: '/admin/parents', label: 'Parents' },
  { to: '/admin/books', label: 'Books' },
  { to: '/admin/flagged', label: 'Flagged' },
  { to: '/admin/settings', label: 'Settings' },
]

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [flaggedCount, setFlaggedCount] = useState(0)

  useEffect(() => {
    getFlaggedStudents().then(r => setFlaggedCount(r.data.length)).catch(() => {})
  }, [])

  async function handleLogout() {
    try { await apiLogout() } catch {}
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-100 flex flex-col flex-shrink-0">
        <div className="px-5 py-5 border-b border-gray-100">
          <span className="text-lg font-bold text-green-700">TutorSnap</span>
          <p className="text-xs text-gray-400 mt-0.5">Admin</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-green-50 text-green-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`
              }
            >
              {label}
              {label === 'Flagged' && flaggedCount > 0 && (
                <span className="bg-red-100 text-red-600 text-xs font-medium px-1.5 py-0.5 rounded-full">
                  {flaggedCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            {user?.avatar_url
              ? <img src={user.avatar_url} className="w-7 h-7 rounded-full" alt="" />
              : <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center text-green-700 text-xs font-bold">
                  {user?.name?.[0]}
                </div>
            }
            <span className="text-xs text-gray-700 truncate">{user?.name}</span>
          </div>
          <button onClick={handleLogout}
            className="w-full text-xs text-gray-500 hover:text-gray-700 text-left px-1">
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
