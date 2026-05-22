import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { logout as apiLogout } from '../../api/client'
import UserAvatar from '../../components/UserAvatar'

const NAV = [
  { to: '/home',         label: 'Home',        icon: '🏠', end: true },
  { to: '/practice',     label: 'Practice',     icon: '⚔️' },
  { to: '/progress',     label: 'My Progress',  icon: '📈' },
  { to: '/strengthen',   label: 'Strengthen',   icon: '💪' },
  { to: '/study-time',   label: 'Study Time',   icon: '⏱️' },
  { to: '/achievements', label: 'Achievements', icon: '🏆' },
]

// Condensed for mobile bottom bar (max 5 fits fine here)
const MOBILE_NAV = [
  { to: '/home',         label: 'Home',     icon: '🏠', end: true },
  { to: '/practice',     label: 'Practice', icon: '⚔️' },
  { to: '/progress',     label: 'Progress', icon: '📈' },
  { to: '/strengthen',   label: 'Strengthen', icon: '💪' },
  { to: '/achievements', label: 'Awards',   icon: '🏆' },
]

const SUBJECT_COLOR = {
  Mathematics:       'from-[#00A2FF] to-[#0066CC]',
  Science:           'from-[#00CC88] to-[#007755]',
  English:           'from-[#FF6B9D] to-[#CC3366]',
  'Social Studies':  'from-[#FFB347] to-[#CC7700]',
  History:           'from-[#C084FC] to-[#7E22CE]',
  Geography:         'from-[#34D399] to-[#059669]',
  Physics:           'from-[#60A5FA] to-[#2563EB]',
  Chemistry:         'from-[#F472B6] to-[#DB2777]',
  Biology:           'from-[#4ADE80] to-[#16A34A]',
  'Computer Science':'from-[#A78BFA] to-[#7C3AED]',
  Tamil:             'from-[#FBBF24] to-[#D97706]',
  Hindi:             'from-[#FB923C] to-[#EA580C]',
  Other:             'from-[#94A3B8] to-[#475569]',
}
export { SUBJECT_COLOR }

export default function StudentLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    try { await apiLogout() } catch {}
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-[#0F0F23]">

      {/* ── Desktop Sidebar (hidden on mobile) ─────────────── */}
      <aside className="hidden md:flex w-56 bg-[#16213E] border-r border-[#2D2B5A] flex-col flex-shrink-0">

        {/* Logo */}
        <div className="px-5 py-5 border-b border-[#2D2B5A]">
          <p className="text-xl font-fredoka font-bold text-white">
            Study<span className="text-[#00A2FF]">Blox</span> <span className="text-base">🎮</span>
          </p>
          <p className="text-[#8892B0] text-xs mt-0.5">Grade {user?.grade} · {user?.name?.split(' ')[0]}</p>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map(({ to, label, icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-nunito font-semibold transition-all ${
                  isActive
                    ? 'bg-[#00A2FF]/15 text-[#00A2FF] border-l-4 border-[#00A2FF]'
                    : 'text-[#8892B0] hover:bg-[#1A1A3E] hover:text-white'
                }`
              }
            >
              <span className="text-base">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User card */}
        <div className="px-4 py-4 border-t border-[#2D2B5A]">
          <button
            onClick={() => navigate('/profile')}
            className="flex items-center gap-2 mb-3 w-full hover:bg-[#1A1A3E] rounded-xl p-1.5 -mx-1.5 transition-all group"
          >
            <UserAvatar user={user} className="w-8 h-8 rounded-xl flex-shrink-0" />
            <div className="min-w-0 text-left">
              <p className="text-xs text-white font-semibold truncate group-hover:text-[#00A2FF] transition-colors">{user?.name}</p>
              <p className="text-[10px] text-[#8892B0]">Student · Edit profile</p>
            </div>
          </button>
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
                `flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-[10px] font-nunito font-semibold transition-all ${
                  isActive ? 'text-[#00A2FF]' : 'text-[#8892B0]'
                }`
              }
            >
              <span className="text-xl leading-none">{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}

          {/* Profile */}
          <button
            onClick={() => navigate('/profile')}
            className="flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-[10px] font-nunito font-semibold text-[#8892B0] hover:text-[#00A2FF] transition-colors"
          >
            <UserAvatar user={user} className="w-6 h-6 rounded-full" textSize="text-xs" />
            <span>Profile</span>
          </button>
        </div>
      </nav>

    </div>
  )
}
