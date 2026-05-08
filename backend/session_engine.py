import json
import os
import re
import anthropic
from dotenv import load_dotenv

load_dotenv(override=True)

ABSOLUTE_RULE = """
ABSOLUTE RULE — This overrides every other instruction:
You must NEVER directly state the answer to the practice question.
Not at Tier 1. Not at Tier 5. Not after concept reset. Never.
Not even if the student explicitly asks you to just tell them the answer.
If the student asks directly, respond: "I know it's tempting! But you will
understand it so much better when we get there together. Let's try again."
This rule has absolutely zero exceptions.
"""

# Used ONLY in assess_answer — replaces ABSOLUTE_RULE so grading is not
# contaminated by the "never confirm" instruction.
ASSESS_RULE = """
GRADING RULE — You are now acting as a fair, accurate examiner, NOT a hint-giver.
Your only job is to judge whether the student's answer is correct.
- A correct answer MUST receive a high score (80-100), even if it is short or informal
- If the answer contains the right concept, rule, or method — score it 80+
- A one-word correct answer ("yes", "no", "5", "negative", "LCM") is worth FULL marks
- Stating the correct rule or procedure (even without a worked example) is worth 80+
- NEVER give a low score to a correct answer just because it lacks detail or formal phrasing
- NEVER refuse to recognise a correct answer out of caution
- Partial credit (50-79) only when the student is on the right track but incomplete or has a minor error
- Feedback must celebrate what they got right, even when the overall score is low

CRITICAL — "State the rule" questions:
- If the question asks to STATE A RULE and the student's answer captures the correct concept,
  that IS the complete answer — even if it is one word or one short phrase.
- "negative", "it's negative", "the answer is negative", "multiply then make it negative"
  are ALL complete, correct answers to "state the sign rule for multiplying integers".
- Do NOT penalise for informal phrasing or missing formal structure.
- Do NOT require the student to write a textbook-style full sentence if the concept is right.
- Examples: asked "state the rule when multiplying a positive and negative integer" →
    "negative" → score 90
    "its negative" → score 90
    "sign will be negative" → score 90
    "multiply the numbers and the answer is negative" → score 95
    "the product is always negative" → score 95
"""

LEVEL_GUIDE = {
    "L1": "Recall and recognition — define, name, identify",
    "L2": "Comprehension — explain in your own words, describe",
    "L3": "Application — solve, calculate, use the method directly",
    "L4": "Analysis — find the mistake, compare two methods, reason about the result",
    "L5": "Synthesis — multi-step word problems requiring combining concepts",
}

LEVEL_ORDER = ["L1", "L2", "L3", "L4", "L5"]

_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


def get_next_level(current: str) -> str:
    idx = LEVEL_ORDER.index(current) if current in LEVEL_ORDER else 0
    return LEVEL_ORDER[min(idx + 1, len(LEVEL_ORDER) - 1)]


def get_start_level(mastery_level: str) -> str:
    idx = LEVEL_ORDER.index(mastery_level) if mastery_level in LEVEL_ORDER else 0
    return LEVEL_ORDER[max(0, idx - 1)]


def build_topic_context(topic) -> str:
    chapter_title = topic.chapter.title if topic.chapter else ""
    key_concepts = ", ".join(topic.key_concepts or [])
    vocabulary = ", ".join(topic.vocabulary or [])
    raw = (topic.raw_content or "")[:1500]

    # Pull grade/subject from the book via chapter → book relationship
    book = getattr(topic.chapter, "book", None) if topic.chapter else None
    subject = getattr(book, "subject", None) or "Mathematics"
    grade = getattr(book, "grade", None) or 7

    exercises_section = ""
    exercises = getattr(topic, "exercises", None) or []
    if exercises:
        ex_lines = "\n".join(f"  - {q}" for q in exercises[:20])
        exercises_section = f"\nReal exercise questions from the textbook (use these as inspiration):\n{ex_lines}\n"

    return (
        f"Subject: {subject}\n"
        f"Grade: {grade}\n"
        f"Chapter: {chapter_title}\n"
        f"Topic: {topic.title}\n"
        f"Key concepts the student must learn: {key_concepts}\n"
        f"Vocabulary introduced: {vocabulary}\n"
        f"Maximum difficulty level for this topic: {topic.difficulty_ceiling}\n"
        f"{exercises_section}"
        f"\nRelevant textbook content:\n---\n{raw}\n---"
    )


def get_subject_label(topic) -> str:
    """Return 'Grade N Subject' string from topic → chapter → book chain."""
    book = getattr(topic.chapter, "book", None) if topic.chapter else None
    subject = getattr(book, "subject", None) or "Mathematics"
    grade = getattr(book, "grade", None) or 7
    return f"Grade {grade} {subject}"


def call_claude(system: str, user: str, max_tokens: int = 800) -> str:
    try:
        response = _client.messages.create(
            model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-5-20250929"),
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return response.content[0].text.strip()
    except Exception as e:
        raise RuntimeError(f"Claude API call failed: {e}") from e


def generate_question(topic, level: str, previous_questions: list[str]) -> dict:
    """Generate a question and return a dict with question, expected_key_points, answer_format."""
    subject_label = get_subject_label(topic)
    system = (
        f"You are Buddy, a friendly AI tutor for a {subject_label} student.\n"
        f"{ABSOLUTE_RULE}\n"
        f"{build_topic_context(topic)}"
    )
    prev = previous_questions[-5:] if previous_questions else []

    exercises = getattr(topic, "exercises", None) or []
    used = set(previous_questions)
    unused_exercises = [q for q in exercises if q not in used]

    if unused_exercises:
        exercise_instruction = (
            f"PRIORITY: Use one of these real textbook exercise questions (pick the most appropriate for level {level}):\n"
            + "\n".join(f"  {i+1}. {q}" for i, q in enumerate(unused_exercises[:10]))
            + "\n\nAdapt the wording slightly if needed to match the level, but keep the mathematical content identical.\n"
            f"If none of the above exercises suit level {level}, generate a fresh question instead.\n"
        )
    else:
        exercise_instruction = "Generate a fresh question based on the textbook content above.\n"

    user = (
        f"Generate exactly ONE practice question at difficulty level {level}.\n"
        f"Level {level} means: {LEVEL_GUIDE[level]}\n\n"
        f"{exercise_instruction}\n"
        f"The question must:\n"
        f"- Be appropriate for a {subject_label} student\n"
        f"- Be clearly worded and unambiguous about what kind of answer is expected\n"
        f"- Not repeat any of these previous questions: {prev}\n\n"
        f"IMPORTANT — question clarity rules by level:\n"
        f"  L1 (Recall): Ask the student to STATE a fact, rule, or definition.\n"
        f"    ✓ Good: 'State the divisibility rule for 5.'\n"
        f"    ✗ Bad:  'Use the rule to find out if 1275 is divisible.' (this mixes recall + application)\n"
        f"  L2 (Comprehension): Ask the student to EXPLAIN something in their own words.\n"
        f"    ✓ Good: 'Explain in your own words what LCM means.'\n"
        f"  L3 (Application): Give a specific problem and ask for a worked answer.\n"
        f"    ✓ Good: 'Find the LCM of 12 and 18. Show your steps.'\n"
        f"    ✓ Good: 'Is 1275 divisible by 5? State the rule you used and give your answer.'\n"
        f"  L4 (Analysis): Ask the student to reason, compare, or spot an error.\n"
        f"  L5 (Synthesis): Multi-step word problem combining two or more concepts.\n\n"
        f"The question must make it obvious what a correct answer looks like — "
        f"never leave the student guessing whether to give a number, a rule, a yes/no, or a worked solution.\n\n"
        f"After composing the question, also determine:\n"
        f"1. expected_key_points — a list of 2-5 short strings capturing what a CORRECT answer MUST contain.\n"
        f"   These are used by the grader, NOT shown to the student.\n"
        f"   Examples:\n"
        f"   - 'State the divisibility rule for 5' → [\"ends in 0 or 5\", \"last digit is 0 or 5\"]\n"
        f"   - 'Is 1275 divisible by 5?' → [\"yes\", \"ends in 5\"]\n"
        f"   - 'Find the LCM of 12 and 18' → [\"36\", \"LCM is 36\"]\n"
        f"   - 'Explain what LCM means' → [\"smallest multiple\", \"common to both\", \"least common multiple\"]\n\n"
        f"2. answer_format — ONE of these exact strings describing the expected answer type:\n"
        f"   - \"number\"      — the answer is a specific number or calculation result\n"
        f"   - \"yes_no\"      — the answer is yes or no\n"
        f"   - \"rule\"        — the answer is a rule, definition, or law stated in words\n"
        f"   - \"explanation\" — the answer is an explanation or description in words\n"
        f"   - \"working\"     — a full worked solution with steps is required\n\n"
        f"Return ONLY valid JSON — no markdown, no code fences, no text before or after:\n"
        f'{{"question": "...", "expected_key_points": ["...", "..."], "answer_format": "..."}}'
    )
    raw = call_claude(system, user, max_tokens=500)
    try:
        # Strip any accidental markdown code fences
        cleaned = re.sub(r"```[a-z]*\n?", "", raw).strip()
        data = json.loads(cleaned)
        return {
            "question": str(data["question"]),
            "expected_key_points": list(data.get("expected_key_points") or []),
            "answer_format": str(data.get("answer_format") or "explanation"),
        }
    except Exception:
        # Fallback: treat the whole response as the question text
        return {
            "question": raw,
            "expected_key_points": [],
            "answer_format": "explanation",
        }


def assess_answer(
    topic,
    question: str,
    answer: str,
    level: str,
    hint_tier: int,
    expected_key_points: list | None = None,
    answer_format: str | None = None,
) -> dict:
    """
    Two-phase scoring: compare the student's answer against the reference key points
    using a per-format rubric, rather than doing blind open-ended grading.
    """
    subject_label = get_subject_label(topic)
    system = (
        f"You are Buddy, a friendly AI tutor for a {subject_label} student.\n"
        f"{ASSESS_RULE}\n"
        f"{build_topic_context(topic)}"
    )

    # Reference answer section (shown to grader, not to student)
    if expected_key_points:
        ref_section = (
            f"\nREFERENCE ANSWER — key points a correct answer MUST contain:\n"
            + "\n".join(f"  ✓ {p}" for p in expected_key_points)
            + "\n"
        )
    else:
        ref_section = ""

    # Per-format scoring rule
    FORMAT_RULES = {
        "number": (
            "\nFORMAT RULE — Expected answer type: NUMBER\n"
            "  - Correct number stated (even without working shown) → score 90+\n"
            "  - Correct number with minor rounding/notation difference → score 80-89\n"
            "  - Right method but arithmetic error → score 55-75\n"
            "  - Wrong number with wrong method → score 0-49\n"
        ),
        "yes_no": (
            "\nFORMAT RULE — Expected answer type: YES or NO\n"
            "  - Correct yes/no (even alone, without explanation) → score 90+\n"
            "  - Correct yes/no WITH correct reasoning → score 95-100\n"
            "  - WRONG yes/no → score 0-40 regardless of explanation quality\n"
            "  - 'yes' alone, if correct → 90. 'no' alone, if correct → 90.\n"
        ),
        "rule": (
            "\nFORMAT RULE — Expected answer type: RULE or DEFINITION\n"
            "  - Correct concept captured, even informally or in one word → score 90+\n"
            "  - Informal/abbreviated phrasing is FINE — do NOT penalise for lack of formal language\n"
            "  - Partially correct (right idea, missing one key element) → score 60-79\n"
            "  - Wrong concept entirely → score 0-49\n"
        ),
        "explanation": (
            "\nFORMAT RULE — Expected answer type: EXPLANATION in words\n"
            "  - Covers the key points (even briefly) → score 80+\n"
            "  - On the right track but missing some key points → score 50-79\n"
            "  - Off-base explanation showing misunderstanding → score 0-49\n"
        ),
        "working": (
            "\nFORMAT RULE — Expected answer type: FULLY WORKED SOLUTION\n"
            "  - Correct answer with clear method shown → score 90+\n"
            "  - Correct answer, method unclear or partially shown → score 75-89\n"
            "  - Correct final answer, no working shown → score 70\n"
            "  - Correct method, arithmetic error → score 55-70\n"
            "  - Wrong method → score 0-49\n"
        ),
    }
    format_rule = FORMAT_RULES.get(answer_format or "", "")

    user = (
        f"The student was asked this question at level {level}:\n"
        f"QUESTION: {question}\n"
        f"{ref_section}"
        f"\nThe student answered:\n"
        f"ANSWER: {answer}\n"
        f"{format_rule}\n"
        f"STEP 1 — Is the answer off-topic?\n"
        f"Set off_topic to TRUE if the answer:\n"
        f"  - Is completely unrelated to the subject (e.g. 'I like pizza', 'Hello', 'What\\'s for lunch?')\n"
        f"  - Is a joke, random words, gibberish, or nonsense\n"
        f"  - Says 'I don\\'t know', 'idk', 'no idea', 'skip', 'pass', or similar\n"
        f"  - Is a question instead of an answer\n"
        f"  - Contains absolutely no genuine academic attempt\n"
        f"Set off_topic to FALSE if the student is genuinely trying to answer, even if completely wrong.\n\n"
        f"STEP 2 — Score the answer (only when off_topic is FALSE):\n"
        f"Compare the student's answer against the REFERENCE ANSWER key points.\n"
        f"Apply the FORMAT RULE strictly.\n"
        f"Be GENEROUS — recognise correct answers even if brief or informally worded.\n\n"
        f"Return ONLY valid JSON — no markdown, no code fences, no text outside the JSON:\n"
        f'{{"score": 85, "feedback": "...", "off_topic": false}}\n\n'
        f"IMPORTANT — score must reflect ONLY the correctness of the answer (0-100).\n"
        f"Do NOT apply any hint tier adjustment to the score — that is handled elsewhere.\n\n"
        f"If off_topic is TRUE:\n"
        f"  - score: 0\n"
        f"  - feedback: warm, playful redirect. Use humour. Make them smile and want to try again.\n"
        f"  - Examples: 'Haha, I like the creativity! But maths hat on now — '\n"
        f"    'Oops, brain wandered! Let\\'s bring it back — '\n"
        f"  - End by briefly restating what the question asks. Do NOT hint at the answer.\n\n"
        f"If off_topic is FALSE:\n"
        f"  - feedback: 1-2 sentences, encouraging, never condescending\n"
        f"  - Celebrate what they got right, even when overall score is low\n"
        f"  - Correct answers: 'Spot on!', 'Exactly right!', 'Perfect!', 'Brilliant!' etc.\n"
        f"  - Wrong answers: encourage the attempt without revealing the answer"
    )
    try:
        raw = call_claude(system, user, max_tokens=400)
        cleaned = re.sub(r"```[a-z]*\n?", "", raw).strip()
        data = json.loads(cleaned)
        raw_score = int(data.get("score", 0))
        feedback = str(data.get("feedback", "Let's try again!"))
        off_topic = bool(data.get("off_topic", False))
    except Exception:
        return {"score": 0, "feedback": "Let's try again!", "confidence_tag": "struggling", "off_topic": False}

    if off_topic:
        # Off-topic answers: don't penalise, just ask them to try the same question again.
        return {"score": 0, "feedback": feedback, "confidence_tag": "off_topic", "off_topic": True}

    # Confidence tag is derived from RAW score BEFORE hint_tier penalty.
    # Critical: a student who nails the answer after hints must still be marked "confident"
    # so the session progresses. The penalty only affects the stored score quality metric.
    if raw_score >= 80:
        confidence_tag = "confident"
    elif raw_score >= 50:
        confidence_tag = "shaky"
    else:
        confidence_tag = "struggling"

    # Apply hint_tier penalty to the stored score (mastery quality metric only).
    if hint_tier == 0:
        score = raw_score
    elif hint_tier == 1:
        score = int(raw_score * 0.9)
    elif hint_tier == 2:
        score = min(raw_score, 79)
    else:  # hint_tier 3+
        score = min(raw_score, 64)  # shaky ceiling, avoids infinite struggle loop

    return {"score": score, "feedback": feedback, "confidence_tag": confidence_tag, "off_topic": False}


def get_hint(topic, question: str, student_answer: str, hint_tier: int) -> str:
    subject_label = get_subject_label(topic)
    system = (
        f"You are Buddy, a friendly AI tutor for a {subject_label} student.\n"
        f"{ABSOLUTE_RULE}\n"
        f"IMPORTANT — Hint context rule: The student's answer shown below has already been\n"
        f"assessed as INCORRECT or INCOMPLETE by the grading system. Do NOT tell the student\n"
        f"their answer is correct or 'spot on' — if it were correct, no hint would be shown.\n"
        f"Focus exclusively on helping them understand what is missing or wrong.\n"
        f"{build_topic_context(topic)}"
    )

    if hint_tier == 1:
        tier_instruction = (
            f"The student got this question wrong and needs a gentle nudge.\n"
            f"QUESTION THEY WERE ASKED: {question}\n"
            f"THEIR INCORRECT ANSWER: {student_answer}\n\n"
            f"Give a Tier 1 hint: a conceptual recall nudge.\n"
            f"- Identify what is specifically wrong or missing in their answer\n"
            f"- Remind them of the relevant concept WITHOUT giving structure or steps\n"
            f"- Do NOT show any worked examples\n"
            f"- Do NOT break the problem into steps\n"
            f"- Ask ONE guiding question that points them in the right direction\n"
            f"- Keep it to 2-3 sentences maximum\n"
            f"- Be warm and encouraging\n"
            f"- Do NOT tell them their answer is correct — it has been marked wrong"
        )
    elif hint_tier == 2:
        tier_instruction = (
            f"The student is still struggling. Give a Tier 2 hint: a worked example.\n"
            f"QUESTION THEY WERE ASKED: {question}\n\n"
            f"- Show a fully worked example of a SIMILAR problem with DIFFERENT numbers\n"
            f"- Walk through each step clearly\n"
            f"- Make sure the example is genuinely different — different numbers, same concept\n"
            f'- End with "Now try your original question again!"\n'
            f"- Do NOT solve their actual question"
        )
    elif hint_tier == 3:
        tier_instruction = (
            f"The student needs more support. Give a Tier 3 hint: process decomposition.\n"
            f"QUESTION THEY WERE ASKED: {question}\n\n"
            f"- Break the student's ACTUAL question into numbered sub-steps\n"
            f"- Do NOT compute or reveal any values — just name the steps\n"
            f"- Ask the student to attempt Step 1 only and tell you what they get\n"
            f'- Format: "Step 1: ... Step 2: ... Step 3: ..."\n'
            f'- End with "What do you get for Step 1?"'
        )
    elif hint_tier == 4:
        tier_instruction = (
            f"The student needs a bigger scaffold. Give a Tier 4 hint: partial answer.\n"
            f"QUESTION THEY WERE ASKED: {question}\n\n"
            f"- Explicitly compute and reveal ONLY Step 1's result\n"
            f'- Say something like "Let me help with the first part: [step 1 result]"\n'
            f"- Ask the student to continue from Step 2 onward\n"
            f"- Do NOT reveal the final answer"
        )
    else:  # tier 5+
        tier_instruction = (
            f"This is the final hint. Give a Tier 5 hint: near-complete walkthrough.\n"
            f"QUESTION THEY WERE ASKED: {question}\n\n"
            f"- Walk through EVERY step of the problem with full working shown\n"
            f"- Stop immediately before revealing the final answer\n"
            f'- Ask the student: "So what do you think the final answer is?"\n'
            f"- Make the last step obvious — they just need to complete it\n"
            f"- This is their last chance before we move to a full concept explanation"
        )

    return call_claude(system, tier_instruction, max_tokens=600)


def get_concept_explanation(topic, question: str) -> str:
    subject_label = get_subject_label(topic)
    system = (
        f"You are Buddy, a friendly AI tutor for a {subject_label} student.\n"
        f"{ABSOLUTE_RULE}\n"
        f"{build_topic_context(topic)}"
    )
    user = (
        f"The student has been unable to answer this question even after 5 hints:\n"
        f"QUESTION: {question}\n\n"
        f"Give a full concept explanation:\n"
        f"- Explain the underlying concept clearly and completely\n"
        f"- Use simple language appropriate for the student's level\n"
        f"- Use a different example to illustrate (NOT the original question)\n"
        f"- ABSOLUTELY DO NOT state the answer to the original question above\n"
        f'- End with exactly this sentence: "Now I\'m going to give you a fresh question on the same concept — let\'s see how you do!"'
    )
    return call_claude(system, user, max_tokens=800)


def get_session_summary(session, topic, turns: list) -> str:
    system = "You are Buddy, a friendly AI tutor."
    user = (
        f"Generate a short, encouraging session summary for a student named {session.student_name}.\n\n"
        f"Session details:\n"
        f"- Topic: {topic.title}\n"
        f"- Questions asked: {session.questions_asked}\n"
        f"- Started at level: L1 (Getting started)\n"
        f"- Finished at level: {session.current_level}\n"
        f"- Key concepts covered: {', '.join(topic.key_concepts or [])}\n\n"
        f"Write 3-4 sentences:\n"
        f"1. Celebrate their effort and what they achieved\n"
        f"2. Mention specifically what level they reached\n"
        f"3. Note one or two concepts they practised\n"
        f"4. Encourage them to keep going\n\n"
        f"Keep it warm, specific, and age-appropriate for an 11-13 year old."
    )
    return call_claude(system, user, max_tokens=300)


def determine_next_action(session, confidence_tag: str, topic) -> dict:
    # Off-topic answers: don't penalise, just ask them to try the same question again
    if confidence_tag == "off_topic":
        return {
            "action": "retry_question",
            "new_level": session.current_level,
            "show_hint_button": False,
        }

    if confidence_tag == "confident":
        session.consecutive_confident += 1
        if session.consecutive_confident >= 2:
            if session.current_level == topic.difficulty_ceiling:
                return {
                    "action": "session_complete",
                    "new_level": session.current_level,
                    "message": "session_complete",
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
                    "show_hint_button": False,
                }
        else:
            session.hint_tier = 0
            session.concept_reset_done = False
            return {
                "action": "next_question",
                "new_level": session.current_level,
                "show_hint_button": False,
            }

    elif confidence_tag == "shaky":
        session.consecutive_confident = 0
        session.hint_tier = 0
        session.concept_reset_done = False
        return {
            "action": "next_question",
            "new_level": session.current_level,
            "show_hint_button": False,
        }

    else:  # struggling
        session.consecutive_confident = 0
        return {
            "action": "show_hint_button",
            "new_level": session.current_level,
            "show_hint_button": True,
        }
