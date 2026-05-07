# TutorSnap

AI-powered Cambridge Mathematics study assistant for Grade 6 students.
Students practice questions with escalating hints, parents track progress, and admins manage the content.

---

## Live URLs

| Service | URL |
|---|---|
| Frontend (web) | https://tutorsnap.web.app |
| Backend API | https://tutorsnap-api-yfxhelshwq-el.a.run.app |
| Admin panel | https://tutorsnap.web.app/admin |
| Android APK | GitHub → Actions → "Build Android APK" → Artifacts |

---

## Architecture

```
Browser / Android app (React + Capacitor)
        │  HTTPS
        ▼
Firebase Hosting  ─── static files (dist/)
        │
        │  /api/* requests
        ▼
Cloud Run  (FastAPI, Python 3.11, Docker)
        │
        ├── Cloud SQL (PostgreSQL 15)  — session + mastery data
        ├── Cloud Storage              — uploaded PDF textbooks
        └── Secret Manager            — all credentials
```

### GCP Project
- **Project ID**: `tutorsnap`
- **Region**: `asia-south1`
- **GitHub repo**: `Thirumal255/tutorsnap`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI 0.115, Python 3.11, Uvicorn |
| ORM | SQLAlchemy 2.0, Alembic migrations |
| Database | Cloud SQL PostgreSQL 15 (`tutorsnap-db`) |
| File storage | Cloud Storage (`tutorsnap-uploads-tutorsnap`) |
| AI | Anthropic Claude (`claude-sonnet-4-20250514`) |
| PDF parsing | PyMuPDF |
| Auth | Google OAuth 2.0 + HS256 JWT |
| Frontend | React 18, Vite 5, Tailwind CSS 3 |
| Mobile | Capacitor 8 (Android wrapper) |
| CI/CD | GitHub Actions (3 workflows) |
| Hosting | Firebase Hosting |
| Container registry | Artifact Registry (`asia-south1-docker.pkg.dev/tutorsnap/tutorsnap/api`) |

---

## User Roles

| Role | How they sign in | Access |
|---|---|---|
| **Admin** | Google OAuth (email in `ADMIN_EMAILS`) | Everything — upload PDFs, manage students/parents, settings |
| **Student** | Google OAuth | Practice sessions at `/` |
| **Parent** | Google OAuth (admin pre-registers them) | Read-only dashboard for linked children at `/parent` |

Admin email: `thirumalreddym1982@gmail.com`

---

## Local Development

### Prerequisites
- Python 3.11+
- Node 22+
- PostgreSQL running locally
- `backend/.env` file (see below)

### Backend `.env`
```
DATABASE_URL=postgresql+psycopg2://postgres:yourpassword@localhost/tutorsnap
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_CLIENT_ID=322472504855-1fsal4q80mm9dgijvutqdrnboprjkr27.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=<random 32-char hex>
JWT_EXPIRY_HOURS=72
ADMIN_EMAILS=thirumalreddym1982@gmail.com
CLAUDE_MODEL=claude-sonnet-4-20250514
MAX_HINT_TIERS=5
USE_GCS=false
```

### Run locally
```bash
# Terminal 1 — Backend
cd backend
pip install -r requirements.txt
alembic upgrade head
uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev
# Opens on http://localhost:5173
```

The Vite dev server proxies `/api/*` → `http://localhost:8000`.

---

## CI/CD — GitHub Actions

Three workflows trigger on push to `main`:

| Workflow | Trigger path | What it does |
|---|---|---|
| `deploy-backend.yml` | `backend/**` | Docker build → Artifact Registry → Alembic migrations → Cloud Run deploy |
| `deploy-frontend.yml` | `frontend/**` (excl. `android/`) | `npm run build` → Firebase Hosting |
| `build-android.yml` | `frontend/**` | `npm run build` → Capacitor sync → Gradle assembleDebug → APK artifact |

### Auth: Workload Identity Federation (keyless)
No service account keys in GitHub. The workflows authenticate via OIDC:
- **Pool**: `github-pool` (global)
- **Provider**: `github-provider`
- **WIF provider resource**: `projects/322472504855/locations/global/workloadIdentityPools/github-pool/providers/github-provider`
- **Service account**: `tutorsnap-api@tutorsnap.iam.gserviceaccount.com`

### GitHub Secrets required
| Secret | Value |
|---|---|
| `WIF_PROVIDER` | WIF provider resource name (above) |
| `WIF_SERVICE_ACCOUNT` | `tutorsnap-api@tutorsnap.iam.gserviceaccount.com` |
| `VITE_GOOGLE_CLIENT_ID` | `322472504855-1fsal4q80mm9dgijvutqdrnboprjkr27.apps.googleusercontent.com` |
| `VITE_API_BASE` | `https://tutorsnap-api-yfxhelshwq-el.a.run.app` |

(`FIREBASE_SERVICE_ACCOUNT` not needed — deploy-frontend uses WIF + firebase-tools ADC.)

---

## Download Android APK

After every push to `main`:
1. Go to GitHub → Actions → "Build Android APK" → latest run
2. Scroll to **Artifacts** → click `tutorsnap-debug-<sha>`
3. Unzip → `app-debug.apk`
4. Transfer to Android phone → install (allow "Install from unknown sources" in Settings)

---

## GCP Infrastructure

### Service Account IAM roles
`tutorsnap-api@tutorsnap.iam.gserviceaccount.com` has:
- `roles/artifactregistry.writer`
- `roles/cloudsql.client`
- `roles/firebase.admin`
- `roles/run.admin`
- `roles/run.developer`
- `roles/secretmanager.secretAccessor`
- `roles/storage.objectAdmin`

### Secret Manager secrets
| Secret | Purpose |
|---|---|
| `DATABASE_URL` | Cloud SQL connection string (socket path for Cloud Run) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `JWT_SECRET` | HS256 signing key |
| `ADMIN_EMAILS` | Comma-separated admin email list |
| `GCS_BUCKET_NAME` | `tutorsnap-uploads-tutorsnap` |
| `FRONTEND_URL` | `https://tutorsnap.web.app` (used in CORS) |

### Cloud SQL
- Instance: `tutorsnap-db` (PostgreSQL 15, `db-f1-micro`, `asia-south1`)
- Database: `tutorsnap`
- User: `tutorsnap_user`

---

## Project Structure

```
tutorsnap/
├── backend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/versions/       — DB migration files
│   ├── main.py                 — FastAPI app + all routes
│   ├── auth.py                 — Google OAuth + JWT
│   ├── database.py             — SQLAlchemy engine + session
│   ├── models.py               — ORM models (User, Session, Topic, …)
│   ├── ingestion.py            — PDF parse + Claude structuring
│   ├── session_engine.py       — question generation + hint logic
│   └── storage.py              — GCS + local dual-mode storage
├── frontend/
│   ├── src/
│   │   ├── api/client.js       — Axios + auth interceptors
│   │   ├── auth/               — AuthContext, ProtectedRoute
│   │   ├── pages/              — Admin, Parent, Student pages
│   │   └── components/         — ChatBubble, HintButton, ProgressBadge
│   ├── android/                — Capacitor Android project (committed)
│   ├── capacitor.config.ts
│   ├── firebase.json
│   └── .firebaserc
├── .github/workflows/
│   ├── deploy-backend.yml
│   ├── deploy-frontend.yml
│   └── build-android.yml
├── spec.md                     — original MVP build spec
├── auth_spec.md                — auth + admin + parent build spec
└── deploy_spec_v2.md           — GCP deployment spec
```

---

## Google OAuth Console — Required Origins

Make sure these are in **Authorised JavaScript origins** for your OAuth 2.0 Client:
```
http://localhost:5173
https://tutorsnap.web.app
https://tutorsnap-api-yfxhelshwq-el.a.run.app
```

And in **Authorised redirect URIs**:
```
http://localhost:5173
https://tutorsnap.web.app
```

---

## Cost Estimate (monthly, MVP scale)

| Service | Est. cost |
|---|---|
| Cloud Run (scales to zero) | $0–5 |
| Cloud SQL `db-f1-micro` | $7–10 |
| Cloud Storage (<1 GB) | $0 |
| Firebase Hosting | $0 |
| Artifact Registry (<1 GB) | $0 |
| GitHub Actions (free tier) | $0 |
| **Total** | **~$7–15** |
