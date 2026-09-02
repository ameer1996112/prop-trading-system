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


def test_raw_audit_renders_each_visible_zone_state_and_rejection_reason() -> None:
    drawing = pine_function_body("updateZoneDrawing")

    assert "displayMode == DISPLAY_RAW_AUDIT" in drawing
    assert "label.new(" in drawing
    assert "zone.debugLabel" in drawing
    assert "zoneText(zone)" in drawing
    assert "label.set_text(zone.debugLabel, zoneText(zone))" in drawing
