"""
Shared helper to update book upload progress in the DB.
Used by both main.py (during GCS upload) and ingestion.py (during AI processing).
Creates its own DB session so it's safe to call from threads.
"""
import os


def set_book_progress(book_id: int, stage: str, progress: int):
    """
    Update the book's upload_stage and upload_progress.
    Safe to call from background threads — opens and closes its own DB session.
    """
    from database import SessionLocal
    from models import Book

    db = SessionLocal()
    try:
        book = db.query(Book).filter(Book.id == book_id).first()
        if book:
            book.upload_stage = stage
            book.upload_progress = min(100, max(0, progress))
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
