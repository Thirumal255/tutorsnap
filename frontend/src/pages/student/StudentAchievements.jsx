import { useState, useEffect } from 'react'
import { getStudentDashboard, getStudentProgress } from '../../api/client'

// Badge definitions
const BADGES = [
  // Streak badges
  {
    id: 'streak_3',
    icon: '🔥',
    title: 'On Fire',
    desc: 'Study 3 days in a row',
    category: 'Streaks',
    check: ({ streak }) => streak >= 3,
    progress: ({ streak }) => Math.min(streak, 3),
    goal: 3,
  },
  {
    id: 'streak_7',
    icon: '🌟',
    title: 'Week Warrior',
    desc: 'Study 7 days in a row',
    category: 'Streaks',
    check: ({ streak }) => streak >= 7,
    progress: ({ streak }) => Math.min(streak, 7),
    goal: 7,
  },
  // Sessions badges
  {
    id: 'sessions_1',
    icon: '🎮',
    title: 'First Battle',
    desc: 'Complete your first session',
    category: 'Sessions',
    check: ({ totalSessions }) => totalSessions >= 1,
    progress: ({ totalSessions }) => Math.min(totalSessions, 1),
    goal: 1,
  },
  {
    id: 'sessions_10',
    icon: '⚔️',
    title: 'Warrior',
    desc: 'Complete 10 sessions',
    category: 'Sessions',
    check: ({ totalSessions }) => totalSessions >= 10,
    progress: ({ totalSessions }) => Math.min(totalSessions, 10),
    goal: 10,
  },
  {
    id: 'sessions_50',
    icon: '🏅',
    title: 'Veteran',
    desc: 'Complete 50 sessions',
    category: 'Sessions',
    check: ({ totalSessions }) => totalSessions >= 50,
    progress: ({ totalSessions }) => Math.min(totalSessions, 50),
    goal: 50,
  },
  // Mastery badges
  {
    id: 'mastered_1',
    icon: '✅',
    title: 'Topic Champion',
    desc: 'Master your first topic (reach L3)',
    category: 'Mastery',
    check: ({ mastered }) => mastered >= 1,
    progress: ({ mastered }) => Math.min(mastered, 1),
    goal: 1,
  },
  {
    id: 'mastered_5',
    icon: '🏆',
    title: 'Master Blaster',
    desc: 'Master 5 topics',
    category: 'Mastery',
    check: ({ mastered }) => mastered >= 5,
    progress: ({ mastered }) => Math.min(mastered, 5),
    goal: 5,
  },
  {
    id: 'mastered_20',
    icon: '👑',
    title: 'Knowledge King',
    desc: 'Master 20 topics',
    category: 'Mastery',
    check: ({ mastered }) => mastered >= 20,
    progress: ({ mastered }) => Math.min(mastered, 20),
    goal: 20,
  },
  // Subject breadth
  {
    id: 'subjects_2',
    icon: '🌈',
    title: 'Multi-Talented',
    desc: 'Try topics from 2 different subjects',
    category: 'Explore',
    check: ({ subjectsTried }) => subjectsTried >= 2,
    progress: ({ subjectsTried }) => Math.min(subjectsTried, 2),
    goal: 2,
  },
  {
    id: 'subjects_4',
    icon: '🌍',
    title: 'All-Rounder',
    desc: 'Try topics from 4 different subjects',
    category: 'Explore',
    check: ({ subjectsTried }) => subjectsTried >= 4,
    progress: ({ subjectsTried }) => Math.min(subjectsTried, 4),
    goal: 4,
  },
  // Challenge
  {
    id: 'l5_1',
    icon: '⭐',
    title: 'Star Player',
    desc: 'Reach Challenge Mode (L5) in any topic',
    category: 'Challenge',
    check: ({ l5Count }) => l5Count >= 1,
    progress: ({ l5Count }) => Math.min(l5Count, 1),
    goal: 1,
  },
]

const CATEGORY_ORDER = ['Sessions', 'Mastery', 'Streaks', 'Explore', 'Challenge']

function BadgeCard({ badge, earned, pct }) {
  return (
    <div className={`blox-card p-4 flex flex-col items-center text-center gap-2 transition-all ${
      earned ? 'border-[#FFD700]/50 shadow-[0_0_12px_rgba(255,215,0,0.15)]' : 'opacity-60'
    }`}>
      <div className={`text-4xl ${!earned ? 'grayscale' : ''}`}>
        {badge.icon}
      </div>
      <div>
        <p className={`font-fredoka font-bold text-sm ${earned ? 'text-[#FFD700]' : 'text-white'}`}>
          {badge.title}
        </p>
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

export default function StudentAchievements() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('All')

  useEffect(() => {
    Promise.all([getStudentDashboard(), getStudentProgress()])
      .then(([dashRes, progRes]) => {
        const dash = dashRes.data
        const prog = progRes.data

        let mastered = 0
        let l5Count = 0
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
          mastered,
          l5Count,
          subjectsTried: subjectsTried.size,
        })
      })
      .catch(() => setStats({ streak: 0, totalSessions: 0, mastered: 0, l5Count: 0, subjectsTried: 0 }))
      .finally(() => setLoading(false))
  }, [])

  const earnedBadges = stats ? BADGES.filter(b => b.check(stats)) : []
  const categories = ['All', ...CATEGORY_ORDER.filter(c => BADGES.some(b => b.category === c))]

  const displayed = filter === 'All'
    ? BADGES
    : BADGES.filter(b => b.category === filter)

  const sorted = [...displayed].sort((a, b) => {
    const ae = stats ? a.check(stats) : false
    const be = stats ? b.check(stats) : false
    return be - ae
  })

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-fredoka font-bold text-white">🏆 Achievements</h1>
          <p className="text-[#8892B0] text-sm mt-0.5">Earn badges by studying consistently</p>
        </div>
        {stats && (
          <div className="blox-card px-4 py-2 text-center">
            <p className="text-2xl font-fredoka font-bold text-[#FFD700]">{earnedBadges.length}/{BADGES.length}</p>
            <p className="text-xs text-[#8892B0]">earned</p>
          </div>
        )}
      </div>

      {loading && (
        <div className="text-center py-16">
          <div className="text-4xl animate-bounce mb-3">🏆</div>
          <p className="text-[#8892B0]">Loading achievements…</p>
        </div>
      )}

      {!loading && stats && (
        <>
          {/* Category filter */}
          <div className="flex gap-2 flex-wrap">
            {categories.map(c => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={`px-3 py-1.5 rounded-full text-sm font-nunito font-semibold transition-all ${
                  filter === c
                    ? 'bg-[#00A2FF] text-white'
                    : 'bg-[#2D2B5A] text-[#8892B0] hover:text-white'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Badges grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {sorted.map(badge => {
              const earned = badge.check(stats)
              const progress = badge.progress(stats)
              const pct = (progress / badge.goal) * 100
              return (
                <BadgeCard
                  key={badge.id}
                  badge={badge}
                  earned={earned}
                  pct={pct}
                />
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
