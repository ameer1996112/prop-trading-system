from __future__ import annotations

import re
import subprocess
import sys
from hashlib import sha256
from pathlib import Path

import pytest
from scripts.generate_rd_v3_release import generate_release

ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "scripts/generate_rd_v3_release.py"
LAB = ROOT / "scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine"
RELEASE = ROOT / "scripts/pinescript/SND_RD_5M_V3_RELEASE.pine"
PROTECTED_REGION_SHA256 = "5ca52c92f1d614e08a3498e9a07f4df4cd6dd43cba96b0e3b6f5d6cd02cff56d"


@pytest.mark.parametrize(
    ("source", "message"),
    [
        ("// @lab-only-end x\n", "unexpected lab-only end: x"),
        ("// @lab-only-begin x\n", "unclosed lab-only section: x"),
        (
            "// @lab-only-begin x\n// @lab-only-begin x\n",
            "duplicate lab-only section: x",
        ),
        (
            "// @lab-only-begin x\n// @lab-only-begin y\n// @lab-only-end x\n",
            "crossed lab-only section: x",
        ),
    ],
)
def test_generate_release_rejects_invalid_markers(source: str, message: str) -> None:
    with pytest.raises(ValueError, match=re.escape(message)):
        generate_release(source)


def test_generate_release_preserves_every_outside_byte_and_removes_marked_bytes() -> None:
    source = (
        "//@version=6\r\n"
        'indicator("SND RD 5M V3 THREE ENTRY LAB", overlay = true)\n'
        "alpha  \n"
        "// @lab-only-begin debug-labels\n"
        "remove me\r\n"
        "// @lab-only-end debug-labels\n"
        "omega\n"
    )

    assert generate_release(source) == (
        '//@version=6\r\nindicator("SND RD 5M V3 RELEASE", overlay = true)\nalpha  \nomega\n'
    )


def test_generate_release_accepts_properly_nested_unique_sections() -> None:
    source = (
        'indicator("SND RD 5M V3 THREE ENTRY LAB")\n'
        "// @lab-only-begin outer\n"
        "outer bytes\n"
        "// @lab-only-begin inner\n"
        "inner bytes\n"
        "// @lab-only-end inner\n"
        "// @lab-only-end outer\n"
        "after\n"
    )

    assert generate_release(source) == ('indicator("SND RD 5M V3 RELEASE")\nafter\n')


@pytest.mark.parametrize(
    ("source", "count"),
    [
        ("//@version=6\nplot(close)\n", 0),
        ('// indicator("SND RD 5M V3 THREE ENTRY LAB")\n', 0),
        ('  indicator("SND RD 5M V3 THREE ENTRY LAB")\n', 0),
        (
            'indicator("SND RD 5M V3 THREE ENTRY LAB")\n'
            'indicator("SND RD 5M V3 THREE ENTRY LAB", overlay = true)\n',
            2,
        ),
    ],
)
def test_generate_release_requires_one_anchored_lab_indicator(
    source: str,
    count: int,
) -> None:
    with pytest.raises(
        ValueError,
        match=re.escape(f"expected exactly one LAB indicator declaration, found {count}"),
    ):
        generate_release(source)


@pytest.mark.parametrize(
    "source",
    [
        "// @lab-only-begin x",
        "// @lab-only-end x",
        "// @lab-only-begin INVALID_NAME\n",
        "// @lab-only-end invalid_name\n",
    ],
)
def test_generate_release_rejects_marker_like_lines_with_invalid_syntax(
    source: str,
) -> None:
    with pytest.raises(ValueError, match="malformed lab-only marker"):
        generate_release(source)


def test_cli_writes_release_and_check_detects_then_accepts_drift(
    tmp_path: Path,
) -> None:
    lab = tmp_path / "lab.pine"
    release = tmp_path / "release.pine"
    lab.write_text(
        'indicator("SND RD 5M V3 THREE ENTRY LAB")\n'
        "keep\n"
        "// @lab-only-begin panel\n"
        "drop\n"
        "// @lab-only-end panel\n",
        encoding="utf-8",
    )

    generate = subprocess.run(
        [sys.executable, str(GENERATOR), "--lab", str(lab), "--release", str(release)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert generate.returncode == 0, generate.stderr
    assert release.read_text(encoding="utf-8") == ('indicator("SND RD 5M V3 RELEASE")\nkeep\n')

    release.write_text("drift\n", encoding="utf-8")
    drift = subprocess.run(
        [
            sys.executable,
            str(GENERATOR),
            "--lab",
            str(lab),
            "--release",
            str(release),
            "--check",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert drift.returncode == 1
    assert "release Pine is out of date" in drift.stderr
    assert release.read_text(encoding="utf-8") == "drift\n"

    release.write_text(generate_release(lab.read_text(encoding="utf-8")), encoding="utf-8")
    clean = subprocess.run(
        [
            sys.executable,
            str(GENERATOR),
            "--lab",
            str(lab),
            "--release",
            str(release),
            "--check",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert clean.returncode == 0, clean.stderr


@pytest.mark.parametrize("check", [False, True])
@pytest.mark.parametrize("alias_kind", ["same-path", "symlink"])
def test_cli_rejects_source_destination_alias_without_modifying_lab(
    tmp_path: Path,
    alias_kind: str,
    check: bool,
) -> None:
    lab = tmp_path / "lab.pine"
    original = (
        b'indicator("SND RD 5M V3 THREE ENTRY LAB")\n'
        b"// @lab-only-begin panel\n"
        b"diagnostic bytes\n"
        b"// @lab-only-end panel\n"
    )
    lab.write_bytes(original)
    if alias_kind == "same-path":
        release = lab
    else:
        release = tmp_path / "release.pine"
        release.symlink_to(lab)

    command = [
        sys.executable,
        str(GENERATOR),
        "--lab",
        str(lab),
        "--release",
        str(release),
    ]
    if check:
        command.append("--check")
    result = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "source and destination refer to the same file" in result.stderr
    assert lab.read_bytes() == original


def _protected_region(source: str) -> bytes:
    start = source.index('const string ENTRY_MODEL_BOC = "BOC"')
    final_call = "                emitExecutionProposalV1ForAttempt(attempt)\n"
    end = source.index(final_call, start) + len(final_call)
    return source[start:end].encode("utf-8")


def test_generated_artifact_matches_generator_and_protected_semantic_digest() -> None:
    lab = LAB.read_text(encoding="utf-8")
    release = RELEASE.read_text(encoding="utf-8")
    generated = generate_release(lab)

    assert release == generated
    assert not release.endswith("\n\n")
    normalized_lab = generate_release(lab)
    assert sha256(_protected_region(normalized_lab)).hexdigest() == (PROTECTED_REGION_SHA256)
    assert sha256(_protected_region(release)).hexdigest() == PROTECTED_REGION_SHA256
