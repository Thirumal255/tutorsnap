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
    <div className="min-h-screen bg-[#0F0F23] flex flex-col">
      <nav className="bg-[#16213E] border-b border-[#2D2B5A] px-6 py-3 flex items-center justify-between shadow-card">
        <div className="flex items-center gap-8">
          <span className="text-xl font-fredoka font-bold text-white">
            Study<span className="text-[#00A2FF]">Blox</span>
          </span>
          <div className="flex items-center gap-6">
            <NavLink to="/parent" end
              className={({ isActive }) =>
                `text-sm font-nunito font-semibold transition-colors ${
                  isActive ? 'text-[#00A2FF]' : 'text-[#8892B0] hover:text-white'
                }`
              }
            >
              👨‍👩‍👧 My Children
            </NavLink>
            <NavLink to="/parent/notifications"
              className={({ isActive }) =>
                `text-sm font-nunito font-semibold flex items-center gap-1.5 transition-colors ${
                  isActive ? 'text-[#00A2FF]' : 'text-[#8892B0] hover:text-white'
                }`
              }
            >
              🔔 Alerts
              {unread > 0 && (
                <span className="bg-[#FF3333] text-white text-xs rounded-full px-1.5 py-0.5 leading-none font-bold shadow-glow-red">
                  {unread}
                </span>
              )}
            </NavLink>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {user?.avatar_url && (
            <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-xl border border-[#2D2B5A]" />
          )}
          <span className="text-sm text-[#8892B0] hidden sm:block font-nunito">{user?.name}</span>
          <button onClick={handleLogout}
            className="text-sm text-[#8892B0] hover:text-white border border-[#2D2B5A] hover:border-[#FF3333] rounded-full px-3 py-1.5 transition-all font-nunito">
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
