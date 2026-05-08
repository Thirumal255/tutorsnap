import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { getMyChildren, getParentNotifications, logout as apiLogout } from '../../api/client'

const CHILD_COLORS = [
  'from-[#FF6B9D] to-[#FF3333]',
  'from-[#00A2FF] to-[#0066CC]',
  'from-[#00CC88] to-[#007755]',
  'from-[#C084FC] to-[#7E22CE]',
  'from-[#FFB347] to-[#CC7700]',
]

export default function ParentLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [children, setChildren] = useState([])
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    getMyChildren()
      .then(r => setChildren(r.data))
      .catch(() => {})
    getParentNotifications()
      .then(r => setUnread(r.data.filter(n => !n.is_read).length))
      .catch(() => {})
  }, [])

  async function handleLogout() {
    try { await apiLogout() } catch {}
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-[#0F0F23]">

      {/* ── Sidebar ───────────────────────────────────────── */}
      <aside className="w-56 bg-[#16213E] border-r border-[#2D2B5A] flex flex-col flex-shrink-0">

        {/* Logo */}
        <div className="px-5 py-5 border-b border-[#2D2B5A]">
          <p className="text-xl font-fredoka font-bold text-white">
            Study<span className="text-[#00A2FF]">Blox</span>
          </p>
          <span className="text-xs bg-[#00CC88]/20 text-[#00CC88] border border-[#00CC88]/30 px-2 py-0.5 rounded-full font-semibold">
            PARENT
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">

          {/* Overview */}
          <NavLink to="/parent" end
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-nunito font-semibold transition-all ${
                isActive
                  ? 'bg-[#00A2FF]/15 text-[#00A2FF] border-l-4 border-[#00A2FF]'
                  : 'text-[#8892B0] hover:bg-[#1A1A3E] hover:text-white'
              }`
            }
          >
            <span>🏠</span> Overview
          </NavLink>

          {/* Per-child nav items */}
          {children.length > 0 && (
            <div className="pt-2 pb-1">
              <p className="text-[10px] text-[#8892B0] uppercase tracking-widest font-semibold px-3 mb-1">
                My Children
              </p>
              {children.map((child, idx) => {
                const gradient = CHILD_COLORS[idx % CHILD_COLORS.length]
                return (
                  <NavLink
                    key={child.id}
                    to={`/parent/children/${child.id}`}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-nunito font-semibold transition-all ${
                        isActive
                          ? 'bg-[#00A2FF]/15 text-[#00A2FF] border-l-4 border-[#00A2FF]'
                          : 'text-[#8892B0] hover:bg-[#1A1A3E] hover:text-white'
                      }`
                    }
                  >
                    <div className={`w-5 h-5 rounded-md bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                      {child.name[0]}
                    </div>
                    <span className="truncate">{child.name.split(' ')[0]}</span>
                    {child.flagged_topics > 0 && (
                      <span className="ml-auto bg-[#FF3333] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                        {child.flagged_topics}
                      </span>
                    )}
                  </NavLink>
                )
              })}
            </div>
          )}

          {/* Alerts */}
          <NavLink to="/parent/notifications"
            className={({ isActive }) =>
              `flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-xl text-sm font-nunito font-semibold transition-all ${
                isActive
                  ? 'bg-[#00A2FF]/15 text-[#00A2FF] border-l-4 border-[#00A2FF]'
                  : 'text-[#8892B0] hover:bg-[#1A1A3E] hover:text-white'
              }`
            }
          >
            <span className="flex items-center gap-2.5">
              <span>🔔</span> Alerts
            </span>
            {unread > 0 && (
              <span className="bg-[#FF3333] text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                {unread}
              </span>
            )}
          </NavLink>
        </nav>

        {/* User card */}
        <div className="px-4 py-4 border-t border-[#2D2B5A]">
          <div className="flex items-center gap-2 mb-3">
            {user?.avatar_url
              ? <img src={user.avatar_url} className="w-8 h-8 rounded-xl border border-[#2D2B5A]" alt="" />
              : (
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#00CC88] to-[#007755] flex items-center justify-center text-white font-fredoka font-bold text-sm">
                  {user?.name?.[0]}
                </div>
              )
            }
            <div className="min-w-0">
              <p className="text-xs text-white font-semibold truncate">{user?.name}</p>
              <p className="text-xs text-[#8892B0]">Parent</p>
            </div>
          </div>
          <button onClick={handleLogout}
            className="w-full text-xs text-[#8892B0] hover:text-white border border-[#2D2B5A] hover:border-[#FF3333] rounded-xl py-2 transition-all font-nunito">
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-[#0F0F23]">
        <Outlet />
      </main>
    </div>
  )
}
