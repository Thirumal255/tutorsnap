"""
Ingestion pipeline for TutorSnap.
Supports both native-text PDFs and scanned/image PDFs.
For scanned PDFs, uses Claude vision to extract structure and content.
Set CHAPTER_LIMIT env var to limit chapters ingested (useful for testing).
"""
import fitz  # PyMuPDF
import json
import os
import base64
import anthropic
from dotenv import load_dotenv

load_dotenv(override=True)

_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-5-20250929")


def _repair_json(text: str) -> str:
    """Best-effort repair of truncated JSON by balancing brackets."""
    # Truncate at last complete object (last closing brace before any incomplete content)
    depth = 0
    last_good = 0
    in_str = False
    escape = False
    for i, ch in enumerate(text):
        if escape:
            escape = False
            continue
        if ch == '\\' and in_str:
            escape = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch in ('{', '['):
            depth += 1
        elif ch in ('}', ']'):
            depth -= 1
            if depth == 0:
                last_good = i + 1
    return text[:last_good] if last_good else text


# ─── helpers ──────────────────────────────────────────────────────────────────

def _render_page_b64(page, scale: float = 1.5) -> str:
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat)
    return base64.standard_b64encode(pix.tobytes("png")).decode()


def _is_scanned(doc) -> bool:
    """Return True if the PDF has no extractable text (scanned)."""
    for pg in range(min(5, doc.page_count)):
        if doc[pg].get_text().strip():
            return False
    return True


# ─── structure detection (one call with sampled pages) ────────────────────────

def _detect_structure(doc, subject: str = "General", grade: int = 0) -> list[dict]:
    """
    Send sampled pages to Claude vision to identify chapter structure.
    Samples the first 12 pages (covers TOC) + distributed pages through the book.
    Returns list of chapter dicts with page_start (1-based).
    """
    total = doc.page_count

    # Always include the first 12 pages — the TOC is almost always here
    early = list(range(min(12, total)))
    # Plus pages spread through the rest of the book to catch later chapters
    distributed = [
        total // 5, total * 2 // 5, total * 3 // 5, total * 4 // 5,
        total - 2,
    ]
    all_indices = early + [min(max(0, i), total - 1) for i in distributed]
    sample_indices = sorted(set(all_indices))

    content = []
    for pg in sample_indices:
        img_b64 = _render_page_b64(doc[pg], scale=1.2)
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": img_b64},
        })
        content.append({"type": "text", "text": f"(page {pg + 1} of {total})"})

    grade_str = f"Grade {grade}" if grade else ""
    content.append({
        "type": "text",
        "text": (
            f"This is a {grade_str} {subject} textbook with {total} pages.\n"
            "Look carefully at the table of contents pages and any chapter title pages.\n"
            "Identify ALL chapter titles and their starting page numbers.\n"
            "Return ONLY valid JSON — no markdown, no explanation:\n"
            '{"chapters": [{"number": 1, "title": "Chapter One Title", "page_start": 5}, '
            '{"number": 2, "title": "Chapter Two Title", "page_start": 20}]}\n'
            "page_start is the 1-based page number where that chapter begins in the book."
        ),
    })

    try:
        resp = _client.messages.create(
            model=_MODEL,
            max_tokens=1500,
            messages=[{"role": "user", "content": content}],
        )
        text = resp.content[0].text.strip()
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        data = json.loads(text.strip())
        chapters = data.get("chapters", [])
        print(f"  Structure detection found {len(chapters)} chapters")
        return chapters
    except Exception as e:
        print(f"  Structure detection error: {e}")
        return []


# ─── per-chapter content + exercise extraction ────────────────────────────────

def _extract_chapter_content(doc, ch_page_start: int, ch_page_end: int,
                              chapter_title: str, chapter_number: int,
                              subject: str = "General", grade: int = 0) -> list[dict]:
    """
    Send sampled pages to Claude vision.
    Returns topic dicts including 'exercises' — real questions pulled from the textbook.
    """
    pages = list(range(ch_page_start - 1, min(ch_page_end, doc.page_count)))
    # Sample: first 3, middle pages at ~25%/50%/75%, last 2 — gives good coverage
    n = len(pages)
    if n <= 8:
        sample = pages
    else:
        mid_indices = [pages[n // 4], pages[n // 2], pages[3 * n // 4]]
        sample = sorted(set(pages[:3] + mid_indices + pages[-2:]))

    content = []
    for pg in sample:
        img_b64 = _render_page_b64(doc[pg], scale=1.3)
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": img_b64},
        })
        content.append({"type": "text", "text": f"(page {pg + 1})"})

    grade_str = f"Grade {grade} " if grade else ""
    content.append({
        "type": "text",
        "text": (
            f"This is Chapter {chapter_number}: '{chapter_title}' of a {grade_str}{subject} textbook.\n"
            "Extract the topic/section structure from these pages.\n"
            "Return ONLY valid JSON — no markdown:\n"
            '{"topics": [{'
            '"number": "1.1", '
            '"title": "Topic Title", '
            '"key_concepts": ["concept1", "concept2"], '
            '"vocabulary": ["term1", "term2"], '
            '"difficulty_ceiling": "L3", '
            '"raw_content": "2-3 sentence summary only"'
            '}]}\n'
            "Rules:\n"
            "- Extract ALL topics/sections visible in these pages (typically 3-8 per chapter)\n"
            "- difficulty_ceiling: L1=recall, L2=explain, L3=apply, L4=analyse, L5=multi-step\n"
            "- key_concepts: 3-6 core ideas\n"
            "- vocabulary: subject-specific terms\n"
            "- raw_content: 2-3 sentences max — keep it brief"
        ),
    })

    try:
        resp = _client.messages.create(
            model=_MODEL,
            max_tokens=2500,
            messages=[{"role": "user", "content": content}],
        )
        text = resp.content[0].text.strip()
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        try:
            data = json.loads(text.strip())
        except json.JSONDecodeError:
            text = _repair_json(text)
            data = json.loads(text)
        topics = data.get("topics", [])
        print(f"  Chapter {chapter_number} extracted {len(topics)} topics")
        return topics
    except Exception as e:
        print(f"  Chapter content extraction error: {e}")
        return [{
            "number": f"{chapter_number}.1",
            "title": chapter_title,
            "key_concepts": [chapter_title],
            "vocabulary": [],
            "difficulty_ceiling": "L3",
            "raw_content": "",
        }]


def _extract_exercises(doc, ch_page_start: int, ch_page_end: int,
                        chapter_title: str, chapter_number: int) -> list[str]:
    """
    Dedicated pass: scan ALL pages of the chapter for Exercise sections.
    Sends pages in batches of 4 and collects every numbered question found.
    Returns a flat list of question strings.
    """
    pages = list(range(ch_page_start - 1, min(ch_page_end, doc.page_count)))
    all_exercises: list[str] = []

    # Process pages in batches of 4 to avoid oversized requests
    batch_size = 4
    for batch_start in range(0, len(pages), batch_size):
        batch = pages[batch_start: batch_start + batch_size]
        content = []
        for pg in batch:
            img_b64 = _render_page_b64(doc[pg], scale=1.4)
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/png", "data": img_b64},
            })
            content.append({"type": "text", "text": f"(page {pg + 1})"})

        content.append({
            "type": "text",
            "text": (
                f"These are pages from Chapter {chapter_number}: '{chapter_title}'.\n"
                "Find every exercise question visible — look for numbered questions in 'Exercise' or 'Practice' sections.\n"
                "Extract each question EXACTLY as written, including any sub-parts (a), (b), (c).\n"
                "Include the numbers, mathematical expressions, and all parts.\n"
                "If you see no exercise questions on these pages, return an empty list.\n"
                "Return ONLY valid JSON — no markdown:\n"
                '{"exercises": ['
                '"Calculate: (-3) + (-5)", '
                '"Find the value of 4 - (-2)", '
                '"a) List all factors of 24  b) Find the HCF of 24 and 36"'
                "]}"
            ),
        })

        try:
            resp = _client.messages.create(
                model=_MODEL,
                max_tokens=1500,
                messages=[{"role": "user", "content": content}],
            )
            text = resp.content[0].text.strip()
            if "```" in text:
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            try:
                data = json.loads(text.strip())
            except json.JSONDecodeError:
                text = _repair_json(text)
                data = json.loads(text)
            batch_exercises = data.get("exercises", [])
            # Deduplicate as we accumulate
            for ex in batch_exercises:
                ex = str(ex).strip()
                if ex and ex not in all_exercises:
                    all_exercises.append(ex)
            print(f"    Exercises batch pp.{batch[0]+1}-{batch[-1]+1}: {len(batch_exercises)} found")
        except Exception as e:
            print(f"    Exercise extraction error (batch pp.{batch[0]+1}-{batch[-1]+1}): {e}")

    return all_exercises


def _extract_native_text(doc, page_start_0: int, page_end_0: int) -> str:
    """Extract native text from a page range (0-based indices)."""
    text = ""
    for p in range(max(0, page_start_0), min(page_end_0 + 1, doc.page_count)):
        text += doc[p].get_text()
    return text[:4000]


# ─── public parse_pdf ──────────────────────────────────────────────────────────

def parse_pdf(filepath: str, subject: str = "General", grade: int = 0,
              progress_callback=None) -> list[dict]:
    try:
        doc = fitz.open(filepath)
    except Exception as e:
        raise ValueError(f"Cannot open PDF: {filepath}") from e

    total = doc.page_count
    scanned = _is_scanned(doc)
    chapter_limit = int(os.getenv("CHAPTER_LIMIT", "0"))  # 0 = no limit

    print(f"  PDF: {total} pages, scanned={scanned}, chapter_limit={chapter_limit or 'none'}")

    # ── Try native TOC first ──
    toc = doc.get_toc()
    chapters_meta = []

    _cb = progress_callback or (lambda stage, pct: None)

    if len(toc) >= 3:
        for i, entry in enumerate(toc):
            level, title, page = entry
            if level == 1:
                chapters_meta.append({"number": len(chapters_meta) + 1, "title": title, "page_start": page})
    else:
        print("  No native TOC — using Claude vision for structure...")
        _cb("analysing", 40)
        chapters_meta = _detect_structure(doc, subject=subject, grade=grade)

    if not chapters_meta:
        print("  Fallback: treating whole PDF as one chapter")
        chapters_meta = [{"number": 1, "title": subject, "page_start": 1}]

    # Apply chapter limit
    if chapter_limit > 0:
        chapters_meta = chapters_meta[:chapter_limit]
        print(f"  Limiting to {chapter_limit} chapters")

    # Assign page_end to each chapter
    for i, ch in enumerate(chapters_meta):
        if i + 1 < len(chapters_meta):
            ch["page_end"] = chapters_meta[i + 1]["page_start"] - 1
        else:
            ch["page_end"] = total
        ch["page_start"] = max(1, ch["page_start"])

    chunks = []
    total_chapters = max(len(chapters_meta), 1)

    for ch_idx, ch in enumerate(chapters_meta):
        ch_num = ch["number"]
        ch_title = ch["title"]
        ch_ps = ch["page_start"]
        ch_pe = ch["page_end"]

        # Progress: 45% + up to 40% spread across chapters
        ch_pct = 45 + int(ch_idx / total_chapters * 40)
        _cb("analysing", ch_pct)

        print(f"  Processing chapter {ch_num}: '{ch_title}' (pp.{ch_ps}-{ch_pe})")

        if scanned:
            # Extract topics/structure
            topics = _extract_chapter_content(doc, ch_ps, ch_pe, ch_title, ch_num,
                                              subject=subject, grade=grade)
            # Extract all exercises from every page in this chapter
            print(f"  Extracting exercises for chapter {ch_num}...")
            exercises = _extract_exercises(doc, ch_ps, ch_pe, ch_title, ch_num)
            print(f"  Total exercises found: {len(exercises)}")
        else:
            raw = _extract_native_text(doc, ch_ps - 1, ch_pe - 1)
            topics = [{
                "number": f"{ch_num}.1",
                "title": ch_title,
                "raw_content": raw,
                "key_concepts": None,
                "vocabulary": None,
                "difficulty_ceiling": None,
            }]
            exercises = []

        # Distribute exercises evenly across topics in this chapter
        n_topics = max(len(topics), 1)
        chunk_size = max(1, len(exercises) // n_topics) if exercises else 0

        for t_idx, topic in enumerate(topics):
            t_num = topic.get("number") or f"{ch_num}.{t_idx + 1}"
            # Give each topic a slice of exercises + any leftovers to the last topic
            if exercises and chunk_size:
                start = t_idx * chunk_size
                end = start + chunk_size if t_idx < n_topics - 1 else len(exercises)
                topic_exercises = exercises[start:end]
            else:
                topic_exercises = []

            chunks.append({
                "chapter_number": ch_num,
                "chapter_title": ch_title,
                "chapter_page_start": ch_ps,
                "chapter_page_end": ch_pe,
                "topic_number": str(t_num),
                "topic_title": topic.get("title", ch_title),
                "page_start": ch_ps,
                "page_end": ch_pe,
                "raw_text": (topic.get("raw_content") or "")[:4000],
                "_key_concepts": topic.get("key_concepts"),
                "_vocabulary": topic.get("vocabulary"),
                "_difficulty_ceiling": topic.get("difficulty_ceiling"),
                "_exercises": topic_exercises,
            })

    doc.close()
    return chunks


# ─── structure_topic ──────────────────────────────────────────────────────────

def structure_topic(chunk: dict, subject: str, grade: int) -> dict:
    # If already extracted by vision, skip API call
    if chunk.get("_key_concepts") is not None:
        return {
            "key_concepts": chunk["_key_concepts"],
            "vocabulary": chunk.get("_vocabulary") or [],
            "difficulty_ceiling": chunk.get("_difficulty_ceiling") or "L3",
        }

    system_prompt = (
        f"You are a curriculum analyst for Cambridge {subject} Grade {grade}.\n"
        "Analyse the textbook content and return ONLY valid JSON with no markdown:\n"
        '{"key_concepts": ["3-6 core concepts"], "vocabulary": ["terms"], "difficulty_ceiling": "L3"}\n'
        "L1=recall, L2=explain, L3=calculate, L4=analyse, L5=multi-step. Most Grade 7 topics are L3 or L4."
    )
    user_message = f"Textbook content:\n\n{chunk['raw_text'][:3000]}"

    try:
        resp = _client.messages.create(
            model=_MODEL,
            max_tokens=500,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )
        text = resp.content[0].text.strip()
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text.strip())
    except Exception:
        return {
            "key_concepts": [chunk["topic_title"]],
            "vocabulary": [],
            "difficulty_ceiling": "L3",
        }


# ─── run_ingestion ─────────────────────────────────────────────────────────────

def run_ingestion(book_id: int, filepath: str, db=None):
    from database import SessionLocal
    from models import Book, Chapter, Topic
    from storage import get_local_path, cleanup_temp
    from progress import set_book_progress

    own_db = db is None
    if own_db:
        db = SessionLocal()

    try:
        book = db.query(Book).filter(Book.id == book_id).first()
        if not book:
            print(f"Book {book_id} not found")
            return

        book.ingestion_status = "processing"
        book.upload_stage = "reading"
        book.upload_progress = 30
        db.commit()

        print(f"\nIngesting book {book_id}: {filepath} | subject={book.subject} grade={book.grade}")

        # ── Stage: Reading PDF (30-40%) ──────────────────────────────────────
        local_path = get_local_path(filepath)
        set_book_progress(book_id, "reading", 35)

        try:
            # parse_pdf will call _detect_structure (AI call) + per-chapter extraction
            # We instrument it via a progress callback approach
            chunks = parse_pdf(
                local_path,
                subject=book.subject or "General",
                grade=book.grade or 0,
                progress_callback=lambda stage, pct: set_book_progress(book_id, stage, pct),
            )
        finally:
            cleanup_temp(local_path)
        print(f"  Parsed {len(chunks)} topic chunks")

        # ── Stage: Saving to DB (85-95%) ────────────────────────────────────
        set_book_progress(book_id, "saving", 85)

        chapter_map = {}
        topic_count = 0
        total_chunks = max(len(chunks), 1)

        for i, chunk in enumerate(chunks):
            ch_num = chunk["chapter_number"]

            if ch_num not in chapter_map:
                chapter = Chapter(
                    book_id=book_id,
                    chapter_number=ch_num,
                    title=chunk["chapter_title"],
                    page_start=chunk["chapter_page_start"],
                    page_end=chunk["chapter_page_end"],
                )
                db.add(chapter)
                db.commit()
                db.refresh(chapter)
                chapter_map[ch_num] = chapter
                print(f"  Created chapter {ch_num}: {chunk['chapter_title']}")

            structured = structure_topic(chunk, book.subject, book.grade)

            topic_exercises = chunk.get("_exercises") or []
            topic = Topic(
                chapter_id=chapter_map[ch_num].id,
                topic_number=chunk["topic_number"],
                title=chunk["topic_title"],
                key_concepts=structured.get("key_concepts"),
                vocabulary=structured.get("vocabulary"),
                exercises=topic_exercises if topic_exercises else None,
                difficulty_ceiling=structured.get("difficulty_ceiling", "L3"),
                raw_content=chunk["raw_text"],
                page_start=chunk["page_start"],
                page_end=chunk["page_end"],
            )
            db.add(topic)
            db.commit()
            topic_count += 1

            # Progress: 85% + up to 10% as topics are saved
            save_pct = 85 + int((i + 1) / total_chunks * 10)
            set_book_progress(book_id, "saving", save_pct)
            print(f"  Saved topic: {chunk['topic_title']} ({len(topic_exercises)} exercises)")

        book.ingestion_status = "done"
        book.chapter_count = len(chapter_map)
        book.topic_count = topic_count
        book.upload_stage = "done"
        book.upload_progress = 100
        db.commit()
        print(f"\nIngestion complete: {len(chapter_map)} chapters, {topic_count} topics")

    except Exception as e:
        import traceback
        traceback.print_exc()
        try:
            book = db.query(Book).filter(Book.id == book_id).first()
            if book:
                book.ingestion_status = "failed"
                book.upload_stage = "failed"
                book.ingestion_error = str(e)[:500]
                db.commit()
        except Exception:
            pass
        print(f"Ingestion failed: {e}")
    finally:
        if own_db:
            db.close()
