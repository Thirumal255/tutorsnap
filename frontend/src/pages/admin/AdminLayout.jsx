import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { logout as apiLogout, getFlaggedStudents } from '../../api/client'
import { useEffect, useState } from 'react'

const NAV = [
  { to: '/admin',            label: 'Dashboard', icon: '🏠', end: true },
  { to: '/admin/students',   label: 'Students',  icon: '🎮' },
  { to: '/admin/parents',    label: 'Parents',   icon: '👨‍👩‍👧' },
  { to: '/admin/books',      label: 'Books',     icon: '📚' },
  { to: '/admin/flagged',    label: 'Flagged',   icon: '🚩' },
  { to: '/admin/analytics',  label: 'Analytics', icon: '📊' },
  { to: '/admin/settings',   label: 'Settings',  icon: '⚙️' },
]

// On mobile, show a condensed set in the bottom nav
const MOBILE_NAV = [
  { to: '/admin',           label: 'Home',      icon: '🏠', end: true },
  { to: '/admin/students',  label: 'Students',  icon: '🎮' },
  { to: '/admin/flagged',   label: 'Flagged',   icon: '🚩' },
  { to: '/admin/analytics', label: 'Analytics', icon: '📊' },
  { to: '/admin/settings',  label: 'Settings',  icon: '⚙️' },
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
    <div className="flex h-screen bg-[#0F0F23]">

      {/* ── Desktop Sidebar (hidden on mobile) ─────────────── */}
      <aside className="hidden md:flex w-60 bg-[#16213E] border-r border-[#2D2B5A] flex-col flex-shrink-0">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-[#2D2B5A]">
          <p className="text-xl font-fredoka font-bold text-white">
            Study<span className="text-[#00A2FF]">Blox</span>
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs bg-[#FF3333]/20 text-[#FF3333] border border-[#FF3333]/30 px-2 py-0.5 rounded-full font-semibold">
              ADMIN
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map(({ to, label, icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-nunito font-semibold transition-all ${
                  isActive
                    ? 'bg-[#00A2FF]/15 text-[#00A2FF] border-l-4 border-[#00A2FF]'
                    : 'text-[#8892B0] hover:bg-[#1A1A3E] hover:text-white'
                }`
              }
            >
              <span className="flex items-center gap-2.5">
                <span>{icon}</span>
                {label}
              </span>
              {label === 'Flagged' && flaggedCount > 0 && (
                <span className="bg-[#FF3333] text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {flaggedCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-[#2D2B5A]">
          <div className="flex items-center gap-2 mb-3">
            {user?.avatar_url
              ? <img src={user.avatar_url} className="w-8 h-8 rounded-xl border border-[#2D2B5A]" alt="" />
              : <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#00A2FF] to-[#0066CC] flex items-center justify-center text-white font-fredoka font-bold">
                  {user?.name?.[0]}
                </div>
            }
            <div className="min-w-0">
              <p className="text-xs text-white font-semibold truncate">{user?.name}</p>
              <p className="text-xs text-[#8892B0]">Admin</p>
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
          {MOBILE_NAV.map(({ to, label, icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-[10px] font-nunito font-semibold transition-all relative ${
                  isActive ? 'text-[#00A2FF]' : 'text-[#8892B0]'
                }`
              }
            >
              <span className="text-xl leading-none relative">
                {icon}
                {label === 'Flagged' && flaggedCount > 0 && (
                  <span className="absolute -top-1 -right-2 bg-[#FF3333] text-white text-[9px] font-bold px-1 rounded-full leading-none min-w-[14px] text-center">
                    {flaggedCount}
                  </span>
                )}
              </span>
              <span>{label}</span>
            </NavLink>
          ))}

          {/* Sign out button */}
          <button
            onClick={handleLogout}
            className="flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-[10px] font-nunito font-semibold text-[#8892B0]"
          >
            {user?.avatar_url
              ? <img src={user.avatar_url} className="w-6 h-6 rounded-full border border-[#2D2B5A]" alt="" />
              : <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#00A2FF] to-[#0066CC] flex items-center justify-center text-white font-bold text-xs">
                  {user?.name?.[0]}
                </div>
            }
            <span>Sign out</span>
          </button>
        </div>
      </nav>

    </div>
  )
}
