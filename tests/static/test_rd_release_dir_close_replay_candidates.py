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


def test_replay_candidates_require_the_contract_qualified_common_setup() -> None:
    pine = source()

    assert "zoneHasVisualDirectCloseCandidate" not in pine
    assert "drawDirectCloseCandidate" not in pine
    assert "REJECT_TARGET_TAP_WITHOUT_ELIGIBILITY and" not in pine
    assert "attempt.core.commonRulesPass" in pine
