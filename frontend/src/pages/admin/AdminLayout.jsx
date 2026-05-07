import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { logout as apiLogout, getFlaggedStudents } from '../../api/client'
import { useEffect, useState } from 'react'
import { useUpload } from '../../context/UploadContext'

const NAV = [
  { to: '/admin',          label: 'Dashboard', icon: '🏠', end: true },
  { to: '/admin/students', label: 'Students',  icon: '🎮' },
  { to: '/admin/parents',  label: 'Parents',   icon: '👨‍👩‍👧' },
  { to: '/admin/books',    label: 'Books',     icon: '📚' },
  { to: '/admin/flagged',  label: 'Flagged',   icon: '🚩' },
  { to: '/admin/settings', label: 'Settings',  icon: '⚙️' },
]

const STAGE_INFO = {
  uploading:  { label: '📤 Uploading to Cloud Storage', color: '#00A2FF' },
  reading:    { label: '🔍 Reading PDF Structure',       color: '#FFD700' },
  analysing:  { label: '🤖 AI Extracting Topics',        color: '#C77DFF' },
  saving:     { label: '💾 Saving to Database',          color: '#00D68F' },
  done:       { label: '✅ Ready!',                       color: '#00D68F' },
  failed:     { label: '❌ Failed',                       color: '#FF3333' },
}

function UploadWidget() {
  const { job, clearJob } = useUpload()
  const [minimised, setMinimised] = useState(false)

  if (!job) return null

  const info = STAGE_INFO[job.stage] || STAGE_INFO.reading
  const isDone = job.stage === 'done'
  const isFailed = job.stage === 'failed'
  const isFinished = isDone || isFailed

  return (
    <div className={`fixed bottom-5 right-5 z-50 w-80 animate-bounce-in`}>
      <div className={`blox-card border ${isFailed ? 'border-[#FF3333]/50' : isDone ? 'border-[#00D68F]/50' : 'border-[#00A2FF]/40'} shadow-2xl overflow-hidden`}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#1A1A3E]">
          <div className="flex items-center gap-2 min-w-0">
            {!isFinished && (
              <div className="w-3 h-3 rounded-full flex-shrink-0 animate-pulse"
                style={{ backgroundColor: info.color }} />
            )}
            <p className="text-xs font-nunito font-bold text-white truncate">
              {job.title || 'Uploading book…'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!isFinished && (
              <button onClick={() => setMinimised(m => !m)}
                className="text-[#8892B0] hover:text-white text-xs transition-colors">
                {minimised ? '▲' : '▼'}
              </button>
            )}
            {isFinished && (
              <button onClick={clearJob}
                className="text-[#8892B0] hover:text-[#FF3333] text-base leading-none transition-colors">
                ×
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        {!minimised && (
          <div className="px-4 py-4 space-y-3">
            {/* Stage label */}
            <p className="text-sm font-semibold font-nunito" style={{ color: info.color }}>
              {info.label}
            </p>

            {/* Progress bar */}
            {!isFailed && (
              <div>
                <div className="flex justify-between text-xs text-[#8892B0] mb-1.5">
                  <span>Progress</span>
                  <span className="font-bold" style={{ color: info.color }}>{job.progress ?? 0}%</span>
                </div>
                <div className="h-2.5 bg-[#0F0F23] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: `${job.progress ?? 0}%`,
                      backgroundColor: info.color,
                      boxShadow: `0 0 8px ${info.color}88`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Stage steps */}
            <div className="grid grid-cols-4 gap-1">
              {[
                { key: 'uploading', short: '📤 Upload', pct: '0–30%' },
                { key: 'reading',   short: '🔍 Read',   pct: '30–45%' },
                { key: 'analysing', short: '🤖 AI',     pct: '45–85%' },
                { key: 'saving',    short: '💾 Save',   pct: '85–100%' },
              ].map(step => {
                const stages = ['uploading', 'reading', 'analysing', 'saving', 'done']
                const currentIdx = stages.indexOf(job.stage)
                const stepIdx = stages.indexOf(step.key)
                const done = currentIdx > stepIdx || isDone
                const active = currentIdx === stepIdx
                return (
                  <div key={step.key} className={`text-center p-1.5 rounded-lg text-xs transition-all ${
                    done    ? 'bg-[#00D68F]/20 text-[#00D68F]' :
                    active  ? 'bg-[#00A2FF]/20 text-[#00A2FF] ring-1 ring-[#00A2FF]/40' :
                              'bg-[#0F0F23] text-[#4A5568]'
                  }`}>
                    <div>{step.short}</div>
                  </div>
                )
              })}
            </div>

            {/* Result */}
            {isDone && (
              <div className="bg-[#00D68F]/10 border border-[#00D68F]/30 rounded-xl px-3 py-2 text-center">
                <p className="text-[#00D68F] text-sm font-bold font-fredoka">
                  🎉 {job.chapterCount} chapters · {job.topicCount} topics ready!
                </p>
              </div>
            )}
            {isFailed && job.error && (
              <div className="bg-[#FF3333]/10 border border-[#FF3333]/30 rounded-xl px-3 py-2">
                <p className="text-[#FF6B6B] text-xs">{job.error}</p>
              </div>
            )}

            {!isFinished && (
              <p className="text-[#8892B0] text-xs text-center">
                You can navigate away — processing continues in the background
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

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
      {/* Sidebar */}
      <aside className="w-60 bg-[#16213E] border-r border-[#2D2B5A] flex flex-col flex-shrink-0">
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

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-[#0F0F23]">
        <Outlet />
      </main>

      {/* Persistent upload progress widget */}
      <UploadWidget />
    </div>
  )
}
