"""
Ingestion pipeline for TutorSnap.
Supports both native-text PDFs and scanned/image PDFs.
For scanned PDFs, uses Claude vision to extract structure and content.

Cost strategy:
  _SCAN_MODEL  (Haiku)  – structure detection, full-page topic scans, exercises
  _MAIN_MODEL  (Sonnet) – session Q&A only (set via CLAUDE_MODEL env var)

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

# Sonnet for session Q&A quality (set by deploy workflow)
_MAIN_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-5-20250929")
# Haiku for all ingestion scanning — ~10× cheaper, still excellent at reading text
_SCAN_MODEL = os.getenv("CLAUDE_FAST_MODEL", "claude-haiku-4-5-20251001")


def _repair_json(text: str) -> str:
    """Best-effort repair of truncated JSON by balancing brackets."""
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


def _call_vision(content: list, max_tokens: int = 2000, use_fast: bool = True) -> str:
    """Single helper for all vision API calls."""
    model = _SCAN_MODEL if use_fast else _MAIN_MODEL
    resp = _client.messages.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": content}],
    )
    return resp.content[0].text.strip()


def _parse_json_response(text: str) -> dict:
    """Strip markdown fences and parse JSON; repair if truncated."""
    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return json.loads(_repair_json(text))


# ─── helpers ──────────────────────────────────────────────────────────────────

def _render_page_b64(page, scale: float = 1.0) -> str:
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat)
    return base64.standard_b64encode(pix.tobytes("png")).decode()


def _is_scanned(doc) -> bool:
    """Return True if the PDF has no extractable text (scanned)."""
    for pg in range(min(5, doc.page_count)):
        if doc[pg].get_text().strip():
            return False
    return True


# ─── structure detection (TOC) ────────────────────────────────────────────────

def _detect_structure(doc, subject: str = "General", grade: int = 0) -> list[dict]:
    """
    Send the first 12 pages (always covers TOC) + distributed samples to Haiku.
    Returns list of chapter dicts with page_start (1-based).
    """
    total = doc.page_count

    # First 12 pages catch the TOC; distributed pages catch late-starting chapters
    early = list(range(min(12, total)))
    distributed = [
        total // 5, total * 2 // 5, total * 3 // 5, total * 4 // 5,
        total - 2,
    ]
    sample_indices = sorted(set(early + [min(max(0, i), total - 1) for i in distributed]))

    content = []
    for pg in sample_indices:
        img_b64 = _render_page_b64(doc[pg], scale=0.8)   # low-res sufficient for TOC
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
        text = _call_vision(content, max_tokens=1500, use_fast=True)
        data = _parse_json_response(text)
        chapters = data.get("chapters", [])
        print(f"  Structure detection found {len(chapters)} chapters")
        return chapters
    except Exception as e:
        print(f"  Structure detection error: {e}")
        return []


# ─── full-chapter topic scan (all pages, batched) ─────────────────────────────

def _scan_all_topics(doc, ch_page_start: int, ch_page_end: int,
                     chapter_title: str, chapter_number: int,
                     subject: str = "General", grade: int = 0) -> list[dict]:
    """
    Scan EVERY page of the chapter in batches of 12 at 0.9× scale using Haiku.
    Merges results across batches so no topic heading is ever missed.
    Returns topic dicts with number, title, key_concepts, vocabulary,
    difficulty_ceiling, and raw_content.
    """
    pages = list(range(ch_page_start - 1, min(ch_page_end, doc.page_count)))
    total_pages = len(pages)
    BATCH = 12          # pages per Claude call
    OVERLAP = 2         # overlap prevents cutting a heading across batches

    # Split into overlapping batches
    batches = []
    start = 0
    while start < total_pages:
        batch = pages[start: start + BATCH]
        batches.append(batch)
        start += BATCH - OVERLAP
        if start >= total_pages:
            break

    all_topics: list[dict] = []
    seen_numbers: set = set()
    grade_str = f"Grade {grade} " if grade else ""

    for b_idx, batch in enumerate(batches):
        content = []
        for pg in batch:
            img_b64 = _render_page_b64(doc[pg], scale=0.9)
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/png", "data": img_b64},
            })
            content.append({"type": "text", "text": f"(page {pg + 1})"})

        content.append({
            "type": "text",
            "text": (
                f"These are pages {batch[0]+1}–{batch[-1]+1} from "
                f"Chapter {chapter_number}: '{chapter_title}' of a {grade_str}{subject} textbook.\n"
                "Extract EVERY topic/section heading visible in these pages. "
                "Do not skip any — include every numbered section (e.g. 1.1, 1.2, 2.3).\n"
                "Return ONLY valid JSON — no markdown:\n"
                '{"topics": [{'
                '"number": "1.1", '
                '"title": "Exact topic title as printed", '
                '"key_concepts": ["concept1", "concept2", "concept3"], '
                '"vocabulary": ["term1", "term2"], '
                '"difficulty_ceiling": "L3", '
                '"raw_content": "2-3 sentence summary of what this topic covers"'
                '}]}\n'
                "Rules:\n"
                "- Use the EXACT section number and title as printed in the book\n"
                "- difficulty_ceiling: L1=recall, L2=explain, L3=apply, L4=analyse, L5=multi-step\n"
                "- key_concepts: 3-6 core ideas students must learn\n"
                "- If no topic headings are visible in these pages, return {\"topics\": []}"
            ),
        })

        try:
            text = _call_vision(content, max_tokens=2500, use_fast=True)
            data = _parse_json_response(text)
            batch_topics = data.get("topics", [])
            added = 0
            for t in batch_topics:
                num = str(t.get("number", "")).strip()
                if num and num not in seen_numbers:
                    seen_numbers.add(num)
                    all_topics.append(t)
                    added += 1
            print(f"    Batch {b_idx+1}/{len(batches)} (pp.{batch[0]+1}-{batch[-1]+1}): "
                  f"{len(batch_topics)} topics found, {added} new")
        except Exception as e:
            print(f"    Topic scan error (batch {b_idx+1}): {e}")

    # Sort by topic number so they're in reading order
    def _sort_key(t):
        try:
            parts = str(t.get("number", "0")).split(".")
            return tuple(int(p) for p in parts if p.isdigit())
        except Exception:
            return (0,)

    all_topics.sort(key=_sort_key)
    print(f"  Chapter {chapter_number}: {len(all_topics)} unique topics found across all pages")
    return all_topics


# ─── exercise extraction (all pages, batched) ─────────────────────────────────

def _extract_exercises(doc, ch_page_start: int, ch_page_end: int,
                       chapter_title: str, chapter_number: int) -> list[str]:
    """
    Scan ALL chapter pages for Exercise/Practice sections using Haiku at 0.9×.
    Sends pages in batches of 6.
    """
    pages = list(range(ch_page_start - 1, min(ch_page_end, doc.page_count)))
    all_exercises: list[str] = []

    batch_size = 6
    for batch_start in range(0, len(pages), batch_size):
        batch = pages[batch_start: batch_start + batch_size]
        content = []
        for pg in batch:
            img_b64 = _render_page_b64(doc[pg], scale=0.9)
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/png", "data": img_b64},
            })
            content.append({"type": "text", "text": f"(page {pg + 1})"})

        content.append({
            "type": "text",
            "text": (
                f"Pages from Chapter {chapter_number}: '{chapter_title}'.\n"
                "Find every exercise question — look for numbered questions in 'Exercise' or 'Practice' sections.\n"
                "Extract each question EXACTLY as written, including sub-parts (a), (b), (c).\n"
                "If no exercise questions are visible, return {\"exercises\": []}.\n"
                "Return ONLY valid JSON — no markdown:\n"
                '{"exercises": ["Calculate: (-3) + (-5)", "Find the value of 4 - (-2)"]}'
            ),
        })

        try:
            text = _call_vision(content, max_tokens=1500, use_fast=True)
            data = _parse_json_response(text)
            batch_ex = data.get("exercises", [])
            for ex in batch_ex:
                ex = str(ex).strip()
                if ex and ex not in all_exercises:
                    all_exercises.append(ex)
            if batch_ex:
                print(f"    Exercises pp.{batch[0]+1}-{batch[-1]+1}: {len(batch_ex)} found")
        except Exception as e:
            print(f"    Exercise error (pp.{batch[0]+1}-{batch[-1]+1}): {e}")

    return all_exercises


def _extract_native_text(doc, page_start_0: int, page_end_0: int) -> str:
    """Extract native text from a page range (0-based indices)."""
    text = ""
    for p in range(max(0, page_start_0), min(page_end_0 + 1, doc.page_count)):
        text += doc[p].get_text()
    return text[:4000]


# ─── public parse_pdf ──────────────────────────────────────────────────────────

def parse_pdf(filepath: str, subject: str = "General", grade: int = 0,
              progress_callback=None,
              skip_chapter_numbers: set = None,
              cancel_check=None) -> list[dict]:
    try:
        doc = fitz.open(filepath)
    except Exception as e:
        raise ValueError(f"Cannot open PDF: {filepath}") from e

    total = doc.page_count
    scanned = _is_scanned(doc)
    chapter_limit = int(os.getenv("CHAPTER_LIMIT", "0"))

    print(f"  PDF: {total} pages, scanned={scanned}, chapter_limit={chapter_limit or 'none'}")
    print(f"  Models: scan={_SCAN_MODEL}")

    _cb = progress_callback or (lambda stage, pct: None)

    # ── Chapter structure ──────────────────────────────────────────────────────
    toc = doc.get_toc()
    chapters_meta = []

    if len(toc) >= 3:
        for entry in toc:
            level, title, page = entry
            if level == 1:
                chapters_meta.append({"number": len(chapters_meta) + 1,
                                      "title": title, "page_start": page})
        print(f"  Native TOC: {len(chapters_meta)} chapters")
    else:
        print("  No native TOC — using Claude vision for structure...")
        _cb("analysing", 40)
        chapters_meta = _detect_structure(doc, subject=subject, grade=grade)

    if not chapters_meta:
        print("  Fallback: treating whole PDF as one chapter")
        chapters_meta = [{"number": 1, "title": subject, "page_start": 1}]

    if chapter_limit > 0:
        chapters_meta = chapters_meta[:chapter_limit]
        print(f"  Limiting to {chapter_limit} chapters")

    # Assign page_end
    for i, ch in enumerate(chapters_meta):
        ch["page_end"] = chapters_meta[i + 1]["page_start"] - 1 if i + 1 < len(chapters_meta) else total
        ch["page_start"] = max(1, ch["page_start"])

    _skip = skip_chapter_numbers or set()
    chunks = []
    total_chapters = max(len(chapters_meta), 1)

    for ch_idx, ch in enumerate(chapters_meta):
        ch_num  = ch["number"]
        ch_title = ch["title"]
        ch_ps   = ch["page_start"]
        ch_pe   = ch["page_end"]

        # ── Cancellation check — stop between chapters if admin cancelled ────
        if cancel_check and cancel_check():
            print(f"  Cancellation flag detected — stopping before chapter {ch_num}")
            break

        # ── Checkpoint skip — chapter already fully saved in DB ─────────────
        if ch_num in _skip:
            print(f"  Skipping chapter {ch_num} '{ch_title}' (already saved)")
            continue

        ch_pct = 45 + int(ch_idx / total_chapters * 40)
        _cb("analysing", ch_pct)

        print(f"  Processing chapter {ch_num}: '{ch_title}' (pp.{ch_ps}-{ch_pe})")

        if scanned:
            # Full-page topic scan — no topics missed
            topics = _scan_all_topics(doc, ch_ps, ch_pe, ch_title, ch_num,
                                      subject=subject, grade=grade)
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

        # Distribute exercises across topics
        n_topics = max(len(topics), 1)
        chunk_size = max(1, len(exercises) // n_topics) if exercises else 0

        for t_idx, topic in enumerate(topics):
            t_num = topic.get("number") or f"{ch_num}.{t_idx + 1}"
            if exercises and chunk_size:
                start = t_idx * chunk_size
                end = start + chunk_size if t_idx < n_topics - 1 else len(exercises)
                topic_exercises = exercises[start:end]
            else:
                topic_exercises = []

            # Always guarantee lists so structure_topic never falls back to a Claude call
            kc = topic.get("key_concepts")
            vc = topic.get("vocabulary")
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
                # Use list or None — but for scanned PDFs force an empty list rather than None
                # so structure_topic skips the Claude fallback call entirely
                "_key_concepts": kc if isinstance(kc, list) else [],
                "_vocabulary": vc if isinstance(vc, list) else [],
                "_difficulty_ceiling": topic.get("difficulty_ceiling") or "L3",
                "_exercises": topic_exercises,
            })

    doc.close()
    return chunks


# ─── structure_topic (native-text PDFs only) ──────────────────────────────────

def structure_topic(chunk: dict, subject: str, grade: int) -> dict:
    """
    For scanned PDFs: vision already populated key_concepts/vocabulary/difficulty.
    We always set _key_concepts to a list (even empty) in parse_pdf for scanned pages,
    so the early-return fires and no Claude call is made.
    Only native-text PDFs with _key_concepts=None reach the Claude fallback below.
    """
    if chunk.get("_key_concepts") is not None:  # includes [] — any list skips Claude
        return {
            "key_concepts": chunk["_key_concepts"] or [chunk.get("topic_title", "")],
            "vocabulary":   chunk.get("_vocabulary") or [],
            "difficulty_ceiling": chunk.get("_difficulty_ceiling") or "L3",
        }

    system_prompt = (
        f"You are a curriculum analyst for Cambridge {subject} Grade {grade}.\n"
        "Analyse the textbook content and return ONLY valid JSON with no markdown:\n"
        '{"key_concepts": ["3-6 core concepts"], "vocabulary": ["terms"], "difficulty_ceiling": "L3"}\n'
        "L1=recall, L2=explain, L3=calculate, L4=analyse, L5=multi-step."
    )
    try:
        resp = _client.messages.create(
            model=_SCAN_MODEL,
            max_tokens=500,
            system=system_prompt,
            messages=[{"role": "user", "content": chunk["raw_text"][:3000]}],
        )
        text = resp.content[0].text.strip()
        return _parse_json_response(text)
    except Exception:
        return {"key_concepts": [chunk["topic_title"]], "vocabulary": [], "difficulty_ceiling": "L3"}


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

        # Only reset to processing if not already cancelled (shouldn't happen, but guard)
        if book.ingestion_status != "failed":
            book.ingestion_status = "processing"
            book.upload_stage = "reading"
            book.upload_progress = 30
            db.commit()

        print(f"\nIngesting book {book_id}: {filepath} | subject={book.subject} grade={book.grade}")

        # ── Checkpoint: find chapters already saved for this book ─────────────
        existing_chapters = db.query(Chapter).filter(Chapter.book_id == book_id).all()
        chapter_map = {ch.chapter_number: ch for ch in existing_chapters}
        topic_count = sum(
            db.query(Topic).filter(Topic.chapter_id == ch.id).count()
            for ch in existing_chapters
        )
        if chapter_map:
            print(f"  Checkpoint resume: {len(chapter_map)} chapters already saved, "
                  f"{topic_count} topics — skipping those chapters")

        def _cancel_check():
            db.refresh(book)
            return book.ingestion_status == "failed"

        local_path = get_local_path(filepath)
        set_book_progress(book_id, "reading", 35)

        try:
            chunks = parse_pdf(
                local_path,
                subject=book.subject or "General",
                grade=book.grade or 0,
                progress_callback=lambda stage, pct: set_book_progress(book_id, stage, pct),
                skip_chapter_numbers=set(chapter_map.keys()),
                cancel_check=_cancel_check,
            )
        finally:
            cleanup_temp(local_path)

        # Check if cancelled during scanning phase
        db.refresh(book)
        if book.ingestion_status == "failed":
            print("  Ingestion cancelled during PDF scanning — partial data preserved in DB")
            return

        print(f"  Parsed {len(chunks)} new topic chunks (plus {len(chapter_map)} existing chapters)")
        set_book_progress(book_id, "saving", 85)

        # ── Group chunks by chapter so we commit once per chapter, not per topic ──
        # This cuts DB round trips from O(topics) → O(chapters) and avoids
        # flooding the connection pool with set_book_progress calls.
        from collections import defaultdict
        chunks_by_chapter: dict = defaultdict(list)
        for chunk in chunks:
            chunks_by_chapter[chunk["chapter_number"]].append(chunk)

        new_chapters = sorted(chunks_by_chapter.keys())
        total_new_chapters = max(len(new_chapters), 1)

        for ch_idx, ch_num in enumerate(new_chapters):
            ch_chunks = chunks_by_chapter[ch_num]

            # Create chapter record if not already in map (from existing DB data)
            if ch_num not in chapter_map:
                first = ch_chunks[0]
                chapter = Chapter(
                    book_id=book_id,
                    chapter_number=ch_num,
                    title=first["chapter_title"],
                    page_start=first["chapter_page_start"],
                    page_end=first["chapter_page_end"],
                )
                db.add(chapter)
                db.flush()   # get the chapter id without a full commit
                chapter_map[ch_num] = chapter
                print(f"  Creating chapter {ch_num}: {first['chapter_title']} ({len(ch_chunks)} topics)")

            ch_id = chapter_map[ch_num].id

            # Add all topics for this chapter in one transaction
            for chunk in ch_chunks:
                structured = structure_topic(chunk, book.subject, book.grade)
                topic_exercises = chunk.get("_exercises") or []
                db.add(Topic(
                    chapter_id=ch_id,
                    topic_number=chunk["topic_number"],
                    title=chunk["topic_title"],
                    key_concepts=structured.get("key_concepts") or [],
                    vocabulary=structured.get("vocabulary") or [],
                    exercises=topic_exercises or None,
                    difficulty_ceiling=structured.get("difficulty_ceiling") or "L3",
                    raw_content=chunk["raw_text"],
                    page_start=chunk["page_start"],
                    page_end=chunk["page_end"],
                ))
                topic_count += 1

            # One commit per chapter (was: one commit per topic)
            db.commit()
            print(f"  Saved chapter {ch_num}: {len(ch_chunks)} topics committed")

            # One progress update per chapter (was: one per topic)
            save_pct = 85 + int((ch_idx + 1) / total_new_chapters * 12)
            set_book_progress(book_id, "saving", min(97, save_pct))

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
