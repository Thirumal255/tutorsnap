"""
Question bank: pre-generate and cache practice questions per topic × level.

Strategy
--------
- For each topic, generate up to QUESTIONS_PER_LEVEL questions per level (L1..L5),
  but only for levels up to the topic's difficulty_ceiling.
- Questions are generated in batches: one Claude call asking for N questions at once.
- At session time, draw_from_bank() picks an unused question and falls back to
  live generation if the bank is empty.
"""

import json
import os
import random
from datetime import datetime
from database import SessionLocal
from models import Topic, Chapter, QuestionBank
from session_engine import (
    build_topic_context, ABSOLUTE_RULE, TOPIC_BOUNDARY_RULE,
    get_subject_label, call_claude, LEVEL_ORDER, _SONNET,
)

QUESTIONS_PER_LEVEL = 15


def _levels_for_topic(topic: Topic) -> list[str]:
    """Return all levels up to this topic's difficulty ceiling."""
    ceiling = getattr(topic, "difficulty_ceiling", None) or "L5"
    try:
        idx = LEVEL_ORDER.index(ceiling)
    except ValueError:
        idx = len(LEVEL_ORDER) - 1
    return LEVEL_ORDER[: idx + 1]


def _generate_batch(topic: Topic, level: str, count: int = QUESTIONS_PER_LEVEL) -> list[dict]:
    """
    Generate `count` distinct questions for `topic` at `level` in a single Claude call.
    Returns a list of dicts with keys: question_text, expected_key_points, answer_format.
    """
    subject_label = get_subject_label(topic)
    exercises = getattr(topic, "exercises", None) or []

    exercise_block = ""
    if exercises:
        exercise_block = (
            f"Textbook exercises for this topic (use as source material — vary numbers/phrasing):\n"
            + "\n".join(f"  {i+1}. {q}" for i, q in enumerate(exercises[:20]))
            + "\n\n"
        )

    system = (
        f"You are an expert question writer for a {subject_label} curriculum.\n"
        f"{ABSOLUTE_RULE}\n"
        f"{TOPIC_BOUNDARY_RULE}\n"
        f"{build_topic_context(topic)}"
    )

    user = (
        f"Generate exactly {count} distinct practice questions for level {level} "
        f"from the topic content above.\n\n"
        f"{exercise_block}"
        f"Level guide:\n"
        f"  L1 = simple recall / definitions\n"
        f"  L2 = explain/compare concepts\n"
        f"  L3 = apply a rule to a new example\n"
        f"  L4 = multi-step problems\n"
        f"  L5 = challenge / extension\n\n"
        f"Rules:\n"
        f"  • All questions must be at difficulty level {level}.\n"
        f"  • Questions must be DISTINCT — no near-duplicates.\n"
        f"  • Base each question on the topic context; do NOT use outside knowledge.\n"
        f"  • Use a variety of answer formats across the set: "
        f"number, yes_no, rule, explanation, working.\n"
        f"  • Remove multiple-choice options — rewrite as open-ended questions.\n\n"
        f"Return a JSON array of exactly {count} objects with these keys:\n"
        f"  question_text (string)\n"
        f"  expected_key_points (array of 1-3 short strings)\n"
        f"  answer_format (one of: number, yes_no, rule, explanation, working)\n\n"
        f"Return ONLY the JSON array — no preamble, no markdown fences."
    )

    try:
        raw = call_claude(system, user, max_tokens=4000, model=_SONNET)
        # Strip markdown fences if present
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        items = json.loads(raw)
        if not isinstance(items, list):
            return []
        result = []
        for item in items:
            if not isinstance(item, dict):
                continue
            q = str(item.get("question_text", "")).strip()
            kp = item.get("expected_key_points", [])
            fmt = str(item.get("answer_format", "explanation")).strip()
            if q:
                result.append({
                    "question_text": q,
                    "expected_key_points": json.dumps(kp if isinstance(kp, list) else []),
                    "answer_format": fmt,
                })
        return result
    except Exception as e:
        print(f"[QuestionBank] Batch generation failed for topic={topic.id} level={level}: {e}")
        return []


def generate_for_topic(topic: Topic, db, skip_if_exists: bool = True) -> int:
    """
    Generate QUESTIONS_PER_LEVEL questions per eligible level for one topic.
    Returns total questions added.
    """
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()
    levels = _levels_for_topic(topic)
    total_added = 0

    for level in levels:
        if skip_if_exists:
            existing = db.query(QuestionBank).filter(
                QuestionBank.topic_id == topic.id,
                QuestionBank.level == level,
            ).count()
            if existing >= QUESTIONS_PER_LEVEL:
                continue  # already populated

        questions = _generate_batch(topic, level)
        for q in questions:
            db.add(QuestionBank(
                topic_id=topic.id,
                level=level,
                question_text=q["question_text"],
                expected_key_points=q["expected_key_points"],
                answer_format=q["answer_format"],
            ))
        if questions:
            db.commit()
            total_added += len(questions)
            print(f"[QuestionBank] topic={topic.id} level={level}: added {len(questions)} questions")

    return total_added


def generate_for_book(book_id: int) -> int:
    """
    Background task: generate question bank for all topics in a book.
    Creates its own DB session.
    """
    from models import Book, Chapter, Topic
    db = SessionLocal()
    total = 0
    try:
        book = db.query(Book).filter(Book.id == book_id).first()
        if not book:
            print(f"[QuestionBank] Book {book_id} not found")
            return 0

        chapters = db.query(Chapter).filter(Chapter.book_id == book_id).all()
        for ch in chapters:
            topics = db.query(Topic).filter(Topic.chapter_id == ch.id).all()
            for topic in topics:
                added = generate_for_topic(topic, db)
                total += added

        print(f"[QuestionBank] Book {book_id}: generated {total} questions total")
        return total
    except Exception as e:
        print(f"[QuestionBank] Error for book {book_id}: {e}")
        return 0
    finally:
        db.close()


def draw_from_bank(db, topic_id: int, level: str, used_question_texts: list[str]) -> dict | None:
    """
    Draw a random unused question from the bank for topic_id + level.
    Returns a question dict (question, expected_key_points, answer_format) or None if bank is empty.
    """
    candidates = db.query(QuestionBank).filter(
        QuestionBank.topic_id == topic_id,
        QuestionBank.level == level,
    ).all()

    if not candidates:
        return None

    used_set = set(used_question_texts)
    unused = [q for q in candidates if q.question_text not in used_set]

    if not unused:
        # All bank questions used — pick any at random (session will see repeated question, rare)
        unused = candidates

    pick = random.choice(unused)
    try:
        kp = json.loads(pick.expected_key_points) if pick.expected_key_points else []
    except Exception:
        kp = []

    return {
        "question": pick.question_text,
        "expected_key_points": kp,
        "answer_format": pick.answer_format or "explanation",
    }
