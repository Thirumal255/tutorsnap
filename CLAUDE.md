# TutorSnap — Claude Code Guide

Read this before writing any code or running any commands.

---

## Project Overview

**StudyBlox** — AI-powered adaptive tutoring platform. Students practice curriculum topics, parents track progress, admins manage content.

- **Frontend** (React 18 + Vite): https://tutorsnap.web.app → `frontend/`
- **Tasks App** (Polyhouse Tracker): https://tutorsnap-tasks.web.app → `tasks-app/`
- **Backend API** (FastAPI): https://tutorsnap-api-5k4my6zffa-el.a.run.app → `backend/`
- **Admin panel**: https://tutorsnap.web.app/admin

---

## GCP Infrastructure

| Resource | Value |
|---|---|
| GCP Account | cloudforthirudec26@gmail.com |
| Project ID | tutorsnap-dec26 |
| Project Number | 844741348720 |
| Region | asia-south1 |
| Cloud Run service | tutorsnap-api |
| Cloud SQL instance | tutorsnap-db (PostgreSQL 15, db-f1-micro) |
| GCS bucket | gs://tutorsnap-dec26 |
| Artifact Registry | asia-south1-docker.pkg.dev/tutorsnap-dec26/tutorsnap/api |
| Service account | tutorsnap-api@tutorsnap-dec26.iam.gserviceaccount.com |
| Firebase (frontend) | tutorsnap (tutorsnap.web.app) |
| Firebase (tasks) | tutorsnap-tasks (tutorsnap-tasks.web.app) |

**Old project** `project-726f0196-ff7a-4360-ad1` (cloudforthiru@gmail.com) — billing disabled, resources dormant. Do not use.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI 0.115, Python 3.11, Uvicorn |
| ORM | SQLAlchemy 2.0, Alembic |
| Database | Cloud SQL PostgreSQL 15 |
| AI | Anthropic Claude (claude-sonnet-4-5-20250929 + claude-haiku-4-5-20251001) |
| Frontend | React 18, Vite 5, Tailwind CSS 3 |
| Mobile | Capacitor 8 (Android) |
| CI/CD | GitHub Actions (5 workflows) |
| Auth | Google OAuth 2.0 + HS256 JWT |

---

## Key Files

| File | Purpose |
|---|---|
| `backend/main.py` | FastAPI app, all API routes, CORS config |
| `backend/auth.py` | Google OAuth token verification, JWT creation |
| `backend/models.py` | SQLAlchemy ORM models |
| `backend/database.py` | Engine + session factory |
| `backend/ingestion.py` | PDF parse + Claude structuring |
| `backend/session_engine.py` | Adaptive Q&A, hints, vision |
| `frontend/src/api/client.js` | Axios instance + all API calls |
| `frontend/src/auth/AuthContext.jsx` | Auth state + ProtectedRoute |
| `.github/workflows/deploy-backend.yml` | Docker build → Cloud Run |
| `.github/workflows/deploy-frontend.yml` | Build → Firebase tutorsnap |
| `.github/workflows/deploy-tasks-app.yml` | Build → Firebase tutorsnap-tasks |

---

## CORS — Important

`backend/main.py` `_ALLOWED_ORIGINS` must include both Firebase URLs:
```python
"https://tutorsnap.web.app",
"https://tutorsnap.firebaseapp.com",
"https://tutorsnap-tasks.web.app",
"https://tutorsnap-tasks.firebaseapp.com",
```
Missing either one causes silent login failures for that app.

---

## Database

- Connection via Unix socket (Cloud SQL): `/cloudsql/tutorsnap-dec26:asia-south1:tutorsnap-db`
- DB password must be **alphanumeric only** — no `@`, `%`, `&`. These break Alembic's configparser `%`-interpolation.
- Run migrations: `alembic upgrade head` (done automatically by deploy-backend.yml via Cloud Run job)

---

## GitHub Secrets (Thirumal255/tutorsnap)

| Secret | Current Value |
|---|---|
| WIF_PROVIDER | projects/844741348720/.../github-pool/providers/github-provider |
| WIF_SERVICE_ACCOUNT | tutorsnap-api@tutorsnap-dec26.iam.gserviceaccount.com |
| VITE_API_BASE | https://tutorsnap-api-5k4my6zffa-el.a.run.app (TutorSnap frontend) |
| TASKS_APP_API_BASE | https://tutorsnap-api-5k4my6zffa-el.a.run.app (Tasks app) |
| VITE_GOOGLE_CLIENT_ID | 1042995821844-9vc7caio5at6cv4hkm0j4mvu30snet56.apps.googleusercontent.com |
| FIREBASE_TOKEN | CI token for tutorsnap Firebase project |
| FIREBASE_SERVICE_ACCOUNT_TASKS | JSON key for tutorsnap-tasks Firebase project |

**`VITE_API_BASE` and `TASKS_APP_API_BASE` are separate secrets** — both must be updated when the Cloud Run URL changes.

---

## Workload Identity Federation

Auth to GCP from GitHub Actions uses keyless WIF — no JSON key files.
- Pool: `github-pool`
- Provider: `github-provider` with condition `assertion.repository=='Thirumal255/tutorsnap'`
- IAM binding uses pool-wide `/*` principal (not per-repo) to avoid case-sensitivity issues
- SA needs 3 self-bindings: `workloadIdentityUser` + `serviceAccountTokenCreator` + `serviceAccountUser`

---

## User Roles

| Role | Access |
|---|---|
| admin | Full platform — upload books, manage students/parents, analytics |
| student | Practice sessions, progress, flashcards, exam mode |
| parent | Read-only dashboard for linked children |

Admin emails defined in `ADMIN_EMAILS` Secret Manager secret.

---

## Related Docs

- `spec.md` — full feature spec
- `auth_spec.md` — Google OAuth + role system spec
- `deploy_spec_v2.md` — GCP deployment spec (note: some commands use old project IDs — substitute tutorsnap-dec26)
- `CHANGELOG.md` — feature history
- `TutorSnap_Credentials.pdf` — full credentials + migration guide (NOT in git)
