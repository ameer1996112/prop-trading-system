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


def test_accuracy_zones_are_created_for_forex_only_with_explicit_symbol_exclusions() -> None:
    eligibility = pine_function_body("isForexAccZoneEligible")
    variants = pine_function_body("appendConfirmedZoneVariants")

    assert 'syminfo.type == "forex"' in eligibility
    assert 'str.contains(symbol, "XAUUSD")' in eligibility
    assert 'str.contains(symbol, "NAS100")' in eligibility
    assert (
        "isForexAccZoneEligible() and candidateHasAccuracyGeometry(candidate, demand)" in variants
    )


def test_accuracy_zone_wins_the_clean_overlap_slot_and_is_labeled() -> None:
    rank = pine_function_body("setupZoneRanksAhead")
    label = pine_function_body("zoneDisplayText")

    assert "candidate.geometry == GEOMETRY_ACCURACY" in rank
    assert "target.geometry == GEOMETRY_ACCURACY" in rank
    assert "ranksAhead := candidateAccuracy" in rank
    assert 'zone.geometry == GEOMETRY_ACCURACY ? "ACC" : ""' in label
    assert "box.set_text(zone.zoneBox, zoneDisplayText(zone))" in source()
