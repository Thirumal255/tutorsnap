# TutorSnap — Runbook

Operational reference for common tasks. For full project context see `CLAUDE.md`. For deployment spec see `deploy_spec_v2.md`.

---

## GCP Projects

| Account | Project ID | Status |
|---|---|---|
| cloudforthirudec26@gmail.com | tutorsnap-dec26 | **Active (production)** |
| cloudforthiru@gmail.com | project-726f0196-ff7a-4360-ad1 | Dormant — billing disabled |

Console links:
- [Cloud Run](https://console.cloud.google.com/run?project=tutorsnap-dec26)
- [Cloud SQL](https://console.cloud.google.com/sql/instances?project=tutorsnap-dec26)
- [Secret Manager](https://console.cloud.google.com/security/secret-manager?project=tutorsnap-dec26)
- [Artifact Registry](https://console.cloud.google.com/artifacts?project=tutorsnap-dec26)
- [Logs](https://console.cloud.google.com/logs/query?project=tutorsnap-dec26)
- [Firebase tutorsnap](https://console.firebase.google.com/project/tutorsnap)
- [Firebase tutorsnap-tasks](https://console.firebase.google.com/project/tutorsnap-tasks)

---

## Live URLs

| Service | URL |
|---|---|
| TutorSnap frontend | https://tutorsnap.web.app |
| Polyhouse Tracker | https://tutorsnap-tasks.web.app |
| Backend API | https://tutorsnap-api-5k4my6zffa-el.a.run.app |
| Admin panel | https://tutorsnap.web.app/admin |

---

## Deployments

### Trigger a redeploy manually

```bash
# Backend
gh workflow run deploy-backend.yml --repo=Thirumal255/tutorsnap

# TutorSnap frontend
gh workflow run deploy-frontend.yml --repo=Thirumal255/tutorsnap

# Tasks app (Polyhouse Tracker)
gh workflow run deploy-tasks-app.yml --repo=Thirumal255/tutorsnap

# Android APK
gh workflow run build-android.yml --repo=Thirumal255/tutorsnap
```

### Watch a running workflow
```bash
gh run list --repo=Thirumal255/tutorsnap --limit=5
gh run watch <RUN_ID> --repo=Thirumal255/tutorsnap
```

### Check last deploy status
```bash
gh run list --repo=Thirumal255/tutorsnap --workflow=deploy-backend.yml --limit=3
```

---

## Cloud Run

### Check service status
```bash
gcloud run services describe tutorsnap-api \
  --region=asia-south1 \
  --project=tutorsnap-dec26 \
  --account=cloudforthirudec26@gmail.com \
  --format="value(status.url, status.conditions[0].status)"
```

### View live logs
```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=tutorsnap-api" \
  --project=tutorsnap-dec26 \
  --account=cloudforthirudec26@gmail.com \
  --limit=50 \
  --format="table(timestamp, httpRequest.status, httpRequest.requestUrl, textPayload)"
```

### View error logs only
```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=tutorsnap-api AND severity>=ERROR" \
  --project=tutorsnap-dec26 \
  --account=cloudforthirudec26@gmail.com \
  --limit=20
```

### Quick health check
```bash
curl https://tutorsnap-api-5k4my6zffa-el.a.run.app/
# Expect: {"detail":"Not Found"} — means the container is up
```

---

## Database (Cloud SQL)

### Connection details
| Field | Value |
|---|---|
| Instance | tutorsnap-db |
| Region | asia-south1-c |
| Tier | db-f1-micro |
| Public IP | 8.234.114.151 |
| Database | tutorsnap |
| User | tutorsnap-user |
| Socket | /cloudsql/tutorsnap-dec26:asia-south1:tutorsnap-db |

### Run Alembic migrations manually
```bash
# Execute the pre-existing migration Cloud Run job
gcloud run jobs execute tutorsnap-migrate \
  --region=asia-south1 \
  --project=tutorsnap-dec26 \
  --account=cloudforthirudec26@gmail.com \
  --wait
```

### Reset DB user password (if needed)
```bash
# Use alphanumeric only — NO @, %, & (breaks Alembic configparser)
gcloud sql users set-password tutorsnap-user \
  --instance=tutorsnap-db \
  --password=NewPassword123 \
  --project=tutorsnap-dec26 \
  --account=cloudforthirudec26@gmail.com

# Then update DATABASE_URL secret
echo -n "postgresql://tutorsnap-user:NewPassword123@/tutorsnap?host=/cloudsql/tutorsnap-dec26:asia-south1:tutorsnap-db" | \
  gcloud secrets versions add DATABASE_URL --data-file=- \
  --project=tutorsnap-dec26 \
  --account=cloudforthirudec26@gmail.com
```

### List instances
```bash
gcloud sql instances list \
  --project=tutorsnap-dec26 \
  --account=cloudforthirudec26@gmail.com
```

---

## Secret Manager

### Read a secret value
```bash
gcloud secrets versions access latest \
  --secret=SECRET_NAME \
  --project=tutorsnap-dec26 \
  --account=cloudforthirudec26@gmail.com
```

### Update a secret value
```bash
echo -n "new-value-here" | gcloud secrets versions add SECRET_NAME \
  --data-file=- \
  --project=tutorsnap-dec26 \
  --account=cloudforthirudec26@gmail.com
```

### List all secrets
```bash
gcloud secrets list \
  --project=tutorsnap-dec26 \
  --account=cloudforthirudec26@gmail.com
```

### All secrets in this project
| Secret | Purpose |
|---|---|
| DATABASE_URL | Cloud SQL socket connection string |
| ANTHROPIC_API_KEY | Claude API key |
| GOOGLE_CLIENT_ID | Primary OAuth client ID |
| GOOGLE_CLIENT_IDS | All OAuth client IDs (comma-separated) |
| GOOGLE_CLIENT_SECRET | OAuth client secret |
| JWT_SECRET | HS256 signing key |
| SEED_SECRET | DB seed endpoint auth |
| ADMIN_EMAILS | Comma-separated admin email addresses |
| GCS_BUCKET_NAME | `tutorsnap-dec26` |
| FRONTEND_URL | `https://tutorsnap-tasks.web.app` (CORS) |
| MOBILE_API_KEY | Bearer token for Android app auth |
| MOBILE_API_EMAIL | Email for mobile API user lookup |
| TELEGRAM_BOT_TOKEN | TutorSnap Telegram bot |
| TELEGRAM_CHAT_ID | TutorSnap Telegram chat |
| TASK_TELEGRAM_BOT_TOKEN | Tasks app Telegram bot |
| TASK_TELEGRAM_CHAT_ID | Tasks app Telegram chat |

---

## GitHub Secrets

### Update a GitHub secret
```bash
echo -n "new-value" | gh secret set SECRET_NAME --repo=Thirumal255/tutorsnap
```

### List all secrets (names only)
```bash
gh secret list --repo=Thirumal255/tutorsnap
```

### Current secrets
| Secret | Notes |
|---|---|
| WIF_PROVIDER | `projects/844741348720/.../github-pool/providers/github-provider` |
| WIF_SERVICE_ACCOUNT | `tutorsnap-api@tutorsnap-dec26.iam.gserviceaccount.com` |
| VITE_API_BASE | New Cloud Run URL — TutorSnap frontend build |
| TASKS_APP_API_BASE | New Cloud Run URL — Tasks app build (separate secret!) |
| VITE_GOOGLE_CLIENT_ID | OAuth client ID for frontend |
| GOOGLE_CLIENT_ID_WEB | OAuth client ID for tasks app |
| MOBILE_API_KEY | Same as Secret Manager value |
| FIREBASE_TOKEN | CI token for `tutorsnap` Firebase project |
| FIREBASE_SERVICE_ACCOUNT_TASKS | JSON key for `tutorsnap-tasks` Firebase project |

---

## Firebase

### Regenerate FIREBASE_TOKEN (if expired)
```bash
# Log in as cloudforthirudec26@gmail.com
firebase login:ci --no-localhost
# Copy the token and update the GitHub secret:
echo -n "TOKEN_HERE" | gh secret set FIREBASE_TOKEN --repo=Thirumal255/tutorsnap
```

### Regenerate FIREBASE_SERVICE_ACCOUNT_TASKS (if key revoked)
1. Go to [console.firebase.google.com/project/tutorsnap-tasks](https://console.firebase.google.com/project/tutorsnap-tasks)
2. Project settings → Service accounts → Generate new private key
3. Download JSON and update GitHub secret:
```bash
gh secret set FIREBASE_SERVICE_ACCOUNT_TASKS \
  --repo=Thirumal255/tutorsnap \
  --body "$(cat path/to/downloaded-key.json)"
```

---

## Cloud Scheduler

```bash
# List jobs
gcloud scheduler jobs list \
  --location=asia-south1 \
  --project=tutorsnap-dec26 \
  --account=cloudforthirudec26@gmail.com

# Trigger manually
gcloud scheduler jobs run tutorsnap-task-digest \
  --location=asia-south1 \
  --project=tutorsnap-dec26 \
  --account=cloudforthirudec26@gmail.com
```

Job: `tutorsnap-task-digest` — runs daily at 07:00 IST → `POST /api/admin/tasks/notify`

---

## Billing

### Check billing status across all projects
```bash
# Active account (production)
for p in tutorsnap-dec26 tapncollect-dev project-7dada17d-187b-42cd-bab; do
  echo -n "$p: "
  gcloud billing projects describe $p \
    --account=cloudforthirudec26@gmail.com \
    --format="value(billingEnabled)"
done

# Old account (should all be false)
for p in project-726f0196-ff7a-4360-ad1 tapncollect-prod; do
  echo -n "$p: "
  gcloud billing projects describe $p \
    --account=cloudforthiru@gmail.com \
    --format="value(billingEnabled)"
done
```

### Disable billing on a project
```bash
gcloud billing projects unlink PROJECT_ID --account=OWNER_ACCOUNT@gmail.com
```

---

## CORS — Known Gotcha

`backend/main.py` `_ALLOWED_ORIGINS` must include **both** Firebase app URLs:

```python
"https://tutorsnap.web.app",        # TutorSnap frontend
"https://tutorsnap.firebaseapp.com",
"https://tutorsnap-tasks.web.app",  # Polyhouse Tracker
"https://tutorsnap-tasks.firebaseapp.com",
```

Missing `tutorsnap.web.app` → TutorSnap login silently fails ("Login failed. Please try again.").
After editing, push to main — backend redeploys automatically.

---

## Download Android APK

1. GitHub → [Actions → Build Android APK](https://github.com/Thirumal255/tutorsnap/actions/workflows/build-android.yml) → latest run
2. Scroll to **Artifacts** → click `PolyhouseTracker-<sha>`
3. Unzip → install `PolyhouseTracker.apk` (enable "Install from unknown sources" on Android)
