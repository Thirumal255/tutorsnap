import json
import os
import re
import anthropic
from dotenv import load_dotenv

load_dotenv(override=True)

# ── Child-safe content moderation (task #36) ──────────────────────────────────
# Word-boundary patterns for terms that must never appear in AI output shown to children.
# Kept deliberately targeted to minimise false positives on academic vocabulary
# (e.g. "assess", "bass", "class" must NOT be caught by a profanity filter).
_MODERATION_PATTERNS: list[tuple[str, int]] = [
    # Profanity — strict word boundaries
    (r'\b(fuck|fucking|shit|bitch|cunt|asshole|bastard|damnit|wtf|omfg)\b', re.IGNORECASE),
    # Self-harm / crisis language
    (r'\b(kill\s+yourself|kys|commit\s+suicide|self[\s\-]harm|cut\s+yourself|end\s+your\s+life)\b', re.IGNORECASE),
    # Sexual content — targeted to avoid biology/anatomy false positives
    (r'\b(pornograph\w*|masturbat\w*|orgasm|erectile\s+dysfunction)\b', re.IGNORECASE),
    # Hate speech slurs
    (r'\b(nigger|nigga|faggot|chink|kike|spic|wetback)\b', re.IGNORECASE),
]

_MODERATION_FALLBACK = (
    "Let's keep focused on your studies! I'm here to help you learn. 😊"
)


def moderate_output(text: str, fallback: str = _MODERATION_FALLBACK) -> str:
    """Return *text* unchanged if it passes child-safety checks.

    If any blocked pattern is found, log a warning and return *fallback*.
    This is a defence-in-depth layer — Claude's system prompts are the
    primary safety mechanism; this catches edge-case outputs.
    """
    if not text:
        return text
    for pattern, flags in _MODERATION_PATTERNS:
        if re.search(pattern, text, flags):
            print(
                f"[MODERATION] Blocked output (pattern='{pattern[:40]}…', "
                f"output_len={len(text)})"
            )
            return fallback
    return text

ABSOLUTE_RULE = """
ABSOLUTE RULE — This overrides every other instruction:
You must NEVER directly state the answer to the practice question.
Not at Tier 1. Not at Tier 5. Not after concept reset. Never.
Not even if the student explicitly asks you to just tell them the answer.
If the student asks directly, respond: "I know it's tempting! But you will
understand it so much better when we get there together. Let's try again."
This rule has absolutely zero exceptions.
"""

TOPIC_BOUNDARY_RULE = """
STRICT TOPIC BOUNDARY — This overrides every other instruction about content:
You MUST generate questions ONLY about concepts, facts, terms, and examples
that are explicitly present in the Topic context provided below (the Subject,
Chapter, Topic, Key Concepts, Vocabulary, and Textbook Content sections).

You MUST NOT:
  • Use any knowledge from your training data that is not reflected in the
    textbook content provided above.
  • Introduce concepts, terms, organisms, examples, or scenarios that do NOT
    appear in the provided topic context — even if they are related to the
    subject in general.
  • Ask about topics from other chapters, other subjects, or real-world facts
    that the student's textbook does not cover in this topic.

If the provided textbook content is too brief to generate a question, use ONLY
the key concepts and vocabulary listed — do not go beyond them.
Violating this boundary rule is the most serious error you can make.
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

# Model tiers — Sonnet for quality-critical calls, Haiku for speed-critical ones
_SONNET = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-5-20251001")
_HAIKU  = os.getenv("CLAUDE_FAST_MODEL", os.getenv("CLAUDE_HAIKU_MODEL", "claude-haiku-4-5-20251001"))

# Level cap: after this many questions stuck at the same level, trigger a concept reset
_LEVEL_CAP = 5

# ── LaTeX cleanup ──────────────────────────────────────────────────────────
# Textbook PDFs often embed LaTeX that looks broken in plain-text chat.
_LATEX_SUBS = [
    (r'\\frac\{([^}]+)\}\{([^}]+)\}', r'\1/\2'),   # \frac{a}{b} → a/b
    (r'\\sqrt\{([^}]+)\}',             r'√(\1)'),    # \sqrt{x}    → √(x)
    (r'\^\{([^}]+)\}',                 r'^\1'),       # ^{n}        → ^n
    (r'_\{([^}]+)\}',                  r'_\1'),       # _{n}        → _n
    (r'\\times',  '×'), (r'\\div',    '÷'),
    (r'\\leq',    '≤'), (r'\\geq',   '≥'),
    (r'\\neq',    '≠'), (r'\\approx','≈'),
    (r'\\cdot',   '·'), (r'\\pm',    '±'),
    (r'\\[a-zA-Z]+\{([^}]*)\}', r'\1'),              # \cmd{x}     → x
    (r'\\[a-zA-Z]+',             ''),                 # remaining \cmd → ''
    (r'\$+',                     ''),                 # $ delimiters
    (r'\s{2,}',                  ' '),                # collapse whitespace
]


def strip_latex(text: str) -> str:
    """Remove LaTeX markup from textbook-extracted strings."""
    if not text:
        return text
    for pattern, repl in _LATEX_SUBS:
        text = re.sub(pattern, repl, text)
    return text.strip()


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
    raw = strip_latex((topic.raw_content or "")[:4000])

    # Pull grade/subject from the book via chapter → book relationship
    book = getattr(topic.chapter, "book", None) if topic.chapter else None
    subject = getattr(book, "subject", None) or "Mathematics"
    grade = getattr(book, "grade", None) or 7

    exercises_section = ""
    exercises = getattr(topic, "exercises", None) or []
    if exercises:
        clean_exercises = [strip_latex(q) for q in exercises[:20] if q]
        ex_lines = "\n".join(f"  - {q}" for q in clean_exercises)
        exercises_section = f"\nReal exercise questions from the textbook:\n{ex_lines}\n"

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


def _grade_profile(grade: int) -> str:
    """Return grade-band language/difficulty guidance for AI system prompts (task #39).

    Three bands mirror the typical school structure:
      Primary      (1-4)  : concrete language, recall focus
      Junior Sec   (5-9)  : standard range, reasoning encouraged
      Senior Sec  (10-12) : exam-ready, rigorous, multi-step
    """
    if grade <= 4:
        return (
            "GRADE PROFILE (Primary, Grades 1-4):\n"
            "- Use very simple, friendly language — short sentences, no jargon\n"
            "- Favour concrete, picture-friendly examples (counting, grouping, everyday objects)\n"
            "- Questions should be short and direct; avoid long problem statements\n"
            "- Limit difficulty to L1-L2 unless the topic ceiling explicitly allows higher\n"
            "- Celebrate every attempt warmly and simply\n"
            "- Never use abstract notation without first giving a concrete example\n"
        )
    elif grade <= 9:
        return (
            "GRADE PROFILE (Junior Secondary, Grades 5-9):\n"
            "- Use clear, approachable language — define any technical term on first use\n"
            "- Full difficulty range L1-L4 is appropriate for this grade band\n"
            "- Balance conceptual understanding with procedural practice\n"
            "- Encourage students to explain their reasoning, not just state an answer\n"
            "- Keep word problems real-world and relatable for 11-15 year olds\n"
        )
    else:
        return (
            "GRADE PROFILE (Senior Secondary, Grades 10-12):\n"
            "- Use precise, subject-accurate vocabulary — students are exam-ready\n"
            "- Full difficulty range L1-L5, including multi-step synthesis questions (L5)\n"
            "- Expect and reward rigorous reasoning, structured working, and formal notation\n"
            "- Challenge assumptions; push students towards exam-level critical thinking\n"
            "- Word problems may involve complex multi-stage scenarios\n"
        )


def call_claude(system: str, user: str, max_tokens: int = 800, model: str = None,
                _usage_out: list = None) -> str:
    """Call Claude and return the text response.

    If *_usage_out* is a list, append a dict with keys
    {model, input_tokens, output_tokens, cost_usd} for cost monitoring.
    """
    m = model or _SONNET
    try:
        response = _client.messages.create(
            model=m,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        if _usage_out is not None:
            _usage_out.append(_extract_usage(response, m))
        return moderate_output(response.content[0].text.strip())
    except Exception as e:
        raise RuntimeError(f"Claude API call failed: {e}") from e


def call_claude_vision(system: str, user_text: str, image_base64: str,
                       max_tokens: int = 800, _usage_out: list = None) -> str:
    """Call Claude with a base64 image + text for handwriting / drawing assessment."""
    try:
        response = _client.messages.create(
            model=_SONNET,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": image_base64,
                    },
                },
                {"type": "text", "text": user_text},
            ]}],
        )
        if _usage_out is not None:
            _usage_out.append(_extract_usage(response, _SONNET))
        return moderate_output(response.content[0].text.strip())
    except Exception as e:
        raise RuntimeError(f"Claude Vision API call failed: {e}") from e


# ── Pricing constants (USD per million tokens) ────────────────────────────────
# Update these if model pricing changes.
_PRICING: dict[str, tuple[float, float]] = {
    # model substring → (input $/M, output $/M)
    "sonnet": (3.0, 15.0),
    "haiku":  (0.8,  4.0),
    "opus":   (15.0, 75.0),
}


def _extract_usage(response, model_name: str) -> dict:
    """Build a usage dict from an Anthropic response object.

    Gracefully returns zeros if the response object lacks real usage data
    (e.g. during tests when the Anthropic client is mocked).
    """
    try:
        usage = getattr(response, "usage", None)
        inp = int(getattr(usage, "input_tokens", 0) or 0)
        out = int(getattr(usage, "output_tokens", 0) or 0)
        if inp < 0 or out < 0 or inp > 10_000_000:  # sanity-check (reject MagicMock ints)
            raise ValueError("implausible token count")
    except (TypeError, ValueError, AttributeError):
        inp, out = 0, 0
    # pick pricing tier by substring match
    cost_in, cost_out = 3.0, 15.0  # default: sonnet
    for key, prices in _PRICING.items():
        if key in model_name.lower():
            cost_in, cost_out = prices
            break
    cost_usd = (inp * cost_in + out * cost_out) / 1_000_000
    return {"model": model_name, "input_tokens": inp, "output_tokens": out, "cost_usd": cost_usd}


def generate_sub_question(topic, original_question: str, confusion_type: str = None) -> str:
    """Generate a simpler stepping-stone sub-question when a student is stuck."""
    subject_label = get_subject_label(topic)
    system = (
        f"You are Buddy, a friendly AI tutor for a {subject_label} student.\n"
        f"{ABSOLUTE_RULE}\n"
        f"{build_topic_context(topic)}"
    )
    confusion_ctx = {
        "formula": "The student cannot remember the formula or rule needed.",
        "apply":   "The student knows the concept but cannot apply it to this specific problem.",
        "concept": "The student does not understand the underlying concept at all.",
    }.get(confusion_type or "", "The student is stuck and does not know how to start.")

    user = (
        f"The student is stuck on this question:\n"
        f"ORIGINAL QUESTION: {original_question}\n\n"
        f"Why they are stuck: {confusion_ctx}\n\n"
        f"Your job: ask ONE short, simpler stepping-stone question that:\n"
        f"  1. Targets the gap identified above\n"
        f"  2. Is easier than the original question — it builds toward answering it\n"
        f"  3. Stays on the same topic and concept\n"
        f"  4. Does NOT reveal the answer to the original question\n"
        f"  5. Is encouraging and warm in tone (you can use a friendly emoji)\n\n"
        f"Return ONLY the question text — no preamble, no JSON, no explanation."
    )
    try:
        return call_claude(system, user, max_tokens=200, model=_HAIKU)
    except Exception:
        return "Let's try a simpler step first — can you recall the key rule or formula for this topic?"


def generate_question(topic, level: str, previous_questions: list[str], recent_formats: list[str] = None,
                      study_summary: str = "", session_memory: str = "") -> dict:
    """Generate a question and return a dict with question, expected_key_points, answer_format."""
    subject_label = get_subject_label(topic)
    book = getattr(topic.chapter, "book", None) if topic.chapter else None
    grade = getattr(book, "grade", None) or 7
    system = (
        f"You are Buddy, a friendly AI tutor for a {subject_label} student.\n"
        f"{_grade_profile(grade)}\n"
        f"{ABSOLUTE_RULE}\n"
        f"{TOPIC_BOUNDARY_RULE}\n"
        f"{build_topic_context(topic)}"
    )
    prev = previous_questions[-5:] if previous_questions else []

    exercises = getattr(topic, "exercises", None) or []
    used = set(previous_questions)
    unused_exercises = [q for q in exercises if q not in used]

    if unused_exercises:
        exercise_pool_label = "UNUSED textbook exercises (not yet asked this session)"
        exercise_pool = unused_exercises[:10]
        recycle_note = ""
    elif exercises:
        # All exercises used — recycle with varied numbers
        exercise_pool_label = "textbook exercises to recycle (all have been used — vary the numbers)"
        exercise_pool = exercises[:10]
        recycle_note = (
            "\nBecause all exercises have been used, pick one and change the numbers "
            "so it feels like a fresh problem. Keep the same concept and structure.\n"
        )
    else:
        exercise_pool_label = None
        exercise_pool = []
        recycle_note = ""

    if exercise_pool:
        exercise_instruction = (
            f"SOURCE — you MUST base your question on one of these {exercise_pool_label}:\n"
            + "\n".join(f"  {i+1}. {q}" for i, q in enumerate(exercise_pool))
            + f"\n{recycle_note}\n"
            f"Rules for using the exercise:\n"
            f"  • Pick the exercise whose CONCEPT best suits level {level}.\n"
            f"  • If the exercise is Multiple Choice (has options A/B/C/D or (a)/(b)/(c)):  \n"
            f"      – REMOVE all the options entirely.\n"
            f"      – Rewrite as a direct open-ended question that asks for the answer outright.\n"
            f"      – Example: 'Which of these is divisible by 3? A) 14 B) 21 C) 25'  \n"
            f"        → becomes: 'Which of the following numbers is divisible by 3: 14, 21, or 25? State the rule you used.'\n"
            f"  • You may change numbers/values to create variety, but the concept must stay identical.\n"
            f"  • Do NOT invent a completely new question — always start from a real exercise above.\n"
        )
    else:
        exercise_instruction = (
            "No textbook exercises are stored for this topic.\n"
            "Generate a question using ONLY the key concepts, vocabulary, and textbook "
            "content provided in the topic context above.\n"
            "Do NOT introduce any concept, example, term, or fact that does not appear "
            "in the topic context — not even related real-world examples from your "
            "general knowledge. If the content is sparse, ask a simple L1 recall "
            "question about one of the listed key concepts or vocabulary terms.\n"
        )

    # Answer-format variety enforcement
    recent = recent_formats or []
    if len(recent) >= 2 and len(set(recent[-2:])) == 1:
        avoid_format = recent[-1]
        variety_rule = (
            f"\nVARIETY RULE — the last two questions were both '{avoid_format}' format. "
            f"Choose a DIFFERENT answer_format this time to keep the session varied.\n"
        )
    else:
        variety_rule = ""

    # Level-specific question starter guidance
    LEVEL_STARTERS = {
        "L1": (
            "L1 is RECALL — the student must state a fact, rule, or definition from memory.\n"
            "  Use openers like: 'State the rule for...', 'Define...', 'What is...', 'True or false:'\n"
            "  ✓ Good: 'State the divisibility rule for 6.'\n"
            "  ✗ Bad:  'Is 42 divisible by 6?' — that's application (L3), not recall."
        ),
        "L2": (
            "L2 is COMPREHENSION — the student must explain a concept in their own words.\n"
            "  Use openers like: 'Explain in one or two sentences...', 'Describe in your own words...', 'What does ... mean?'\n"
            "  ✓ Good: 'Explain in your own words what it means for a number to be divisible by another.'\n"
            "  ✗ Bad:  'Calculate the LCM of 6 and 9.' — that's application (L3)."
        ),
        "L3": (
            "L3 is APPLICATION — give a specific problem and ask for a direct answer.\n"
            "  Use openers like: 'Find...', 'Calculate...', 'Is ... divisible by ...? Yes or No — state the rule you used.'\n"
            "  Always include all the numbers/values the student needs.\n"
            "  ✓ Good: 'Find the LCM of 8 and 12. Show your steps.'\n"
            "  ✓ Good: 'Is 144 divisible by 9? State the rule and give your answer.'"
        ),
        "L4": (
            "L4 is ANALYSIS — the student must reason, spot an error, or compare approaches.\n"
            "  Use structures like: 'A student says [wrong claim]. Is this correct? Explain why or why not.'\n"
            "  Or: 'Two students solved this differently — which method is correct and why?'\n"
            "  ✓ Good: 'Arun says the LCM of 4 and 6 is 24. Is he correct? Explain your reasoning.'"
        ),
        "L5": (
            "L5 is SYNTHESIS — multi-step word problem requiring two or more concepts.\n"
            "  Write a real-world scenario with all given information, then ask a clear question.\n"
            "  End with 'Show all your working.'\n"
            "  ✓ Good: 'Two buses leave the same stop. Bus A comes every 12 minutes and Bus B every 18 minutes. "
            "If they both leave at 9:00 am, when will they next leave together? Show all your working.'"
        ),
    }

    few_shot = """
FEW-SHOT EXAMPLES — study these carefully, they show the expected output format:

Example A — L1 recall, rule format:
{"question": "📘 Prime Numbers — State the definition of a prime number.",
 "expected_key_points": ["exactly two factors", "divisible only by 1 and itself"],
 "answer_format": "rule"}

Example B — L3 application, working format:
{"question": "📘 LCM and HCF — Find the LCM of 8 and 12. Show your steps.",
 "expected_key_points": ["24"],
 "answer_format": "working"}

Example C — L2 comprehension, explanation format:
{"question": "📘 Fractions — Explain in one or two sentences what a proper fraction is.",
 "expected_key_points": ["numerator smaller than denominator", "value less than 1"],
 "answer_format": "explanation"}

Example D — MCQ converted to open-ended, yes_no format:
Original MCQ: "Which is NOT a prime? A) 7  B) 11  C) 15  D) 17"
Converted: {"question": "📘 Prime Numbers — True or false: 15 is a prime number? Explain your answer briefly.",
            "expected_key_points": ["false", "divisible by 3 and 5", "more than two factors"],
            "answer_format": "yes_no"}

Example E — L4 analysis, explanation format:
{"question": "📘 Divisibility Rules — A student says that 132 is divisible by 9 because 1 + 3 + 2 = 6. Is this correct? Explain why or why not.",
 "expected_key_points": ["incorrect", "digits must add to 9 or multiple of 9", "6 is not divisible by 9"],
 "answer_format": "explanation"}
"""

    study_ctx = (
        f"\nSTUDY CONTEXT — the student already studied this topic with Buddy. "
        f"Here is a summary of what was explained:\n{study_summary}\n"
        f"Your question MUST be drawn from concepts covered in this study session.\n"
    ) if study_summary.strip() else ""

    # ── Session memory (task #40) — inject past-session summaries so Buddy can
    # avoid re-testing mastered concepts and target known weak areas. ───────────
    memory_ctx = ""
    if session_memory:
        try:
            memories = json.loads(session_memory)
            if memories:
                mem_lines = [
                    f"  - {m.get('date','')}: Level {m.get('level','')} — {m.get('summary','')[:200]}"
                    for m in memories[-3:]
                ]
                memory_ctx = (
                    "\nPAST SESSIONS — what Buddy already knows about this student's history on this topic:\n"
                    + "\n".join(mem_lines)
                    + "\nUse this to avoid repeating already-mastered concepts, target persistent weak "
                      "areas, and acknowledge genuine progress where relevant.\n"
                )
        except Exception:
            pass

    user = (
        f"Generate exactly ONE practice question at difficulty level {level}.\n"
        f"Level {level} means: {LEVEL_GUIDE[level]}\n\n"
        f"{study_ctx}"
        f"{memory_ctx}"
        f"{exercise_instruction}\n"
        f"LEVEL GUIDANCE:\n{LEVEL_STARTERS.get(level, '')}\n\n"
        f"{variety_rule}"
        f"QUESTION CLARITY RULES — make the answer type obvious from the wording:\n"
        f"  number      → start with 'Calculate', 'Find', 'What is the value of'\n"
        f"  yes_no      → start with 'True or false:' or end with '— Yes or No?'\n"
        f"  rule        → start with 'State the rule for', 'Define', 'Complete this statement:'\n"
        f"  explanation → start with 'Explain in one or two sentences' or 'Describe in your own words'\n"
        f"  working     → end with 'Show all your working.' or 'Show your steps.'\n\n"
        f"TOPIC ANCHOR — the question MUST begin with a one-line anchor:\n"
        f"  Format: '📘 [Topic name] — [the actual question]'\n"
        f"  Example: '📘 Divisibility Rules — State the divisibility rule for 9.'\n\n"
        f"The student can only see the chat — they do NOT have the textbook open.\n"
        f"Every question must be fully self-contained (include all given values and context).\n"
        f"Do NOT repeat any of these previous questions: {prev}\n\n"
        f"After composing the question, also determine:\n"
        f"1. expected_key_points — 2-5 short strings capturing what a correct answer MUST contain.\n"
        f"   Write these as a student would naturally say them, NOT as a textbook definition.\n"
        f"   Keep each point short — a student partial match should still score it.\n\n"
        f"2. answer_format — ONE of: \"number\", \"yes_no\", \"rule\", \"explanation\", \"working\"\n\n"
        f"{few_shot}\n"
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
    image_data: str | None = None,
    _usage_out: list | None = None,
) -> dict:
    """
    Two-phase scoring: compare the student's answer against the reference key points
    using a per-format rubric, rather than doing blind open-ended grading.
    When image_data (base64 JPEG) is provided the answer is handwritten — use vision.
    """
    subject_label = get_subject_label(topic)
    _book = getattr(topic.chapter, "book", None) if topic.chapter else None
    _grade = getattr(_book, "grade", None) or 7
    system = (
        f"You are Buddy, a friendly AI tutor for a {subject_label} student.\n"
        f"{_grade_profile(_grade)}\n"
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
        f'{{"score": 85, "feedback": "...", "off_topic": false, "missed_key_points": []}}\n\n'
        f"IMPORTANT — score must reflect ONLY the correctness of the answer (0-100).\n"
        f"Do NOT apply any hint tier adjustment to the score — that is handled elsewhere.\n\n"
        f"If off_topic is TRUE:\n"
        f"  - score: 0\n"
        f"  - feedback: warm, playful redirect. Use humour. Make them smile and want to try again.\n"
        f"  - Examples: 'Haha, I like the creativity! But maths hat on now — '\n"
        f"    'Oops, brain wandered! Let\\'s bring it back — '\n"
        f"  - End by briefly restating what the question asks. Do NOT hint at the answer.\n\n"
        f"If off_topic is FALSE:\n"
        f"  - feedback: 1-2 sentences max, warm and encouraging, never condescending\n"
        f"  - CORRECT answers (score 80+): celebrate clearly — 'Spot on!', 'Exactly!', 'Perfect!', 'Brilliant!'\n"
        f"  - PARTIALLY correct (score 50-79): name what they got right, then point at the gap without revealing the answer\n"
        f"      ✓ Good: 'You're right that it involves multiples — but check what *least* common means.'\n"
        f"      ✗ Bad:  'Not quite, try again!' — too vague, student learns nothing\n"
        f"  - WRONG answers (score < 50): name specifically what is off (not the answer itself)\n"
        f"      ✓ Good: 'The method is right but check your arithmetic in the last step.'\n"
        f"      ✓ Good: 'You've found a common multiple, but is it the *smallest* one?'\n"
        f"      ✗ Bad:  'Keep trying!' — gives no direction\n"
        f"  - NEVER reveal the correct answer in feedback — that is the hint system's job\n"
        f"  - NEVER say 'Good effort' or 'I can see you tried' for clearly wrong answers — be honest but kind\n\n"
        f"Also return missed_key_points: list the reference key points the student's answer did NOT address.\n"
        f"  - Leave as [] if all points covered, or if off_topic is true, or if there are no reference points.\n"
        f"  - Example: reference=[\"digits add to 9\",\"last digit 0 or 5\"], student said only last digit rule → missed=[\"digits add to 9\"]"
    )
    transcription: str | None = None
    try:
        if image_data:
            # Handwritten answer — use vision model; inject image + text prompt.
            # Ask Claude to also return a `transcription` of what it reads, so
            # the student can verify their handwriting was read correctly (#11).
            vision_user = (
                f"The student wrote their answer by hand (see the image above).\n"
                f"IMPORTANT: First, carefully transcribe exactly what you can read from the handwriting "
                f"into a 'transcription' field in your JSON. Then assess that transcribed text as the student's answer.\n\n"
                + user
                + "\n\nIMPORTANT: Include a 'transcription' key in your JSON with the exact text you read from the image. "
                  "Example: {\"transcription\": \"The answer is 42\", \"score\": 90, ...}"
            )
            raw = call_claude_vision(system, vision_user, image_data, max_tokens=550,
                                     _usage_out=_usage_out)
        else:
            raw = call_claude(system, user, max_tokens=450, model=_SONNET,
                              _usage_out=_usage_out)
        cleaned = re.sub(r"```[a-z]*\n?", "", raw).strip()
        data = json.loads(cleaned)
        raw_score = int(data.get("score", 0))
        feedback = str(data.get("feedback", "Let's try again!"))
        off_topic = bool(data.get("off_topic", False))
        missed_key_points = list(data.get("missed_key_points") or [])
        if image_data:
            transcription = data.get("transcription") or None
    except Exception:
        return {"score": 0, "feedback": "Let's try again!", "confidence_tag": "struggling",
                "off_topic": False, "missed_key_points": [], "transcription": None}

    if off_topic:
        # Off-topic answers: don't penalise, just ask them to try the same question again.
        return {"score": 0, "feedback": feedback, "confidence_tag": "off_topic",
                "off_topic": True, "missed_key_points": [], "transcription": transcription}

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

    return {"score": score, "feedback": feedback, "confidence_tag": confidence_tag,
            "off_topic": False, "missed_key_points": missed_key_points,
            "transcription": transcription}


def get_hint(topic, question: str, student_answer: str, hint_tier: int,
             missed_key_points: list = None) -> str:
    subject_label = get_subject_label(topic)
    _hbook = getattr(topic.chapter, "book", None) if topic.chapter else None
    _hgrade = getattr(_hbook, "grade", None) or 7
    system = (
        f"You are Buddy, a friendly AI tutor for a {subject_label} student.\n"
        f"{_grade_profile(_hgrade)}\n"
        f"{ABSOLUTE_RULE}\n"
        f"IMPORTANT — Hint context rule: The student's answer shown below has already been\n"
        f"assessed as INCORRECT or INCOMPLETE by the grading system. Do NOT tell the student\n"
        f"their answer is correct or 'spot on' — if it were correct, no hint would be shown.\n"
        f"Focus exclusively on helping them understand what is missing or wrong.\n"
        f"{build_topic_context(topic)}"
    )

    # Sharpen tier-1 and tier-2 hints using the specific gaps the grader found
    missed_section = ""
    if missed_key_points:
        missed_section = (
            f"\nThe grader identified these SPECIFIC GAPS in the student's answer — "
            f"address these directly (without revealing the answer):\n"
            + "\n".join(f"  - Missing: {p}" for p in missed_key_points)
            + "\n"
        )

    if hint_tier == 1:
        tier_instruction = (
            f"The student got this question wrong and needs a gentle nudge.\n"
            f"QUESTION THEY WERE ASKED: {question}\n"
            f"THEIR INCORRECT ANSWER: {student_answer}\n"
            f"{missed_section}\n"
            f"Give a Tier 1 hint: a targeted conceptual nudge.\n"
            f"- Address the specific gap identified above (if any), otherwise identify what is wrong\n"
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

    # Haiku is fast enough for guidance hints (tiers 1-3); Sonnet for heavy scaffolding (4-5)
    hint_model = _HAIKU if hint_tier <= 3 else _SONNET
    return call_claude(system, tier_instruction, max_tokens=600, model=hint_model)


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
    system = "You are Buddy, a friendly AI tutor. Keep all responses concise and encouraging."

    answered = [t for t in turns if t.student_answer and t.assessment_score is not None]
    n_answered = len(answered)

    # ── Case 1: student left without answering anything ────────────────────────
    if n_answered == 0:
        user = (
            f"Write a SHORT (2-3 sentences) friendly message for {session.student_name}, "
            f"who opened a practice session on '{topic.title}' but left before answering any questions. "
            f"Acknowledge they showed up (that matters!), gently encourage them to try again and give it a go next time. "
            f"Do NOT pretend they answered questions or celebrate performance they didn't have. "
            f"Age-appropriate for an 11-13 year old."
        )
        return call_claude(system, user, max_tokens=150, model=_HAIKU)

    # ── Case 2: real session with answers ─────────────────────────────────────
    scores = [t.assessment_score for t in answered]
    avg_score = round(sum(scores) / len(scores))
    performance = "excellent" if avg_score >= 80 else "developing" if avg_score >= 55 else "needs more practice"

    # Summarise what the student actually answered
    turn_lines = []
    for t in answered[-4:]:   # last 4 turns max
        score_label = "✅" if (t.assessment_score or 0) >= 70 else "❌"
        q_short = (t.question_text or "")[:80].replace('\n', ' ')
        turn_lines.append(f"  {score_label} Q: {q_short} → score {t.assessment_score}")
    turns_text = "\n".join(turn_lines) if turn_lines else "  (no detail available)"

    user = (
        f"Generate a short (3-4 sentences) encouraging session summary for {session.student_name}.\n\n"
        f"Session facts:\n"
        f"- Topic: {topic.title}\n"
        f"- Questions answered: {n_answered}\n"
        f"- Average score: {avg_score}% ({performance})\n"
        f"- Level reached: {session.current_level}\n"
        f"- Key concepts covered: {', '.join(topic.key_concepts or [])}\n"
        f"- Recent answers:\n{turns_text}\n\n"
        f"Instructions:\n"
        f"1. Celebrate their effort and reference their actual score ({avg_score}%).\n"
        f"2. Mention the level they reached ({session.current_level}).\n"
        f"3. Pick one concept they practised from the list above.\n"
        f"4. One specific tip or encouragement based on their performance.\n\n"
        f"Keep it warm, specific, and age-appropriate for an 11-13 year old."
    )
    return call_claude(system, user, max_tokens=300, model=_HAIKU)


def determine_next_action(session, confidence_tag: str, topic, raw_score: int = 0) -> dict:
    """
    Decide what happens next after a student submits an answer.

    Improvements vs original:
    - Fast advancement: a perfect no-hint answer (raw_score >= 90, hint_tier == 0) counts
      as 2 consecutive confident answers, so the student advances immediately.
    - Level cap: after _LEVEL_CAP questions at the same level without advancing, a concept
      reset is triggered automatically rather than letting the student loop forever.
    """
    lqc = getattr(session, 'level_question_count', 0) or 0

    # Off-topic: retry the same question, no penalties
    if confidence_tag == "off_topic":
        return {
            "action": "retry_question",
            "new_level": session.current_level,
            "show_hint_button": False,
        }

    if confidence_tag == "confident":
        # Fast advancement: perfect answer with no hints counts double
        clean_run = (raw_score >= 90 and session.hint_tier == 0)
        session.consecutive_confident += 2 if clean_run else 1

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
                session.level_question_count = 0   # reset cap for new level
                return {
                    "action": "advance_level",
                    "new_level": new_level,
                    "show_hint_button": False,
                }
        else:
            session.hint_tier = 0
            session.concept_reset_done = False
            session.level_question_count = lqc + 1
            return {
                "action": "next_question",
                "new_level": session.current_level,
                "show_hint_button": False,
            }

    elif confidence_tag == "shaky":
        session.consecutive_confident = 0
        session.hint_tier = 0
        session.concept_reset_done = False
        new_lqc = lqc + 1
        session.level_question_count = new_lqc

        # Level cap: too many shaky/struggling attempts at this level → concept reset
        if new_lqc >= _LEVEL_CAP and not session.concept_reset_done:
            session.concept_reset_done = True
            session.level_question_count = 0
            return {
                "action": "level_cap_reset",
                "new_level": session.current_level,
                "show_hint_button": False,
            }
        return {
            "action": "next_question",
            "new_level": session.current_level,
            "show_hint_button": False,
        }

    else:  # struggling
        session.consecutive_confident = 0
        new_lqc = lqc + 1
        session.level_question_count = new_lqc

        # Level cap: too many struggling attempts → concept reset
        if new_lqc >= _LEVEL_CAP and not session.concept_reset_done:
            session.concept_reset_done = True
            session.level_question_count = 0
            return {
                "action": "level_cap_reset",
                "new_level": session.current_level,
                "show_hint_button": False,
            }
        return {
            "action": "show_hint_button",
            "new_level": session.current_level,
            "show_hint_button": True,
        }


# ── Worked example generator (task #30) ──────────────────────────────────────

def generate_worked_example(topic, level: str, study_summary: str = "") -> str:
    """Generate a short worked example for a topic at the given level.

    Returns a Markdown string the tutor can show before the first question.
    Returns an empty string on failure (non-fatal).
    """
    subject_label = get_subject_label(topic)
    context_section = build_topic_context(topic)
    summary_section = (
        f"\nStudent's study notes:\n{study_summary}\n" if study_summary else ""
    )
    system = (
        f"You are Buddy, a friendly AI tutor for a {subject_label} student.\n"
        f"Your job is to show ONE brief, fully worked example question for this topic "
        f"at difficulty level {level}. The example should:\n"
        f"  - Be clearly labelled as an EXAMPLE (not the practice question)\n"
        f"  - Show the question AND a complete step-by-step solution\n"
        f"  - Be encouraging and easy to follow\n"
        f"  - Be 4–8 lines maximum\n"
        f"  - NOT ask the student to do anything — it is a demonstration\n"
        f"{TOPIC_BOUNDARY_RULE}\n"
        f"{context_section}"
        f"{summary_section}"
    )
    user = (
        f"Create one short worked example at level {level} for this topic. "
        f"Format:\n"
        f"**Example:** [question text]\n"
        f"**Solution:** [step-by-step answer]\n\n"
        f"Keep it brief (≤8 lines). Do not ask the student to try — just show the example."
    )
    try:
        return call_claude(system, user, max_tokens=300, model=_HAIKU)
    except Exception:
        return ""


def generate_parent_tip(
    topic_title: str,
    key_concepts: list,
    mastery_level: str,
    session_summary: str,
) -> str:
    """#49: One-to-two-sentence AI tip for a parent about what their child just practised."""
    concepts = ", ".join(key_concepts[:4]) if key_concepts else topic_title
    summary_snippet = (session_summary or "")[:250]
    user = (
        f"A student just finished a practice session on '{topic_title}'. "
        f"Their current mastery level: {mastery_level}. Key concepts covered: {concepts}. "
        f"Session summary: {summary_snippet}\n\n"
        f"Write 1–2 sentences for the parent: briefly state what was practised and suggest ONE "
        f"simple, specific thing they can do at home to reinforce it. "
        f"Be warm, practical and under 70 words. No emoji, no bullet points."
    )
    try:
        return call_claude("You are a friendly tutor writing a brief note to a parent.", user,
                           max_tokens=120, model=_HAIKU)
    except Exception:
        return (
            f"Your child practised {topic_title} today — ask them to explain one thing they "
            f"learned in their own words. That single step makes the knowledge stick!"
        )
