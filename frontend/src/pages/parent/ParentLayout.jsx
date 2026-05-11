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
  const [showChildPicker, setShowChildPicker] = useState(false)

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

  function handleChildTabPress() {
    if (children.length === 1) {
      navigate(`/parent/children/${children[0].id}`)
    } else {
      setShowChildPicker(p => !p)
    }
  }

  return (
    <div className="flex h-screen bg-[#0F0F23]">

      {/* ── Desktop Sidebar (hidden on mobile) ─────────────── */}
      <aside className="hidden md:flex w-56 bg-[#16213E] border-r border-[#2D2B5A] flex-col flex-shrink-0">

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

      {/* ── Main content ───────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-[#0F0F23] pb-20 md:pb-0">
        <Outlet />
      </main>

      {/* ── Mobile Bottom Nav (hidden on desktop) ──────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#16213E] border-t border-[#2D2B5A] z-50">
        <div className="flex items-stretch">

          {/* Overview */}
          <NavLink to="/parent" end
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-[10px] font-nunito font-semibold transition-all ${
                isActive ? 'text-[#00A2FF]' : 'text-[#8892B0]'
              }`
            }
          >
            <span className="text-xl leading-none">🏠</span>
            <span>Overview</span>
          </NavLink>

          {/* Children tab */}
          <button
            onClick={handleChildTabPress}
            className="flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-[10px] font-nunito font-semibold text-[#8892B0] relative"
          >
            <span className="text-xl leading-none">👨‍👩‍👧</span>
            <span>Children</span>

            {/* Child picker popover */}
            {showChildPicker && children.length > 1 && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 bg-[#1A1A3E] border border-[#2D2B5A] rounded-2xl shadow-xl overflow-hidden">
                {children.map((child, idx) => {
                  const gradient = CHILD_COLORS[idx % CHILD_COLORS.length]
                  return (
                    <button
                      key={child.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowChildPicker(false)
                        navigate(`/parent/children/${child.id}`)
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#2D2B5A] transition-all border-b border-[#2D2B5A] last:border-b-0"
                    >
                      <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                        {child.name[0]}
                      </div>
                      <span className="text-sm text-white font-semibold truncate">{child.name.split(' ')[0]}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </button>

          {/* Alerts */}
          <NavLink to="/parent/notifications"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-[10px] font-nunito font-semibold transition-all relative ${
                isActive ? 'text-[#00A2FF]' : 'text-[#8892B0]'
              }`
            }
          >
            <span className="text-xl leading-none relative">
              🔔
              {unread > 0 && (
                <span className="absolute -top-1 -right-2 bg-[#FF3333] text-white text-[9px] font-bold px-1 py-0.5 rounded-full leading-none min-w-[14px] text-center">
                  {unread}
                </span>
              )}
            </span>
            <span>Alerts</span>
          </NavLink>

          {/* Profile / Sign out */}
          <button
            onClick={handleLogout}
            className="flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-[10px] font-nunito font-semibold text-[#8892B0]"
          >
            {user?.avatar_url
              ? <img src={user.avatar_url} className="w-6 h-6 rounded-full border border-[#2D2B5A]" alt="" />
              : (
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#00CC88] to-[#007755] flex items-center justify-center text-white font-bold text-xs">
                  {user?.name?.[0]}
                </div>
              )
            }
            <span>Sign out</span>
          </button>

        </div>
      </nav>

      {/* Backdrop to close child picker */}
      {showChildPicker && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setShowChildPicker(false)} />
      )}
    </div>
  )
}
