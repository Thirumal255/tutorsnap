# TutorSnap — Deployment Spec v2
# Addendum to spec.md + auth_spec.md
# For Claude Code — GCP Cloud Deployment + Android APK via GitHub Actions
# Read spec.md and auth_spec.md first, then this file
# REPLACES deploy_spec.md entirely

---

## CRITICAL INSTRUCTIONS

1. Read spec.md and auth_spec.md fully before starting
2. Do not break any existing working code
3. Build in exact phase order below
4. All secrets go in GCP Secret Manager + GitHub Secrets — never in code or Dockerfiles
5. Test each phase before moving to the next
6. No Android Studio required — APK is built entirely by GitHub Actions

---

## 1. OVERVIEW

### What gets built
- Backend: Dockerised FastAPI deployed to GCP Cloud Run
- Database: Local PostgreSQL migrated to GCP Cloud SQL (PostgreSQL)
- File storage: PDF uploads moved from local folder to GCP Cloud Storage
- Frontend web: Built as static files, deployed to Firebase Hosting
- Android APK: Built by GitHub Actions on every push — no Android Studio needed
- CI/CD: GitHub Actions — push to main → auto deploys backend + frontend + APK

### GCP services used
| Service | Purpose |
|---|---|
| Cloud Run | Backend FastAPI container |
| Cloud SQL (PostgreSQL 15) | Production database |
| Cloud Storage | PDF file storage |
| Artifact Registry | Docker image storage |
| Secret Manager | All environment secrets |
| Firebase Hosting | Frontend static hosting (free) |

### Final URLs + artifacts
- Backend API: https://tutorsnap-api-xxxx-uc.a.run.app
- Frontend web: https://tutorsnap-xxxx.web.app
- Android APK: downloadable from GitHub Actions → Artifacts on every push

---

## 2. PROJECT STRUCTURE ADDITIONS

Add these to the existing project. Nothing existing is removed.

```
tutorsnap/
├── backend/
│   ├── Dockerfile                       # NEW
│   ├── .dockerignore                    # NEW
│   ├── storage.py                       # NEW — GCS + local dual mode
│   └── ... (all existing files unchanged)
├── frontend/
│   ├── capacitor.config.ts              # NEW
│   ├── .env.production                  # NEW
│   ├── firebase.json                    # NEW
│   ├── .firebaserc                      # NEW
│   └── ... (all existing files unchanged)
├── .github/
│   └── workflows/
│       ├── deploy-backend.yml           # NEW
│       ├── deploy-frontend.yml          # NEW
│       └── build-android.yml            # NEW
└── deploy_spec.md                       # this file
```

---

## 3. BACKEND DOCKER

### backend/Dockerfile
```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p uploads

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### backend/.dockerignore
```
.env
__pycache__/
*.pyc
*.pyo
uploads/
.venv/
venv/
alembic/versions/__pycache__/
```

---

## 4. BACKEND STORAGE — DUAL MODE (LOCAL + GCS)

### backend/storage.py (new file)

```python
import os
import tempfile
from fastapi import UploadFile

USE_GCS = os.getenv("USE_GCS", "false").lower() == "true"
BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "tutorsnap-uploads")

def save_upload(file: UploadFile, filename: str) -> str:
    """
    Local dev: saves to uploads/ folder, returns local path
    Production: uploads to GCS, returns gs:// path
    """
    if USE_GCS:
        from google.cloud import storage
        client = storage.Client()
        bucket = client.bucket(BUCKET_NAME)
        blob = bucket.blob(f"uploads/{filename}")
        file.file.seek(0)
        blob.upload_from_file(file.file, content_type="application/pdf")
        return f"gs://{BUCKET_NAME}/uploads/{filename}"
    else:
        upload_dir = os.getenv("UPLOAD_DIR", "uploads")
        os.makedirs(upload_dir, exist_ok=True)
        filepath = os.path.join(upload_dir, filename)
        file.file.seek(0)
        with open(filepath, "wb") as f:
            f.write(file.file.read())
        return filepath

def get_local_path(filepath: str) -> str:
    """
    For ingestion pipeline:
    - If GCS path: download to temp file, return temp path
    - If local path: return as-is
    """
    if filepath.startswith("gs://"):
        from google.cloud import storage
        parts = filepath.replace("gs://", "").split("/", 1)
        bucket_name = parts[0]
        blob_path = parts[1]
        client = storage.Client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        blob.download_to_filename(tmp.name)
        tmp.close()
        return tmp.name
    return filepath

def cleanup_temp(filepath: str):
    """Remove temp file after ingestion if it was downloaded from GCS"""
    if filepath.startswith("/tmp/"):
        try:
            os.unlink(filepath)
        except Exception:
            pass
```

### Update backend/ingestion.py

In `run_ingestion()`, wrap parse_pdf call with get_local_path:

```python
from storage import get_local_path, cleanup_temp

def run_ingestion(book_id: int, filepath: str, db: Session):
    try:
        book = db.query(Book).filter(Book.id == book_id).first()
        book.ingestion_status = "processing"
        db.commit()

        # Download from GCS if needed
        local_path = get_local_path(filepath)

        try:
            chunks = parse_pdf(local_path)
        finally:
            cleanup_temp(local_path)  # clean up temp file if GCS download

        # ... rest of existing ingestion logic unchanged
```

### Update backend/requirements.txt — add
```
google-cloud-storage==2.18.2
```

### Update backend/main.py — import and use storage.py

In the upload route, replace direct file save with:
```python
from storage import save_upload

# In POST /api/upload:
filepath = save_upload(file, file.filename)
```

### Update backend/main.py — CORS for production

```python
import os

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    os.getenv("FRONTEND_URL", ""),        # Firebase Hosting URL
    "capacitor://localhost",              # Capacitor Android
    "http://localhost",                   # Capacitor Android fallback
    "https://localhost",                  # Capacitor Android HTTPS
]
# Filter empty strings
ALLOWED_ORIGINS = [o for o in ALLOWED_ORIGINS if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Add FRONTEND_URL to Secret Manager and Cloud Run env vars after Firebase deploy.

---

## 5. GCP INFRASTRUCTURE SETUP

Claude Code runs all of these gcloud commands. Replace PROJECT_ID with actual value.

### Step 1 — Enable APIs
```bash
gcloud config set project PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  sql-component.googleapis.com \
  sqladmin.googleapis.com \
  sqladmin.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com
```

### Step 2 — Artifact Registry
```bash
gcloud artifacts repositories create tutorsnap \
  --repository-format=docker \
  --location=asia-south1 \
  --description="TutorSnap Docker images"
```

### Step 3 — Cloud SQL
```bash
# Create instance (takes 3-5 minutes)
gcloud sql instances create tutorsnap-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=asia-south1 \
  --storage-auto-increase \
  --storage-size=10GB \
  --no-backup

# Create database
gcloud sql databases create tutorsnap --instance=tutorsnap-db

# Create user (replace STRONG_PASSWORD with generated password)
gcloud sql users create tutorsnap_user \
  --instance=tutorsnap-db \
  --password=STRONG_PASSWORD

# Get connection name — save this output
gcloud sql instances describe tutorsnap-db \
  --format="value(connectionName)"
```

### Step 4 — Cloud Storage
```bash
gsutil mb -l asia-south1 gs://tutorsnap-uploads-PROJECT_ID
gsutil uniformbucketlevelaccess set on gs://tutorsnap-uploads-PROJECT_ID
```

### Step 5 — Service Account
```bash
gcloud iam service-accounts create tutorsnap-api \
  --display-name="TutorSnap API"

SA="tutorsnap-api@PROJECT_ID.iam.gserviceaccount.com"

# Grant Cloud SQL access
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:$SA" \
  --role="roles/cloudsql.client"

# Grant Secret Manager access
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:$SA" \
  --role="roles/secretmanager.secretAccessor"

# Grant Cloud Storage access
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:$SA" \
  --role="roles/storage.objectAdmin"
```

### Step 6 — Secret Manager
```bash
# DATABASE_URL — uses Cloud SQL socket format for Cloud Run
# Replace PROJECT_ID, STRONG_PASSWORD with real values
echo -n "postgresql+psycopg2://tutorsnap_user:STRONG_PASSWORD@/tutorsnap?host=/cloudsql/PROJECT_ID:asia-south1:tutorsnap-db" \
  | gcloud secrets create DATABASE_URL --data-file=-

# Copy value from your backend/.env
echo -n "sk-ant-your-anthropic-key" \
  | gcloud secrets create ANTHROPIC_API_KEY --data-file=-

echo -n "your-google-client-id.apps.googleusercontent.com" \
  | gcloud secrets create GOOGLE_CLIENT_ID --data-file=-

echo -n "your-google-client-secret" \
  | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=-

echo -n "your-32-char-jwt-secret" \
  | gcloud secrets create JWT_SECRET --data-file=-

echo -n "thirumalreddym1982@gmail.com" \
  | gcloud secrets create ADMIN_EMAILS --data-file=-

echo -n "tutorsnap-uploads-PROJECT_ID" \
  | gcloud secrets create GCS_BUCKET_NAME --data-file=-
```

---

## 6. BACKEND — BUILD AND DEPLOY TO CLOUD RUN

```bash
cd backend

# Authenticate Docker with Artifact Registry
gcloud auth configure-docker asia-south1-docker.pkg.dev --quiet

# Build image
docker build -t asia-south1-docker.pkg.dev/PROJECT_ID/tutorsnap/api:latest .

# Push image
docker push asia-south1-docker.pkg.dev/PROJECT_ID/tutorsnap/api:latest

# Deploy to Cloud Run
gcloud run deploy tutorsnap-api \
  --image=asia-south1-docker.pkg.dev/PROJECT_ID/tutorsnap/api:latest \
  --region=asia-south1 \
  --platform=managed \
  --allow-unauthenticated \
  --service-account=tutorsnap-api@PROJECT_ID.iam.gserviceaccount.com \
  --add-cloudsql-instances=PROJECT_ID:asia-south1:tutorsnap-db \
  --set-secrets="\
DATABASE_URL=DATABASE_URL:latest,\
ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,\
GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,\
GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,\
JWT_SECRET=JWT_SECRET:latest,\
ADMIN_EMAILS=ADMIN_EMAILS:latest,\
GCS_BUCKET_NAME=GCS_BUCKET_NAME:latest" \
  --set-env-vars="\
CLAUDE_MODEL=claude-sonnet-4-20250514,\
USE_GCS=true,\
MAX_HINT_TIERS=5,\
JWT_EXPIRY_HOURS=72" \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10 \
  --port=8080

# Save the deployed URL — looks like:
# https://tutorsnap-api-xxxx-el.a.run.app
```

### Run Alembic migrations via Cloud Run Job
```bash
# Create migration job
gcloud run jobs create tutorsnap-migrate \
  --image=asia-south1-docker.pkg.dev/PROJECT_ID/tutorsnap/api:latest \
  --region=asia-south1 \
  --service-account=tutorsnap-api@PROJECT_ID.iam.gserviceaccount.com \
  --add-cloudsql-instances=PROJECT_ID:asia-south1:tutorsnap-db \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest" \
  --command="python" \
  --args="-m,alembic,upgrade,head"

# Execute it
gcloud run jobs execute tutorsnap-migrate \
  --region=asia-south1 \
  --wait
```

### Verify backend is live
```bash
curl https://YOUR_CLOUD_RUN_URL/api/books
# Should return: {"detail": "Not authenticated"} or [] — either means it's running
```

---

## 7. FRONTEND — PRODUCTION BUILD + FIREBASE HOSTING

### frontend/.env.production (create this file)
```
VITE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
VITE_API_BASE=https://tutorsnap-api-xxxx-el.a.run.app
```
Replace with your actual Cloud Run URL.

### Update frontend/src/api/client.js
Change baseURL:
```javascript
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
})
```

### Install Firebase CLI and initialize
```bash
npm install -g firebase-tools
firebase login --no-localhost

cd frontend
firebase init hosting
# Prompts:
# ? Please select an option: Use an existing project (or create new)
# ? Select a default Firebase project: tutorsnap (or your project)
# ? What do you want to use as your public directory? dist
# ? Configure as a single-page app? Yes
# ? Set up automatic builds with GitHub? No
# ? File dist/index.html already exists. Overwrite? No
```

### frontend/firebase.json (verify after init, update if needed)
```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }],
    "headers": [
      {
        "source": "**/*.@(js|css|woff2)",
        "headers": [{ "key": "Cache-Control", "value": "max-age=31536000" }]
      }
    ]
  }
}
```

### Build and deploy frontend (first time, manual)
```bash
cd frontend
npm run build
firebase deploy --only hosting
# Note the Hosting URL: https://tutorsnap-xxxx.web.app
```

### Update FRONTEND_URL secret in GCP + redeploy backend
```bash
echo -n "https://tutorsnap-xxxx.web.app" \
  | gcloud secrets create FRONTEND_URL --data-file=-

gcloud run services update tutorsnap-api \
  --region=asia-south1 \
  --update-secrets="FRONTEND_URL=FRONTEND_URL:latest"
```

### Update Google OAuth Console
```
console.cloud.google.com
→ APIs & Services → Credentials → your OAuth 2.0 Client ID → Edit
→ Authorised JavaScript origins:
    ADD: https://tutorsnap-xxxx.web.app
→ Authorised redirect URIs:
    ADD: https://tutorsnap-xxxx.web.app
→ Save
```

### Verify frontend works
Open https://tutorsnap-xxxx.web.app → login → full session → confirm API calls
go to Cloud Run URL (not localhost).

---

## 8. CAPACITOR SETUP (Android wrapper)

No Android Studio needed. Capacitor wraps the React build into an Android project.
GitHub Actions will build the APK.

### Install Capacitor packages
```bash
cd frontend
npm install @capacitor/core @capacitor/cli @capacitor/android
npm install @capacitor/google-auth
```

### Initialize Capacitor
```bash
cd frontend
npx cap init TutorSnap com.tutorsnap.app --web-dir=dist
```

### frontend/capacitor.config.ts (create/update to exactly this)
```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tutorsnap.app',
  appName: 'TutorSnap',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // In production the app loads from bundled assets, not a live URL
    // Remove the url property entirely for production APK
  },
  plugins: {
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: 'YOUR_GOOGLE_CLIENT_ID',
      forceCodeForRefreshToken: true,
    }
  }
};

export default config;
```
Replace YOUR_GOOGLE_CLIENT_ID with actual value.

### Add Android platform
```bash
cd frontend
npx cap add android
```

This creates the `android/` directory. Commit it — GitHub Actions needs it.

### Update frontend/src/pages/Login.jsx for native Google Sign-In

Add platform detection at the top of the component:
```jsx
import { Capacitor } from '@capacitor/core'

// Inside Login component, add this handler:
const handleNativeGoogleLogin = async () => {
  try {
    const { GoogleAuth } = await import('@capacitor/google-auth')
    await GoogleAuth.initialize()
    const result = await GoogleAuth.signIn()
    const idToken = result.authentication.idToken

    const res = await googleLogin(idToken)
    login(res.data.user, res.data.access_token)
    redirectByRole(res.data.user.role)
  } catch (err) {
    setError('Login failed. Please try again.')
    console.error(err)
  }
}

// In JSX, render based on platform:
const isNative = Capacitor.isNativePlatform()

return (
  // ... existing layout ...
  {isNative ? (
    <button
      onClick={handleNativeGoogleLogin}
      className="flex items-center gap-3 bg-white border border-gray-300 rounded-lg px-6 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors w-full justify-center"
    >
      <img src="https://developers.google.com/identity/images/g-logo.png" className="w-5 h-5" />
      Sign in with Google
    </button>
  ) : (
    <GoogleLogin
      onSuccess={...existing handler...}
      onError={...existing handler...}
    />
  )}
)
```

### Sync and verify Android project builds locally (optional — CI will do this)
```bash
cd frontend
npm run build
npx cap sync android
# Should complete without errors
```

### android/app/src/main/res/values/strings.xml (update after cap add android)
```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">TutorSnap</string>
    <string name="server_client_id">YOUR_GOOGLE_CLIENT_ID</string>
    <string name="custom_url_scheme">com.tutorsnap.app</string>
</resources>
```

### Commit the entire android/ directory
```bash
git add android/
git commit -m "Add Capacitor Android project"
git push
```

---

## 9. GITHUB ACTIONS — THREE WORKFLOWS

### Workflow 1: .github/workflows/deploy-backend.yml
Triggers on push to main when backend files change.
Builds Docker image, pushes to Artifact Registry, deploys to Cloud Run.

```yaml
name: Deploy Backend

on:
  push:
    branches: [main]
    paths:
      - 'backend/**'
      - '.github/workflows/deploy-backend.yml'

env:
  PROJECT_ID: YOUR_GCP_PROJECT_ID
  REGION: asia-south1
  IMAGE: asia-south1-docker.pkg.dev/YOUR_GCP_PROJECT_ID/tutorsnap/api

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Authenticate to GCP
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker for Artifact Registry
        run: gcloud auth configure-docker asia-south1-docker.pkg.dev --quiet

      - name: Build Docker image
        run: |
          docker build \
            -t $IMAGE:${{ github.sha }} \
            -t $IMAGE:latest \
            ./backend

      - name: Push Docker image
        run: |
          docker push $IMAGE:${{ github.sha }}
          docker push $IMAGE:latest

      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy tutorsnap-api \
            --image=$IMAGE:${{ github.sha }} \
            --region=$REGION \
            --platform=managed \
            --quiet

      - name: Run database migrations
        run: |
          gcloud run jobs update tutorsnap-migrate \
            --image=$IMAGE:${{ github.sha }} \
            --region=$REGION \
            --quiet || true
          gcloud run jobs execute tutorsnap-migrate \
            --region=$REGION \
            --wait
```

### Workflow 2: .github/workflows/deploy-frontend.yml
Triggers on push to main when frontend files change.
Builds React app, deploys to Firebase Hosting.

```yaml
name: Deploy Frontend

on:
  push:
    branches: [main]
    paths:
      - 'frontend/**'
      - '!frontend/android/**'
      - '.github/workflows/deploy-frontend.yml'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        working-directory: frontend
        run: npm ci

      - name: Build
        working-directory: frontend
        env:
          VITE_GOOGLE_CLIENT_ID: ${{ secrets.VITE_GOOGLE_CLIENT_ID }}
          VITE_API_BASE: ${{ secrets.VITE_API_BASE }}
        run: npm run build

      - name: Deploy to Firebase Hosting
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          channelId: live
          projectId: YOUR_FIREBASE_PROJECT_ID
          entryPoint: ./frontend
```

### Workflow 3: .github/workflows/build-android.yml
Triggers on push to main when frontend files change.
Builds debug APK, uploads as downloadable GitHub Actions artifact.
No Android Studio. No local SDK needed.

```yaml
name: Build Android APK

on:
  push:
    branches: [main]
    paths:
      - 'frontend/**'
      - '.github/workflows/build-android.yml'

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Setup Java 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Install frontend dependencies
        working-directory: frontend
        run: npm ci

      - name: Build React app
        working-directory: frontend
        env:
          VITE_GOOGLE_CLIENT_ID: ${{ secrets.VITE_GOOGLE_CLIENT_ID }}
          VITE_API_BASE: ${{ secrets.VITE_API_BASE }}
        run: npm run build

      - name: Sync Capacitor
        working-directory: frontend
        run: npx cap sync android

      - name: Make Gradle executable
        working-directory: frontend/android
        run: chmod +x gradlew

      - name: Build debug APK
        working-directory: frontend/android
        run: ./gradlew assembleDebug --no-daemon

      - name: Upload APK artifact
        uses: actions/upload-artifact@v4
        with:
          name: tutorsnap-debug-${{ github.sha }}
          path: frontend/android/app/build/outputs/apk/debug/app-debug.apk
          retention-days: 30

      - name: Comment APK download link on commit
        uses: actions/github-script@v7
        with:
          script: |
            const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
            console.log(`APK built successfully. Download from: ${runUrl}`)
```

---

## 10. WORKLOAD IDENTITY FEDERATION (keyless GCP auth for GitHub Actions)

No service account key files needed. Uses OIDC tokens.

```bash
# Get project number
PROJECT_NUMBER=$(gcloud projects describe PROJECT_ID --format="value(projectNumber)")

# Create Workload Identity Pool
gcloud iam workload-identity-pools create github-pool \
  --location=global \
  --display-name="GitHub Actions Pool"

# Create OIDC provider
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-condition="assertion.ref == 'refs/heads/main'"

# Allow GitHub Actions to impersonate the service account
# Replace YOUR_GITHUB_USERNAME and YOUR_REPO_NAME
gcloud iam service-accounts add-iam-policy-binding \
  tutorsnap-api@PROJECT_ID.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/YOUR_GITHUB_USERNAME/tutorsnap"

# Get the WIF provider resource name — save this for GitHub Secrets
gcloud iam workload-identity-pools providers describe github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --format="value(name)"
# Output: projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider
```

---

## 11. GITHUB SECRETS TO ADD

Go to: GitHub repo → Settings → Secrets and variables → Actions → New repository secret

| Secret name | Value |
|---|---|
| WIF_PROVIDER | projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider |
| WIF_SERVICE_ACCOUNT | tutorsnap-api@PROJECT_ID.iam.gserviceaccount.com |
| FIREBASE_SERVICE_ACCOUNT | JSON content from Firebase Console → Project Settings → Service Accounts → Generate new private key |
| VITE_GOOGLE_CLIENT_ID | your-google-client-id.apps.googleusercontent.com |
| VITE_API_BASE | https://tutorsnap-api-xxxx-el.a.run.app |

### How to get FIREBASE_SERVICE_ACCOUNT
```
Firebase Console → tutorsnap project
→ Project Settings (gear icon)
→ Service accounts tab
→ "Generate new private key"
→ Download JSON file
→ Copy entire JSON contents → paste as secret value
```

---

## 12. HOW TO DOWNLOAD THE APK

After every push to main:

```
GitHub → your repo → Actions tab
→ "Build Android APK" workflow → latest run
→ Scroll to bottom → Artifacts section
→ Click "tutorsnap-debug-abc1234" → downloads zip
→ Unzip → app-debug.apk
→ Transfer to Android phone → install
```

On Android phone, before installing:
```
Settings → Apps → Special app access → Install unknown apps
→ Allow from Files or your browser
```

---

## 13. BUILD ORDER FOR CLAUDE CODE

### PHASE A — Backend Docker + storage
1. Create backend/Dockerfile
2. Create backend/.dockerignore
3. Create backend/storage.py
4. Update backend/ingestion.py to use get_local_path() + cleanup_temp()
5. Update backend/main.py upload route to use save_upload() from storage.py
6. Update backend/main.py CORS to use FRONTEND_URL env var
7. Add google-cloud-storage to backend/requirements.txt
8. Build Docker image locally to verify: docker build -t tutorsnap-api ./backend
9. VERIFY: docker run --env-file .env -p 8080:8080 tutorsnap-api starts without errors

### PHASE B — GCP infrastructure
10. Run all gcloud commands from Section 5 in order (APIs, Artifact Registry, Cloud SQL, GCS, Service Account, Secrets)
11. VERIFY: gcloud sql instances list shows RUNNABLE
12. VERIFY: gcloud secrets list shows all 7 secrets

### PHASE C — Deploy backend to Cloud Run
13. Push Docker image to Artifact Registry
14. Deploy to Cloud Run with all flags from Section 6
15. Create and run migration job
16. VERIFY: curl https://CLOUD_RUN_URL/api/books returns valid response

### PHASE D — Frontend production + Firebase
17. Create frontend/.env.production with Cloud Run URL
18. Update frontend/src/api/client.js baseURL
19. Install Firebase CLI, initialize hosting
20. Build frontend: npm run build
21. Deploy: firebase deploy --only hosting
22. Note Firebase URL, update FRONTEND_URL secret, update Google OAuth console
23. VERIFY: open Firebase URL → full login + session works end to end

### PHASE E — Capacitor Android setup
24. Install Capacitor packages
25. Run npx cap init
26. Create capacitor.config.ts
27. Run npx cap add android
28. Update Login.jsx with native Google Sign-In detection
29. Update android/app/src/main/res/values/strings.xml
30. Build and sync: npm run build && npx cap sync android
31. Commit android/ directory to git
32. VERIFY: npx cap sync android completes without errors

### PHASE F — GitHub Actions workflows
33. Create .github/workflows/deploy-backend.yml
34. Create .github/workflows/deploy-frontend.yml
35. Create .github/workflows/build-android.yml
36. Set up Workload Identity Federation (Section 10)
37. Add all GitHub Secrets (Section 11)
38. Push everything to main
39. VERIFY: all 3 workflow runs complete green in GitHub Actions
40. VERIFY: APK artifact appears in build-android workflow run
41. Download APK, install on Android device, complete full session

---

## 14. ENVIRONMENT VARIABLES — FULL SUMMARY

| Variable | Local (.env) | Cloud Run | GitHub Actions |
|---|---|---|---|
| DATABASE_URL | postgres://localhost/tutorsnap | Secret Manager | — |
| ANTHROPIC_API_KEY | sk-ant-... | Secret Manager | — |
| GOOGLE_CLIENT_ID | from console | Secret Manager | — |
| GOOGLE_CLIENT_SECRET | from console | Secret Manager | — |
| JWT_SECRET | random string | Secret Manager | — |
| ADMIN_EMAILS | your email | Secret Manager | — |
| GCS_BUCKET_NAME | — | Secret Manager | — |
| FRONTEND_URL | — | Secret Manager | — |
| USE_GCS | false | true (env var) | — |
| CLAUDE_MODEL | claude-sonnet-4-20250514 | env var | — |
| VITE_GOOGLE_CLIENT_ID | frontend/.env | — | GitHub Secret |
| VITE_API_BASE | /api (proxy) | — | GitHub Secret |

---

## 15. COST ESTIMATE (monthly, MVP scale)

| Service | Spec | Est. cost |
|---|---|---|
| Cloud Run | scales to zero, 1GB RAM | $0–5 |
| Cloud SQL | db-f1-micro, 10GB | $7–10 |
| Cloud Storage | <1GB PDFs | $0 |
| Artifact Registry | <1GB images | $0 |
| Firebase Hosting | free tier | $0 |
| Secret Manager | <10k accesses/month | $0 |
| GitHub Actions | free tier (2000 min/month) | $0 |
| **Total** | | **~$7–15/month** |

---

## 16. COMMON MISTAKES TO AVOID

- Do NOT commit backend/.env — it is gitignored
- Do NOT commit android/local.properties — add to .gitignore
- Do NOT put ANTHROPIC_API_KEY in Dockerfile or workflow yml files
- Do NOT forget to commit the android/ folder — CI needs it to build APK
- Do NOT forget capacitor://localhost in CORS origins — Android app needs it
- Do NOT use db-f1-micro for >50 concurrent students — upgrade to db-g1-small
- DO run migration job after every backend deployment
- DO add Firebase URL to Google OAuth Console authorised origins before testing login
- DO set androidScheme: 'https' in capacitor.config.ts — required for Google OAuth on Android
- DO add android/local.properties to .gitignore (contains local SDK path)
- DO use --no-daemon flag in Gradle build on CI — prevents memory issues
