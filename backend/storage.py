import os
import tempfile
from fastapi import UploadFile

USE_GCS = os.getenv("USE_GCS", "false").lower() == "true"
BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "tutorsnap-uploads")


def generate_upload_signed_url(
    filename: str,
    content_type: str = "application/pdf",
    expiration_minutes: int = 60,
) -> str:
    """
    Generate a GCS v4 signed URL for direct browser → GCS upload.
    Works on Cloud Run via ADC (Application Default Credentials) + IAM signBlob.
    """
    from datetime import timedelta
    import google.auth
    from google.auth.transport import requests as google_auth_requests
    from google.cloud import storage as gcs

    credentials, project = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    auth_request = google_auth_requests.Request()
    if not credentials.valid:
        credentials.refresh(auth_request)

    client = gcs.Client(credentials=credentials, project=project)
    bucket = client.bucket(BUCKET_NAME)
    blob = bucket.blob(f"uploads/{filename}")

    signed_url = blob.generate_signed_url(
        version="v4",
        expiration=timedelta(minutes=expiration_minutes),
        method="PUT",
        content_type=content_type,
        service_account_email=credentials.service_account_email,
        access_token=credentials.token,
    )
    return signed_url


def save_upload_bytes(content: bytes, filename: str, book_id: int = None) -> str:
    """
    Save raw bytes. Used from async context via run_in_executor.
    Tracks GCS upload progress (0-30%) via set_book_progress if book_id is given.
    """
    import io

    if USE_GCS:
        from google.cloud import storage

        total = len(content)
        last_reported = [-1]  # mutable cell for closure

        class ProgressBytesIO(io.BytesIO):
            """BytesIO wrapper that reports read progress."""
            def read(self, size=-1):
                chunk = super().read(size)
                if book_id and total > 0:
                    pos = self.tell()
                    pct = int(pos / total * 100)
                    # GCS upload = 0→30% of overall progress; throttle every 4%
                    scaled = int(pct * 0.30)
                    if scaled > last_reported[0]:
                        last_reported[0] = scaled
                        from progress import set_book_progress
                        set_book_progress(book_id, "uploading", scaled)
                return chunk

        client = storage.Client()
        bucket = client.bucket(BUCKET_NAME)
        blob = bucket.blob(f"uploads/{filename}")
        blob.upload_from_file(
            ProgressBytesIO(content),
            content_type="application/pdf",
            size=total,
        )
        return f"gs://{BUCKET_NAME}/uploads/{filename}"
    else:
        upload_dir = os.getenv("UPLOAD_DIR", "uploads")
        os.makedirs(upload_dir, exist_ok=True)
        filepath = os.path.join(upload_dir, filename)
        with open(filepath, "wb") as f:
            f.write(content)
        return filepath


def save_upload(file: UploadFile, filename: str) -> str:
    """
    Local dev: saves to uploads/ folder, returns local path.
    Production: uploads to GCS, returns gs:// path.
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
    - If GCS path: download to temp file, return temp path.
    - If local path: return as-is.
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
    """Remove temp file after ingestion if it was downloaded from GCS."""
    if filepath.startswith("/tmp/"):
        try:
            os.unlink(filepath)
        except Exception:
            pass
