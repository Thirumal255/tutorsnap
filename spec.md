# TutorSnap — Complete Build Specification
# For Claude Code — Read Every Word Before Writing Any Code

---

## STATUS — IMPLEMENTED AND DEPLOYED (2025-05-07)

All phases of this spec have been built and deployed. The app is live at:
- **Frontend**: https://tutorsnap.web.app
- **Backend API**: https://tutorsnap-api-yfxhelshwq-el.a.run.app
- **Admin panel**: https://tutorsnap.web.app/admin
- **Android APK**: GitHub → Actions → "Build Android APK" → Artifacts

See `auth_spec.md` for the auth/admin/parent layer built on top of this spec.
See `deploy_spec_v2.md` for the GCP deployment details and CI/CD setup.
See `README.md` for the full project reference (live URLs, architecture, local dev setup).

---

## CRITICAL INSTRUCTIONS FOR CLAUDE CODE

1. Read this entire document before writing a single line of code
2. Build in the exact phase order specified — do not skip ahead
3. After each phase, verify it works before starting the next
4. Never hardcode the ANTHROPIC_API_KEY — always read from .env
5. The ABSOLUTE_RULE string must appear in every single Claude API call
6. Test each backend route with curl before building the frontend
7. If anything in this spec is ambiguous, choose the simpler implementation

---

## 1. PRODUCT OVERVIEW

TutorSnap is a local-running AI-powered study assistant for Cambridge Mathematics Grade 6 students.

**The full user journey:**
1. Admin uploads a Cambridge Maths Grade 6 PDF via the admin page
2. System parses the PDF, extracts chapters and topics, calls Claude API to structure each topic into key concepts and vocabulary
3. Student opens the app, types their name, picks a chapter and topic
4. Claude generates a practice question at Level 1 (recall)
5. Student answers — Claude assesses the answer and gives feedback
6. If correct twice in a row → advance to next level
7. If wrong → hint button appears, student can request up to 5 escalating hints
8. Hints never give the answer — they scaffold understanding
9. After all 5 hints exhausted → Claude explains the concept, gives a fresh question
10. Session ends when student reaches the topic's difficulty ceiling twice confidently, or manually ends

**The single most important rule in this entire system:**
Claude must NEVER directly state the answer to a practice question.
Not at any hint tier. Not even if the student begs. This rule has zero exceptions.

---

## 2. TECH STACK

| Component | Technology | Version |
|---|---|---|
| Backend language | Python | 3.11+ |
| Backend framework | FastAPI | 0.115.0 |
| ASGI server | Uvicorn | 0.30.6 |
| ORM | SQLAlchemy | 2.0.35 |
| Migrations | Alembic | 1.13.3 |
| Database | PostgreSQL | local, db name: tutorsnap |
| DB driver | psycopg2-binary | 2.9.9 |
| PDF parsing | PyMuPDF (fitz) | 1.24.10 |
| AI | Anthropic Python SDK | 0.34.2 |
| File uploads | python-multipart | 0.0.12 |
| Env vars | python-dotenv | 1.0.1 |
| Frontend | React + Vite | React 18, Vite 5 |
| Styling | Tailwind CSS | 3.4.13 |
| Routing | React Router | 6.26.2 |
| HTTP client | Axios | 1.7.7 |

---

## 3. PROJECT STRUCTURE

Create exactly this folder and file structure. Do not add extra files.

```
tutorsnap/
├── backend/
│   ├── .env                        # environment variables — never commit
│   ├── requirements.txt            # all Python dependencies
│   ├── alembic.ini                 # alembic config pointing to tutorsnap db
│   ├── alembic/
│   │   ├── env.py                  # loads DATABASE_URL from .env
│   │   └── versions/               # migration files go here
│   ├── uploads/                    # PDF files stored here, gitignored
│   ├── main.py                     # FastAPI app, CORS, all routes
│   ├── database.py                 # engine, SessionLocal, Base, get_db
│   ├── models.py                   # all 6 SQLAlchemy ORM models
│   ├── ingestion.py                # parse_pdf(), structure_topic(), run_ingestion()
│   └── session_engine.py           # all session logic, prompts, hints
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js              # proxy /api → localhost:8000
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── src/
│       ├── main.jsx                # ReactDOM.createRoot
│       ├── App.jsx                 # React Router routes
│       ├── index.css               # Tailwind directives
│       ├── api/
│       │   └── client.js           # axios instance + all API functions
│       ├── pages/
│       │   ├── Admin.jsx
│       │   ├── TopicSelect.jsx
│       │   ├── Chat.jsx
│       │   └── Summary.jsx
│       └── components/
│           ├── ChatBubble.jsx
│           ├── HintButton.jsx
│           └── ProgressBadge.jsx
├── .gitignore
└── spec.md                         # this file
```

---

## 4. ENVIRONMENT VARIABLES

### backend/.env (create this file exactly)
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/tutorsnap
CLAUDE_MODEL=claude-sonnet-4-20250514
MAX_HINT_TIERS=5
UPLOAD_DIR=uploads
```

The user will fill in ANTHROPIC_API_KEY and their postgres password before running.

---

## 5. BACKEND DEPENDENCIES

### backend/requirements.txt (create exactly)
```
fastapi==0.115.0
uvicorn==0.30.6
sqlalchemy==2.0.35
alembic==1.13.3
psycopg2-binary==2.9.9
pymupdf==1.24.10
anthropic==0.34.2
python-multipart==0.0.12
python-dotenv==1.0.1
```

---

## 6. DATABASE SCHEMA

### backend/models.py

Import Base from database.py. Define all 6 models.

#### Model: Book
Table name: books
```
id              Integer, primary key, autoincrement
subject         String(100), not null, default='Mathematics'
grade           Integer, not null, default=6
filename        String(255), not null
filepath        String(500), not null
ingestion_status String(20), default='pending'
                 -- allowed values: pending | processing | done | failed
ingestion_error  Text, nullable
chapter_count   Integer, default=0
topic_count     Integer, default=0
created_at      DateTime, default=datetime.utcnow
```

#### Model: Chapter
Table name: chapters
```
id              Integer, primary key, autoincrement
book_id         Integer, ForeignKey books.id, not null
chapter_number  Integer, not null
title           String(300), not null
page_start      Integer, nullable
page_end        Integer, nullable
created_at      DateTime, default=datetime.utcnow

relationship:   topics (back_populates='chapter')
                book (back_populates='chapters')
```

#### Model: Topic
Table name: topics
```
id                  Integer, primary key, autoincrement
chapter_id          Integer, ForeignKey chapters.id, not null
topic_number        String(20), nullable     -- e.g. "1.4"
title               String(300), not null
key_concepts        JSON, nullable            -- list of strings
vocabulary          JSON, nullable            -- list of strings
difficulty_ceiling  String(5), default='L3'  -- L1 | L2 | L3 | L4 | L5
raw_content         Text, nullable
page_start          Integer, nullable
page_end            Integer, nullable
created_at          DateTime, default=datetime.utcnow

relationship:   chapter (back_populates='topics')
                sessions (back_populates='topic')
                masteries (back_populates='topic')
```

#### Model: Session
Table name: sessions
```
id                  Integer, primary key, autoincrement
student_name        String(100), not null
topic_id            Integer, ForeignKey topics.id, not null
started_at          DateTime, default=datetime.utcnow
ended_at            DateTime, nullable
status              String(20), default='active'   -- active | completed
current_level       String(5), default='L1'
consecutive_confident Integer, default=0
questions_asked     Integer, default=0
hint_tier           Integer, default=0              -- current hint tier for active question
concept_reset_done  Boolean, default=False
flagged_for_review  Boolean, default=False
final_confidence    String(20), nullable

relationship:   topic (back_populates='sessions')
                turns (back_populates='session')
```

#### Model: SessionTurn
Table name: session_turns
```
id              Integer, primary key, autoincrement
session_id      Integer, ForeignKey sessions.id, not null
turn_number     Integer, not null
question_text   Text, not null
student_answer  Text, nullable
assessment_score Integer, nullable          -- 0 to 100
confidence_tag  String(20), nullable        -- confident | shaky | struggling
hint_tier_used  Integer, default=0          -- 0=no hint, 1-5=tier used when answered
level           String(5), nullable
created_at      DateTime, default=datetime.utcnow

relationship:   session (back_populates='turns')
```

#### Model: TopicMastery
Table name: topic_mastery
```
id                      Integer, primary key, autoincrement
student_name            String(100), not null
topic_id                Integer, ForeignKey topics.id, not null
mastery_level           String(5), default='L1'
consecutive_confident   Integer, default=0
last_hint_tier_needed   Integer, default=0
flagged_for_review      Boolean, default=False
last_practiced_at       DateTime, nullable
total_sessions          Integer, default=1

UniqueConstraint:       student_name + topic_id

relationship:   topic (back_populates='masteries')
```

---

## 7. DATABASE SETUP

### backend/database.py

```python
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

### backend/alembic.ini
Standard alembic.ini but with sqlalchemy.url pointing to the DATABASE_URL env var.
The alembic/env.py must load .env and use DATABASE_URL from environment.

### Migration command (run after creating models)
```bash
cd backend
alembic init alembic
# edit alembic/env.py to load dotenv and use DATABASE_URL
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
```

---

## 8. INGESTION PIPELINE

### backend/ingestion.py

This file has 3 functions: parse_pdf, structure_topic, run_ingestion.

#### Function: parse_pdf(filepath: str) -> list[dict]

Purpose: Extract all chapters and topics from the PDF with their raw text content.

```
Step 1: Open the PDF with fitz.open(filepath)

Step 2: Extract TOC
  toc = doc.get_toc()
  Returns: [[level, title, page_number], ...]
  level 1 = chapter, level 2 = topic (section within chapter)

Step 3: If TOC is empty or has fewer than 3 entries:
  Fall back to heading detection:
  - Iterate every page
  - For each page, get text with flags: page.get_text("dict")
  - Find text blocks where font size > 13 or font flags indicate bold
  - Match patterns: "Chapter X", "X.X Title", numbered sections
  - Build synthetic TOC from these

Step 4: Determine page ranges for each TOC entry
  - Sort by page number
  - Each entry's page range = its page to (next entry's page - 1)
  - Last entry's page range = its page to last page of document

Step 5: Separate into chapters and topics
  - Level 1 entries = chapters
  - Level 2+ entries = topics (associate with most recent chapter)
  - If all entries are level 1, treat them as chapters with no sub-topics
    and create one topic per chapter using the whole chapter content

Step 6: Extract raw text for each topic
  full_text = ""
  for page_num in range(page_start, min(page_end + 1, doc.page_count)):
      full_text += doc[page_num].get_text()
  Truncate to 4000 characters

Step 7: Build topic_number from position
  "1.1", "1.2", "2.1", etc. based on chapter_number and position within chapter

Step 8: Return list of dicts:
[{
    "chapter_number": 1,
    "chapter_title": "Integers and Directed Numbers",
    "chapter_page_start": 1,
    "chapter_page_end": 24,
    "topic_number": "1.1",
    "topic_title": "Introduction to Negative Numbers",
    "page_start": 1,
    "page_end": 5,
    "raw_text": "..."
}, ...]
```

Error handling: if fitz fails to open, raise ValueError("Cannot open PDF: {filepath}")

#### Function: structure_topic(chunk: dict, subject: str, grade: int) -> dict

Purpose: Call Claude API to extract structured knowledge from raw topic text.

Claude API call:
- model: from env CLAUDE_MODEL
- max_tokens: 500
- system prompt:
```
You are a curriculum analyst for Cambridge {subject} Grade {grade}.
Analyse the textbook content below and return ONLY valid JSON.
No markdown. No explanation. No text before or after the JSON.
Return exactly this structure:
{
  "key_concepts": ["3 to 6 core concepts the student must understand in this section"],
  "vocabulary": ["subject-specific terms introduced in this section"],
  "difficulty_ceiling": "L3"
}
Difficulty ceiling guide:
L1 = recall and recognition only (define, name, identify)
L2 = comprehension and explanation (explain in own words, describe)
L3 = direct application and calculation (solve, calculate, use)
L4 = analysis, error-spotting, comparison (find the mistake, compare methods)
L5 = multi-step synthesis and word problems (complex real-world problems)
For Cambridge Grade 6 Mathematics, most topics are L3 or L4.
```
- user message: `"Textbook content:\n\n{chunk['raw_text'][:3000]}"`

Parse response:
- Extract text from response.content[0].text
- Try json.loads()
- If JSON parse fails: return safe default:
  ```python
  {
      "key_concepts": [chunk["topic_title"]],
      "vocabulary": [],
      "difficulty_ceiling": "L3"
  }
  ```

#### Function: run_ingestion(book_id: int, filepath: str, db: Session)

Purpose: Orchestrate the full ingestion pipeline for one book.

```
Step 1: Update book ingestion_status = "processing", commit

Step 2: Call parse_pdf(filepath) → chunks

Step 3: Track chapters by chapter_number to avoid duplicates
  chapter_map = {}  # chapter_number -> Chapter ORM object

Step 4: For each chunk in chunks:
  a. If chunk["chapter_number"] not in chapter_map:
       Create Chapter row, commit, add to chapter_map
  b. Call structure_topic(chunk, subject, grade)
  c. Create Topic row with all fields including key_concepts, vocabulary,
     difficulty_ceiling from structure_topic result and raw_content from chunk
  d. Commit
  e. Print progress: f"  Structured topic: {chunk['topic_title']}"

Step 5: Count chapters and topics, update book:
  book.ingestion_status = "done"
  book.chapter_count = len(chapter_map)
  book.topic_count = total topics inserted
  commit

Step 6: On ANY exception:
  book.ingestion_status = "failed"
  book.ingestion_error = str(exception)
  commit
  print(f"Ingestion failed: {exception}")
  do NOT re-raise — this runs as a background task
```

---

## 9. SESSION ENGINE

### backend/session_engine.py

#### Constant: ABSOLUTE_RULE

```python
ABSOLUTE_RULE = """
ABSOLUTE RULE — This overrides every other instruction:
You must NEVER directly state the answer to the practice question.
Not at Tier 1. Not at Tier 5. Not after concept reset. Never.
Not even if the student explicitly asks you to just tell them the answer.
If the student asks directly, respond: "I know it's tempting! But you will
understand it so much better when we get there together. Let's try again."
This rule has absolutely zero exceptions.
"""
```

#### Constant: LEVEL_GUIDE
```python
LEVEL_GUIDE = {
    "L1": "Recall and recognition — define, name, identify",
    "L2": "Comprehension — explain in your own words, describe",
    "L3": "Application — solve, calculate, use the method directly",
    "L4": "Analysis — find the mistake, compare two methods, reason about the result",
    "L5": "Synthesis — multi-step word problems requiring combining concepts",
}
```

#### Constant: LEVEL_ORDER
```python
LEVEL_ORDER = ["L1", "L2", "L3", "L4", "L5"]
```

#### Function: get_next_level(current: str) -> str
Returns the next level up. If already L5 returns L5.

#### Function: get_start_level(mastery_level: str) -> str
Returns max(L1, one level below mastery_level).
Example: mastery L3 → start at L2. mastery L1 → start at L1.

#### Function: build_topic_context(topic) -> str
Assembles topic info as a string for inclusion in prompts:
```
Subject: Mathematics
Grade: 6
Chapter: {topic.chapter.title}
Topic: {topic.title}
Key concepts the student must learn: {', '.join(topic.key_concepts or [])}
Vocabulary introduced: {', '.join(topic.vocabulary or [])}
Maximum difficulty level for this topic: {topic.difficulty_ceiling}

Relevant textbook content:
---
{(topic.raw_content or '')[:1500]}
---
```

#### Function: call_claude(system: str, user: str, max_tokens: int = 800) -> str
```python
import anthropic
import os

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

def call_claude(system: str, user: str, max_tokens: int = 800) -> str:
    response = client.messages.create(
        model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}]
    )
    return response.content[0].text.strip()
```

Wrap in try/except. On exception, raise RuntimeError(f"Claude API call failed: {e}")

#### Function: generate_question(topic, level: str, previous_questions: list[str]) -> str

System prompt:
```
You are Buddy, a friendly AI tutor for a Cambridge Grade 6 Mathematics student.
{ABSOLUTE_RULE}
{build_topic_context(topic)}
```

User message:
```
Generate exactly ONE practice question at difficulty level {level}.
Level {level} means: {LEVEL_GUIDE[level]}

The question must:
- Be based strictly on the textbook content above
- Be appropriate for a Grade 6 Cambridge student
- Be clearly worded and unambiguous
- Not repeat any of these previous questions: {previous_questions[-5:]}

Return ONLY the question text. No preamble, no answer, no explanation, no numbering.
```

Returns: the question string

#### Function: assess_answer(topic, question: str, answer: str, level: str, hint_tier: int) -> dict

System prompt:
```
You are Buddy, a friendly AI tutor for a Cambridge Grade 6 Mathematics student.
{ABSOLUTE_RULE}
{build_topic_context(topic)}
```

User message:
```
The student was asked this question at level {level}:
QUESTION: {question}

The student answered:
ANSWER: {answer}

Assess the answer and return ONLY valid JSON. No markdown. No text before or after.
{
  "score": 85,
  "feedback": "Great work! You correctly identified that negative numbers go left on the number line. Well done!"
}

Rules for score:
- 0 to 100 based on correctness, method, and reasoning
- 90-100: completely correct with good method
- 70-89: mostly correct, minor error
- 50-69: partially correct, on the right track
- 0-49: incorrect or fundamentally wrong approach

Rules for feedback:
- 1 to 2 sentences maximum
- Always encouraging, never condescending
- Celebrate what they got right even if wrong overall
- NEVER reveal the answer or any part of it in feedback
- If wrong, say something like "Good try! Let's work through this step by step" or "Nice thinking! There's one part we need to revisit"

Hint tier weighting — apply BEFORE returning score:
- hint_tier 0 (no hints used): score unchanged
- hint_tier 1: multiply score by 0.9
- hint_tier 2: cap score at 79 maximum
- hint_tier 3 or higher: cap score at 49 maximum
Current hint_tier: {hint_tier}
```

Parse JSON from response. Extract score and feedback.
Compute confidence_tag from final score:
- score >= 80: "confident"
- score 50-79: "shaky"
- score < 50: "struggling"

Return:
```python
{
    "score": int,
    "feedback": str,
    "confidence_tag": str,  # confident | shaky | struggling
}
```

On JSON parse failure: return { "score": 0, "feedback": "Let's try again!", "confidence_tag": "struggling" }

#### Function: get_hint(topic, question: str, student_answer: str, hint_tier: int) -> str

System prompt:
```
You are Buddy, a friendly AI tutor for a Cambridge Grade 6 Mathematics student.
{ABSOLUTE_RULE}
{build_topic_context(topic)}
```

Build tier_instruction based on hint_tier:

```
Tier 1 instruction:
The student got this question wrong and needs a gentle nudge.
QUESTION THEY WERE ASKED: {question}
THEIR INCORRECT ANSWER: {student_answer}

Give a Tier 1 hint: a conceptual recall nudge.
- Remind them of the relevant concept WITHOUT giving structure or steps
- Do NOT show any worked examples
- Do NOT break the problem into steps
- Ask ONE guiding question that points them in the right direction
- Keep it to 2-3 sentences maximum
- Be warm and encouraging

Tier 2 instruction:
The student is still struggling. Give a Tier 2 hint: a worked example.
QUESTION THEY WERE ASKED: {question}

- Show a fully worked example of a SIMILAR problem with DIFFERENT numbers
- Walk through each step clearly
- Make sure the example is genuinely different — different numbers, same concept
- End with "Now try your original question again!"
- Do NOT solve their actual question

Tier 3 instruction:
The student needs more support. Give a Tier 3 hint: process decomposition.
QUESTION THEY WERE ASKED: {question}

- Break the student's ACTUAL question into numbered sub-steps
- Do NOT compute or reveal any values — just name the steps
- Ask the student to attempt Step 1 only and tell you what they get
- Format: "Step 1: ... Step 2: ... Step 3: ..."
- End with "What do you get for Step 1?"

Tier 4 instruction:
The student needs a bigger scaffold. Give a Tier 4 hint: partial answer.
QUESTION THEY WERE ASKED: {question}

- Explicitly compute and reveal ONLY Step 1's result
- Say something like "Let me help with the first part: [step 1 result]"
- Ask the student to continue from Step 2 onward
- Do NOT reveal the final answer

Tier 5 instruction:
This is the final hint. Give a Tier 5 hint: near-complete walkthrough.
QUESTION THEY WERE ASKED: {question}

- Walk through EVERY step of the problem with full working shown
- Stop immediately before revealing the final answer
- Ask the student: "So what do you think the final answer is?"
- Make the last step obvious — they just need to complete it
- This is their last chance before we move to a full concept explanation
```

User message: `"Please give the hint as instructed."`

Returns: hint text string

#### Function: get_concept_explanation(topic, question: str) -> str

Called after all 5 hints are exhausted and student still cannot answer.

System prompt:
```
You are Buddy, a friendly AI tutor for a Cambridge Grade 6 Mathematics student.
{ABSOLUTE_RULE}
{build_topic_context(topic)}
```

User message:
```
The student has been unable to answer this question even after 5 hints:
QUESTION: {question}

Give a full concept explanation:
- Explain the underlying concept clearly and completely
- Use simple language appropriate for Grade 6
- Use a different example to illustrate (NOT the original question)
- ABSOLUTELY DO NOT state the answer to the original question above
- End with exactly this sentence: "Now I'm going to give you a fresh question on the same concept — let's see how you do!"
```

Returns: explanation text string

#### Function: get_session_summary(session, topic, turns: list) -> str

System prompt: `"You are Buddy, a friendly AI tutor."`

User message:
```
Generate a short, encouraging session summary for a student named {session.student_name}.

Session details:
- Topic: {topic.title}
- Questions asked: {session.questions_asked}
- Started at level: L1 (Getting started)
- Finished at level: {session.current_level}
- Key concepts covered: {', '.join(topic.key_concepts or [])}

Write 3-4 sentences:
1. Celebrate their effort and what they achieved
2. Mention specifically what level they reached
3. Note one or two concepts they practised
4. Encourage them to keep going

Keep it warm, specific, and age-appropriate for a 11-12 year old.
```

Returns: summary text string

#### Function: determine_next_action(session, confidence_tag: str, topic) -> dict

```python
def determine_next_action(session, confidence_tag: str, topic) -> dict:
    if confidence_tag == "confident":
        session.consecutive_confident += 1
        if session.consecutive_confident >= 2:
            # Check if at ceiling
            if session.current_level == topic.difficulty_ceiling:
                return {
                    "action": "session_complete",
                    "new_level": session.current_level,
                    "message": "session_complete"
                }
            else:
                new_level = get_next_level(session.current_level)
                session.current_level = new_level
                session.consecutive_confident = 0
                session.hint_tier = 0
                session.concept_reset_done = False
                return {
                    "action": "advance_level",
                    "new_level": new_level,
                    "show_hint_button": False
                }
        else:
            session.hint_tier = 0
            session.concept_reset_done = False
            return {
                "action": "next_question",
                "new_level": session.current_level,
                "show_hint_button": False
            }

    elif confidence_tag == "shaky":
        session.consecutive_confident = 0
        session.hint_tier = 0
        session.concept_reset_done = False
        return {
            "action": "next_question",
            "new_level": session.current_level,
            "show_hint_button": False
        }

    else:  # struggling
        session.consecutive_confident = 0
        return {
            "action": "show_hint_button",
            "new_level": session.current_level,
            "show_hint_button": True
        }
```

---

## 10. API ROUTES

### backend/main.py

Full FastAPI app. All routes inline in main.py — no separate router files for MVP.

#### App setup
```python
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import os, shutil
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="TutorSnap API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
```

#### Route: POST /api/upload

Request: multipart/form-data with field `file` (PDF)

Logic:
1. Validate file is PDF (filename.endswith('.pdf'))
2. Save file to UPLOAD_DIR/{filename}
3. Create Book row: subject="Mathematics", grade=6, filename, filepath, status="pending"
4. Commit
5. Start BackgroundTasks: background_tasks.add_task(run_ingestion, book.id, filepath, db_session)

Note: Background task needs its own db session — do NOT pass the request db session to the background task. Create a new SessionLocal() inside run_ingestion.

Response:
```json
{
    "book_id": 1,
    "filename": "maths_grade6.pdf",
    "status": "processing",
    "message": "Upload successful. Ingestion started."
}
```

Error: 400 if not PDF. 500 if save fails.

#### Route: GET /api/ingestion/{book_id}

Logic: Fetch book by id. If not found: 404.

Response:
```json
{
    "book_id": 1,
    "status": "done",
    "chapter_count": 8,
    "topic_count": 34,
    "error": null
}
```
status is one of: pending | processing | done | failed

#### Route: GET /api/books

Logic: Return all books ordered by created_at desc.

Response:
```json
[{
    "book_id": 1,
    "subject": "Mathematics",
    "grade": 6,
    "filename": "maths_grade6.pdf",
    "status": "done",
    "chapter_count": 8,
    "topic_count": 34,
    "created_at": "2024-01-01T10:00:00"
}]
```

#### Route: GET /api/topics/{book_id}

Logic: Fetch book, then all chapters for that book ordered by chapter_number,
each with their topics ordered by id.

Response:
```json
{
    "book_id": 1,
    "subject": "Mathematics",
    "grade": 6,
    "status": "done",
    "chapters": [{
        "id": 1,
        "chapter_number": 1,
        "title": "Integers and Directed Numbers",
        "topics": [{
            "id": 1,
            "topic_number": "1.1",
            "title": "Introduction to Negative Numbers",
            "difficulty_ceiling": "L3",
            "key_concepts": ["concept1", "concept2"],
            "vocabulary": ["term1", "term2"]
        }]
    }]
}
```

#### Route: POST /api/session/start

Request body:
```json
{
    "student_name": "Arjun",
    "topic_id": 5
}
```

Logic:
1. Validate student_name not empty, topic_id exists
2. Fetch topic (with chapter and book via joins)
3. Check/create TopicMastery for student_name + topic_id
4. Determine start_level: get_start_level(mastery.mastery_level)
5. Create Session: student_name, topic_id, current_level=start_level, status="active"
6. Commit
7. Fetch previous questions for this student on this topic (from old session_turns, limit 10)
8. Call generate_question(topic, start_level, previous_questions)
9. Create SessionTurn: session_id, turn_number=1, question_text=question, level=start_level
10. Commit
11. Update session.questions_asked = 1, commit

Response:
```json
{
    "session_id": 1,
    "topic_title": "Introduction to Negative Numbers",
    "chapter_title": "Integers and Directed Numbers",
    "student_name": "Arjun",
    "current_level": "L1",
    "level_label": "Getting started",
    "message": "Hi Arjun! Let's practise Introduction to Negative Numbers.\n\n[question text here]",
    "show_hint_button": false,
    "turn_number": 1
}
```

The message should open with a greeting incorporating student_name and topic title, then the question on a new line.

#### Route: POST /api/session/answer

Request body:
```json
{
    "session_id": 1,
    "answer": "The answer is -5"
}
```

Logic:
1. Fetch session by id. If not found: 404. If status="completed": 400 with message "Session already completed"
2. Fetch topic (with chapter, book)
3. Get current turn: latest session_turn for this session
4. Validate answer not empty
5. Call assess_answer(topic, current_turn.question_text, answer, session.current_level, session.hint_tier)
6. Update current_turn: student_answer=answer, assessment_score, confidence_tag, hint_tier_used=session.hint_tier
7. Call determine_next_action(session, confidence_tag, topic)
8. Commit session changes

9. If action == "session_complete":
   - Mark session complete (set ended_at, status="completed", final_confidence=confidence_tag)
   - Update topic_mastery
   - Call get_session_summary()
   - Return response with session_complete=true, summary text

10. If action == "advance_level":
    - Generate next question at new level
    - Create new SessionTurn
    - Update session.questions_asked
    - Commit

11. If action == "next_question":
    - Generate next question at same level
    - Create new SessionTurn
    - Update session.questions_asked
    - Commit

12. If action == "show_hint_button":
    - Do NOT generate next question yet
    - Just return with show_hint_button=true

Response (normal):
```json
{
    "session_id": 1,
    "feedback": "Great work! You correctly identified...",
    "score": 85,
    "confidence_tag": "confident",
    "action": "advance_level",
    "current_level": "L2",
    "level_label": "Building up",
    "show_hint_button": false,
    "session_complete": false,
    "next_question": "What is the sum of -3 and 7?",
    "turn_number": 2
}
```

Response (session complete):
```json
{
    "session_id": 1,
    "feedback": "Amazing! You've mastered this topic!",
    "score": 90,
    "confidence_tag": "confident",
    "action": "session_complete",
    "current_level": "L3",
    "level_label": "Practising",
    "show_hint_button": false,
    "session_complete": true,
    "summary": "Fantastic work, Arjun! You completed the session on Negative Numbers...",
    "turn_number": 4
}
```

Response (hint needed):
```json
{
    "session_id": 1,
    "feedback": "Good try! There's one part we need to revisit. Would you like a hint?",
    "score": 30,
    "confidence_tag": "struggling",
    "action": "show_hint_button",
    "current_level": "L1",
    "level_label": "Getting started",
    "show_hint_button": true,
    "session_complete": false,
    "next_question": null,
    "turn_number": 1
}
```

#### Route: POST /api/session/hint

Request body:
```json
{
    "session_id": 1
}
```

Logic:
1. Fetch session. If not found: 404. If completed: 400.
2. Fetch topic
3. Get current turn (latest turn for this session)
4. Increment session.hint_tier by 1
5. max_hints = int(os.getenv("MAX_HINT_TIERS", 5))

6. If session.hint_tier > max_hints and not session.concept_reset_done:
   - session.concept_reset_done = True
   - Call get_concept_explanation(topic, current_turn.question_text)
   - Generate fresh question at same level (call generate_question)
   - Create new SessionTurn with new question
   - session.hint_tier = 0 (reset for fresh question)
   - session.questions_asked += 1
   - Commit
   - Return with is_concept_reset=true, fresh_question included

7. If session.hint_tier > max_hints and session.concept_reset_done:
   - This means student failed even after concept reset
   - session.flagged_for_review = True
   - Update topic_mastery: flagged_for_review = True
   - Generate next question on different subtopic OR end session
   - For MVP: just end the session gracefully
   - Commit
   - Return with flagged=true

8. Otherwise: call get_hint(topic, question, student_answer, session.hint_tier)
9. Commit

Response (normal hint):
```json
{
    "session_id": 1,
    "hint_message": "Think about which direction you move on the number line when...",
    "hint_tier": 1,
    "is_final_hint": false,
    "is_concept_reset": false,
    "flagged": false,
    "fresh_question": null
}
```

Response (concept reset):
```json
{
    "session_id": 1,
    "hint_message": "Let me explain how negative numbers work...\n\nNow I'm going to give you a fresh question on the same concept!",
    "hint_tier": 6,
    "is_final_hint": false,
    "is_concept_reset": true,
    "flagged": false,
    "fresh_question": "If the temperature is -2°C and drops by 3 degrees, what is the new temperature?"
}
```

#### Route: POST /api/session/end

Request body:
```json
{
    "session_id": 1
}
```

Logic:
1. Fetch session. If not found: 404. If already completed: return current state.
2. Fetch topic
3. Mark session: status="completed", ended_at=now, final_confidence based on last turn
4. Update or create TopicMastery:
   - mastery_level = session.current_level
   - last_practiced_at = now
   - increment total_sessions
   - flagged_for_review = session.flagged_for_review
5. Call get_session_summary(session, topic, turns)
6. Commit

Response:
```json
{
    "session_id": 1,
    "student_name": "Arjun",
    "topic_title": "Introduction to Negative Numbers",
    "level_reached": "L3",
    "level_label": "Practising",
    "questions_asked": 6,
    "summary": "Fantastic effort today, Arjun! ...",
    "flagged_for_review": false
}
```

---

## 11. FRONTEND

### frontend/src/api/client.js

```javascript
import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' }
})

export const uploadPDF = (formData) =>
  api.post('/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })

export const getIngestionStatus = (bookId) =>
  api.get(`/ingestion/${bookId}`)

export const getBooks = () =>
  api.get('/books')

export const getTopics = (bookId) =>
  api.get(`/topics/${bookId}`)

export const startSession = (studentName, topicId) =>
  api.post('/session/start', { student_name: studentName, topic_id: topicId })

export const submitAnswer = (sessionId, answer) =>
  api.post('/session/answer', { session_id: sessionId, answer })

export const requestHint = (sessionId) =>
  api.post('/session/hint', { session_id: sessionId })

export const endSession = (sessionId) =>
  api.post('/session/end', { session_id: sessionId })
```

### frontend/src/App.jsx

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Admin from './pages/Admin'
import TopicSelect from './pages/TopicSelect'
import Chat from './pages/Chat'
import Summary from './pages/Summary'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TopicSelect />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/session/:id" element={<Chat />} />
        <Route path="/summary/:id" element={<Summary />} />
      </Routes>
    </BrowserRouter>
  )
}
```

### frontend/src/main.jsx

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

### frontend/src/index.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background-color: #f0fdf4;
  font-family: 'Inter', system-ui, sans-serif;
}
```

---

### Page: Admin.jsx (/admin)

Layout: centered max-w-3xl, white card, padding.

Header:
- "TutorSnap" in brand green, bold, large
- Subtitle: "Admin — Upload Textbook PDF"
- Small link at bottom right: "← Student view" linking to /

Upload section:
- Label: "Cambridge Mathematics Grade 6"
- File input: accept=".pdf" only
- When file selected: show filename
- "Upload & Extract" button: green, disabled while uploading
- On click: call uploadPDF(formData), store returned book_id

Ingestion progress section (shown after upload):
- While status is "processing": spinning indicator + "Extracting chapters and topics..."
- Poll getIngestionStatus(book_id) every 3000ms
- On "done": show green checkmark + "Success! X chapters and Y topics extracted"
- On "failed": show red error message + book.error

Topic tree section (shown when status is "done"):
- Call getTopics(book_id)
- Render each chapter as a collapsible section:
  - Chapter header: bold, chapter number + title + count of topics
  - When expanded: list of topics
  - Each topic shows:
    - Topic number + title
    - Difficulty ceiling badge (small pill: L3 in green, L4 in blue, L5 in purple)
    - Key concepts as small grey pills
- All chapters expanded by default

### Page: TopicSelect.jsx (/)

Layout: centered max-w-2xl, full page.

Header:
- TutorSnap logo text in brand green, large
- Tagline: "Your Cambridge Maths study buddy 📚"

Student name section:
- Label: "What's your name?"
- Text input, placeholder: "Enter your name"
- Name stored in component state

Book/topic section:
- On mount: call getBooks(), find the first book with status="done"
- If no book found: show message "No textbook uploaded yet. Ask your teacher to upload the PDF."
- If book found: call getTopics(book.id)
- Render chapter accordion:
  - Chapter button: bold title + topic count
  - Click to expand/collapse
  - Topic list: each topic is a card with:
    - Topic title (bold)
    - Difficulty badge
    - "Start Practice" button (green)

On "Start Practice":
- Validate name is not empty (show red error if empty: "Please enter your name")
- Call startSession(studentName, topicId)
- Navigate to /session/{session_id}
- Store { sessionId, studentName, topicTitle, chapterTitle, initialMessage, currentLevel, levelLabel } in sessionStorage

### Page: Chat.jsx (/session/:id)

On mount: load session data from sessionStorage. Display initial message from Buddy.

Layout: full height flex column.

Top bar (fixed):
- Left: TutorSnap logo (small)
- Center: topic title (truncated)
- Right: level badge (ProgressBadge component) + "End Session" button (grey, small)

Message area (scrollable, flex-1):
- Messages rendered as ChatBubble components
- Auto-scroll to bottom on new message
- Initial message: Buddy's greeting + first question (from sessionStorage)

Input area (fixed bottom):
- Text input: placeholder "Type your answer..."
- Send button: "Send" in green
- Enter key submits
- Disabled while waiting for API response
- Show loading spinner in send button while waiting

Hint button area (between messages and input):
- HintButton component
- Only visible when showHintButton === true
- On click: call requestHint(sessionId)
- After click: add hint message to chat, update showHintButton based on response
- If is_concept_reset: also display fresh_question as next Buddy message
- If hint_tier >= 5: change button label to "Get full explanation"
- Hide after concept reset (reset on new question)

Message flow:
1. Buddy message shows initial question
2. Student types answer, clicks Send
3. POST /api/session/answer
4. Add Buddy message with feedback
5. If session_complete: navigate to /summary/:id after 2 second delay
6. If next_question: add new Buddy message with next question
7. If show_hint_button: show HintButton
8. If action=="advance_level": add Buddy message "Great job! Let's try something a bit harder 🎉" + new question

End Session button:
- Show confirmation: "Are you sure you want to end this session?"
- On confirm: POST /api/session/end, navigate to /summary/:id

### Page: Summary.jsx (/summary/:id)

On mount: GET /api/session/end (or use stored summary from navigation state).
If navigating from Chat with session_complete, the summary is already in state.
Otherwise call endSession(sessionId) to get summary.

Layout: centered, card, celebration feel.

Content:
- Large checkmark or star emoji at top
- "Session Complete!" heading in brand green
- Student name: "Great work, {name}!"
- Topic: "{topicTitle}" in grey subtitle
- Level reached: ProgressBadge showing final level
- Summary text from API (Buddy's encouraging message)
- Divider
- "Concepts you practised today:" — key_concepts as pills
- Two buttons:
  - "Practice this topic again" → navigate to / and auto-select same topic (pass topicId in state)
  - "Choose another topic" → navigate to /

---

### Component: ChatBubble.jsx

Props: { message: string, sender: 'buddy' | 'student', isLoading: boolean }

Buddy bubble: left-aligned, teal/green background, "B" avatar circle
Student bubble: right-aligned, white background, grey border
Loading state: show three animated dots

### Component: HintButton.jsx

Props: { onHint: function, hintTier: number, isLoading: boolean, isFinalHint: boolean }

Renders as a subtle button below the message area.
Label logic:
- tier 0 (first hint): "Need a hint? 💡"
- tier 1-4: "Get another hint"
- tier 5 (final): "Get full explanation"
Show small text: "Hint {tier}/5" (don't show this for concept reset)
Style: outline button, amber/yellow colour, not too prominent

### Component: ProgressBadge.jsx

Props: { level: string }

Level to label mapping:
```javascript
const LABELS = {
  L1: "Getting started",
  L2: "Building up",
  L3: "Practising",
  L4: "Going deeper",
  L5: "Challenge mode"
}
const COLORS = {
  L1: "bg-gray-100 text-gray-700",
  L2: "bg-blue-100 text-blue-700",
  L3: "bg-green-100 text-green-700",
  L4: "bg-purple-100 text-purple-700",
  L5: "bg-orange-100 text-orange-700"
}
```

Renders as a small pill/badge showing the label.

---

## 12. VITE CONFIG (proxy)

### frontend/vite.config.js
```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
})
```

This proxies all /api/* requests to the FastAPI backend. No CORS issues during development.

---

## 13. GITIGNORE

Create .gitignore at project root:
```
__pycache__/
*.py[cod]
.venv/
venv/
.env
backend/uploads/
*.db
node_modules/
frontend/dist/
.DS_Store
```

---

## 14. BUILD ORDER FOR CLAUDE CODE

Build in exactly this order. Verify each step before continuing.

### PHASE A — Database
1. Create backend/database.py
2. Create backend/models.py with all 6 models
3. Create backend/.env (template — user fills in credentials)
4. Create backend/requirements.txt
5. Run: pip install -r requirements.txt
6. Run: alembic init alembic
7. Edit alembic/env.py to load dotenv and use DATABASE_URL
8. Run: alembic revision --autogenerate -m "initial schema"
9. Run: alembic upgrade head
10. VERIFY: psql -U postgres -d tutorsnap -c "\dt" should show all 6 tables

### PHASE B — Ingestion
11. Create backend/ingestion.py with all 3 functions
12. Create uploads/ directory
13. VERIFY: python -c "from ingestion import parse_pdf; chunks = parse_pdf('uploads/test.pdf'); print(f'Found {len(chunks)} topic chunks')" — skip if no PDF yet

### PHASE C — Session Engine
14. Create backend/session_engine.py with all functions
15. VERIFY: python -c "from session_engine import ABSOLUTE_RULE; print('ABSOLUTE_RULE loaded')"

### PHASE D — API
16. Create backend/main.py with FastAPI app and all 8 routes
17. Run: uvicorn main:app --reload --port 8000
18. VERIFY each route with curl:
    - curl -X GET http://localhost:8000/api/books
    - curl -X POST http://localhost:8000/api/upload -F "file=@test.pdf" (if PDF available)

### PHASE E — Frontend
19. cd frontend && npm install
20. Create all frontend files in order:
    - src/index.css
    - src/main.jsx
    - src/App.jsx
    - src/api/client.js
    - src/components/ChatBubble.jsx
    - src/components/HintButton.jsx
    - src/components/ProgressBadge.jsx
    - src/pages/Admin.jsx
    - src/pages/TopicSelect.jsx
    - src/pages/Chat.jsx
    - src/pages/Summary.jsx
21. Run: npm run dev
22. VERIFY: open http://localhost:5173/admin — should see upload form

### PHASE F — End-to-end test
23. Upload the Cambridge Maths Grade 6 PDF via /admin
24. Wait for ingestion to complete (watch chapter/topic count appear)
25. Go to / — enter name, pick a topic, start practice
26. Answer a question correctly twice — verify level advances
27. Answer a question wrong — verify hint button appears
28. Click hint 5 times — verify all 5 tiers appear, then concept explanation
29. End session — verify summary page

---

## 15. HOW TO RUN (print this at the end)

```bash
# One-time database setup
psql -U postgres -c "CREATE DATABASE tutorsnap;"

# Terminal 1 — Backend
cd tutorsnap/backend
pip install -r requirements.txt
alembic upgrade head
uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend
cd tutorsnap/frontend
npm install
npm run dev

# Open in browser:
# Admin:   http://localhost:5173/admin
# Student: http://localhost:5173
```

---

## 16. COMMON MISTAKES TO AVOID

- Do NOT pass the FastAPI request db session to background tasks — create a new SessionLocal() inside run_ingestion
- Do NOT forget ABSOLUTE_RULE in every Claude API call in session_engine.py
- Do NOT use json.loads on the whole Claude response — extract .content[0].text first, then parse
- Do NOT generate a new question in /session/answer when action is "show_hint_button" — wait for the hint flow
- Do NOT reset hint_tier to 0 after a shaky or struggling answer — only reset when a new question is issued
- Do NOT block the upload response waiting for ingestion — use BackgroundTasks
- Do NOT hardcode subject or grade — read from the book row joined through topic → chapter → book
- DO ensure all Claude calls have max_tokens set explicitly
- DO handle JSON parse failures in assess_answer with a safe fallback
- DO scroll Chat.jsx message container to bottom after every new message

---

## 17. PHASE B — AUTH, ROLES & EXTENDED FEATURES

This section documents all additions made after the original MVP spec. The core session/ingestion logic is unchanged. Everything below is additive.

---

### 17.1 NEW ENVIRONMENT VARIABLES

#### backend/.env additions
```
GOOGLE_CLIENT_ID=<from Google Cloud Console OAuth 2.0 credentials>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
JWT_SECRET=<any long random hex string>
JWT_EXPIRY_HOURS=24
ADMIN_EMAILS=admin@example.com
DISABLE_DEV_LOGIN=false
```

`ADMIN_EMAILS` is a comma-separated list of Google email addresses that get `role=admin` automatically on first sign-in. Everyone else gets `role=student`.

`DISABLE_DEV_LOGIN` — set to `true` in production to block the dev login endpoint.

#### frontend/.env
```
VITE_GOOGLE_CLIENT_ID=<same as GOOGLE_CLIENT_ID above>
```

---

### 17.2 NEW BACKEND DEPENDENCIES

Add to `backend/requirements.txt`:
```
PyJWT==2.9.0
google-auth==2.35.0
```

`google-auth` provides `google.oauth2.id_token.verify_oauth2_token` for validating Google ID tokens server-side.
`PyJWT` issues and validates the app's own JWTs.

---

### 17.3 NEW DATABASE MODELS

Four new models in `backend/models.py`. The existing models are unchanged except `Session` gains a nullable `user_id` FK.

#### Model: User
Table name: users
```
id              Integer, primary key, autoincrement
email           String(255), unique, not null
name            String(200), not null
google_id       String(200), unique, not null
                -- stub parents use "stub_{email}" until they sign in via Google
avatar_url      String(500), nullable
role            String(20), not null, default='student'
                -- allowed values: student | parent | admin
grade           Integer, nullable
is_active       Boolean, default=True
created_at      DateTime, default=datetime.utcnow
last_login_at   DateTime, nullable

relationships:  parent_links (ParentStudentLink where parent_id=self)
                student_links (ParentStudentLink where student_id=self)
                notifications (Notification)
                sessions (Session)
```

#### Model: ParentStudentLink
Table name: parent_student_links
```
id              Integer, primary key, autoincrement
parent_id       Integer, ForeignKey users.id, not null
student_id      Integer, ForeignKey users.id, not null
created_at      DateTime, default=datetime.utcnow

UniqueConstraint: parent_id + student_id
```

#### Model: Notification
Table name: notifications
```
id                  Integer, primary key, autoincrement
user_id             Integer, ForeignKey users.id, not null
type                String(50), not null   -- e.g. "flagged_for_review"
title               String(200), not null
body                Text, not null
is_read             Boolean, default=False
related_topic_id    Integer, ForeignKey topics.id, nullable
related_session_id  Integer, ForeignKey sessions.id, nullable
created_at          DateTime, default=datetime.utcnow
```

Notifications are created automatically when a student exhausts all hints including concept reset (i.e., gets `flagged=true`). All parents linked to that student receive a notification.

#### Model: AppSettings
Table name: app_settings
```
id          Integer, primary key, autoincrement
key         String(100), unique, not null
value       Text, not null
updated_by  Integer, ForeignKey users.id, nullable
updated_at  DateTime, default=datetime.utcnow
```

Three default settings are seeded at startup:
- `max_questions_per_session` = "20"
- `max_hint_tiers` = "5"
- `session_timeout_minutes` = "30"

#### Session model change
`Session` gains one new column:
```
user_id     Integer, ForeignKey users.id, nullable
```
Used to tie sessions to authenticated users and enforce ownership checks.

---

### 17.4 AUTH MODULE (backend/auth.py)

Standalone module. Provides:

#### verify_google_token(token: str) -> dict
Calls `google.oauth2.id_token.verify_oauth2_token` with `GOOGLE_CLIENT_ID`.
Returns `{ google_id, email, name, avatar_url }`.
Raises `ValueError` on invalid token.

#### create_jwt(user_id, email, role) -> str
Signs a HS256 JWT with `JWT_SECRET`. Expires in `JWT_EXPIRY_HOURS` hours.
Payload: `{ user_id, email, role, exp, iat }`.

#### decode_jwt(token) -> dict
Decodes and validates the JWT. Raises `ValueError` on expiry or invalid signature.

#### get_current_user(authorization: str = Header, db) -> User
FastAPI dependency. Extracts Bearer token from `Authorization` header.
Decodes JWT, fetches User from DB, checks `is_active`.
Raises HTTP 401 if missing/invalid/inactive.

#### require_admin(current_user = Depends(get_current_user)) -> User
Raises HTTP 403 if `role != "admin"`.

#### require_parent(current_user = Depends(get_current_user)) -> User
Raises HTTP 403 if `role not in ["parent", "admin"]`. (Admins can access parent views.)

---

### 17.5 AUTH API ROUTES

All mounted at `/api/auth/`.

#### POST /api/auth/google
Request: `{ "credential": "<Google ID token>" }`

Logic:
1. Call `verify_google_token(credential)` → fails with 401 if invalid
2. Look up user by `google_id`, then by `email` (for stub parents upgrading to real login)
3. If stub found (`google_id.startswith("stub_")`): replace stub google_id with real one
4. If no user: create with `role=admin` if email in `ADMIN_EMAILS`, else `role=student`
5. Update `name`, `avatar_url`, `last_login_at`
6. Check `is_active` — raise 403 if deactivated
7. Issue JWT

Response:
```json
{
  "access_token": "<jwt>",
  "token_type": "bearer",
  "user": { "id": 1, "email": "...", "name": "...", "role": "student", "grade": null, "avatar_url": "...", "is_active": true, "created_at": "...", "last_login_at": "..." },
  "requires_setup": true
}
```
`requires_setup` is true when `role == "student"` and `grade == null` — front-end can use this to prompt grade selection.

#### GET /api/auth/me
Auth required. Returns `_user_dict(current_user)`.

#### POST /api/auth/logout
No-op on the server (JWTs are stateless). Returns `{ "message": "Logged out" }`.
The client deletes the token from localStorage.

#### POST /api/auth/dev-login (localhost/dev only)
Request: `{ "email": "user@example.com" }`

Disabled when `DISABLE_DEV_LOGIN=true`. Creates or returns user with `google_id="dev_{email}"`.
Role assignment follows same `ADMIN_EMAILS` rule.
Returns same shape as `/api/auth/google`.

---

### 17.6 UPDATED EXISTING ROUTES (auth enforcement)

After adding auth, the existing routes gain `Depends(...)` guards:

| Route | Guard |
|---|---|
| POST /api/upload | `require_admin` |
| GET /api/ingestion/{book_id} | `require_admin` |
| GET /api/books | `get_current_user` (any authenticated user) |
| GET /api/topics/{book_id} | `get_current_user` |
| POST /api/session/start | `get_current_user` + checks `role == "student"` |
| POST /api/session/answer | `get_current_user` + checks session ownership |
| POST /api/session/hint | `get_current_user` + checks session ownership |
| POST /api/session/end | `get_current_user` + checks session ownership |

Session ownership check: `session.user_id` may be `None` (legacy sessions) — only enforce if `user_id` is set.

---

### 17.7 ADMIN API ROUTES

All require `require_admin`. Prefix: `/api/admin/`.

| Method | Path | Description |
|---|---|---|
| GET | /admin/students | All users with role=student, with stats (total_sessions, topics_mastered, flagged_topics) |
| GET | /admin/students/{id} | Student detail: mastery list, recent sessions, linked parent names |
| POST | /admin/students/{id}/grade | Set student.grade |
| POST | /admin/students/{id}/deactivate | Set is_active=False |
| POST | /admin/students/{id}/activate | Set is_active=True |
| POST | /admin/students/{id}/reset-mastery | Delete all TopicMastery rows for student (requires `{"confirm": true}`) |
| GET | /admin/parents | All users with role=parent, each with children list |
| POST | /admin/parents | Create parent user. If email already exists: upgrade to parent role. Otherwise: create stub user with `google_id="stub_{email}"` — they claim the account when they sign in via Google |
| POST | /admin/parents/{id}/link-student | Create ParentStudentLink |
| DELETE | /admin/parents/{id}/unlink-student/{student_id} | Delete ParentStudentLink |
| GET | /admin/flagged | All TopicMastery rows with flagged_for_review=True |
| POST | /admin/flagged/{student_id}/{topic_id}/resolve | Set flagged_for_review=False on that mastery row |
| GET | /admin/settings | Returns all AppSettings as `{ key: value }` dict |
| PUT | /admin/settings | Upsert settings. Body: `{ "max_hint_tiers": "5", ... }` |
| GET | /admin/reports/overview | Dashboard KPIs: total_students, active_this_week, sessions_this_week, flagged_students, books_uploaded, topics_available |

---

### 17.8 PARENT API ROUTES

Accessible to `role=parent` and `role=admin`. Prefix: `/api/parent/`.

| Method | Path | Description |
|---|---|---|
| GET | /parent/children | List of linked students with last_active, topics_practised, flagged_topics |
| GET | /parent/children/{id} | Full child detail: summary stats, topic mastery list, recent sessions, flagged topics list |
| GET | /parent/children/{id}/sessions | Paginated session list. Query params: limit (default 20), offset (default 0) |
| GET | /parent/notifications | All notifications for current parent, ordered newest first |
| POST | /parent/notifications/{id}/read | Mark notification as read |

Parent access is enforced by `ParentStudentLink` — a parent can only access children they are linked to. The 403 check is: fetch link where `parent_id=current_user.id AND student_id=requested_id`; if missing, raise 403.

---

### 17.9 FRONTEND AUTH STRUCTURE

New files added to `frontend/src/`:

#### frontend/.env
```
VITE_GOOGLE_CLIENT_ID=<same as backend GOOGLE_CLIENT_ID>
```

#### src/auth/AuthContext.jsx
React context providing `{ user, loading, login, logout }`.

- On mount: reads `tutorsnap_token` from localStorage. If present, calls `GET /api/auth/me` to hydrate `user`. On 401, clears token.
- `login(token, userData)`: saves token to localStorage, sets user state.
- `logout()`: removes token from localStorage, clears user state.

#### src/auth/ProtectedRoute.jsx
Wraps any route element. Props: `{ children, roles }`.

- While `loading`: shows centered "Loading…" spinner.
- If `!user`: redirects to `/login`.
- If `roles` provided and `user.role` not in `roles`: redirects to `/unauthorized`.

#### src/pages/Login.jsx
Single sign-in page for all roles. Route: `/login`.

- Google sign-in button via `@react-oauth/google`'s `<GoogleLogin>` component.
  - `onSuccess`: POSTs credential to `/api/auth/google`, calls `login()`, redirects by role.
  - `onError`: shows error message.
- After successful login, `redirectByRole(role)`:
  - `admin` → `/admin`
  - `parent` → `/parent`
  - `student` → `/`
- Dev login form (shown only when `import.meta.env.DEV === true`): email input + submit → POST `/api/auth/dev-login`.

#### src/pages/Unauthorized.jsx
Simple page shown when a signed-in user hits a route they don't have permission for.

#### src/App.jsx (updated)
- Wrapped with `<GoogleOAuthProvider clientId={VITE_GOOGLE_CLIENT_ID}>` and `<AuthProvider>`.
- New routes:
  - `/login` → `<Login />`
  - `/unauthorized` → `<Unauthorized />`
- All existing routes wrapped in `<ProtectedRoute roles={[...]}>`.
- Admin routes nested under `/admin` with `AdminLayout` as parent.
- Parent routes nested under `/parent` with `ParentLayout` as parent.
- Catch-all `*` → redirect to `/login`.

Route → role mapping:
```
/                      roles: ['student']
/session/:id           roles: ['student']
/summary/:id           roles: ['student']
/admin/*               roles: ['admin']
/parent/*              roles: ['parent', 'admin']
```

---

### 17.10 ADMIN FRONTEND PAGES

All under `src/pages/admin/`, nested inside `<AdminLayout>` (sidebar nav).

| File | Route | Purpose |
|---|---|---|
| AdminLayout.jsx | /admin | Sidebar with nav links, Outlet |
| AdminDashboard.jsx | /admin (index) | KPI cards from /admin/reports/overview, quick links |
| AdminStudents.jsx | /admin/students | Student table with search, stats, activate/deactivate |
| AdminStudentDetail.jsx | /admin/students/:id | Mastery table, recent sessions, linked parents, grade edit |
| AdminParents.jsx | /admin/parents | Parent list, create parent form, link/unlink student |
| AdminFlagged.jsx | /admin/flagged | Flagged students table, resolve button |
| AdminSettings.jsx | /admin/settings | Edit max_hint_tiers, max_questions_per_session, etc. |
| AdminBooks.jsx | /admin/books | Upload PDF, ingestion status, topic tree (replaces old Admin.jsx) |

---

### 17.11 PARENT FRONTEND PAGES

All under `src/pages/parent/`, nested inside `<ParentLayout>` (header + nav tabs).

| File | Route | Purpose |
|---|---|---|
| ParentLayout.jsx | /parent | Header, tab nav, Outlet |
| ParentDashboard.jsx | /parent (index) | Child cards with last active and flagged count |
| ParentChildDetail.jsx | /parent/children/:id | Summary stats, topic mastery list, recent sessions, flagged topics |
| ParentNotifications.jsx | /parent/notifications | Notification list with mark-as-read |

---

### 17.12 AXIOS CLIENT (updated)

`src/api/client.js` updated to:
1. Add `Authorization: Bearer <token>` header to every request via request interceptor (reads from `localStorage.tutorsnap_token`).
2. On 401 response: clear token from localStorage and redirect to `/login` via response interceptor.

New API functions added:
```javascript
// Auth
export const googleLogin = (credential) => api.post('/auth/google', { credential })
export const getCurrentUser = () => api.get('/auth/me')
export const logout = () => api.post('/auth/logout')
export const devLogin = (email) => api.post('/auth/dev-login', { email })

// Admin
export const getAdminStudents = () => api.get('/admin/students')
export const getAdminStudent = (id) => api.get(`/admin/students/${id}`)
export const updateStudentGrade = (id, grade) => api.post(`/admin/students/${id}/grade`, { grade })
export const deactivateStudent = (id) => api.post(`/admin/students/${id}/deactivate`)
export const activateStudent = (id) => api.post(`/admin/students/${id}/activate`)
export const resetStudentMastery = (id) => api.post(`/admin/students/${id}/reset-mastery`, { confirm: true })
export const getAdminParents = () => api.get('/admin/parents')
export const createParent = (email, name) => api.post('/admin/parents', { email, name })
export const linkStudentToParent = (parentId, studentId) =>
  api.post(`/admin/parents/${parentId}/link-student`, { student_id: studentId })
export const unlinkStudentFromParent = (parentId, studentId) =>
  api.delete(`/admin/parents/${parentId}/unlink-student/${studentId}`)
export const getFlaggedStudents = () => api.get('/admin/flagged')
export const resolveFlag = (studentId, topicId) =>
  api.post(`/admin/flagged/${studentId}/${topicId}/resolve`)
export const getSettings = () => api.get('/admin/settings')
export const updateSettings = (settings) => api.put('/admin/settings', settings)
export const getAdminOverview = () => api.get('/admin/reports/overview')

// Parent
export const getMyChildren = () => api.get('/parent/children')
export const getChildDetail = (id) => api.get(`/parent/children/${id}`)
export const getChildSessions = (id, limit = 20, offset = 0) =>
  api.get(`/parent/children/${id}/sessions?limit=${limit}&offset=${offset}`)
export const getParentNotifications = () => api.get('/parent/notifications')
export const markNotificationRead = (id) => api.post(`/parent/notifications/${id}/read`)
```

---

### 17.13 FRONTEND PACKAGE ADDITIONS

Install in `frontend/`:
```bash
npm install @react-oauth/google
```

`@react-oauth/google` wraps the Google Identity Services (GIS) library. Use `<GoogleOAuthProvider>` at the root and `<GoogleLogin>` on the login page.

---

### 17.14 HOW ROLES WORK END-TO-END

1. **Admin**: Email must be in `ADMIN_EMAILS` env var. First Google sign-in auto-assigns `role=admin`. Admins access `/admin/*` and can also access `/parent/*` to see parent views.

2. **Parent**: Admin creates parent via POST `/api/admin/parents` with their email. A stub User row is created with `google_id="stub_{email}"`. When the parent signs in via Google, the stub is claimed: `google_id` is replaced with the real Google ID. Admin then links children via POST `/api/admin/parents/{id}/link-student`.

3. **Student**: Any Google account not in `ADMIN_EMAILS` gets `role=student`. Students access `/` and `/session/*` only.

---

### 17.15 MIGRATION NOTE

Two Alembic migrations were added after the initial schema:

1. `add_auth_and_user_tables` — adds `users`, `parent_student_links`, `notifications`, `app_settings` tables; adds `user_id` column to `sessions`.
2. `add_exercises_to_topics` — adds `exercises` JSON column to `topics` (for future use, currently nullable and unused).

Run `alembic upgrade head` to apply both.
