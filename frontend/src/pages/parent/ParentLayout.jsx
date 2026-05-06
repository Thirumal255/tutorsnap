import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { getParentNotifications, logout } from '../../api/client'

export default function ParentLayout() {
  const { user, logout: authLogout } = useAuth()
  const navigate = useNavigate()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    getParentNotifications()
      .then(r => setUnread(r.data.filter(n => !n.is_read).length))
      .catch(() => {})
  }, [])

  async function handleLogout() {
    try { await logout() } catch {}
    authLogout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-white border-b border-gray-100 shadow-sm px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="text-lg font-bold text-green-700">TutorSnap</span>
          <div className="flex items-center gap-6">
            <NavLink
              to="/parent"
              end
              className={({ isActive }) =>
                `text-sm font-medium ${isActive ? 'text-green-700' : 'text-gray-500 hover:text-gray-700'}`
              }
            >
              My Children
            </NavLink>
            <NavLink
              to="/parent/notifications"
              className={({ isActive }) =>
                `text-sm font-medium flex items-center gap-1 ${isActive ? 'text-green-700' : 'text-gray-500 hover:text-gray-700'}`
              }
            >
              Notifications
              {unread > 0 && (
                <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                  {unread}
                </span>
              )}
            </NavLink>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {user?.avatar_url && (
            <img src={user.avatar_url} alt="" className="w-7 h-7 rounded-full" />
          )}
          <span className="text-sm text-gray-600 hidden sm:block">{user?.name}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            Sign out
          </button>
        </div>
      </nav>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
