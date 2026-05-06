# TutorSnap — Auth, Admin Controls & Parent Dashboard
# Addendum to spec.md — Read spec.md first, then this file
# For Claude Code — Build on top of the existing working MVP

---

## CRITICAL INSTRUCTIONS

1. Read the original spec.md fully before reading this file
2. Do NOT break any existing functionality — this is additive only
3. Build in the exact phase order below
4. The existing session engine, ingestion pipeline, and chat UI stay unchanged
5. Every protected route must verify the JWT token before doing anything else

---

## 1. OVERVIEW OF WHAT GETS ADDED

### New user roles
| Role | How they log in | What they can do |
|---|---|---|
| Admin | Google OAuth → assigned admin role | Everything |
| Parent | Google OAuth → links to child accounts | Read-only dashboard for their children |
| Student | Google OAuth → grade stored in profile | Practice sessions (existing flow) |

### New pages
- /login — Google OAuth entry point for all roles
- /admin/* — full admin portal (protected, admin only)
- /parent/* — parent dashboard (protected, parent only)
- / — student home (protected, student only, existing TopicSelect)
- /session/:id — existing Chat page (protected, student only)
- /summary/:id — existing Summary page (protected, student only)

---

## 2. DEPENDENCIES TO ADD

### Backend — add to requirements.txt
```
google-auth==2.35.0
google-auth-oauthlib==1.2.1
google-auth-httplib2==0.2.0
PyJWT==2.9.0
httpx==0.27.2
```

### Frontend — add to package.json dependencies
```json
"@react-oauth/google": "^0.12.1"
```

---

## 3. NEW ENVIRONMENT VARIABLES

### Add to backend/.env
```
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
JWT_SECRET=generate-a-random-32-char-string-here
JWT_EXPIRY_HOURS=24
ADMIN_EMAILS=youremail@gmail.com,anotheremail@gmail.com
```

ADMIN_EMAILS is a comma-separated list of Google email addresses that get
automatically assigned the admin role on first login.

### Add to frontend — create frontend/.env
```
VITE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
VITE_API_URL=http://localhost:8000
```

### How to get Google OAuth credentials
1. Go to https://console.cloud.google.com
2. Create a new project or select existing
3. APIs & Services → Credentials → Create Credentials → OAuth Client ID
4. Application type: Web application
5. Authorised JavaScript origins: http://localhost:5173
6. Authorised redirect URIs: http://localhost:5173
7. Copy Client ID and Client Secret to .env

---

## 4. NEW DATABASE TABLES

Add these models to backend/models.py. Run alembic migration after.

#### Model: User
Table name: users
```
id                  Integer, primary key, autoincrement
email               String(255), unique, not null
name                String(200), not null
google_id           String(200), unique, not null
avatar_url          String(500), nullable
role                String(20), not null, default='student'
                    -- values: admin | parent | student
grade               Integer, nullable     -- only for students (5-10)
is_active           Boolean, default=True
created_at          DateTime, default=datetime.utcnow
last_login_at       DateTime, nullable

relationships:
  parent_links (as parent) → ParentStudentLink
  student_links (as student) → ParentStudentLink
  notifications → Notification
```

#### Model: ParentStudentLink
Table name: parent_student_links
```
id              Integer, primary key, autoincrement
parent_id       Integer, ForeignKey users.id, not null
student_id      Integer, ForeignKey users.id, not null
created_at      DateTime, default=datetime.utcnow

UniqueConstraint: parent_id + student_id

relationships:
  parent → User
  student → User
```

#### Model: Notification
Table name: notifications
```
id              Integer, primary key, autoincrement
user_id         Integer, ForeignKey users.id, not null
type            String(50), not null
                -- values: flagged_for_review | weekly_summary
title           String(200), not null
body            Text, not null
is_read         Boolean, default=False
related_topic_id Integer, ForeignKey topics.id, nullable
related_session_id Integer, ForeignKey sessions.id, nullable
created_at      DateTime, default=datetime.utcnow

relationships:
  user → User
```

#### Model: AppSettings
Table name: app_settings
```
id              Integer, primary key, autoincrement
key             String(100), unique, not null
value           Text, not null
updated_by      Integer, ForeignKey users.id, nullable
updated_at      DateTime, default=datetime.utcnow
```

Default settings to seed on first run:
```python
[
  { key: "max_questions_per_session", value: "20" },
  { key: "max_hint_tiers", value: "5" },
  { key: "session_timeout_minutes", value: "30" },
]
```

### Update existing Student model
The existing sessions table uses student_name (string). 
Add user_id column to sessions:
```
user_id   Integer, ForeignKey users.id, nullable
          -- nullable for backward compat with existing sessions
```

Create Alembic migration:
```bash
alembic revision --autogenerate -m "add auth tables and user_id to sessions"
alembic upgrade head
```

---

## 5. AUTH BACKEND

### backend/auth.py (new file)

#### Function: verify_google_token(token: str) -> dict
```python
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
import os

def verify_google_token(token: str) -> dict:
    """
    Verify Google ID token and return user info.
    Returns: { google_id, email, name, avatar_url }
    Raises: ValueError if token is invalid
    """
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    try:
        idinfo = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            client_id
        )
        return {
            "google_id": idinfo["sub"],
            "email": idinfo["email"],
            "name": idinfo.get("name", ""),
            "avatar_url": idinfo.get("picture", None)
        }
    except Exception as e:
        raise ValueError(f"Invalid Google token: {e}")
```

#### Function: create_jwt(user_id: int, email: str, role: str) -> str
```python
import jwt
from datetime import datetime, timedelta

def create_jwt(user_id: int, email: str, role: str) -> str:
    expiry_hours = int(os.getenv("JWT_EXPIRY_HOURS", 24))
    payload = {
        "user_id": user_id,
        "email": email,
        "role": role,
        "exp": datetime.utcnow() + timedelta(hours=expiry_hours),
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, os.getenv("JWT_SECRET"), algorithm="HS256")
```

#### Function: decode_jwt(token: str) -> dict
```python
def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, os.getenv("JWT_SECRET"), algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise ValueError("Token expired")
    except jwt.InvalidTokenError:
        raise ValueError("Invalid token")
```

#### FastAPI dependency: get_current_user
```python
from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session

def get_current_user(
    authorization: str = Header(None),
    db: Session = Depends(get_db)
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.replace("Bearer ", "")
    try:
        payload = decode_jwt(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    user = db.query(User).filter(User.id == payload["user_id"]).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user
```

#### FastAPI dependency: require_admin
```python
def require_admin(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user
```

#### FastAPI dependency: require_parent
```python
def require_parent(current_user: User = Depends(get_current_user)):
    if current_user.role not in ["parent", "admin"]:
        raise HTTPException(status_code=403, detail="Parent access required")
    return current_user
```

---

## 6. NEW AUTH API ROUTES

Add these to backend/main.py.

#### POST /api/auth/google

This is the single login endpoint for all roles.

Request body:
```json
{
    "credential": "google-id-token-string-from-frontend"
}
```

Logic:
1. Call verify_google_token(credential) → get google_id, email, name, avatar_url
2. Look up user by google_id in users table
3. If user does not exist: create new user
   - role determination:
     - If email in ADMIN_EMAILS env var → role = "admin"
     - Else → role = "student" (parent role is assigned by admin later)
   - grade = None (admin sets grade for students later)
4. If user exists: update last_login_at, update name/avatar_url in case changed
5. Create JWT: create_jwt(user.id, user.email, user.role)
6. Return response

Response:
```json
{
    "access_token": "jwt-token-string",
    "token_type": "bearer",
    "user": {
        "id": 1,
        "email": "student@gmail.com",
        "name": "Arjun Kumar",
        "role": "student",
        "grade": 6,
        "avatar_url": "https://..."
    },
    "requires_setup": false
}
```

requires_setup = true when:
- role is "student" and grade is null (needs grade assigned by admin)
- New student who hasn't been set up yet

#### GET /api/auth/me

Returns current user info. Protected — requires valid JWT.

Response: same user object as above

#### POST /api/auth/logout

Stateless JWT — just return success. Frontend deletes the token.

Response: `{ "message": "Logged out" }`

---

## 7. ADMIN API ROUTES

All routes below require require_admin dependency.
Prefix: /api/admin/

#### GET /api/admin/students
Returns all users with role="student", ordered by name.
Response:
```json
[{
    "id": 1,
    "name": "Arjun Kumar",
    "email": "arjun@gmail.com",
    "grade": 6,
    "is_active": true,
    "created_at": "...",
    "last_login_at": "...",
    "total_sessions": 12,
    "topics_mastered": 4,
    "flagged_topics": 1
}]
```
Compute total_sessions, topics_mastered, flagged_topics via joins.

#### GET /api/admin/students/{student_id}
Full detail for one student.
Response:
```json
{
    "id": 1,
    "name": "Arjun Kumar",
    "email": "arjun@gmail.com",
    "grade": 6,
    "is_active": true,
    "topic_mastery": [{
        "topic_title": "Introduction to Negative Numbers",
        "chapter_title": "Integers",
        "mastery_level": "L3",
        "level_label": "Practising",
        "last_practiced_at": "...",
        "total_sessions": 3,
        "flagged_for_review": false,
        "last_hint_tier_needed": 2
    }],
    "recent_sessions": [{
        "id": 5,
        "topic_title": "...",
        "started_at": "...",
        "ended_at": "...",
        "current_level": "L3",
        "questions_asked": 8,
        "status": "completed"
    }],
    "parent_names": ["Mrs. Priya Kumar"]
}
```

#### POST /api/admin/students/{student_id}/grade
Update a student's grade.
Request: `{ "grade": 6 }`
Response: updated user object

#### POST /api/admin/students/{student_id}/deactivate
Set is_active = False. Student can no longer log in.
Response: `{ "message": "Student deactivated" }`

#### POST /api/admin/students/{student_id}/activate
Set is_active = True.
Response: `{ "message": "Student activated" }`

#### POST /api/admin/students/{student_id}/reset-mastery
Delete all topic_mastery rows for this student.
Use case: student wants to start fresh.
Request: `{ "confirm": true }`
Response: `{ "message": "Mastery reset for Arjun Kumar", "topics_cleared": 7 }`

#### GET /api/admin/parents
Returns all users with role="parent".
Response: list of parent objects with their linked children names.

#### POST /api/admin/parents
Create or promote a user to parent role.
If user with email exists → update role to "parent".
If not exists → create stub user with role="parent" (they log in via Google later).
Request:
```json
{
    "email": "parent@gmail.com",
    "name": "Mrs. Priya Kumar"
}
```
Response: user object

#### POST /api/admin/parents/{parent_id}/link-student
Link a parent to a student.
Request: `{ "student_id": 5 }`
Response: `{ "message": "Linked successfully" }`
Error: 400 if already linked, 404 if either not found

#### DELETE /api/admin/parents/{parent_id}/unlink-student/{student_id}
Remove a parent-student link.
Response: `{ "message": "Unlinked" }`

#### GET /api/admin/flagged
Returns all students flagged for review.
Response:
```json
[{
    "student_name": "Arjun Kumar",
    "student_id": 1,
    "grade": 6,
    "topic_title": "Subtraction of Integers",
    "chapter_title": "Integers",
    "flagged_at": "...",
    "total_sessions_on_topic": 2,
    "last_hint_tier_needed": 5
}]
```

#### POST /api/admin/flagged/{student_id}/{topic_id}/resolve
Mark a flagged topic as resolved (admin has intervened).
Sets topic_mastery.flagged_for_review = False for that student+topic.
Response: `{ "message": "Flag resolved" }`

#### GET /api/admin/settings
Returns all app settings as key-value pairs.
Response:
```json
{
    "max_questions_per_session": "20",
    "max_hint_tiers": "5",
    "session_timeout_minutes": "30"
}
```

#### PUT /api/admin/settings
Update one or more settings.
Request:
```json
{
    "max_questions_per_session": "15",
    "max_hint_tiers": "5"
}
```
Logic: upsert each key in app_settings table, set updated_by = current admin user id.
After saving, these values must be read by session_engine.py at runtime (not from .env).
Response: updated settings object

#### GET /api/admin/reports/overview
High-level stats for the dashboard.
Response:
```json
{
    "total_students": 24,
    "active_this_week": 18,
    "total_sessions_this_week": 47,
    "flagged_students": 3,
    "books_uploaded": 2,
    "topics_available": 68
}
```

---

## 8. PARENT API ROUTES

All routes require require_parent dependency.
Prefix: /api/parent/

#### GET /api/parent/children
Returns all students linked to this parent.
Response:
```json
[{
    "id": 1,
    "name": "Arjun Kumar",
    "grade": 6,
    "avatar_url": "...",
    "last_active": "...",
    "topics_practised": 8,
    "flagged_topics": 1
}]
```

#### GET /api/parent/children/{student_id}
Full progress report for one child.
Validate that student_id is actually linked to this parent — 403 if not.
Response:
```json
{
    "student": {
        "name": "Arjun Kumar",
        "grade": 6
    },
    "summary": {
        "total_sessions": 14,
        "total_time_minutes": 210,
        "topics_practised": 8,
        "topics_at_l3_or_above": 5,
        "flagged_topics": 1
    },
    "topic_mastery": [{
        "topic_title": "Introduction to Negative Numbers",
        "chapter_title": "Integers",
        "mastery_level": "L3",
        "level_label": "Practising",
        "last_practiced_at": "...",
        "sessions_on_topic": 3
    }],
    "recent_sessions": [{
        "topic_title": "...",
        "started_at": "...",
        "duration_minutes": 18,
        "level_reached": "L3",
        "questions_asked": 7,
        "status": "completed"
    }],
    "flagged_topics": [{
        "topic_title": "Subtraction of Integers",
        "chapter_title": "Integers",
        "message": "Arjun needed extra help with this topic. Consider reviewing it together."
    }]
}
```

#### GET /api/parent/children/{student_id}/sessions
Session history for one child. Validate parent-child link.
Query params: ?limit=20&offset=0
Response: paginated list of session objects with duration_minutes computed.

#### GET /api/parent/notifications
Returns unread notifications for this parent.
Response:
```json
[{
    "id": 1,
    "type": "flagged_for_review",
    "title": "Arjun needs help with Subtraction of Integers",
    "body": "Arjun used all available hints on this topic and may need some extra support.",
    "is_read": false,
    "created_at": "..."
}]
```

#### POST /api/parent/notifications/{notification_id}/read
Mark a notification as read.
Response: `{ "message": "Marked as read" }`

---

## 9. NOTIFICATION TRIGGER

When a student is flagged for review (hint tier exhausted), the backend must:
1. Find all parents linked to that student
2. Create a Notification row for each parent:
   ```python
   Notification(
       user_id=parent.id,
       type="flagged_for_review",
       title=f"{student.name} needs help with {topic.title}",
       body=f"{student.name} used all available hints on '{topic.title}' and may need some extra support.",
       related_topic_id=topic.id,
       related_session_id=session.id
   )
   ```
3. Commit

Add this logic inside the existing /api/session/hint route in main.py,
in the block that handles hint exhaustion and sets flagged_for_review=True.

---

## 10. UPDATE EXISTING ROUTES FOR AUTH

These existing routes need auth added. Update them in main.py:

#### POST /api/upload → require_admin
Add `current_user: User = Depends(require_admin)` to function signature.

#### GET /api/ingestion/{book_id} → require_admin
#### GET /api/books → require_admin
#### GET /api/topics/{book_id} → get_current_user (any logged-in user)

#### POST /api/session/start → get_current_user (student only)
Add validation: if current_user.role != "student": raise 403
Also store user_id in session: session.user_id = current_user.id

#### POST /api/session/answer → get_current_user
Validate session.user_id == current_user.id (can't answer someone else's session)

#### POST /api/session/hint → get_current_user
Validate session.user_id == current_user.id

#### POST /api/session/end → get_current_user
Validate session.user_id == current_user.id

---

## 11. SESSION ENGINE — READ SETTINGS FROM DB

Update session_engine.py to read max_hint_tiers from app_settings table
instead of from .env. The .env value is the fallback only.

```python
def get_setting(key: str, default: str, db: Session) -> str:
    setting = db.query(AppSettings).filter(AppSettings.key == key).first()
    return setting.value if setting else default

# Usage in hint route:
max_hints = int(get_setting("max_hint_tiers", os.getenv("MAX_HINT_TIERS", "5"), db))
max_questions = int(get_setting("max_questions_per_session", "20", db))
```

Pass db session into the routes that need these settings.

---

## 12. FRONTEND AUTH

### frontend/src/auth/AuthContext.jsx (new file)

```jsx
import { createContext, useContext, useState, useEffect } from 'react'
import { getCurrentUser } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const token = localStorage.getItem('tutorsnap_token')
        if (token) {
            getCurrentUser()
                .then(res => setUser(res.data))
                .catch(() => localStorage.removeItem('tutorsnap_token'))
                .finally(() => setLoading(false))
        } else {
            setLoading(false)
        }
    }, [])

    const login = (token, userData) => {
        localStorage.setItem('tutorsnap_token', token)
        setUser(userData)
    }

    const logout = () => {
        localStorage.removeItem('tutorsnap_token')
        setUser(null)
    }

    return (
        <AuthContext.Provider value={{ user, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => useContext(AuthContext)
```

### frontend/src/auth/ProtectedRoute.jsx (new file)

```jsx
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function ProtectedRoute({ children, roles }) {
    const { user, loading } = useAuth()

    if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>
    if (!user) return <Navigate to="/login" replace />
    if (roles && !roles.includes(user.role)) return <Navigate to="/unauthorized" replace />

    return children
}
```

### Update frontend/src/App.jsx

```jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import Login from './pages/Login'
import TopicSelect from './pages/TopicSelect'
import Chat from './pages/Chat'
import Summary from './pages/Summary'
import AdminLayout from './pages/admin/AdminLayout'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminStudents from './pages/admin/AdminStudents'
import AdminStudentDetail from './pages/admin/AdminStudentDetail'
import AdminParents from './pages/admin/AdminParents'
import AdminFlagged from './pages/admin/AdminFlagged'
import AdminSettings from './pages/admin/AdminSettings'
import AdminBooks from './pages/admin/AdminBooks'
import ParentLayout from './pages/parent/ParentLayout'
import ParentDashboard from './pages/parent/ParentDashboard'
import ParentChildDetail from './pages/parent/ParentChildDetail'
import Unauthorized from './pages/Unauthorized'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

export default function App() {
    return (
        <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
            <AuthProvider>
                <BrowserRouter>
                    <Routes>
                        {/* Public */}
                        <Route path="/login" element={<Login />} />
                        <Route path="/unauthorized" element={<Unauthorized />} />

                        {/* Student routes */}
                        <Route path="/" element={
                            <ProtectedRoute roles={['student']}>
                                <TopicSelect />
                            </ProtectedRoute>
                        } />
                        <Route path="/session/:id" element={
                            <ProtectedRoute roles={['student']}>
                                <Chat />
                            </ProtectedRoute>
                        } />
                        <Route path="/summary/:id" element={
                            <ProtectedRoute roles={['student']}>
                                <Summary />
                            </ProtectedRoute>
                        } />

                        {/* Admin routes */}
                        <Route path="/admin" element={
                            <ProtectedRoute roles={['admin']}>
                                <AdminLayout />
                            </ProtectedRoute>
                        }>
                            <Route index element={<AdminDashboard />} />
                            <Route path="students" element={<AdminStudents />} />
                            <Route path="students/:id" element={<AdminStudentDetail />} />
                            <Route path="parents" element={<AdminParents />} />
                            <Route path="flagged" element={<AdminFlagged />} />
                            <Route path="settings" element={<AdminSettings />} />
                            <Route path="books" element={<AdminBooks />} />
                        </Route>

                        {/* Parent routes */}
                        <Route path="/parent" element={
                            <ProtectedRoute roles={['parent', 'admin']}>
                                <ParentLayout />
                            </ProtectedRoute>
                        }>
                            <Route index element={<ParentDashboard />} />
                            <Route path="child/:id" element={<ParentChildDetail />} />
                        </Route>

                        {/* Fallback */}
                        <Route path="*" element={<Navigate to="/login" replace />} />
                    </Routes>
                </BrowserRouter>
            </AuthProvider>
        </GoogleOAuthProvider>
    )
}
```

### Update frontend/src/api/client.js

Add auth header to all requests and new API functions:

```javascript
import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// Attach JWT to every request
api.interceptors.request.use(config => {
    const token = localStorage.getItem('tutorsnap_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
})

// Redirect to login on 401
api.interceptors.response.use(
    res => res,
    err => {
        if (err.response?.status === 401) {
            localStorage.removeItem('tutorsnap_token')
            window.location.href = '/login'
        }
        return Promise.reject(err)
    }
)

// Auth
export const googleLogin = (credential) =>
    api.post('/auth/google', { credential })

export const getCurrentUser = () =>
    api.get('/auth/me')

export const logout = () =>
    api.post('/auth/logout')

// Existing routes (unchanged)
export const uploadPDF = (formData) =>
    api.post('/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })

export const getIngestionStatus = (bookId) => api.get(`/ingestion/${bookId}`)
export const getBooks = () => api.get('/books')
export const getTopics = (bookId) => api.get(`/topics/${bookId}`)
export const startSession = (studentName, topicId) =>
    api.post('/session/start', { student_name: studentName, topic_id: topicId })
export const submitAnswer = (sessionId, answer) =>
    api.post('/session/answer', { session_id: sessionId, answer })
export const requestHint = (sessionId) =>
    api.post('/session/hint', { session_id: sessionId })
export const endSession = (sessionId) =>
    api.post('/session/end', { session_id: sessionId })

// Admin
export const getAdminStudents = () => api.get('/admin/students')
export const getAdminStudent = (id) => api.get(`/admin/students/${id}`)
export const updateStudentGrade = (id, grade) =>
    api.post(`/admin/students/${id}/grade`, { grade })
export const deactivateStudent = (id) =>
    api.post(`/admin/students/${id}/deactivate`)
export const activateStudent = (id) =>
    api.post(`/admin/students/${id}/activate`)
export const resetStudentMastery = (id) =>
    api.post(`/admin/students/${id}/reset-mastery`, { confirm: true })
export const getAdminParents = () => api.get('/admin/parents')
export const createParent = (email, name) =>
    api.post('/admin/parents', { email, name })
export const linkStudentToParent = (parentId, studentId) =>
    api.post(`/admin/parents/${parentId}/link-student`, { student_id: studentId })
export const unlinkStudentFromParent = (parentId, studentId) =>
    api.delete(`/admin/parents/${parentId}/unlink-student/${studentId}`)
export const getFlaggedStudents = () => api.get('/admin/flagged')
export const resolveFlag = (studentId, topicId) =>
    api.post(`/admin/flagged/${studentId}/${topicId}/resolve`)
export const getSettings = () => api.get('/admin/settings')
export const updateSettings = (settings) => api.put('/admin/settings', settings)
export const getAdminOverview = () => api.get('/admin/reports/overview')

// Parent
export const getMyChildren = () => api.get('/parent/children')
export const getChildDetail = (id) => api.get(`/parent/children/${id}`)
export const getChildSessions = (id, limit = 20, offset = 0) =>
    api.get(`/parent/children/${id}/sessions?limit=${limit}&offset=${offset}`)
export const getParentNotifications = () => api.get('/parent/notifications')
export const markNotificationRead = (id) =>
    api.post(`/parent/notifications/${id}/read`)
```

---

## 13. FRONTEND PAGES

### frontend/src/pages/Login.jsx

Layout: full screen centered, white card, max-w-sm.

Content:
- TutorSnap logo text (brand green, large, bold)
- Tagline: "Cambridge Maths made simple 📚"
- Divider
- Google Sign-In button using @react-oauth/google:
  ```jsx
  import { GoogleLogin } from '@react-oauth/google'

  <GoogleLogin
    onSuccess={handleSuccess}
    onError={() => setError('Login failed. Please try again.')}
    useOneTap
  />
  ```
- On success: call googleLogin(credentialResponse.credential)
  - Store token: login(response.data.access_token, response.data.user)
  - Route based on role:
    - admin → /admin
    - parent → /parent
    - student → / (or /setup if requires_setup is true)
- Error state: show red error message below button
- Small footer text: "Students, parents and teachers all sign in here"

If user is already logged in (token in localStorage), redirect immediately to role home.

### frontend/src/pages/Unauthorized.jsx

Simple page: "You don't have access to this page."
Link back to home.

### frontend/src/pages/admin/AdminLayout.jsx

Sidebar layout. Left sidebar (fixed) + main content area (scrollable).

Sidebar items:
- TutorSnap logo at top
- Navigation links:
  - Dashboard (icon: grid) → /admin
  - Students (icon: users) → /admin/students
  - Parents (icon: heart) → /admin/parents
  - Books (icon: book) → /admin/books
  - Flagged (icon: flag, show red badge with count) → /admin/flagged
  - Settings (icon: gear) → /admin/settings
- Bottom: user avatar + name + "Sign out" button

Main content: <Outlet /> from React Router

### frontend/src/pages/admin/AdminDashboard.jsx

On mount: call getAdminOverview()

Display stat cards in a 2x3 grid:
- Total Students (number)
- Active This Week (number)
- Sessions This Week (number)
- Flagged Students (number, red if > 0)
- Books Uploaded (number)
- Topics Available (number)

Below stats: "Recent flags" section — call getFlaggedStudents(), show first 5.
Each row: student name, topic, "Resolve" button.

### frontend/src/pages/admin/AdminStudents.jsx

On mount: call getAdminStudents()

Table with columns: Name, Email, Grade, Last Active, Sessions, Flagged, Status, Actions

Actions per row:
- "View" → navigate to /admin/students/:id
- "Deactivate" / "Activate" toggle button
- Grade dropdown (5-10) — on change, call updateStudentGrade()

Search input at top: filter table by name or email (client-side filtering).

### frontend/src/pages/admin/AdminStudentDetail.jsx

On mount: call getAdminStudent(id)

Sections:
1. Student header: name, email, grade selector, active status badge
2. Topic mastery table: chapter, topic, level badge, sessions, hints needed, flagged
3. Recent sessions list: topic, date, duration, level reached
4. Parent links: list of parents linked to this student
5. Danger zone: "Reset all mastery" button (confirmation dialog)

### frontend/src/pages/admin/AdminParents.jsx

On mount: call getAdminParents()

Two sections:
1. "Add Parent" form: email input + name input + "Add" button → calls createParent()
2. Parents table: name, email, children linked (as pills), actions

For each parent: "Link Child" button → opens modal with student dropdown → calls linkStudentToParent()
Unlink button next to each child name.

### frontend/src/pages/admin/AdminBooks.jsx

This is the existing Admin.jsx upload functionality, moved here.
Identical functionality: upload PDF, show ingestion status, show topic tree.
Remove the old /admin route — it's now /admin/books.

### frontend/src/pages/admin/AdminFlagged.jsx

On mount: call getFlaggedStudents()

Table: Student, Grade, Topic, Chapter, Sessions on Topic, Max Hint Tier, Date Flagged, Action
Action: "Mark Resolved" button → calls resolveFlag(), removes from list.

Empty state: "No flagged students 🎉 Everyone's doing great!"

### frontend/src/pages/admin/AdminSettings.jsx

On mount: call getSettings()

Form with labeled inputs:
- Max questions per session (number input, min 5, max 50)
- Max hint tiers (number input, min 3, max 7)
- Session timeout in minutes (number input, min 10, max 60)

"Save Settings" button → calls updateSettings() → show success toast.
Note below: "Changes take effect for new sessions immediately."

### frontend/src/pages/parent/ParentLayout.jsx

Simpler than admin — top navbar instead of sidebar (parents are on mobile more).

Navbar: TutorSnap logo | "My Children" | Notifications bell (badge with unread count) | Sign out

On mount: call getParentNotifications() — store unread count for bell badge.

Main content: <Outlet />

### frontend/src/pages/parent/ParentDashboard.jsx

On mount: call getMyChildren()

If no children linked yet: "No children linked yet. Ask your child's teacher to link your account."

For each child: a card showing:
- Child name + grade
- Last active (relative time: "2 days ago")
- Topics practised count
- Mastery summary: "5 topics at Practising level or above"
- Flagged badge (red) if flagged_topics > 0
- "View Progress" button → /parent/child/:id

Notifications section below cards:
- Show unread notifications as alert banners
- "Mark as read" X button on each
- If none: hide section

### frontend/src/pages/parent/ParentChildDetail.jsx

On mount: call getChildDetail(id) and getChildSessions(id)

Sections:
1. Header: child name + grade + last active
2. Summary cards: total sessions, total time, topics practised, topics at L3+
3. Topic mastery table: chapter, topic, level badge, last practised, sessions
   - Flagged topics highlighted in amber
4. Session history table: topic, date, duration, level reached, questions asked
   - Paginated: "Load more" button
5. Flagged topics section (if any):
   - Amber alert card per flagged topic
   - "Arjun needed extra help with Subtraction of Integers.
     Consider reviewing this topic together at home."

---

## 14. UPDATE TopicSelect.jsx FOR AUTH

The student no longer types their name — it comes from the logged-in user.

Changes:
- Remove name input field
- Get student name from useAuth().user.name
- Get grade from useAuth().user.grade
- If user.grade is null: show message "Your grade hasn't been set up yet. Please ask your teacher."
- Pass user.name to startSession() instead of typed name

---

## 15. BUILD ORDER FOR CLAUDE CODE

Build in exactly this order. Verify each phase before continuing.

### PHASE A — Backend auth foundation
1. Add new dependencies to requirements.txt and install them
2. Create backend/auth.py with all 4 functions
3. Add 4 new models to models.py (User, ParentStudentLink, Notification, AppSettings)
4. Add user_id column to sessions model
5. Run: alembic revision --autogenerate -m "add auth and user tables"
6. Run: alembic upgrade head
7. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET, ADMIN_EMAILS, JWT_EXPIRY_HOURS to .env
8. Seed default AppSettings rows on app startup (check if exists first)
9. VERIFY: alembic shows all migrations applied, no errors

### PHASE B — Auth routes
10. Add POST /api/auth/google to main.py
11. Add GET /api/auth/me to main.py
12. Add POST /api/auth/logout to main.py
13. VERIFY with curl:
    curl -X GET http://localhost:8000/api/auth/me
    Should return 401 (no token)

### PHASE C — Protect existing routes
14. Add auth dependencies to all 8 existing routes as specified in Section 10
15. VERIFY: GET /api/books without token returns 401

### PHASE D — Admin routes
16. Add all 14 admin routes to main.py
17. Add notification trigger to hint exhaustion logic
18. Update session_engine to read settings from DB
19. VERIFY: GET /api/admin/students without admin token returns 403

### PHASE E — Parent routes
20. Add all 5 parent routes to main.py
21. VERIFY: GET /api/parent/children without parent token returns 403

### PHASE F — Frontend auth
22. Add @react-oauth/google to package.json, run npm install
23. Create frontend/.env with VITE_GOOGLE_CLIENT_ID
24. Create frontend/src/auth/AuthContext.jsx
25. Create frontend/src/auth/ProtectedRoute.jsx
26. Update frontend/src/api/client.js (add interceptors + all new API functions)
27. Create frontend/src/pages/Login.jsx
28. Create frontend/src/pages/Unauthorized.jsx
29. Update frontend/src/App.jsx with full routing
30. Update frontend/src/pages/TopicSelect.jsx (remove name input, use auth user)

### PHASE G — Admin pages
31. Create frontend/src/pages/admin/AdminLayout.jsx
32. Create frontend/src/pages/admin/AdminDashboard.jsx
33. Create frontend/src/pages/admin/AdminStudents.jsx
34. Create frontend/src/pages/admin/AdminStudentDetail.jsx
35. Create frontend/src/pages/admin/AdminParents.jsx
36. Create frontend/src/pages/admin/AdminBooks.jsx (move content from old Admin.jsx)
37. Create frontend/src/pages/admin/AdminFlagged.jsx
38. Create frontend/src/pages/admin/AdminSettings.jsx

### PHASE H — Parent pages
39. Create frontend/src/pages/parent/ParentLayout.jsx
40. Create frontend/src/pages/parent/ParentDashboard.jsx
41. Create frontend/src/pages/parent/ParentChildDetail.jsx

### PHASE I — End-to-end verification
42. Log in with admin Google account → should land on /admin/dashboard
43. Upload PDF from /admin/books → verify ingestion works with auth
44. Create a parent account from /admin/parents
45. Log in with student Google account → should land on / (topic select)
46. Complete a session → verify session stored with user_id
47. Log in with parent Google account → should see linked student's progress
48. Exhaust all hints → verify parent gets notification

---

## 16. COMMON MISTAKES TO AVOID

- Do NOT store the Google Client Secret in the frontend — backend only
- Do NOT skip token validation on any protected route
- Do NOT assume role from the JWT without also checking the DB — always fetch User
- Do NOT forget to validate parent-child link before returning child data to parent
- Do NOT use the request db session in background tasks — create new SessionLocal()
- DO seed AppSettings on startup with a check-first pattern (don't duplicate)
- DO handle the case where a student's grade is null gracefully in TopicSelect
- DO redirect based on role after Google login — not all users go to the same page
- DO add the Google Client ID to both backend .env and frontend .env (they're different vars)
