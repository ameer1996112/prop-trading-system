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


def test_replay_dir_close_candidate_recognizes_a_valid_rejection_without_liquidity_promotion() -> None:
    candidate = pine_function_body("zoneHasVisualDirectCloseCandidate")

    assert "zone.state == STATE_TAPPED" in candidate
    assert "zone.stateBar == bar_index" in candidate
    assert "zone.setupReason == REJECT_TARGET_TAP_WITHOUT_ELIGIBILITY" in candidate
    assert "directionalCloseConfirmedForZone(zone)" in candidate
    assert "not zoneWickInvalidThroughDistal(zone)" in candidate


def test_replay_dir_close_candidate_is_visual_only_and_emits_once() -> None:
    pine = source()
    drawing = pine_function_body("drawDirectCloseCandidate")

    assert "bool directCloseCandidateEmitted" in pine
    assert '" · PAPER CANDIDATE · DIR_CLOSE"' in drawing
    assert "alert(" not in drawing
    assert "not zone.directCloseCandidateEmitted and zoneHasVisualDirectCloseCandidate(zone)" in pine
    assert "drawDirectCloseCandidate(zone)" in pine
