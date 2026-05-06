import os
import tempfile
from fastapi import UploadFile

USE_GCS = os.getenv("USE_GCS", "false").lower() == "true"
BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "tutorsnap-uploads")


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
