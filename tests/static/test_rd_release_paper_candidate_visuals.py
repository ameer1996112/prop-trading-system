from pathlib import Path

PINE = Path("scripts/pinescript/SND_RD_5M_V3_RELEASE.pine")


def source() -> str:
    assert PINE.exists(), "released Pine source must be versioned with the prop system"
    return PINE.read_text(encoding="utf-8")


def pine_function_body(name: str) -> str:
    lines = source().splitlines()
    signature_prefix = f"{name}("
    for index, line in enumerate(lines):
        if line.startswith(signature_prefix) and line.endswith("=>"):
            body: list[str] = []
            for candidate in lines[index + 1 :]:
                if candidate and not candidate[0].isspace():
                    break
                body.append(candidate)
            return "\n".join(body)
    raise AssertionError(f"Pine function not found: {name}")


def test_technical_candidate_is_separate_from_reviewed_paper_eligibility() -> None:
    technical = pine_function_body("entryHasTechnicalSelection")
    reviewed = pine_function_body("entryHasPaperEligibleSelection")

    assert "attempt.core.commonRulesPass" in technical
    assert "reviewedProducerHashesValid()" not in technical
    assert "entryHasTechnicalSelection(attempt) and reviewedProducerHashesValid()" in reviewed


def test_unreviewed_technical_setup_draws_a_non_executable_candidate_marker() -> None:
    pine = source()
    drawing = pine_function_body("drawTechnicalCandidate")

    assert 'showTechnicalCandidates = input.bool(true, "Show technical paper candidates"' in pine
    assert '" · PAPER CANDIDATE"' in drawing
    assert '"CAND ENTRY  "' in drawing
    assert "line.style_dotted" in drawing
    assert "bool visualCandidateEmitted" in pine
    assert "not attempt.core.visualCandidateEmitted and technicalCandidate" in pine
    assert "drawTechnicalCandidate(attempt)" in pine
    assert "alert(" not in drawing
