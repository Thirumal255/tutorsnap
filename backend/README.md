# Backend — API Reference

FastAPI application serving the StudyBlox platform. All routes are prefixed with `/api`.

---

## Running locally

```bash
cd backend
pip install -r requirements.txt
alembic upgrade head
uvicorn main:app --reload --port 8000
# API docs at http://localhost:8000/docs
```

---

## Environment Variables (`.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | ✅ | Claude API key |
| `GOOGLE_CLIENT_ID` | ✅ | OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | OAuth 2.0 client secret |
| `JWT_SECRET` | ✅ | HS256 signing key (32+ chars) |
| `JWT_EXPIRY_HOURS` | — | Token lifetime, default `72` |
| `ADMIN_EMAILS` | ✅ | Comma-separated admin emails |
| `CLAUDE_MODEL` | — | Default `claude-sonnet-4-20250514` |
| `CLAUDE_FAST_MODEL` | — | Default `claude-haiku-4-5-20251001` |
| `MAX_HINT_TIERS` | — | Default `5` |
| `USE_GCS` | — | `true` in production, `false` locally |
| `GCS_BUCKET_NAME` | prod | Cloud Storage bucket name |

---

## Database Migrations

Run with Alembic:
```bash
alembic upgrade head          # apply all pending migrations
alembic current               # show current revision
alembic history               # show full migration chain
```

### Migration chain
| Revision | Description |
|---|---|
| `859fa00bda28` | Initial schema (Book, Chapter, Topic, Session, SessionTurn, TopicMastery) |
| `a963847deb5a` | Add `exercises` JSON to Topics |
| `e06b85dfc23f` | Add auth/user tables (User, ParentStudentLink, Notification, AppSettings) |
| `f3a912c4e001` | Add `title` to Books |
| `c7e891f23a45` | Add upload progress columns to Books |
| `d4f8a2b1c3e9` | Add missing session columns (`level_question_count`, `final_confidence`) |
| `f7a1b2c3d4e5` | Add gamification (XP, streak, buddy, weekly challenge tables) |
| `g8b2c3d4e5f6` | Add learning effectiveness (`next_review_at`, `review_interval_days`, `exam_sessions`) |

> All migrations use `IF NOT EXISTS` / `IF column EXISTS` patterns for safe re-runs.

---

## Data Models

### User
```
id, email, name, google_id, avatar_url, role, grade, is_active,
created_at, last_login_at,
total_xp, weekly_xp, weekly_xp_reset_at, show_on_leaderboard,
buddy_name, buddy_avatar
```

### Book / Chapter / Topic
```
Book: id, title, subject, grade, filename, ingestion_status, chapter_count,
      topic_count, upload_stage, upload_progress, toc_pages, chapter_structure
Chapter: id, book_id, chapter_number, title, page_start, page_end
Topic: id, chapter_id, topic_number, title, key_concepts(JSON),
       vocabulary(JSON), exercises(JSON), difficulty_ceiling, raw_content
```

### Session / SessionTurn
```
Session: id, student_name, user_id, topic_id, started_at, ended_at, status,
         current_level, consecutive_confident, questions_asked, hint_tier,
         flagged_for_review, final_confidence, level_question_count
SessionTurn: id, session_id, turn_number, question_text, expected_key_points,
             answer_format, student_answer, assessment_score, confidence_tag,
             hint_tier_used, level, missed_key_points
```

### TopicMastery
```
id, student_name, topic_id, mastery_level (L1-L5), total_sessions,
last_practiced_at, flagged_for_review, last_hint_tier_needed,
next_review_at, review_interval_days
```

### WeeklyChallenge / WeeklyChallengeCompletion
```
WeeklyChallenge: id, grade, week_start, topic_id, question_text,
                 expected_key_points, answer_format
WeeklyChallengeCompletion: id, user_id, challenge_id, score, completed_at
```

### ExamSession
```
id, user_id, grade, subjects_json, questions_json, answers_json,
scores_json, feedbacks_json, time_limit_seconds, question_count,
started_at, ended_at, status, total_score, xp_earned
```

---

## API Routes

### Auth — `/api/auth/*`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/google` | Public | Exchange Google credential for JWT |
| `GET` | `/api/auth/me` | JWT | Get current user profile |
| `POST` | `/api/auth/logout` | JWT | Invalidate session |
| `POST` | `/api/auth/dev-login` | Public | Dev-only email login (disabled in prod) |

**Response — `/api/auth/me`**
```json
{
  "id": 1, "email": "...", "name": "...", "role": "student",
  "grade": 7, "avatar_url": "...", "is_active": true,
  "total_xp": 1250, "weekly_xp": 200,
  "buddy_name": "Bloxy", "buddy_avatar": "robot",
  "show_on_leaderboard": true
}
```

---

### Book Ingestion — `/api/upload/*`, `/api/books/*`, `/api/topics/*`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/upload/init` | Admin | Create book record + get GCS signed URL |
| `POST` | `/api/upload/complete/{book_id}` | Admin | Trigger background ingestion after GCS upload |
| `POST` | `/api/upload` | Admin | Direct upload (fallback, max 32 MB) |
| `GET` | `/api/books` | JWT | List books, optionally filtered by `?grade=` |
| `DELETE` | `/api/books/{book_id}` | Admin | Delete book + all dependent data |
| `POST` | `/api/books/{book_id}/cancel` | Admin | Cancel in-progress ingestion |
| `POST` | `/api/books/{book_id}/retry` | Admin | Retry failed ingestion |
| `GET` | `/api/ingestion/{book_id}` | Admin | Poll ingestion progress (stage, %) |
| `GET` | `/api/topics/{book_id}` | JWT | Get all chapters + topics for a book |

---

### Session Engine — `/api/session/*`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/session/start` | Student | Start a new session for a topic |
| `POST` | `/api/session/answer` | Student | Submit an answer (text or base64 image) |
| `POST` | `/api/session/hint` | Student | Get the next hint tier |
| `POST` | `/api/session/sub-question` | Student | Get a simpler sub-question |
| `POST` | `/api/session/end` | Student | End a session and get summary |

**`POST /api/session/start`** request:
```json
{ "student_name": "Alice", "topic_id": 42 }
```

**`POST /api/session/answer`** request:
```json
{
  "session_id": "uuid",
  "answer": "The answer is 15",
  "image_data": "base64jpeg..."   // optional — handwriting
}
```

**`POST /api/session/answer`** response:
```json
{
  "session_id": "uuid", "score": 85,
  "next_question": "...", "answer_format": "number",
  "level_up": true, "session_complete": false,
  "xp_earned": 50, "new_level": "L3"
}
```

---

### Admin — `/api/admin/*`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/admin/students` | Admin | List all students with stats |
| `POST` | `/api/admin/students` | Admin | Create a new student |
| `GET` | `/api/admin/students/{id}` | Admin | Student detail with mastery + sessions |
| `POST` | `/api/admin/students/{id}/grade` | Admin | Update student grade |
| `POST` | `/api/admin/students/{id}/deactivate` | Admin | Deactivate student |
| `POST` | `/api/admin/students/{id}/activate` | Admin | Activate student |
| `POST` | `/api/admin/students/{id}/reset-mastery` | Admin | Reset all mastery data |
| `GET` | `/api/admin/parents` | Admin | List all parents with linked students |
| `POST` | `/api/admin/parents` | Admin | Create a new parent |
| `POST` | `/api/admin/parents/{id}/link-student` | Admin | Link a student to a parent |
| `DELETE` | `/api/admin/parents/{id}/unlink-student/{sid}` | Admin | Unlink a student |
| `GET` | `/api/admin/flagged` | Admin | All flagged topics with student info |
| `POST` | `/api/admin/flagged/{sid}/{tid}/resolve` | Admin | Resolve a flag |
| `GET` | `/api/admin/settings` | Admin | Get platform settings |
| `PUT` | `/api/admin/settings` | Admin | Update platform settings |
| `GET` | `/api/admin/reports/overview` | Admin | Dashboard stats (students, sessions, flags, books) |
| `GET` | `/api/admin/analytics` | Admin | Rich analytics (trend, grades, subjects, mastery, top XP) |

**`GET /api/admin/analytics`** response:
```json
{
  "sessions_trend": [{ "date": "2026-05-01", "sessions": 12 }, ...],
  "grade_breakdown": [{ "grade": 7, "students": 8, "sessions": 45 }, ...],
  "subject_breakdown": [{ "subject": "Mathematics", "sessions": 60, "flags": 3 }, ...],
  "mastery_distribution": { "L1": 12, "L2": 8, "L3": 15, "L4": 5, "L5": 2 },
  "top_students": [{ "id": 1, "name": "Alice", "grade": 7, "total_xp": 1200, "topics_mastered": 8 }, ...]
}
```

---

### Student — `/api/student/*`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/student/dashboard` | Student | Home page data (streak, XP, weekly challenge status) |
| `GET` | `/api/student/progress` | Student | All books → chapters → topics with mastery + review dates |
| `GET` | `/api/student/sessions` | Student | Session history (default last 50) |
| `GET` | `/api/student/review-queue` | Student | Topics due for spaced repetition review |
| `GET` | `/api/student/mistakes` | Student | All low-score answers grouped by topic |
| `GET` | `/api/student/buddy` | Student | Fetch buddy name + avatar |
| `PUT` | `/api/student/buddy` | Student | Update buddy name + avatar + leaderboard opt-in |
| `GET` | `/api/student/leaderboard` | Student | All-time and weekly XP rankings |
| `GET` | `/api/student/weekly-challenge` | Student | Fetch or generate this week's challenge |
| `POST` | `/api/student/weekly-challenge/submit` | Student | Submit challenge answer |

---

### Exam — `/api/exam/*`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/exam/start` | Student | Generate exam questions (concurrent Claude calls) |
| `POST` | `/api/exam/submit` | Student | Assess all answers (concurrent Claude calls), save result |

**`POST /api/exam/start`** request:
```json
{
  "subjects": ["Mathematics", "Science"],
  "question_count": 10,
  "time_limit_minutes": 15
}
```

**`POST /api/exam/submit`** request:
```json
{
  "exam_session_id": 1,
  "answers": ["answer 1", "answer 2", ...]
}
```

---

### Flashcard — `/api/flashcard/*`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/flashcard/question` | Student | Get a question + key_concepts for a topic |
| `POST` | `/api/flashcard/mark` | Student | Mark as known/unknown; updates SM-2 interval |

---

### Parent — `/api/parent/*`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/parent/children` | Parent | List linked children with summary stats |
| `GET` | `/api/parent/children/{id}` | Parent | Full child detail (summary, subject progress, mastery, sessions) |
| `GET` | `/api/parent/children/{id}/sessions` | Parent | Paginated session history |
| `GET` | `/api/parent/children/{id}/weekly-report` | Parent | Week-over-week comparison snapshot |
| `GET` | `/api/parent/family-activity` | Parent | 7-day activity data for all children (for chart) |
| `GET` | `/api/parent/notifications` | Parent | All notifications, sorted newest first |
| `POST` | `/api/parent/notifications/{id}/read` | Parent | Mark one notification as read |
| `POST` | `/api/parent/notifications/mark-all-read` | Parent | Mark all notifications as read |

**`GET /api/parent/children/{id}/weekly-report`** response:
```json
{
  "this_week": { "sessions": 5, "topics_count": 3, "xp_earned": 200, "total_xp": 1250 },
  "last_week": { "sessions": 3, "topics_count": 2 },
  "delta_sessions": 2,
  "new_masteries": [{ "topic_title": "Algebra", "level": "L3" }]
}
```

---

## Session Engine Logic

### Adaptive Level Progression
- Levels: L1 (recall) → L2 (understand) → L3 (apply) → L4 (analyse) → L5 (evaluate)
- Level-up condition: `consecutive_confident >= 2` (configurable)
- Level-down: if student scores < 60 after 3 attempts at current level

### XP Awards
| Event | XP |
|---|---|
| Correct answer (score ≥ 80) | +10 |
| Level-up | +50 |
| Session complete | +100 |
| Weekly challenge correct | +50 |
| Exam submission | +`total_score` (max 100) |

### Spaced Repetition Intervals
| Level | Days until next review |
|---|---|
| L1 | 1 day |
| L2 | 3 days |
| L3 | 7 days |
| L4 | 14 days |
| L5 | 21 days |

### Hint Tiers
Each tier adds more context. After `max_hint_tiers` (default 5), the answer is revealed and the topic is flagged for review.

### Flagging Logic
A topic is flagged (`flagged_for_review = True`) when a student reaches maximum hint tiers on any question. Flagged topics appear in the admin panel and parent notifications.

---

## Key Files

| File | Purpose |
|---|---|
| `main.py` | All FastAPI routes (55 endpoints), Pydantic models, background tasks |
| `session_engine.py` | Claude API calls for question generation, answer assessment, hints, sub-questions, vision |
| `ingestion.py` | PDF parsing with PyMuPDF, Claude-powered topic structuring, chapter checkpoint/resume |
| `auth.py` | `verify_google_token`, `create_jwt`, `get_current_user`, `require_admin`, `require_parent` |
| `models.py` | 13 SQLAlchemy ORM models |
| `database.py` | Engine + `get_db` dependency |
| `storage.py` | Dual-mode: `USE_GCS=true` → Cloud Storage, else local `uploads/` |
| `progress.py` | Thread-safe in-memory dict for ingestion progress polling |




