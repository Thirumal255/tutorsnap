# Frontend — Component & Page Reference

React 18 + Vite 5 + Tailwind CSS 3 single-page application.  
Deployed to Firebase Hosting. Mobile wrapper via Capacitor 8 (Android).

---

## Running locally

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # production build to dist/
npm run preview    # serve dist/ locally
```

Vite proxies `/api/*` → `http://localhost:8000` in development (see `vite.config.js`).

---

## Project Structure

```
frontend/src/
├── main.jsx                   — React root, mounts <App />
├── App.jsx                    — Router + all routes + providers
├── api/
│   └── client.js              — Axios instance + every API call function
├── auth/
│   ├── AuthContext.jsx        — user state, login, logout, refreshUser
│   └── ProtectedRoute.jsx     — role-based route guard
├── context/
│   ├── ToastContext.jsx        — global toast system
│   └── UploadContext.jsx       — PDF upload progress state
├── components/
│   ├── BuddyCustomizer.jsx    — avatar + name picker modal
│   ├── ChatBubble.jsx         — message bubble with buddy emoji
│   ├── HintButton.jsx         — progressive hint reveal button
│   ├── ProgressBadge.jsx      — mastery level badge (L1–L5)
│   └── WritingCanvas.jsx      — HTML5 Canvas handwriting input
└── pages/
    ├── Login.jsx              — Google OAuth sign-in page
    ├── Unauthorized.jsx       — 403 page
    ├── Chat.jsx               — live session (Q&A + hints + canvas)
    ├── Summary.jsx            — post-session summary with XP
    ├── ExamMode.jsx           — full-screen timed exam
    ├── FlashcardMode.jsx      — full-screen flashcard review
    ├── TopicSelect.jsx        — topic browser (legacy/standalone)
    ├── Admin.jsx              — legacy admin shell (kept for reference)
    ├── admin/
    │   ├── AdminLayout.jsx    — sidebar + bottom nav wrapper
    │   ├── AdminDashboard.jsx — overview stats + recent flags
    │   ├── AdminAnalytics.jsx — charts: trend, grades, subjects, mastery, top XP
    │   ├── AdminStudents.jsx  — student list + grade filter + CSV export
    │   ├── AdminStudentDetail.jsx — individual student management
    │   ├── AdminParents.jsx   — parent management + link/unlink
    │   ├── AdminFlagged.jsx   — flagged topics grouped by student
    │   ├── AdminBooks.jsx     — PDF upload + ingestion management
    │   └── AdminSettings.jsx  — platform configuration
    ├── parent/
    │   ├── ParentLayout.jsx   — sidebar + bottom nav wrapper
    │   ├── ParentDashboard.jsx — family overview + activity chart
    │   ├── ParentChildDetail.jsx — child detail + weekly report card
    │   └── ParentNotifications.jsx — grouped alerts with read/unread
    └── student/
        ├── StudentLayout.jsx  — sidebar + bottom nav wrapper
        ├── StudentHome.jsx    — dashboard: XP, streak, challenge, review queue
        ├── StudentPractice.jsx — book/topic browser + exam/flashcard shortcuts
        ├── StudentProgress.jsx — map/list toggle, concept map, spaced rep badges
        ├── StudentStudyTime.jsx — session history, heatmap, subject time bars
        ├── StudentAchievements.jsx — badges + XP leaderboard
        └── StudentMistakes.jsx — mistake journal with re-practice
```

---

## Routing

All routes are defined in `App.jsx`:

| Path | Component | Auth |
|---|---|---|
| `/login` | `Login` | Public |
| `/unauthorized` | `Unauthorized` | Public |
| `/` → `/home` | Redirect | Student |
| `/home` | `StudentHome` | Student |
| `/practice` | `StudentPractice` | Student |
| `/progress` | `StudentProgress` | Student |
| `/study-time` | `StudentStudyTime` | Student |
| `/achievements` | `StudentAchievements` | Student |
| `/mistakes` | `StudentMistakes` | Student |
| `/session/:id` | `Chat` | Student |
| `/summary/:id` | `Summary` | Student |
| `/exam` | `ExamMode` | Student (full-screen) |
| `/flashcard` | `FlashcardMode` | Student (full-screen) |
| `/admin` | `AdminDashboard` | Admin |
| `/admin/students` | `AdminStudents` | Admin |
| `/admin/students/:id` | `AdminStudentDetail` | Admin |
| `/admin/parents` | `AdminParents` | Admin |
| `/admin/flagged` | `AdminFlagged` | Admin |
| `/admin/analytics` | `AdminAnalytics` | Admin |
| `/admin/settings` | `AdminSettings` | Admin |
| `/admin/books` | `AdminBooks` | Admin |
| `/parent` | `ParentDashboard` | Parent / Admin |
| `/parent/children/:id` | `ParentChildDetail` | Parent / Admin |
| `/parent/notifications` | `ParentNotifications` | Parent / Admin |

---

## Context Providers

### `AuthContext` (`src/auth/AuthContext.jsx`)

Wraps the entire app. Provides:

```js
const { user, login, logout, refreshUser } = useAuth()
```

| Value | Type | Description |
|---|---|---|
| `user` | `object \| null` | Current user from `/api/auth/me` |
| `user.total_xp` | `number` | Cumulative XP |
| `user.weekly_xp` | `number` | XP earned this calendar week |
| `user.buddy_name` | `string` | Custom buddy name |
| `user.buddy_avatar` | `string` | Avatar key (`robot`, `fox`, etc.) |
| `login(token)` | `fn` | Stores JWT + fetches user |
| `logout()` | `fn` | Clears token + user state |
| `refreshUser()` | `fn` | Re-fetches `/api/auth/me` and updates user |

### `ToastContext` (`src/context/ToastContext.jsx`)

```js
const { toast } = useToast()
toast.success('Saved!')
toast.error('Something went wrong', 5000)   // optional duration ms
toast.info('FYI…')
toast.warn('Watch out!')
```

- Auto-dismisses after 3.5s (errors 5s by default)
- Stacks up to 5 toasts
- Renders in top-right corner, `z-[9999]`

### `UploadContext` (`src/context/UploadContext.jsx`)

Manages PDF upload state. Provides floating progress widget during ingestion.

---

## Key Components

### `ChatBubble` (`src/components/ChatBubble.jsx`)

Renders a chat message. When role is `'assistant'`, shows the buddy emoji.

```jsx
<ChatBubble role="assistant" text="..." buddyAvatar="fox" />
```

**BUDDY_EMOJI map**: `robot→🤖`, `fox→🦊`, `panda→🐼`, `lion→🦁`, `dolphin→🐬`, `owl→🦉`, `dragon→🐉`, `wizard→🧙`

### `WritingCanvas` (`src/components/WritingCanvas.jsx`)

HTML5 Canvas handwriting input with `forwardRef`.

```jsx
const canvasRef = useRef()
<WritingCanvas ref={canvasRef} width={600} height={200} />

// Exposed via useImperativeHandle:
canvasRef.current.getImageData()  // returns base64 JPEG string (no data: prefix)
canvasRef.current.clear()
canvasRef.current.undo()
canvasRef.current.isEmpty()
```

- HiDPI scaling via `devicePixelRatio`
- PointerEvent API (works on touch + stylus)
- Exports as JPEG (quality 0.85) for Claude Vision

### `BuddyCustomizer` (`src/components/BuddyCustomizer.jsx`)

Modal for selecting avatar + custom name.

```jsx
<BuddyCustomizer
  currentName="Bloxy"
  currentAvatar="robot"
  onSave={() => refreshUser()}
  onClose={() => setOpen(false)}
/>
```

### `ProgressBadge` (`src/components/ProgressBadge.jsx`)

Mastery level badge chip: `L1`=🟡, `L2`=🔵, `L3`=🟢, `L4`=🟣, `L5`=⭐

---

## Page Details

### `Chat.jsx` — Live Session

State machine: `loading` → `active` → `complete`

Key features:
- Message history rendered as `ChatBubble` components
- XP pop animation on award (`xp_earned` from API)
- Canvas mode toggle (✏️) → `WritingCanvas` with submit
- Hint button with tier progress
- Give-up scaffolding (4 stages: rephrase → sub-question → hint → answer)
- Confusion type picker before sub-question
- Buddy avatar + name shown in top bar from `user.buddy_avatar` / `user.buddy_name`

### `ExamMode.jsx` — Full-Screen Exam

Three phases:
1. **Setup** — subject multi-select, question count (5/10/15), time limit (10/15/20 min)
2. **InProgress** — countdown timer (auto-submits at 0), dot navigation, answer textarea per question
3. **Results** — score card + XP, tabs: Overview (subject breakdown bars) / Question Detail (per-Q score + feedback)

### `FlashcardMode.jsx` — Full-Screen Flashcards

Two screens:
1. **TopicSelect** — lists practised topics, filterable by subject or "Due for review"
2. **FlashCard** — 10-card round: question shown → tap to reveal key points → Know it ✅ / Need practice 😅

### `StudentProgress.jsx` — Progress Page

Two view modes toggled by button:
- **List view** — accordion chapters with topic rows, mastery icons, 🔁 due badges
- **Map view** — `ConceptMap` component: responsive grid of topic cards colour-coded by mastery, hover popup with key_concepts

### `StudentHome.jsx` — Dashboard

Sections:
- Buddy avatar button → opens `BuddyCustomizer`
- XP + streak stat cards (from `/api/student/dashboard`)
- `WeeklyChallengeCard` — inline question, one attempt, shows result + XP award
- Review queue — up to 3 due topics with ▶ Review buttons

### `AdminAnalytics.jsx` — Analytics Page

Charts (all pure React, no chart library):
- 14-day sessions trend — bar chart, today highlighted gold
- Grade breakdown — horizontal progress bars
- Mastery distribution — SVG donut chart with arc segments
- Subject performance — horizontal progress bars with flag counts
- Top-5 XP students — clickable leaderboard rows with gold/silver/bronze medals
- Platform health summary — 4 stat cards

### `ParentChildDetail.jsx` — Child Detail

Added in latest update:
- **`WeeklyReportCard`** — this week vs last week: sessions ↑/↓, topics, XP earned + total XP; new mastery badges
- Tabs: Overview (subject bars) / Topic Mastery (full list) / Sessions (paginated)
- Flagged topics alert section

---

## API Client (`src/api/client.js`)

Axios instance with base URL `VITE_API_BASE/api` (or `/api` in dev).

Auto-injects `Authorization: Bearer <token>` from `localStorage`.  
Redirects to `/login` on 401.

### Available functions

```js
// Auth
googleLogin(credential)
getCurrentUser()
logout()
devLogin(email)

// Books / ingestion
uploadPDF(formData)
initUpload(data)
completeUpload(bookId)
getIngestionStatus(bookId)
getBooks(grade?)
getTopics(bookId)
deleteBook(bookId)
cancelIngestion(bookId)
retryIngestion(bookId)

// Session engine
startSession(studentName, topicId)
submitAnswer(sessionId, answer, imageData?)
requestSubQuestion(sessionId, confusionType?)
requestHint(sessionId)
endSession(sessionId)

// Admin
getAdminStudents()
createStudent(email, name, grade)
getAdminStudent(id)
updateStudentGrade(id, grade)
deactivateStudent(id)
activateStudent(id)
resetStudentMastery(id)
getAdminParents()
createParent(email, name)
linkStudentToParent(parentId, studentId)
unlinkStudentFromParent(parentId, studentId)
getFlaggedStudents()
resolveFlag(studentId, topicId)
getSettings()
updateSettings(settings)
getAdminOverview()
getAdminAnalytics()              // NEW — analytics page data

// Student
getStudentDashboard()
getBuddySettings()
updateBuddySettings(data)
getLeaderboard()
getWeeklyChallenge()
submitWeeklyChallenge(challengeId, answer)
getStudentProgress()
getReviewQueue()
getMistakes()
getStudentSessions(limit?)

// Exam / Flashcard
startExam(data)
submitExam(data)
getFlashcardQuestion(topicId)
markFlashcard(topicId, known)

// Parent
getMyChildren()
getChildDetail(id)
getChildSessions(id, limit?, offset?)
getChildWeeklyReport(id)         // NEW — weekly report card data
getFamilyActivity()
getParentNotifications()
markNotificationRead(id)
markAllNotificationsRead()
```

---

## Design System

### Colours
| Token | Hex | Usage |
|---|---|---|
| Background | `#0F0F23` | Page background |
| Card | `#16213E` | Card / sidebar background |
| Border | `#2D2B5A` | Card borders, dividers |
| Muted | `#8892B0` | Secondary text, placeholders |
| Dark muted | `#4A5568` | Tertiary text |
| Primary blue | `#00A2FF` | Buttons, active nav, links |
| Success green | `#00CC88` | Correct answers, mastery L3 |
| Warning orange | `#FFB347` | Caution states, mastery L1 |
| Danger red | `#FF3333` | Errors, flags, danger zone |
| Gold | `#FFD700` | Streaks, today highlight, rank 1 |
| Purple | `#C084FC` | Mastery L4, Computer Science |
| Yellow | `#FBBF24` | Mastery L5, Tamil |

### Tailwind Utilities (custom in `index.css`)
| Class | Purpose |
|---|---|
| `.blox-card` | Dark card with border + rounded-2xl |
| `.btn-blox-primary` | Blue gradient button with hover |
| `.blox-input` | Dark input with focus ring |
| `.blox-hover` | Scale + border highlight on hover |
| `.shadow-glow-blue` | Blue glow shadow |
| `.shadow-glow-green` | Green glow shadow |
| `.animate-bounce-in` | Entrance animation with scale + fade |

### Fonts
- **Fredoka One** — headings, numbers, level labels (loaded from Google Fonts)
- **Nunito** — body text, labels, descriptions

---

## Mobile (Capacitor 8 / Android)

The Android app wraps the same React build via Capacitor:

```bash
npm run build
npx cap sync android
# Open in Android Studio, or:
cd android && ./gradlew assembleDebug
```

- APK artifact built automatically by `build-android.yml` CI workflow on every push
- Uses committed `debug.keystore` for stable SHA-1 (required for Google Sign-In)
- Google Sign-In uses `@capacitor-community/google-auth` with both web + Android client IDs

---

## Environment Variables (Vite)

Set in `.env` (local) or GitHub Secrets (CI):

```env
VITE_GOOGLE_CLIENT_ID=322472504855-...apps.googleusercontent.com
VITE_API_BASE=https://tutorsnap-api-yfxhelshwq-el.a.run.app
```

In development, `VITE_API_BASE` can be omitted — the Vite proxy handles `/api/*`.
