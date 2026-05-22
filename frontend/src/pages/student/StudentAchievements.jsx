import { useState, useEffect } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { getStudentDashboard, getStudentProgress, getLeaderboard, updateBuddySettings } from '../../api/client'

const BUDDY_EMOJI = {
  robot:'🤖', fox:'🦊', panda:'🐼', lion:'🦁',
  dolphin:'🐬', owl:'🦉', dragon:'🐉', wizard:'🧙',
}

// ── Badge definitions ───────────────────────────────────────────────────────
const BADGES = [
  // Streaks
  { id: 'streak_3',  icon: '🔥', title: 'On Fire',       desc: 'Study 3 days in a row',  category: 'Streaks',
    check: ({ streak }) => streak >= 3,  progress: ({ streak }) => Math.min(streak, 3),  goal: 3 },
  { id: 'streak_7',  icon: '🌟', title: 'Week Warrior',   desc: 'Study 7 days in a row',  category: 'Streaks',
    check: ({ streak }) => streak >= 7,  progress: ({ streak }) => Math.min(streak, 7),  goal: 7 },
  // Sessions
  { id: 'sessions_1',  icon: '🎮', title: 'First Battle', desc: 'Complete your first session',   category: 'Sessions',
    check: ({ totalSessions: s }) => s >= 1,  progress: ({ totalSessions: s }) => Math.min(s, 1),   goal: 1 },
  { id: 'sessions_10', icon: '⚔️', title: 'Warrior',      desc: 'Complete 10 sessions',          category: 'Sessions',
    check: ({ totalSessions: s }) => s >= 10, progress: ({ totalSessions: s }) => Math.min(s, 10),  goal: 10 },
  { id: 'sessions_50', icon: '🏅', title: 'Veteran',      desc: 'Complete 50 sessions',          category: 'Sessions',
    check: ({ totalSessions: s }) => s >= 50, progress: ({ totalSessions: s }) => Math.min(s, 50),  goal: 50 },
  // Mastery
  { id: 'mastered_1',  icon: '✅', title: 'Topic Champion', desc: 'Master your first topic (L3+)', category: 'Mastery',
    check: ({ mastered: m }) => m >= 1,  progress: ({ mastered: m }) => Math.min(m, 1),  goal: 1 },
  { id: 'mastered_5',  icon: '🏆', title: 'Master Blaster', desc: 'Master 5 topics',               category: 'Mastery',
    check: ({ mastered: m }) => m >= 5,  progress: ({ mastered: m }) => Math.min(m, 5),  goal: 5 },
  { id: 'mastered_20', icon: '👑', title: 'Knowledge King', desc: 'Master 20 topics',              category: 'Mastery',
    check: ({ mastered: m }) => m >= 20, progress: ({ mastered: m }) => Math.min(m, 20), goal: 20 },
  // Explore
  { id: 'subjects_2',  icon: '🌈', title: 'Multi-Talented', desc: 'Try 2 different subjects',      category: 'Explore',
    check: ({ subjectsTried: s }) => s >= 2, progress: ({ subjectsTried: s }) => Math.min(s, 2),  goal: 2 },
  { id: 'subjects_4',  icon: '🌍', title: 'All-Rounder',    desc: 'Try 4 different subjects',      category: 'Explore',
    check: ({ subjectsTried: s }) => s >= 4, progress: ({ subjectsTried: s }) => Math.min(s, 4),  goal: 4 },
  // XP milestones
  { id: 'xp_100',  icon: '⭐',  title: 'XP Starter',  desc: 'Earn 100 XP',    category: 'XP',
    check: ({ totalXp: x }) => x >= 100,  progress: ({ totalXp: x }) => Math.min(x, 100),  goal: 100 },
  { id: 'xp_500',  icon: '💫',  title: 'XP Chaser',   desc: 'Earn 500 XP',   category: 'XP',
    check: ({ totalXp: x }) => x >= 500,  progress: ({ totalXp: x }) => Math.min(x, 500),  goal: 500 },
  { id: 'xp_2000', icon: '🌠',  title: 'XP Legend',   desc: 'Earn 2000 XP',  category: 'XP',
    check: ({ totalXp: x }) => x >= 2000, progress: ({ totalXp: x }) => Math.min(x, 2000), goal: 2000 },
  // Challenge
  { id: 'l5_1', icon: '⭐', title: 'Star Player', desc: 'Reach Challenge Mode (L5)', category: 'Challenge',
    check: ({ l5Count: c }) => c >= 1, progress: ({ l5Count: c }) => Math.min(c, 1), goal: 1 },
  // Effort (#47) — rewarding persistence regardless of score
  { id: 'effort_25',  icon: '💪', title: 'Persistent',  desc: 'Answer 25 questions',  category: 'Effort',
    check: ({ totalQuestions: q }) => q >= 25,  progress: ({ totalQuestions: q }) => Math.min(q ?? 0, 25),  goal: 25 },
  { id: 'effort_100', icon: '🔬', title: 'Gritty',      desc: 'Answer 100 questions', category: 'Effort',
    check: ({ totalQuestions: q }) => q >= 100, progress: ({ totalQuestions: q }) => Math.min(q ?? 0, 100), goal: 100 },
  { id: 'effort_500', icon: '🎖️', title: 'Iron Will',   desc: 'Answer 500 questions', category: 'Effort',
    check: ({ totalQuestions: q }) => q >= 500, progress: ({ totalQuestions: q }) => Math.min(q ?? 0, 500), goal: 500 },
]

const CATEGORY_ORDER = ['Sessions', 'Mastery', 'Streaks', 'XP', 'Explore', 'Challenge', 'Effort']

function BadgeCard({ badge, earned, pct }) {
  return (
    <div className={`blox-card p-4 flex flex-col items-center text-center gap-2 transition-all ${
      earned ? 'border-[#FFD700]/50 shadow-[0_0_12px_rgba(255,215,0,0.15)]' : 'opacity-60'
    }`}>
      <div className={`text-4xl ${!earned ? 'grayscale' : ''}`}>{badge.icon}</div>
      <div>
        <p className={`font-fredoka font-bold text-sm ${earned ? 'text-[#FFD700]' : 'text-white'}`}>{badge.title}</p>
        <p className="text-xs text-[#8892B0] mt-0.5">{badge.desc}</p>
      </div>
      {earned ? (
        <span className="text-xs bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/40 px-2 py-0.5 rounded-full font-semibold">
          ✓ Earned
        </span>
      ) : (
        <div className="w-full">
          <div className="h-1.5 bg-[#2D2B5A] rounded-full overflow-hidden">
            <div className="h-full bg-[#00A2FF] rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-[#8892B0] mt-1">{Math.round(pct)}%</p>
        </div>
      )}
    </div>
  )
}

// ── Leaderboard tab ─────────────────────────────────────────────────────────
function Leaderboard({ currentUser, refreshUser }) {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [toggling, setToggling] = useState(false)
  const [tab, setTab]           = useState('total')  // 'total' | 'weekly'

  useEffect(() => {
    getLeaderboard()
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  const grade = currentUser?.grade || 0
  const eligible = grade >= 6

  async function toggleVisibility() {
    if (!eligible) return
    setToggling(true)
    const newVal = !(currentUser?.show_on_leaderboard ?? false)
    try {
      await updateBuddySettings({ show_on_leaderboard: newVal })
      refreshUser()
      // Reload leaderboard
      const r = await getLeaderboard()
      setData(r.data)
    } catch {}
    finally { setToggling(false) }
  }

  if (loading) return (
    <div className="text-center py-12">
      <div className="text-4xl animate-bounce mb-3">🏅</div>
      <p className="text-[#8892B0]">Loading leaderboard…</p>
    </div>
  )

  // Grade 1-5: leaderboard not available
  if (!eligible || data?.disabled) {
    return (
      <div className="blox-card p-6 text-center space-y-3">
        <div className="text-5xl">🔒</div>
        <p className="text-white font-nunito font-bold">Leaderboard unlocks at Grade 6</p>
        <p className="text-[#8892B0] text-sm">
          Keep practising and earning XP — the leaderboard opens up when you reach Grade 6!
        </p>
      </div>
    )
  }

  if (!data) return (
    <div className="blox-card p-6 text-center">
      <p className="text-[#8892B0]">Could not load leaderboard.</p>
    </div>
  )

  const { leaderboard, my_rank, my_total_xp, my_weekly_xp } = data
  const sorted = [...leaderboard].sort((a, b) =>
    tab === 'total' ? b.total_xp - a.total_xp : b.weekly_xp - a.weekly_xp
  )
  const optedIn = currentUser?.show_on_leaderboard ?? false

  return (
    <div className="space-y-4">
      {/* Opt-in notice if not yet opted in */}
      {!optedIn && (
        <div className="bg-[#2D2B5A]/60 border border-[#3D3B6A] rounded-2xl p-3 flex items-center gap-3">
          <span className="text-2xl">👤</span>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-nunito font-bold">You're hidden</p>
            <p className="text-[#8892B0] text-xs">Turn on the toggle below to appear on the leaderboard.</p>
          </div>
        </div>
      )}

      {/* My stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="blox-card p-3 text-center">
          <p className="text-2xl font-fredoka font-bold text-[#FFD700]">#{optedIn && my_rank ? my_rank : '—'}</p>
          <p className="text-xs text-[#8892B0]">my rank</p>
        </div>
        <div className="blox-card p-3 text-center">
          <p className="text-2xl font-fredoka font-bold text-[#00A2FF]">⭐{my_total_xp}</p>
          <p className="text-xs text-[#8892B0]">total XP</p>
        </div>
      </div>

      {/* Weekly / Total toggle */}
      <div className="flex gap-2">
        {['total', 'weekly'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-sm font-nunito font-semibold transition-all ${
              tab === t ? 'bg-[#00A2FF] text-white' : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
            }`}
          >
            {t === 'total' ? '⭐ All-time' : '📅 This week'}
          </button>
        ))}
      </div>

      {/* Rankings */}
      {sorted.length === 0 ? (
        <div className="blox-card p-6 text-center">
          <p className="text-[#8892B0] text-sm">No students on the leaderboard yet. Opt in below to be the first!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((entry, idx) => {
            const xp = tab === 'total' ? entry.total_xp : entry.weekly_xp
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${entry.rank}`
            return (
              <div key={idx} className={`flex items-center gap-3 rounded-2xl px-4 py-3 border transition-all ${
                entry.is_me
                  ? 'bg-[#00A2FF]/10 border-[#00A2FF]/40'
                  : 'bg-[#16213E] border-[#2D2B5A]'
              }`}>
                <span className="text-lg w-8 text-center font-fredoka font-bold text-[#FFD700]">{medal}</span>
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#00A2FF] to-[#0066CC] flex items-center justify-center text-xl flex-shrink-0">
                  {BUDDY_EMOJI[entry.buddy_avatar] || '🤖'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">
                    {entry.name}{entry.is_me && <span className="text-[#00A2FF] ml-1 text-xs">(you)</span>}
                  </p>
                </div>
                <span className="font-fredoka font-bold text-[#FFD700] text-sm">⭐{xp}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Privacy toggle — opt-in */}
      <div className="blox-card p-3 flex items-center justify-between">
        <div>
          <p className="text-xs text-white font-nunito font-semibold">Show me on the leaderboard</p>
          <p className="text-[10px] text-[#8892B0]">Off by default — your choice</p>
        </div>
        <button
          onClick={toggleVisibility}
          disabled={toggling || !eligible}
          className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${
            optedIn ? 'bg-[#00A2FF]' : 'bg-[#2D2B5A]'
          }`}
        >
          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
            optedIn ? 'left-6' : 'left-1'
          }`} />
        </button>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function StudentAchievements() {
  const { user, refreshUser } = useAuth()
  const [stats, setStats]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('All')
  const [mainTab, setMainTab] = useState('badges')  // 'badges' | 'leaderboard'

  useEffect(() => {
    Promise.all([getStudentDashboard(), getStudentProgress()])
      .then(([dashRes, progRes]) => {
        const dash = dashRes.data
        const prog = progRes.data
        let mastered = 0, l5Count = 0
        const subjectsTried = new Set()
        for (const book of prog) {
          for (const ch of book.chapters) {
            for (const t of ch.topics) {
              if (['L3','L4','L5'].includes(t.mastery_level)) mastered++
              if (t.mastery_level === 'L5') l5Count++
              if (t.mastery_level) subjectsTried.add(book.subject)
            }
          }
        }
        setStats({
          streak: dash.streak_days,
          totalSessions: dash.total_sessions,
          totalXp: dash.total_xp || 0,
          totalQuestions: dash.total_questions_answered || 0,   // #47
          mastered, l5Count,
          subjectsTried: subjectsTried.size,
        })
      })
      .catch(() => setStats({ streak: 0, totalSessions: 0, totalXp: 0, totalQuestions: 0, mastered: 0, l5Count: 0, subjectsTried: 0 }))
      .finally(() => setLoading(false))
  }, [])

  const earnedBadges = stats ? BADGES.filter(b => b.check(stats)) : []
  const categories   = ['All', ...CATEGORY_ORDER.filter(c => BADGES.some(b => b.category === c))]
  const displayed    = filter === 'All' ? BADGES : BADGES.filter(b => b.category === filter)
  const sorted       = [...displayed].sort((a, b) => {
    const ae = stats ? a.check(stats) : false
    const be = stats ? b.check(stats) : false
    return be - ae
  })

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-fredoka font-bold text-white">🏆 Achievements</h1>
          <p className="text-[#8892B0] text-sm mt-0.5">Earn badges and climb the leaderboard (Grade 6+)</p>
        </div>
        {stats && mainTab === 'badges' && (
          <div className="blox-card px-4 py-2 text-center">
            <p className="text-2xl font-fredoka font-bold text-[#FFD700]">{earnedBadges.length}/{BADGES.length}</p>
            <p className="text-xs text-[#8892B0]">badges earned</p>
          </div>
        )}
      </div>

      {/* Main tabs */}
      <div className="flex gap-2">
        {[['badges', '🏅 Badges'], ['leaderboard', '📊 Leaderboard']].map(([key, label]) => (
          <button key={key} onClick={() => setMainTab(key)}
            className={`flex-1 py-2.5 rounded-2xl text-sm font-nunito font-semibold transition-all ${
              mainTab === key ? 'bg-[#00A2FF] text-white' : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Badges tab ── */}
      {mainTab === 'badges' && (
        <>
          {loading && (
            <div className="text-center py-16">
              <div className="text-4xl animate-bounce mb-3">🏆</div>
              <p className="text-[#8892B0]">Loading achievements…</p>
            </div>
          )}
          {!loading && stats && (
            <>
              {/* XP bar */}
              <div className="blox-card p-4 flex items-center gap-4">
                <span className="text-3xl">⭐</span>
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-[#8892B0] mb-1">
                    <span>Total XP</span>
                    <span className="font-fredoka font-bold text-[#FFD700]">{stats.totalXp} XP</span>
                  </div>
                  <div className="h-2 bg-[#2D2B5A] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#FFD700] to-[#FF6B9D] rounded-full transition-all duration-700"
                      style={{ width: `${Math.min((stats.totalXp / 2000) * 100, 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-[#8892B0] mt-1">{stats.totalXp}/2000 XP to 🌠 Legend</p>
                </div>
              </div>

              {/* Category filter */}
              <div className="flex gap-2 flex-wrap">
                {categories.map(c => (
                  <button key={c} onClick={() => setFilter(c)}
                    className={`px-3 py-1.5 rounded-full text-sm font-nunito font-semibold transition-all ${
                      filter === c ? 'bg-[#00A2FF] text-white' : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>

              {/* Badges grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {sorted.map(badge => {
                  const earned   = badge.check(stats)
                  const progress = badge.progress(stats)
                  const pct      = (progress / badge.goal) * 100
                  return <BadgeCard key={badge.id} badge={badge} earned={earned} pct={pct} />
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Leaderboard tab ── */}
      {mainTab === 'leaderboard' && (
        <Leaderboard currentUser={user} refreshUser={refreshUser} />
      )}
    </div>
  )
}
