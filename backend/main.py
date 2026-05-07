from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, UploadFile, File, Query, Form
import asyncio
from concurrent.futures import ThreadPoolExecutor
_executor = ThreadPoolExecutor(max_workers=4)
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional, Dict
from datetime import datetime, timedelta
import os
import shutil
from dotenv import load_dotenv
from storage import save_upload, save_upload_bytes, USE_GCS, BUCKET_NAME
from progress import set_book_progress

load_dotenv(override=True)

from database import get_db, SessionLocal
from models import (
    Book, Chapter, Topic, Session as SessionModel, SessionTurn, TopicMastery,
    AppSettings, User, ParentStudentLink, Notification,
)
from ingestion import run_ingestion
from auth import get_current_user, require_admin, require_parent, verify_google_token, create_jwt
from session_engine import (
    generate_question, assess_answer, get_hint, get_concept_explanation,
    get_session_summary, determine_next_action, get_start_level,
    LEVEL_GUIDE, LEVEL_ORDER,
)

app = FastAPI(title="TutorSnap API")

_DEFAULT_SETTINGS = [
    {"key": "max_questions_per_session", "value": "20"},
    {"key": "max_hint_tiers", "value": "5"},
    {"key": "session_timeout_minutes", "value": "30"},
]


@app.on_event("startup")
def seed_settings():
    db = SessionLocal()
    try:
        for s in _DEFAULT_SETTINGS:
            if not db.query(AppSettings).filter(AppSettings.key == s["key"]).first():
                db.add(AppSettings(key=s["key"], value=s["value"]))
        db.commit()
    finally:
        db.close()


_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    os.getenv("FRONTEND_URL", ""),
    "capacitor://localhost",
    "http://localhost",
    "https://localhost",
]
ALLOWED_ORIGINS = [o for o in _ALLOWED_ORIGINS if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ─── Helpers ───────────────────────────────────────────────────────────────

def level_label(level: str) -> str:
    return {
        "L1": "Getting started", "L2": "Building up", "L3": "Practising",
        "L4": "Going deeper",    "L5": "Challenge mode",
    }.get(level, level)


def _get_setting(key: str, default: str, db: Session) -> str:
    row = db.query(AppSettings).filter(AppSettings.key == key).first()
    return row.value if row else default


def _user_dict(u: User) -> dict:
    return {
        "id": u.id, "email": u.email, "name": u.name, "role": u.role,
        "grade": u.grade, "avatar_url": u.avatar_url, "is_active": u.is_active,
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
    }


def _student_stats(db: Session, student_name: str) -> dict:
    total = db.query(func.count(SessionModel.id)).filter(
        SessionModel.student_name == student_name
    ).scalar() or 0
    mastered = db.query(func.count(TopicMastery.id)).filter(
        TopicMastery.student_name == student_name,
        TopicMastery.mastery_level.in_(["L3", "L4", "L5"]),
    ).scalar() or 0
    flagged = db.query(func.count(TopicMastery.id)).filter(
        TopicMastery.student_name == student_name,
        TopicMastery.flagged_for_review == True,
    ).scalar() or 0
    return {"total_sessions": total, "topics_mastered": mastered, "flagged_topics": flagged}


def _notify_parents(db: Session, session, topic, student_user: Optional[User]):
    if not student_user:
        return
    links = db.query(ParentStudentLink).filter(
        ParentStudentLink.student_id == student_user.id
    ).all()
    for link in links:
        db.add(Notification(
            user_id=link.parent_id,
            type="flagged_for_review",
            title=f"{student_user.name} needs help with {topic.title}",
            body=(
                f"{student_user.name} used all available hints on '{topic.title}' "
                f"and may need some extra support."
            ),
            related_topic_id=topic.id,
            related_session_id=session.id,
        ))


def _update_mastery(db: Session, session, topic, flagged: bool = False):
    mastery = db.query(TopicMastery).filter(
        TopicMastery.student_name == session.student_name,
        TopicMastery.topic_id == session.topic_id,
    ).first()
    if mastery:
        mastery.mastery_level = session.current_level
        mastery.last_practiced_at = datetime.utcnow()
        mastery.total_sessions += 1
        if flagged or session.flagged_for_review:
            mastery.flagged_for_review = True
    else:
        db.add(TopicMastery(
            student_name=session.student_name,
            topic_id=session.topic_id,
            mastery_level=session.current_level,
            last_practiced_at=datetime.utcnow(),
            total_sessions=1,
            flagged_for_review=flagged or session.flagged_for_review,
        ))
    db.commit()


# ─── Pydantic request models ───────────────────────────────────────────────

class GoogleLoginRequest(BaseModel):
    credential: str

class StartSessionRequest(BaseModel):
    student_name: str
    topic_id: int

class AnswerRequest(BaseModel):
    session_id: int
    answer: str

class HintRequest(BaseModel):
    session_id: int

class EndSessionRequest(BaseModel):
    session_id: int

class UpdateGradeRequest(BaseModel):
    grade: int

class CreateStudentRequest(BaseModel):
    email: str
    name: str
    grade: Optional[int] = None

class CreateParentRequest(BaseModel):
    email: str
    name: str

class LinkStudentRequest(BaseModel):
    student_id: int

class ConfirmRequest(BaseModel):
    confirm: bool

class InitUploadRequest(BaseModel):
    title: str
    subject: str
    grade: int
    filename: str
    content_type: str = "application/pdf"


# ─── Phase B: Auth Routes ──────────────────────────────────────────────────

class DevLoginRequest(BaseModel):
    email: str

@app.post("/api/auth/dev-login")
def dev_login(req: DevLoginRequest, db: Session = Depends(get_db)):
    """Dev-only endpoint — disabled in production (when GOOGLE_CLIENT_ID is real)."""
    if os.getenv("DISABLE_DEV_LOGIN", "false").lower() == "true":
        raise HTTPException(status_code=403, detail="Dev login disabled")

    admin_emails = [e.strip() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()]
    user = db.query(User).filter(User.email == req.email).first()
    if not user:
        role = "admin" if req.email in admin_emails else "student"
        user = User(
            google_id=f"dev_{req.email}",
            email=req.email,
            name=req.email.split("@")[0].replace(".", " ").title(),
            role=role,
        )
        db.add(user)
    user.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    token = create_jwt(user.id, user.email, user.role)
    return {"access_token": token, "token_type": "bearer", "user": _user_dict(user)}


@app.post("/api/auth/google")
def google_login(req: GoogleLoginRequest, db: Session = Depends(get_db)):
    try:
        info = verify_google_token(req.credential)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    admin_emails = [e.strip() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()]

    # Look up by google_id first, then by email (handles stub parents)
    user = db.query(User).filter(User.google_id == info["google_id"]).first()
    if not user:
        user = db.query(User).filter(User.email == info["email"]).first()
        if user and user.google_id.startswith("stub_"):
            user.google_id = info["google_id"]

    if not user:
        # Admin emails are always allowed and auto-created
        if info["email"] in admin_emails:
            user = User(
                google_id=info["google_id"],
                email=info["email"],
                name=info["name"],
                avatar_url=info.get("avatar_url"),
                role="admin",
            )
            db.add(user)
        else:
            # All other users must be pre-registered by admin
            raise HTTPException(
                status_code=403,
                detail="Account not registered. Please ask your administrator to add you."
            )
    else:
        user.name = info["name"]
        user.avatar_url = info.get("avatar_url")

    user.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(user)

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account deactivated")

    token = create_jwt(user.id, user.email, user.role)
    requires_setup = user.role == "student" and user.grade is None

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _user_dict(user),
        "requires_setup": requires_setup,
    }


@app.get("/api/auth/me")
def get_me(current_user: User = Depends(get_current_user)):
    return _user_dict(current_user)


@app.post("/api/auth/logout")
def logout():
    return {"message": "Logged out"}


# ─── Phase C: Updated existing routes (with auth) ─────────────────────────

@app.post("/api/upload")
async def upload_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    subject: str = Form(...),
    grade: int = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    # Read file bytes eagerly so they're available in the thread
    file_content = await file.read()

    # Create book record first so we have an ID for progress tracking
    book = Book(
        title=title.strip(),
        subject=subject.strip(),
        grade=grade,
        filename=file.filename,
        filepath="pending",          # placeholder until GCS upload completes
        ingestion_status="pending",
        upload_stage="uploading",
        upload_progress=0,
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    book_id = book.id

    # Upload to GCS in thread pool (non-blocking), with live progress tracking
    try:
        loop = asyncio.get_event_loop()
        filepath = await loop.run_in_executor(
            _executor,
            lambda: save_upload_bytes(file_content, file.filename, book_id=book_id)
        )
    except Exception as e:
        book.ingestion_status = "failed"
        book.upload_stage = "failed"
        book.ingestion_error = f"File upload failed: {e}"
        db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    # Update filepath and kick off ingestion
    book.filepath = filepath
    book.upload_stage = "reading"
    book.upload_progress = 30
    db.commit()

    background_tasks.add_task(run_ingestion, book_id, filepath)

    return {"book_id": book_id, "filename": book.filename, "title": book.title,
            "status": "processing", "message": "Upload successful. Ingestion started."}


@app.post("/api/upload/init")
def init_upload(
    req: InitUploadRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Step 1 of direct-to-GCS upload.
    Creates a Book record and returns a signed URL the browser can PUT the file to directly,
    bypassing Cloud Run's 32 MB request-body limit.
    """
    if not req.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    # Sanitise filename to avoid collisions
    import re, uuid
    safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", req.filename)
    unique_name = f"{uuid.uuid4().hex}_{safe_name}"

    book = Book(
        title=req.title.strip(),
        subject=req.subject.strip(),
        grade=req.grade,
        filename=unique_name,
        filepath="pending",
        ingestion_status="pending",
        upload_stage="uploading",
        upload_progress=0,
    )
    db.add(book)
    db.commit()
    db.refresh(book)

    upload_url = None
    if USE_GCS:
        from storage import generate_upload_signed_url
        upload_url = generate_upload_signed_url(unique_name, content_type=req.content_type)

    return {
        "book_id": book.id,
        "upload_url": upload_url,
        "gcs_path": f"gs://{BUCKET_NAME}/uploads/{unique_name}",
        "use_signed_url": USE_GCS,
    }


@app.post("/api/upload/complete/{book_id}")
def complete_upload(
    book_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Step 2 of direct-to-GCS upload.
    Called by the browser after the signed-URL PUT succeeds.
    Updates the book filepath and kicks off background ingestion.
    """
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    if book.filepath != "pending":
        raise HTTPException(status_code=400, detail="Upload already completed")

    filepath = f"gs://{BUCKET_NAME}/uploads/{book.filename}"
    book.filepath = filepath
    book.upload_stage = "reading"
    book.upload_progress = 30
    db.commit()

    background_tasks.add_task(run_ingestion, book_id, filepath)
    return {"book_id": book_id, "status": "processing", "message": "Ingestion started."}


@app.get("/api/ingestion/{book_id}")
def get_ingestion_status(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    return {
        "book_id": book.id,
        "status": book.ingestion_status,
        "stage": book.upload_stage or ("done" if book.ingestion_status == "done" else "processing"),
        "progress": book.upload_progress or (100 if book.ingestion_status == "done" else 0),
        "chapter_count": book.chapter_count,
        "topic_count": book.topic_count,
        "error": book.ingestion_error,
    }


@app.get("/api/books")
def get_books(
    grade: Optional[int] = Query(None, description="Filter books by grade"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Book).filter(Book.ingestion_status == "done")
    if grade is not None:
        q = q.filter(Book.grade == grade)
    # Admins see all books including non-done ones
    if current_user.role == "admin":
        q = db.query(Book)
        if grade is not None:
            q = q.filter(Book.grade == grade)
    books = q.order_by(Book.created_at.desc()).all()
    return [{"book_id": b.id, "title": b.title or b.filename,
             "subject": b.subject, "grade": b.grade,
             "filename": b.filename, "status": b.ingestion_status,
             "chapter_count": b.chapter_count, "topic_count": b.topic_count,
             "created_at": b.created_at.isoformat() if b.created_at else None}
            for b in books]


@app.delete("/api/books/{book_id}")
def delete_book(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    # Delete topics → chapters → book in order
    for ch in db.query(Chapter).filter(Chapter.book_id == book_id).all():
        db.query(Topic).filter(Topic.chapter_id == ch.id).delete()
    db.query(Chapter).filter(Chapter.book_id == book_id).delete()
    db.delete(book)
    db.commit()
    return {"message": f"Book {book_id} deleted"}


@app.get("/api/topics/{book_id}")
def get_topics(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    chapters = (db.query(Chapter).filter(Chapter.book_id == book_id)
                .order_by(Chapter.chapter_number).all())
    chapters_data = []
    for ch in chapters:
        topics = db.query(Topic).filter(Topic.chapter_id == ch.id).order_by(Topic.id).all()
        chapters_data.append({
            "id": ch.id, "chapter_number": ch.chapter_number, "title": ch.title,
            "topics": [{"id": t.id, "topic_number": t.topic_number, "title": t.title,
                        "difficulty_ceiling": t.difficulty_ceiling,
                        "key_concepts": t.key_concepts or [],
                        "vocabulary": t.vocabulary or []} for t in topics],
        })

    return {"book_id": book.id, "subject": book.subject, "grade": book.grade,
            "status": book.ingestion_status, "chapters": chapters_data}


@app.post("/api/session/start")
def start_session(
    req: StartSessionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can start sessions")
    if not req.student_name.strip():
        raise HTTPException(status_code=400, detail="student_name is required")

    topic = db.query(Topic).filter(Topic.id == req.topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()
    topic.chapter = chapter

    mastery = db.query(TopicMastery).filter(
        TopicMastery.student_name == req.student_name,
        TopicMastery.topic_id == req.topic_id,
    ).first()
    if not mastery:
        mastery = TopicMastery(student_name=req.student_name, topic_id=req.topic_id, mastery_level="L1")
        db.add(mastery)
        db.commit()
        db.refresh(mastery)

    start_level = get_start_level(mastery.mastery_level)

    session = SessionModel(
        student_name=req.student_name,
        user_id=current_user.id,
        topic_id=req.topic_id,
        current_level=start_level,
        status="active",
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    prev_sessions = db.query(SessionModel).filter(
        SessionModel.student_name == req.student_name,
        SessionModel.topic_id == req.topic_id,
        SessionModel.id != session.id,
    ).all()
    previous_questions = []
    if prev_sessions:
        prev_turns = (db.query(SessionTurn)
                      .filter(SessionTurn.session_id.in_([s.id for s in prev_sessions]))
                      .order_by(SessionTurn.created_at.desc()).limit(10).all())
        previous_questions = [t.question_text for t in prev_turns]

    question = generate_question(topic, start_level, previous_questions)
    db.add(SessionTurn(session_id=session.id, turn_number=1,
                       question_text=question, level=start_level))
    session.questions_asked = 1
    db.commit()

    return {
        "session_id": session.id, "topic_title": topic.title,
        "chapter_title": chapter.title if chapter else "",
        "student_name": req.student_name, "current_level": start_level,
        "level_label": level_label(start_level),
        "message": f"Hi {req.student_name}! Let's practise {topic.title}.\n\n{question}",
        "show_hint_button": False, "turn_number": 1,
    }


@app.post("/api/session/answer")
def submit_answer(
    req: AnswerRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(SessionModel).filter(SessionModel.id == req.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == "completed":
        raise HTTPException(status_code=400, detail="Session already completed")
    if session.user_id and session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")
    if not req.answer.strip():
        raise HTTPException(status_code=400, detail="Answer cannot be empty")

    topic = db.query(Topic).filter(Topic.id == session.topic_id).first()
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()

    current_turn = (db.query(SessionTurn).filter(SessionTurn.session_id == session.id)
                    .order_by(SessionTurn.turn_number.desc()).first())

    assessment = assess_answer(topic, current_turn.question_text, req.answer,
                               session.current_level, session.hint_tier)

    current_turn.student_answer = req.answer
    current_turn.assessment_score = assessment["score"]
    current_turn.confidence_tag = assessment["confidence_tag"]
    current_turn.hint_tier_used = session.hint_tier
    db.commit()

    next_action = determine_next_action(session, assessment["confidence_tag"], topic)
    db.commit()

    if next_action["action"] == "session_complete":
        session.ended_at = datetime.utcnow()
        session.status = "completed"
        session.final_confidence = assessment["confidence_tag"]
        _update_mastery(db, session, topic)
        turns = db.query(SessionTurn).filter(SessionTurn.session_id == session.id).all()
        summary = get_session_summary(session, topic, turns)
        db.commit()
        return {"session_id": session.id, "feedback": assessment["feedback"],
                "score": assessment["score"], "confidence_tag": assessment["confidence_tag"],
                "action": "session_complete", "current_level": session.current_level,
                "level_label": level_label(session.current_level), "show_hint_button": False,
                "session_complete": True, "summary": summary,
                "turn_number": current_turn.turn_number}

    next_question = None
    new_turn_number = current_turn.turn_number

    if next_action["action"] == "retry_question":
        next_question = current_turn.question_text
    elif next_action["action"] in ("advance_level", "next_question"):
        prev_qs = [t.question_text for t in
                   db.query(SessionTurn).filter(SessionTurn.session_id == session.id).all()]
        next_question = generate_question(topic, session.current_level, prev_qs)
        new_turn_number = current_turn.turn_number + 1
        db.add(SessionTurn(session_id=session.id, turn_number=new_turn_number,
                           question_text=next_question, level=session.current_level))
        session.questions_asked += 1
        db.commit()

    return {"session_id": session.id, "feedback": assessment["feedback"],
            "score": assessment["score"], "confidence_tag": assessment["confidence_tag"],
            "action": next_action["action"], "current_level": session.current_level,
            "level_label": level_label(session.current_level),
            "show_hint_button": next_action.get("show_hint_button", False),
            "session_complete": False, "next_question": next_question,
            "turn_number": new_turn_number}


@app.post("/api/session/hint")
def request_hint(
    req: HintRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(SessionModel).filter(SessionModel.id == req.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == "completed":
        raise HTTPException(status_code=400, detail="Session already completed")
    if session.user_id and session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    topic = db.query(Topic).filter(Topic.id == session.topic_id).first()
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()

    current_turn = (db.query(SessionTurn).filter(SessionTurn.session_id == session.id)
                    .order_by(SessionTurn.turn_number.desc()).first())

    session.hint_tier += 1
    max_hints = int(_get_setting("max_hint_tiers", os.getenv("MAX_HINT_TIERS", "5"), db))

    if session.hint_tier > max_hints and not session.concept_reset_done:
        session.concept_reset_done = True
        explanation = get_concept_explanation(topic, current_turn.question_text)
        prev_qs = [t.question_text for t in
                   db.query(SessionTurn).filter(SessionTurn.session_id == session.id).all()]
        fresh_question = generate_question(topic, session.current_level, prev_qs)
        new_turn_number = current_turn.turn_number + 1
        db.add(SessionTurn(session_id=session.id, turn_number=new_turn_number,
                           question_text=fresh_question, level=session.current_level))
        session.hint_tier = 0
        session.questions_asked += 1
        db.commit()
        return {"session_id": session.id, "hint_message": explanation,
                "hint_tier": max_hints + 1, "is_final_hint": False,
                "is_concept_reset": True, "flagged": False, "fresh_question": fresh_question}

    if session.hint_tier > max_hints and session.concept_reset_done:
        session.flagged_for_review = True
        _update_mastery(db, session, topic, flagged=True)
        session.status = "completed"
        session.ended_at = datetime.utcnow()
        # Notify parents
        student_user = (db.query(User).filter(User.id == session.user_id).first()
                        if session.user_id else None)
        _notify_parents(db, session, topic, student_user)
        db.commit()
        return {"session_id": session.id,
                "hint_message": "You've done great trying today! Let's revisit this topic with your teacher.",
                "hint_tier": session.hint_tier, "is_final_hint": True,
                "is_concept_reset": False, "flagged": True, "fresh_question": None}

    hint_text = get_hint(topic, current_turn.question_text,
                         current_turn.student_answer or "", session.hint_tier)
    db.commit()
    return {"session_id": session.id, "hint_message": hint_text,
            "hint_tier": session.hint_tier, "is_final_hint": session.hint_tier >= max_hints,
            "is_concept_reset": False, "flagged": False, "fresh_question": None}


@app.post("/api/session/end")
def end_session(
    req: EndSessionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(SessionModel).filter(SessionModel.id == req.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id and session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    topic = db.query(Topic).filter(Topic.id == session.topic_id).first()
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()

    if session.status != "completed":
        last_turn = (db.query(SessionTurn).filter(SessionTurn.session_id == session.id)
                     .order_by(SessionTurn.turn_number.desc()).first())
        session.status = "completed"
        session.ended_at = datetime.utcnow()
        session.final_confidence = (last_turn.confidence_tag
                                    if last_turn and last_turn.confidence_tag else "shaky")
        _update_mastery(db, session, topic)
        db.commit()

    turns = db.query(SessionTurn).filter(SessionTurn.session_id == session.id).all()
    summary = get_session_summary(session, topic, turns)
    return {"session_id": session.id, "student_name": session.student_name,
            "topic_title": topic.title, "level_reached": session.current_level,
            "level_label": level_label(session.current_level),
            "questions_asked": session.questions_asked, "summary": summary,
            "flagged_for_review": session.flagged_for_review}


# ─── Phase C: Admin Routes ─────────────────────────────────────────────────

@app.post("/api/admin/students")
def admin_create_student(
    req: CreateStudentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        existing.role = "student"
        if req.name:
            existing.name = req.name
        if req.grade:
            existing.grade = req.grade
        db.commit()
        db.refresh(existing)
        return _user_dict(existing)

    student = User(
        email=req.email,
        name=req.name,
        google_id=f"stub_{req.email}",
        role="student",
        grade=req.grade,
        is_active=True,
    )
    db.add(student)
    db.commit()
    db.refresh(student)
    return _user_dict(student)


@app.get("/api/admin/students")
def admin_get_students(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    students = db.query(User).filter(User.role == "student").order_by(User.name).all()
    result = []
    for s in students:
        stats = _student_stats(db, s.name)
        result.append({**_user_dict(s), **stats})
    return result


@app.get("/api/admin/students/{student_id}")
def admin_get_student(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == student_id, User.role == "student").first()
    if not user:
        raise HTTPException(status_code=404, detail="Student not found")

    masteries = db.query(TopicMastery).filter(TopicMastery.student_name == user.name).all()
    topic_mastery_list = []
    for m in masteries:
        topic = db.query(Topic).filter(Topic.id == m.topic_id).first()
        chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first() if topic else None
        topic_mastery_list.append({
            "topic_title": topic.title if topic else "",
            "chapter_title": chapter.title if chapter else "",
            "mastery_level": m.mastery_level, "level_label": level_label(m.mastery_level),
            "last_practiced_at": m.last_practiced_at.isoformat() if m.last_practiced_at else None,
            "total_sessions": m.total_sessions, "flagged_for_review": m.flagged_for_review,
            "last_hint_tier_needed": m.last_hint_tier_needed,
        })

    recent = (db.query(SessionModel).filter(SessionModel.student_name == user.name)
              .order_by(SessionModel.started_at.desc()).limit(10).all())
    recent_sessions = []
    for s in recent:
        t = db.query(Topic).filter(Topic.id == s.topic_id).first()
        recent_sessions.append({
            "id": s.id, "topic_title": t.title if t else "",
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "ended_at": s.ended_at.isoformat() if s.ended_at else None,
            "current_level": s.current_level, "questions_asked": s.questions_asked,
            "status": s.status,
        })

    parent_links = db.query(ParentStudentLink).filter(ParentStudentLink.student_id == user.id).all()
    parent_names = []
    for link in parent_links:
        p = db.query(User).filter(User.id == link.parent_id).first()
        if p:
            parent_names.append(p.name)

    return {**_user_dict(user), "topic_mastery": topic_mastery_list,
            "recent_sessions": recent_sessions, "parent_names": parent_names}


@app.post("/api/admin/students/{student_id}/grade")
def admin_update_grade(
    student_id: int,
    req: UpdateGradeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == student_id, User.role == "student").first()
    if not user:
        raise HTTPException(status_code=404, detail="Student not found")
    user.grade = req.grade
    db.commit()
    db.refresh(user)
    return _user_dict(user)


@app.post("/api/admin/students/{student_id}/deactivate")
def admin_deactivate(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == student_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    db.commit()
    return {"message": "Student deactivated"}


@app.post("/api/admin/students/{student_id}/activate")
def admin_activate(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == student_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = True
    db.commit()
    return {"message": "Student activated"}


@app.post("/api/admin/students/{student_id}/reset-mastery")
def admin_reset_mastery(
    student_id: int,
    req: ConfirmRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if not req.confirm:
        raise HTTPException(status_code=400, detail="Confirmation required")
    user = db.query(User).filter(User.id == student_id, User.role == "student").first()
    if not user:
        raise HTTPException(status_code=404, detail="Student not found")
    deleted = db.query(TopicMastery).filter(TopicMastery.student_name == user.name).delete()
    db.commit()
    return {"message": f"Mastery reset for {user.name}", "topics_cleared": deleted}


@app.get("/api/admin/parents")
def admin_get_parents(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    parents = db.query(User).filter(User.role == "parent").order_by(User.name).all()
    result = []
    for p in parents:
        links = db.query(ParentStudentLink).filter(ParentStudentLink.parent_id == p.id).all()
        children = []
        for link in links:
            child = db.query(User).filter(User.id == link.student_id).first()
            if child:
                children.append({"id": child.id, "name": child.name})
        result.append({**_user_dict(p), "children": children})
    return result


@app.post("/api/admin/parents")
def admin_create_parent(
    req: CreateParentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        existing.role = "parent"
        if req.name:
            existing.name = req.name
        db.commit()
        db.refresh(existing)
        return _user_dict(existing)

    stub = User(
        email=req.email, name=req.name,
        google_id=f"stub_{req.email}",
        role="parent", is_active=True,
    )
    db.add(stub)
    db.commit()
    db.refresh(stub)
    return _user_dict(stub)


@app.post("/api/admin/parents/{parent_id}/link-student")
def admin_link_student(
    parent_id: int,
    req: LinkStudentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    parent = db.query(User).filter(User.id == parent_id, User.role == "parent").first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    student = db.query(User).filter(User.id == req.student_id, User.role == "student").first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    existing = db.query(ParentStudentLink).filter(
        ParentStudentLink.parent_id == parent_id,
        ParentStudentLink.student_id == req.student_id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Already linked")
    db.add(ParentStudentLink(parent_id=parent_id, student_id=req.student_id))
    db.commit()
    return {"message": "Linked successfully"}


@app.delete("/api/admin/parents/{parent_id}/unlink-student/{student_id}")
def admin_unlink_student(
    parent_id: int,
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    link = db.query(ParentStudentLink).filter(
        ParentStudentLink.parent_id == parent_id,
        ParentStudentLink.student_id == student_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete(link)
    db.commit()
    return {"message": "Unlinked"}


@app.get("/api/admin/flagged")
def admin_get_flagged(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    flagged = db.query(TopicMastery).filter(TopicMastery.flagged_for_review == True).all()
    result = []
    for m in flagged:
        topic = db.query(Topic).filter(Topic.id == m.topic_id).first()
        chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first() if topic else None
        user = db.query(User).filter(User.name == m.student_name).first()
        result.append({
            "student_name": m.student_name,
            "student_id": user.id if user else None,
            "grade": user.grade if user else None,
            "topic_title": topic.title if topic else "",
            "chapter_title": chapter.title if chapter else "",
            "flagged_at": m.last_practiced_at.isoformat() if m.last_practiced_at else None,
            "total_sessions_on_topic": m.total_sessions,
            "last_hint_tier_needed": m.last_hint_tier_needed,
        })
    return result


@app.post("/api/admin/flagged/{student_id}/{topic_id}/resolve")
def admin_resolve_flag(
    student_id: int,
    topic_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == student_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Student not found")
    mastery = db.query(TopicMastery).filter(
        TopicMastery.student_name == user.name,
        TopicMastery.topic_id == topic_id,
    ).first()
    if not mastery:
        raise HTTPException(status_code=404, detail="Mastery record not found")
    mastery.flagged_for_review = False
    db.commit()
    return {"message": "Flag resolved"}


@app.get("/api/admin/settings")
def admin_get_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    rows = db.query(AppSettings).all()
    return {r.key: r.value for r in rows}


@app.put("/api/admin/settings")
def admin_update_settings(
    payload: Dict[str, str],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    for key, value in payload.items():
        row = db.query(AppSettings).filter(AppSettings.key == key).first()
        if row:
            row.value = value
            row.updated_by = current_user.id
            row.updated_at = datetime.utcnow()
        else:
            db.add(AppSettings(key=key, value=value, updated_by=current_user.id))
    db.commit()
    rows = db.query(AppSettings).all()
    return {r.key: r.value for r in rows}


@app.get("/api/admin/reports/overview")
def admin_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    week_ago = datetime.utcnow() - timedelta(days=7)
    total_students = db.query(func.count(User.id)).filter(User.role == "student").scalar() or 0
    sessions_this_week = db.query(func.count(SessionModel.id)).filter(
        SessionModel.started_at >= week_ago
    ).scalar() or 0
    active_names = db.query(SessionModel.student_name).filter(
        SessionModel.started_at >= week_ago
    ).distinct().all()
    active_this_week = len(active_names)
    flagged_students = db.query(func.count(func.distinct(TopicMastery.student_name))).filter(
        TopicMastery.flagged_for_review == True
    ).scalar() or 0
    books_uploaded = db.query(func.count(Book.id)).scalar() or 0
    topics_available = db.query(func.count(Topic.id)).scalar() or 0
    return {
        "total_students": total_students, "active_this_week": active_this_week,
        "total_sessions_this_week": sessions_this_week, "flagged_students": flagged_students,
        "books_uploaded": books_uploaded, "topics_available": topics_available,
    }


# ─── Phase C: Parent Routes ────────────────────────────────────────────────

@app.get("/api/parent/children")
def parent_get_children(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    links = db.query(ParentStudentLink).filter(
        ParentStudentLink.parent_id == current_user.id
    ).all()
    result = []
    for link in links:
        child = db.query(User).filter(User.id == link.student_id).first()
        if not child:
            continue
        last_session = (db.query(SessionModel).filter(SessionModel.student_name == child.name)
                        .order_by(SessionModel.started_at.desc()).first())
        stats = _student_stats(db, child.name)
        result.append({
            "id": child.id, "name": child.name, "grade": child.grade,
            "avatar_url": child.avatar_url,
            "last_active": last_session.started_at.isoformat() if last_session and last_session.started_at else None,
            "topics_practised": stats["total_sessions"],
            "flagged_topics": stats["flagged_topics"],
        })
    return result


@app.get("/api/parent/children/{student_id}")
def parent_get_child_detail(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    link = db.query(ParentStudentLink).filter(
        ParentStudentLink.parent_id == current_user.id,
        ParentStudentLink.student_id == student_id,
    ).first()
    if not link:
        raise HTTPException(status_code=403, detail="Not linked to this student")

    child = db.query(User).filter(User.id == student_id).first()
    if not child:
        raise HTTPException(status_code=404, detail="Student not found")

    sessions = (db.query(SessionModel).filter(SessionModel.student_name == child.name)
                .order_by(SessionModel.started_at.desc()).all())

    total_sessions = len(sessions)
    total_minutes = 0
    for s in sessions:
        if s.started_at and s.ended_at:
            total_minutes += int((s.ended_at - s.started_at).total_seconds() / 60)

    masteries = db.query(TopicMastery).filter(TopicMastery.student_name == child.name).all()
    topics_practised = len(masteries)
    topics_at_l3 = sum(1 for m in masteries if m.mastery_level in ("L3", "L4", "L5"))
    flagged_count = sum(1 for m in masteries if m.flagged_for_review)

    topic_mastery_list = []
    for m in masteries:
        topic = db.query(Topic).filter(Topic.id == m.topic_id).first()
        chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first() if topic else None
        topic_mastery_list.append({
            "topic_title": topic.title if topic else "", "chapter_title": chapter.title if chapter else "",
            "mastery_level": m.mastery_level, "level_label": level_label(m.mastery_level),
            "last_practiced_at": m.last_practiced_at.isoformat() if m.last_practiced_at else None,
            "sessions_on_topic": m.total_sessions, "flagged_for_review": m.flagged_for_review,
        })

    recent_sessions = []
    for s in sessions[:10]:
        t = db.query(Topic).filter(Topic.id == s.topic_id).first()
        dur = int((s.ended_at - s.started_at).total_seconds() / 60) if s.started_at and s.ended_at else 0
        recent_sessions.append({
            "topic_title": t.title if t else "", "started_at": s.started_at.isoformat() if s.started_at else None,
            "duration_minutes": dur, "level_reached": s.current_level,
            "questions_asked": s.questions_asked, "status": s.status,
        })

    flagged_topics = []
    for m in masteries:
        if m.flagged_for_review:
            topic = db.query(Topic).filter(Topic.id == m.topic_id).first()
            chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first() if topic else None
            flagged_topics.append({
                "topic_title": topic.title if topic else "",
                "chapter_title": chapter.title if chapter else "",
                "message": (f"{child.name} needed extra help with {topic.title if topic else 'this topic'}. "
                            "Consider reviewing it together."),
            })

    last_session = sessions[0] if sessions else None
    return {
        "student": {"name": child.name, "grade": child.grade},
        "summary": {"total_sessions": total_sessions, "total_time_minutes": total_minutes,
                    "topics_practised": topics_practised, "topics_at_l3_or_above": topics_at_l3,
                    "flagged_topics": flagged_count},
        "topic_mastery": topic_mastery_list,
        "recent_sessions": recent_sessions,
        "flagged_topics": flagged_topics,
    }


@app.get("/api/parent/children/{student_id}/sessions")
def parent_get_child_sessions(
    student_id: int,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    link = db.query(ParentStudentLink).filter(
        ParentStudentLink.parent_id == current_user.id,
        ParentStudentLink.student_id == student_id,
    ).first()
    if not link:
        raise HTTPException(status_code=403, detail="Not linked to this student")

    child = db.query(User).filter(User.id == student_id).first()
    if not child:
        raise HTTPException(status_code=404, detail="Student not found")

    sessions = (db.query(SessionModel).filter(SessionModel.student_name == child.name)
                .order_by(SessionModel.started_at.desc()).offset(offset).limit(limit).all())
    result = []
    for s in sessions:
        t = db.query(Topic).filter(Topic.id == s.topic_id).first()
        dur = int((s.ended_at - s.started_at).total_seconds() / 60) if s.started_at and s.ended_at else 0
        result.append({
            "id": s.id, "topic_title": t.title if t else "",
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "duration_minutes": dur, "level_reached": s.current_level,
            "questions_asked": s.questions_asked, "status": s.status,
        })
    return result


@app.get("/api/parent/notifications")
def parent_get_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    notifs = (db.query(Notification).filter(Notification.user_id == current_user.id)
              .order_by(Notification.created_at.desc()).all())
    return [{"id": n.id, "type": n.type, "title": n.title, "body": n.body,
             "is_read": n.is_read,
             "created_at": n.created_at.isoformat() if n.created_at else None}
            for n in notifs]


@app.post("/api/parent/notifications/{notification_id}/read")
def parent_mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    notif = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id,
    ).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.is_read = True
    db.commit()
    return {"message": "Marked as read"}
