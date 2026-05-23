"""
Unit tests for session_engine.py helper functions.

These tests do NOT call the real Claude API — all Anthropic calls are patched.
Covers:
- strip_latex           — LaTeX → plain text conversion
- get_next_level        — level progression
- get_start_level       — mastery → starting level
- LEVEL_ORDER           — sanity checks
- LEVEL_GUIDE           — all levels documented
"""

import json
import pytest
from unittest.mock import patch, MagicMock
from session_engine import (
    strip_latex,
    get_next_level,
    get_start_level,
    LEVEL_ORDER,
    LEVEL_GUIDE,
    PROMPT_VERSION,
    generate_transfer_question,
    generate_parent_tip,
)


class TestStripLatex:
    def test_fraction_conversion(self):
        assert "1/2" in strip_latex(r"\frac{1}{2}")

    def test_sqrt_conversion(self):
        assert "√(x)" in strip_latex(r"\sqrt{x}")

    def test_times_symbol(self):
        assert "×" in strip_latex(r"a \times b")

    def test_div_symbol(self):
        assert "÷" in strip_latex(r"a \div b")

    def test_leq_symbol(self):
        assert "≤" in strip_latex(r"x \leq 5")

    def test_geq_symbol(self):
        assert "≥" in strip_latex(r"x \geq 5")

    def test_dollar_signs_removed(self):
        result = strip_latex(r"$x = 5$")
        assert "$" not in result

    def test_empty_string_returns_empty(self):
        assert strip_latex("") == ""

    def test_none_returns_none(self):
        assert strip_latex(None) is None

    def test_plain_text_unchanged(self):
        text = "The answer is 42"
        assert strip_latex(text) == text

    def test_superscript_conversion(self):
        result = strip_latex(r"x^{2}")
        assert "^2" in result

    def test_subscript_conversion(self):
        result = strip_latex(r"x_{n}")
        assert "_n" in result

    def test_nested_command_stripped(self):
        result = strip_latex(r"\textbf{bold text}")
        assert "bold text" in result

    def test_pm_symbol(self):
        assert "±" in strip_latex(r"\pm 5")

    def test_approx_symbol(self):
        assert "≈" in strip_latex(r"x \approx 3.14")

    def test_multiple_transformations(self):
        expr = r"\frac{a}{b} \times \sqrt{c} \leq d"
        result = strip_latex(expr)
        assert "/" in result
        assert "×" in result
        assert "√" in result
        assert "≤" in result
        assert "\\" not in result


class TestLevelProgression:
    def test_l1_progresses_to_l2(self):
        assert get_next_level("L1") == "L2"

    def test_l2_progresses_to_l3(self):
        assert get_next_level("L2") == "L3"

    def test_l3_progresses_to_l4(self):
        assert get_next_level("L3") == "L4"

    def test_l4_progresses_to_l5(self):
        assert get_next_level("L4") == "L5"

    def test_l5_stays_at_l5(self):
        """Level 5 is the maximum — should not exceed."""
        assert get_next_level("L5") == "L5"

    def test_invalid_level_returns_l1(self):
        """Unknown levels should default gracefully."""
        result = get_next_level("L9")
        assert result in LEVEL_ORDER

    def test_get_start_level_from_l1(self):
        """Starting level for L1 mastery should be L1 (can't go lower)."""
        assert get_start_level("L1") == "L1"

    def test_get_start_level_from_l3(self):
        """Starting level should be one below mastery."""
        assert get_start_level("L3") == "L2"

    def test_get_start_level_from_l5(self):
        assert get_start_level("L5") == "L4"

    def test_get_start_level_from_l2(self):
        assert get_start_level("L2") == "L1"

    def test_get_start_level_from_l4(self):
        assert get_start_level("L4") == "L3"


class TestLevelConstants:
    def test_level_order_has_five_levels(self):
        assert len(LEVEL_ORDER) == 5

    def test_level_order_correct_sequence(self):
        assert LEVEL_ORDER == ["L1", "L2", "L3", "L4", "L5"]

    def test_level_guide_has_all_levels(self):
        for level in LEVEL_ORDER:
            assert level in LEVEL_GUIDE, f"LEVEL_GUIDE missing entry for {level}"

    def test_level_guide_values_are_strings(self):
        for level, description in LEVEL_GUIDE.items():
            assert isinstance(description, str)
            assert len(description) > 0

    def test_level_order_is_list(self):
        assert isinstance(LEVEL_ORDER, list)

    def test_all_level_order_entries_in_guide(self):
        for lvl in LEVEL_ORDER:
            assert lvl in LEVEL_GUIDE


# ── PROMPT_VERSION (#65) ──────────────────────────────────────────────────────

class TestPromptVersion:
    def test_prompt_version_is_string(self):
        assert isinstance(PROMPT_VERSION, str)

    def test_prompt_version_non_empty(self):
        assert len(PROMPT_VERSION) > 0

    def test_prompt_version_format(self):
        """Version should be in semver-like format e.g. '2.1'."""
        parts = PROMPT_VERSION.split(".")
        assert len(parts) >= 2
        for part in parts:
            assert part.isdigit(), f"Version part '{part}' should be numeric"


# ── generate_transfer_question (#60) ──────────────────────────────────────────

class TestGenerateTransferQuestion:
    @patch("session_engine._client")
    def test_returns_expected_keys(self, mock_client):
        """Return dict must have question, key_points, answer_format, topic_a, topic_b."""
        mock_client.messages.create.return_value = MagicMock(
            content=[MagicMock(text=json.dumps({
                "question": "How do ratios relate to fractions?",
                "key_points": ["Both compare quantities", "Fractions are ratios"],
                "answer_format": "explanation",
            }))]
        )
        result = generate_transfer_question(
            topic_a_title="Fractions",
            topic_a_concepts=["numerator", "denominator"],
            topic_b_title="Ratios",
            topic_b_concepts=["comparison", "proportion"],
            grade=6,
            subject="Mathematics",
        )
        assert "question" in result
        assert "key_points" in result
        assert "answer_format" in result
        assert result["topic_a"] == "Fractions"
        assert result["topic_b"] == "Ratios"
        assert isinstance(result["key_points"], list)

    @patch("session_engine._client")
    def test_returns_fallback_on_invalid_json(self, mock_client):
        """When Claude returns invalid JSON, a meaningful fallback question is returned."""
        mock_client.messages.create.return_value = MagicMock(
            content=[MagicMock(text="Not valid JSON at all")]
        )
        result = generate_transfer_question(
            topic_a_title="Gravity",
            topic_a_concepts=["force", "mass"],
            topic_b_title="Acceleration",
            topic_b_concepts=["velocity", "time"],
            grade=8,
            subject="Physics",
        )
        assert "question" in result
        assert len(result["question"]) > 0
        assert "Gravity" in result["question"] or "Acceleration" in result["question"]
        assert result["topic_a"] == "Gravity"
        assert result["topic_b"] == "Acceleration"

    @patch("session_engine._client")
    def test_key_points_capped_at_four(self, mock_client):
        """key_points should contain at most 4 entries."""
        mock_client.messages.create.return_value = MagicMock(
            content=[MagicMock(text=json.dumps({
                "question": "Combined question",
                "key_points": ["p1", "p2", "p3", "p4", "p5", "p6"],
                "answer_format": "working",
            }))]
        )
        result = generate_transfer_question(
            "TopicA", ["c1"], "TopicB", ["c2"], 7, "Science"
        )
        assert len(result["key_points"]) <= 4


# ── generate_parent_tip (#49) ─────────────────────────────────────────────────

class TestGenerateParentTip:
    @patch("session_engine._client")
    def test_returns_string(self, mock_client):
        mock_client.messages.create.return_value = MagicMock(
            content=[MagicMock(text="Ask your child to explain fractions using pizza slices.")]
        )
        result = generate_parent_tip(
            topic_title="Fractions",
            key_concepts=["numerator", "denominator", "equivalent fractions"],
            mastery_level="L2",
            session_summary="Student improved on equivalent fractions.",
        )
        assert isinstance(result, str)
        assert len(result) > 0

    @patch("session_engine._client")
    def test_fallback_on_error(self, mock_client):
        """If Claude call fails, a safe default tip should be returned."""
        mock_client.messages.create.side_effect = Exception("API error")
        result = generate_parent_tip(
            topic_title="Geometry",
            key_concepts=["angles", "triangles"],
            mastery_level="L1",
            session_summary="Student struggled with angle types.",
        )
        # Should not raise, should return a string
        assert isinstance(result, str)
