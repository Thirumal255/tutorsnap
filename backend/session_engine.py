import json
import os
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
- A one-word correct answer ("yes", "no", "5", "LCM") is worth FULL marks
- Stating the correct rule or procedure (even without a worked example) is worth 80+
- NEVER give a low score to a correct answer just because it lacks detail
- NEVER refuse to recognise a correct answer out of caution
- Partial credit (50-79) only when the student is on the right track but incomplete or has a minor error
- Feedback must celebrate what they got right, even when the overall score is low
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


def generate_question(topic, level: str, previous_questions: list[str]) -> str:
    system = (
        f"You are Buddy, a friendly AI tutor for a Cambridge Grade 7 Mathematics student.\n"
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
        f"- Be appropriate for a Grade 7 Cambridge student\n"
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
        f"Return ONLY the question text. No preamble, no answer, no explanation, no numbering."
    )
    return call_claude(system, user, max_tokens=300)


def assess_answer(topic, question: str, answer: str, level: str, hint_tier: int) -> dict:
    system = (
        f"You are Buddy, a friendly AI tutor for a Cambridge Grade 7 Mathematics student.\n"
        f"{ASSESS_RULE}\n"
        f"{build_topic_context(topic)}"
    )
    user = (
        f"The student was asked this question at level {level}:\n"
        f"QUESTION: {question}\n\n"
        f"The student answered:\n"
        f"ANSWER: {answer}\n\n"
        f"STEP 1 — Is the answer off-topic?\n"
        f"Set off_topic to TRUE if the answer:\n"
        f"  - Is completely unrelated to maths (e.g. 'I like pizza', 'What's for lunch?', 'Hello')\n"
        f"  - Is a joke, random words, gibberish, or nonsense\n"
        f"  - Says 'I don't know', 'idk', 'no idea', 'skip', or similar\n"
        f"  - Is a question instead of an answer\n"
        f"  - Contains no mathematical attempt whatsoever\n"
        f"Set off_topic to FALSE only if the student is genuinely attempting to answer the maths question,\n"
        f"even if their answer is completely wrong.\n\n"
        f"STEP 2 — Score the answer (off_topic must be FALSE):\n"
        f"Be GENEROUS — recognise correct answers even if brief or informally worded.\n"
        f"  - 90-100: correct answer or correct key concept/rule stated — award this even for short answers\n"
        f"  - 70-89: mostly correct, minor omission or small error\n"
        f"  - 50-69: partially correct, on the right track but incomplete\n"
        f"  - 0-49: wrong approach, no understanding shown\n\n"
        f"IMPORTANT scoring examples:\n"
        f"  - If asked 'is X divisible by Y?' and student says 'yes' or 'no' correctly → score 80+\n"
        f"  - If student states the correct rule or test → score 85+\n"
        f"  - If student gives the correct numerical answer → score 90+\n"
        f"  - Do NOT penalise for not showing full working if the answer is correct\n\n"
        f"Return ONLY valid JSON. No markdown. No text before or after.\n"
        f'{{"score": 85, "feedback": "...", "off_topic": false}}\n\n'
        f"If off_topic is TRUE:\n"
        f"  - Set score to 0\n"
        f"  - Write a feedback message that is warm, playful, and gently redirects them back to the question.\n"
        f"  - Use humour or a fun analogy. Make them smile and want to try again.\n"
        f"  - Examples: 'Haha, I like the creativity! But let\\'s put our maths hats on — '\n"
        f"    'Oops, looks like your brain wandered off on a little adventure! Let\\'s bring it back —'\n"
        f"    'Ha! Nice try sneaking that in 😄 Let\\'s focus — '\n"
        f"  - End by briefly restating what the question is asking. Do NOT give any hint about the answer.\n\n"
        f"If off_topic is FALSE:\n"
        f"  - feedback: 1-2 sentences, always encouraging, never condescending\n"
        f"  - Celebrate what they got right, even if the overall score is low\n"
        f"  - For correct answers, be enthusiastic: 'Spot on!', 'Exactly right!', 'Perfect!' etc.\n"
        f"  - For wrong answers, encourage the attempt without revealing the answer\n\n"
        f"Hint tier weighting (apply to score when off_topic is false):\n"
        f"  - hint_tier 0: score unchanged\n"
        f"  - hint_tier 1: multiply score by 0.9\n"
        f"  - hint_tier 2: cap score at 79 maximum\n"
        f"  - hint_tier 3+: cap score at 49 maximum\n"
        f"Current hint_tier: {hint_tier}"
    )
    try:
        text = call_claude(system, user, max_tokens=400)
        data = json.loads(text)
        score = int(data.get("score", 0))
        feedback = str(data.get("feedback", "Let's try again!"))
        off_topic = bool(data.get("off_topic", False))
    except Exception:
        return {"score": 0, "feedback": "Let's try again!", "confidence_tag": "struggling", "off_topic": False}

    if off_topic:
        # Off-topic answers don't count as struggling — keep the hint button hidden,
        # just ask them to try again with the same question.
        return {"score": 0, "feedback": feedback, "confidence_tag": "off_topic", "off_topic": True}

    if score >= 80:
        confidence_tag = "confident"
    elif score >= 50:
        confidence_tag = "shaky"
    else:
        confidence_tag = "struggling"

    return {"score": score, "feedback": feedback, "confidence_tag": confidence_tag, "off_topic": False}


def get_hint(topic, question: str, student_answer: str, hint_tier: int) -> str:
    system = (
        f"You are Buddy, a friendly AI tutor for a Cambridge Grade 7 Mathematics student.\n"
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
    system = (
        f"You are Buddy, a friendly AI tutor for a Cambridge Grade 7 Mathematics student.\n"
        f"{ABSOLUTE_RULE}\n"
        f"{build_topic_context(topic)}"
    )
    user = (
        f"The student has been unable to answer this question even after 5 hints:\n"
        f"QUESTION: {question}\n\n"
        f"Give a full concept explanation:\n"
        f"- Explain the underlying concept clearly and completely\n"
        f"- Use simple language appropriate for Grade 7\n"
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
