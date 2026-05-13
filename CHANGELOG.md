# Changelog

All notable changes to StudyBlox are documented here in reverse chronological order.

---

## [2026-05-13] — Parent/Admin Tools + UX/Quality of Life

### Added
**Parent Tools**
- `GET /api/parent/children/{id}/weekly-report` — week-over-week snapshot: sessions this week vs last week, topics count, weekly XP, new L3+ mastery badges
- `WeeklyReportCard` component in `ParentChildDetail` — 3-column stats grid (sessions ↑/↓, topics, XP) + "New levels this week" badge row
- `getChildWeeklyReport()` API helper in `client.js`

**Admin Tools**
- `GET /api/admin/analytics` — rich analytics: 14-day session trend, per-grade student/session breakdown, subject performance + flags, mastery level distribution, top-5 XP students
- `AdminAnalytics` page at `/admin/analytics` — 14-day bar chart (today highlighted gold), grade breakdown progress bars, mastery level donut chart (pure SVG), subject performance bars, top-5 clickable leaderboard, platform health summary grid
- `📊 Analytics` nav item added to AdminLayout sidebar and mobile bottom bar
- Grade filter chips in `AdminStudents` — pill buttons per available grade, computed from live data
- CSV export in `AdminStudents` — "↓ Export CSV" downloads filtered list as `students_YYYY-MM-DD.csv`
- `getAdminAnalytics()` API helper in `client.js`

**UX / Quality of Life**
- `ToastContext.jsx` — global toast system with `useToast()` hook; `toast.success/error/info/warn()` methods; auto-dismiss after 3.5s (errors 5s); stacks up to 5 toasts; top-right fixed position; `animate-bounce-in` entry animation
- Replaced all `alert()` calls with proper toasts across 7 files: `TopicSelect`, `AdminFlagged`, `AdminParents`, `AdminSettings`, `StudentHome`, `StudentMistakes`, `StudentPractice`, `StudentProgress`
- `ToastProvider` wraps entire app in `App.jsx`

### Changed
- `AdminFlagged` — resolve success/error now shows toast
- `AdminSettings` — save success/error now shows toast
- `AdminParents` — link error now shows toast
- `AdminStudents` — add/grade/activate operations now show toasts; search + grade filter + count display updated

---

## [2026-05-13] — Learning Effectiveness Feature Suite

### Added
**Spaced Repetition**
- `next_review_at` and `review_interval_days` columns on `TopicMastery`
- Review intervals: L1=1d, L2=3d, L3=7d, L4=14d, L5=21d — set on every mastery update
- `GET /api/student/review-queue` — topics due for review sorted by overdue amount
- 🔁 due badges on Practice page and Progress map
- Alembic migration `g8b2c3d4e5f6`

**Mistake Journal**
- `GET /api/student/mistakes` — all SessionTurns with score < 80, enriched with topic/chapter/subject
- `StudentMistakes` page — subject filter, score/date sort, expandable cards (question + wrong answer + feedback), one-click re-practice
- Navigation: 📝 Mistakes in student sidebar and mobile bottom nav

**Exam Mode**
- `ExamSession` model with full exam record (questions, answers, scores, XP)
- `POST /api/exam/start` — concurrent Claude question generation via `ThreadPoolExecutor` (up to 6 parallel); round-robin topic selection across chapters
- `POST /api/exam/submit` — parallel assessment of all answers; XP = `total_score` (max 100)
- `ExamMode` page (full-screen, 3 phases): Setup (subject multi-select, 5/10/15 Qs, 10/15/20 min) → InProgress (countdown timer, dot navigation, auto-submit on expiry) → Results (overview + per-question breakdown)
- 🎯 Exam Mode quick-access card on Practice page

**Flashcard Mode**
- `POST /api/flashcard/question` — fetches a question + key_concepts for a topic
- `POST /api/flashcard/mark` — marks known/unknown; SM-2-inspired interval update (×1.5 on know, reset to 1 on don't know)
- `FlashcardMode` page (full-screen): TopicSelect (filterable by subject/due) → FlashCard (tap-to-reveal key concepts, Know it / Need practice buttons, 10-card round) → Done summary
- ⚡ Flashcards quick-access card on Practice page

**Concept Map**
- `student_progress` endpoint extended to return `key_concepts` and `next_review_at` per topic
- `StudentProgress` — Map/List view toggle; ConceptMap sub-component with colour-coded topic grid, hover popup with key_concepts, 🔁/🚩 badges

### Changed
- `App.jsx` — added `/exam`, `/flashcard` (full-screen) and `/mistakes` (student layout) routes
- `StudentLayout` — added Mistakes to NAV + MOBILE_NAV

---

## [2026-05-11] — Gamification Feature Suite

### Added
**XP System**
- `total_xp`, `weekly_xp`, `weekly_xp_reset_at`, `show_on_leaderboard` columns on `User`
- `_update_user_xp()` helper — resets weekly XP on Monday UTC boundary; increments both totals
- XP awarded in `submit_answer`: +10 per correct answer (score ≥ 80), +50 on level-up, +100 on session complete
- XP included in `submit_answer` response (`xp_earned`)
- XP pop animation in `Chat.jsx` when XP is earned

**Daily Streaks**
- Streak days computed from consecutive session activity
- Shown in StudentHome stats, parent dashboard child cards, ParentChildDetail

**Buddy Avatar Customisation**
- `buddy_name`, `buddy_avatar` columns on `User`
- `GET/PUT /api/student/buddy` — fetch and update buddy settings
- `BuddyCustomizer` modal component — 8 preset avatars (robot/fox/panda/lion/dolphin/owl/dragon/wizard), custom name input (max 20 chars), preview
- `buddyAvatar` prop on `ChatBubble` — renders emoji avatar
- `refreshUser()` in `AuthContext` propagates buddy changes without re-login

**Weekly Challenge**
- `WeeklyChallenge` model — one question per grade per week (Monday UTC boundary)
- `WeeklyChallengeCompletion` model — tracks which students completed
- `GET /api/student/weekly-challenge` — fetches or creates this week's challenge; skips if already completed
- `POST /api/student/weekly-challenge/submit` — assesses answer; awards 50 XP on correct
- `WeeklyChallengeCard` sub-component in `StudentHome` — inline question card, one attempt, shows result

**XP Leaderboard**
- `GET /api/student/leaderboard` — all-time and this-week rankings for students with `show_on_leaderboard=true`
- `StudentAchievements` — Leaderboard tab with all-time/this-week toggle, buddy emojis, privacy opt-in/out toggle

**Achievements / Badges**
- 14 badges: XP milestones (⭐100, 💫500, 🌠2000), streak milestones, sessions milestones, mastery level milestones
- Category filter, XP progress bar (0→2000 range)

**Alembic Migration** `f7a1b2c3d4e5` — adds all gamification columns and tables with `IF NOT EXISTS` pattern

---

## [2026-05-10] — Handwriting Canvas + Give-up Scaffolding

### Added
- `WritingCanvas` component — HTML5 Canvas + PointerEvent API, pressure-sensitive drawing, HiDPI scaling via `devicePixelRatio`, exports base64 JPEG
- `forwardRef` + `useImperativeHandle` exposing `getImageData()`, `clear()`, `undo()`, `isEmpty()`
- Canvas mode toggle (✏️ button) in `Chat.jsx`
- `call_claude_vision()` in `session_engine.py` — sends handwriting image to Claude Vision API for assessment
- `generate_sub_question()` using Haiku model for faster sub-questions
- `assess_answer()` updated to accept `image_data: str | None` — routes through vision when image present
- `requestSubQuestion()` and `imageData` param on `submitAnswer` in `client.js`
- Give-up detection (`isGivingUp` state) with 4-stage scaffolding in Chat: rephrase → sub-question → hint → answer
- Confusion type picker — student selects what they're confused about before requesting help

---

## [2026-05-09] — Full UI Revamp (StudyBlox Theme)

### Added / Changed
- Complete Roblox-inspired dark UI redesign across all pages
- Fredoka One (headings) + Nunito (body) font pairing
- Colour palette: `#0F0F23` bg, `#16213E` cards, `#00A2FF` primary, `#00CC88` success, `#FF3333` danger
- `blox-card`, `btn-blox-primary`, `blox-input`, `blox-hover`, `shadow-glow-*`, `animate-bounce-in` Tailwind utility classes
- Mobile-first responsive layouts — bottom nav bar for student, admin, and parent roles
- Subject colour map (`SUBJECT_COLOR`) exported from `StudentLayout`
- Desktop sidebars for all three roles with flagged count badge on admin nav

---

## [2026-05-08] — Session Engine Improvements

### Changed
- Two-phase assessment: reference answer generation → per-format scoring
- Answer formats: `number`, `yes_no`, `rule`, `explanation`, `working`
- Level starters and topic anchoring for more contextual questions
- Textbook exercises used exclusively as question source
- Progressive hint tiers with missed key points tracking
- Fixed double hint-tier penalty bug
- Fixed infinite hint loop
- Session summary improved with per-topic breakdown

---

## [2026-05-07] — Auth, Admin, Parent Roles

### Added
- Google OAuth 2.0 sign-in with `@react-oauth/google`
- HS256 JWT tokens (72h expiry), stored in `localStorage`
- `AuthContext` with `user`, `login`, `logout`, `refreshUser`
- `ProtectedRoute` with role-based access control
- Admin-only user registration for students and parents
- Admin: student management (add, grade, activate/deactivate, reset mastery)
- Admin: parent management (add, link/unlink to children)
- Admin: flagged students view with resolve
- Admin: platform settings (max questions, hint tiers, timeout)
- Parent dashboard: child cards, family activity chart, notifications
- Parent: child detail (subject progress, topic mastery, session history)
- Parent: notifications page with read/unread management
- `ParentStudentLink`, `Notification`, `AppSettings` models
- Flagging system: auto-flag when student reaches max hint tier

---

## [2026-05-06] — PDF Ingestion + Book Management

### Added
- PDF upload with direct-to-GCS signed URLs (bypasses Cloud Run 32 MB limit)
- `POST /api/upload/init` + `POST /api/upload/complete/{book_id}`
- Real-time ingestion progress via `UploadContext` floating widget
- Book subject, grade, title, TOC pages, chapter structure metadata
- Ingestion cancel + checkpoint resume
- Book delete (cascades all FK-dependent rows)
- Admin book management page with ingestion status, progress bar, retry/cancel
- `Book`, `Chapter`, `Topic` models with key_concepts JSON

---

## [2026-05-05] — Core Session Engine (MVP)

### Added
- `POST /api/session/start` — creates session, generates first question
- `POST /api/session/answer` — assesses answer, returns next question or level-up
- `POST /api/session/hint` — progressive hint with tier tracking
- `POST /api/session/end` — finalises session, computes summary
- `POST /api/session/sub-question` — generates a simpler sub-question
- `Session`, `SessionTurn`, `TopicMastery` models
- Adaptive level progression L1→L5
- Chat UI with message bubbles, hint button, level indicator

---

## [2026-05-04] — Initial Setup

### Added
- FastAPI backend scaffolding (main.py, database.py, models.py)
- SQLAlchemy + Alembic setup, initial migration `859fa00bda28`
- React + Vite + Tailwind CSS frontend scaffolding
- GitHub Actions: `deploy-backend.yml`, `deploy-frontend.yml`, `build-android.yml`
- Capacitor 8 Android project with debug keystore
- Firebase Hosting configuration
- GCP infrastructure: Cloud Run, Cloud SQL, Cloud Storage, Secret Manager, Artifact Registry
- Workload Identity Federation for keyless CI/CD auth
