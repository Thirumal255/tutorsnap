#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Run this against your OLD GCP project
# Exports the Cloud SQL database and all Secret Manager values to local files.
# ─────────────────────────────────────────────────────────────────────────────
set -e

OLD_PROJECT="tutorsnap"
OLD_REGION="asia-south1"
OLD_SQL_INSTANCE="tutorsnap-db"
OLD_SA="tutorsnap-api@${OLD_PROJECT}.iam.gserviceaccount.com"

# Bucket name for the export (must exist in old project)
EXPORT_BUCKET="gs://${OLD_PROJECT}-migration-export"
EXPORT_FILE="tutorsnap-db-$(date +%Y%m%d-%H%M%S).sql"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TutorSnap — Export from old project: $OLD_PROJECT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Ensure we're on the old project
gcloud config set project "$OLD_PROJECT"

# ── 1. Create temp GCS bucket for the export ─────────────────────────────────
echo ""
echo "▶ Creating export bucket..."
gsutil mb -l "$OLD_REGION" "$EXPORT_BUCKET" 2>/dev/null || echo "  (bucket already exists, continuing)"

# Grant Cloud SQL service account write access to bucket
SQL_SA=$(gcloud sql instances describe "$OLD_SQL_INSTANCE" \
  --format="value(serviceAccountEmailAddress)")
gsutil iam ch "serviceAccount:${SQL_SA}:objectAdmin" "$EXPORT_BUCKET"

# ── 2. Export Cloud SQL database ──────────────────────────────────────────────
echo ""
echo "▶ Exporting Cloud SQL → $EXPORT_BUCKET/$EXPORT_FILE"
echo "  (This may take 1-2 minutes...)"
gcloud sql export sql "$OLD_SQL_INSTANCE" \
  "${EXPORT_BUCKET}/${EXPORT_FILE}" \
  --database=tutorsnap \
  --offload

echo "  ✓ Database exported"

# ── 3. Download export to local machine ───────────────────────────────────────
echo ""
echo "▶ Downloading export locally..."
gsutil cp "${EXPORT_BUCKET}/${EXPORT_FILE}" ./migration/db_export.sql
echo "  ✓ Saved to ./migration/db_export.sql"

# ── 4. Export all Secret Manager secrets ─────────────────────────────────────
echo ""
echo "▶ Exporting secrets from Secret Manager..."
mkdir -p ./migration/secrets

SECRETS=(
  DATABASE_URL
  ANTHROPIC_API_KEY
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  JWT_SECRET
  ADMIN_EMAILS
  GCS_BUCKET_NAME
  FRONTEND_URL
  TELEGRAM_BOT_TOKEN
  TELEGRAM_CHAT_ID
  TASK_TELEGRAM_BOT_TOKEN
  TASK_TELEGRAM_CHAT_ID
)

for SECRET in "${SECRETS[@]}"; do
  VALUE=$(gcloud secrets versions access latest \
    --secret="$SECRET" \
    --project="$OLD_PROJECT" 2>/dev/null || echo "")
  if [ -n "$VALUE" ]; then
    echo -n "$VALUE" > "./migration/secrets/${SECRET}.txt"
    echo "  ✓ $SECRET"
  else
    echo "  ⚠ $SECRET — not found or empty, skipping"
  fi
done

# ── 5. Get current GCS bucket name ───────────────────────────────────────────
echo ""
echo "▶ Listing GCS buckets in old project (for reference)..."
gsutil ls

# ── 6. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Export complete!"
echo ""
echo "  Files created:"
echo "    ./migration/db_export.sql     ← database dump"
echo "    ./migration/secrets/*.txt     ← all secret values"
echo ""
echo "  Next: Run ./migration/02_setup_new_project.sh"
echo "         (after telling Claude your new Project ID)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
