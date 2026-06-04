#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — Run this against your NEW GCP project
# Sets up all infrastructure: APIs, SQL, Artifact Registry, SA, WIF, Secrets.
# ─────────────────────────────────────────────────────────────────────────────
set -e

# ── CONFIG — fill these in ────────────────────────────────────────────────────
NEW_PROJECT="FILL_ME_IN"          # ← your new GCP project ID
REGION="asia-south1"
GITHUB_REPO="Thirumal255/tutorsnap"
DB_INSTANCE="tutorsnap-db"
DB_NAME="tutorsnap"
DB_USER="tutorsnap"
# ─────────────────────────────────────────────────────────────────────────────

if [ "$NEW_PROJECT" = "FILL_ME_IN" ]; then
  echo "❌ ERROR: Set NEW_PROJECT at the top of this script before running."
  exit 1
fi

SA="${NEW_PROJECT}@${NEW_PROJECT}.iam.gserviceaccount.com"
SA_NAME="tutorsnap-api"
SA_EMAIL="${SA_NAME}@${NEW_PROJECT}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${NEW_PROJECT}/tutorsnap/api"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TutorSnap — Setup new project: $NEW_PROJECT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

gcloud config set project "$NEW_PROJECT"

# ── 1. Enable required APIs ───────────────────────────────────────────────────
echo ""
echo "▶ Enabling APIs (takes ~60 seconds)..."
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  storage.googleapis.com \
  cloudbuild.googleapis.com
echo "  ✓ APIs enabled"

# ── 2. Create Artifact Registry ───────────────────────────────────────────────
echo ""
echo "▶ Creating Artifact Registry..."
gcloud artifacts repositories create tutorsnap \
  --repository-format=docker \
  --location="$REGION" \
  --description="TutorSnap Docker images" 2>/dev/null || echo "  (already exists)"
echo "  ✓ Artifact Registry ready: ${IMAGE}"

# ── 3. Create Cloud SQL PostgreSQL instance ───────────────────────────────────
echo ""
echo "▶ Creating Cloud SQL instance (takes 3-5 minutes)..."
gcloud sql instances create "$DB_INSTANCE" \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region="$REGION" \
  --no-backup \
  --quiet 2>/dev/null || echo "  (already exists)"

# Generate a random DB password
DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)
echo "  ⚠ Generated DB password: $DB_PASSWORD"
echo "  ⚠ Saving to ./migration/db_password.txt — keep this safe!"
echo -n "$DB_PASSWORD" > ./migration/db_password.txt

gcloud sql users set-password postgres --instance="$DB_INSTANCE" --password="$DB_PASSWORD" 2>/dev/null || true
gcloud sql databases create "$DB_NAME" --instance="$DB_INSTANCE" 2>/dev/null || echo "  (database already exists)"
gcloud sql users create "$DB_USER" --instance="$DB_INSTANCE" --password="$DB_PASSWORD" 2>/dev/null || \
  gcloud sql users set-password "$DB_USER" --instance="$DB_INSTANCE" --password="$DB_PASSWORD"

# Get Cloud SQL connection name
SQL_CONN="${NEW_PROJECT}:${REGION}:${DB_INSTANCE}"
DATABASE_URL="postgresql+psycopg2://${DB_USER}:${DB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${SQL_CONN}"
echo "  ✓ Cloud SQL ready: $SQL_CONN"

# ── 4. Create GCS bucket for uploads ─────────────────────────────────────────
echo ""
echo "▶ Creating GCS bucket for file uploads..."
BUCKET_NAME="${NEW_PROJECT}-uploads"
gsutil mb -l "$REGION" "gs://${BUCKET_NAME}" 2>/dev/null || echo "  (bucket already exists)"
gsutil cors set - "gs://${BUCKET_NAME}" <<'EOF'
[{"origin":["*"],"method":["GET","PUT","POST"],"responseHeader":["Content-Type"],"maxAgeSeconds":3600}]
EOF
echo "  ✓ GCS bucket: gs://${BUCKET_NAME}"

# ── 5. Create Service Account ─────────────────────────────────────────────────
echo ""
echo "▶ Creating service account..."
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="TutorSnap API" 2>/dev/null || echo "  (already exists)"

PROJECT_NUMBER=$(gcloud projects describe "$NEW_PROJECT" --format="value(projectNumber)")

for ROLE in \
  roles/cloudsql.client \
  roles/secretmanager.secretAccessor \
  roles/storage.objectAdmin \
  roles/run.invoker; do
  gcloud projects add-iam-policy-binding "$NEW_PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE" --quiet 2>/dev/null || true
done
echo "  ✓ Service account: $SA_EMAIL"

# ── 6. Set up Workload Identity Federation ────────────────────────────────────
echo ""
echo "▶ Setting up Workload Identity Federation for GitHub Actions..."

gcloud iam workload-identity-pools create github-pool \
  --location=global \
  --display-name="GitHub Actions Pool" 2>/dev/null || echo "  (pool already exists)"

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com" 2>/dev/null || echo "  (provider already exists)"

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${GITHUB_REPO}" \
  --quiet 2>/dev/null || true

WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
echo "  ✓ WIF configured"

# ── 7. Set up Secret Manager secrets ─────────────────────────────────────────
echo ""
echo "▶ Creating secrets in Secret Manager..."

SECRETS_DIR="./migration/secrets"

create_secret() {
  local NAME=$1
  local VALUE_FILE="${SECRETS_DIR}/${NAME}.txt"

  if [ -f "$VALUE_FILE" ]; then
    VALUE=$(cat "$VALUE_FILE")
    # Override DATABASE_URL with new value
    if [ "$NAME" = "DATABASE_URL" ]; then
      VALUE="$DATABASE_URL"
    fi
    # Override GCS_BUCKET_NAME with new bucket
    if [ "$NAME" = "GCS_BUCKET_NAME" ]; then
      VALUE="$BUCKET_NAME"
    fi
    echo -n "$VALUE" | gcloud secrets create "$NAME" --data-file=- --project="$NEW_PROJECT" 2>/dev/null || \
    echo -n "$VALUE" | gcloud secrets versions add "$NAME" --data-file=- --project="$NEW_PROJECT"
    echo "  ✓ $NAME"
  else
    echo "  ⚠ $NAME — no exported value found (./migration/secrets/${NAME}.txt missing)"
    echo "    You'll need to set this manually:"
    echo "    echo -n 'YOUR_VALUE' | gcloud secrets create $NAME --data-file=- --project=$NEW_PROJECT"
  fi
}

# Create DATABASE_URL with new value
echo -n "$DATABASE_URL" | gcloud secrets create DATABASE_URL --data-file=- --project="$NEW_PROJECT" 2>/dev/null || \
echo -n "$DATABASE_URL" | gcloud secrets versions add DATABASE_URL --data-file=- --project="$NEW_PROJECT"
echo "  ✓ DATABASE_URL (updated for new Cloud SQL)"

# Create GCS bucket name secret
echo -n "$BUCKET_NAME" | gcloud secrets create GCS_BUCKET_NAME --data-file=- --project="$NEW_PROJECT" 2>/dev/null || \
echo -n "$BUCKET_NAME" | gcloud secrets versions add GCS_BUCKET_NAME --data-file=- --project="$NEW_PROJECT"
echo "  ✓ GCS_BUCKET_NAME → $BUCKET_NAME"

# Copy remaining secrets from exported files
for SECRET in \
  ANTHROPIC_API_KEY \
  GOOGLE_CLIENT_ID \
  GOOGLE_CLIENT_SECRET \
  JWT_SECRET \
  ADMIN_EMAILS \
  FRONTEND_URL \
  TELEGRAM_BOT_TOKEN \
  TELEGRAM_CHAT_ID \
  TASK_TELEGRAM_BOT_TOKEN \
  TASK_TELEGRAM_CHAT_ID; do
  create_secret "$SECRET"
done

echo ""
echo "  ✓ All secrets created"

# ── 8. Import database from dump ──────────────────────────────────────────────
echo ""
echo "▶ Importing database dump..."
if [ -f "./migration/db_export.sql" ]; then
  # Upload to new project's bucket first
  gsutil cp ./migration/db_export.sql "gs://${BUCKET_NAME}/db_export.sql"

  # Grant Cloud SQL service account access
  NEW_SQL_SA=$(gcloud sql instances describe "$DB_INSTANCE" \
    --format="value(serviceAccountEmailAddress)" --project="$NEW_PROJECT")
  gsutil iam ch "serviceAccount:${NEW_SQL_SA}:objectViewer" "gs://${BUCKET_NAME}"

  gcloud sql import sql "$DB_INSTANCE" \
    "gs://${BUCKET_NAME}/db_export.sql" \
    --database="$DB_NAME" \
    --project="$NEW_PROJECT" \
    --quiet
  echo "  ✓ Database imported"
else
  echo "  ⚠ ./migration/db_export.sql not found — skipping import"
  echo "    Run 01_export_old_project.sh first, then re-run this step."
fi

# ── 9. Print GitHub secrets to set ───────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ New project setup complete!"
echo ""
echo "  ▸ Set these two GitHub Actions secrets:"
echo "    (GitHub → tutorsnap repo → Settings → Secrets → Actions)"
echo ""
echo "    WIF_PROVIDER:"
echo "    $WIF_PROVIDER"
echo ""
echo "    WIF_SERVICE_ACCOUNT:"
echo "    $SA_EMAIL"
echo ""
echo "  ▸ New Cloud Run URL will be set after first deploy."
echo "    Update FRONTEND_URL secret once you have it."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Save values for reference
cat > ./migration/new_project_values.txt << EOF
NEW_PROJECT=$NEW_PROJECT
REGION=$REGION
SA_EMAIL=$SA_EMAIL
WIF_PROVIDER=$WIF_PROVIDER
SQL_CONNECTION=$SQL_CONN
DATABASE_URL=$DATABASE_URL
GCS_BUCKET=$BUCKET_NAME
IMAGE=$IMAGE
EOF

echo ""
echo "  Values saved to ./migration/new_project_values.txt"
