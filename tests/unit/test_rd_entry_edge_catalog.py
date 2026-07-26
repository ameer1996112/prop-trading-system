from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "build_rd_entry_edge_catalog.py"
CONTRACT = ROOT / "config" / "phase0" / "rd-strategy-rule-contract-v2.json"


def _load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("build_rd_entry_edge_catalog", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load catalog builder")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _contract() -> dict[str, object]:
    value = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def _write(path: Path, value: object) -> Path:
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


@pytest.mark.parametrize("corruption", ["duplicate", "nan", "overflow"])
def test_catalog_builder_rejects_duplicate_and_nonfinite_json(
    tmp_path: Path,
    corruption: str,
) -> None:
    module = _load_script()
    source = CONTRACT.read_text(encoding="utf-8")
    if corruption == "duplicate":
        source = source.replace(
            '"contract_version": "2.0.0",',
            '"contract_version": "2.0.0", "contract_version": "2.0.0",',
            1,
        )
    elif corruption == "nan":
        source = source.replace(
            '"timestamp_start_seconds": 223',
            '"timestamp_start_seconds": NaN',
            1,
        )
    else:
        source = source.replace(
            '"timestamp_start_seconds": 223',
            '"timestamp_start_seconds": 1e400',
            1,
        )
    path = tmp_path / "corrupt.json"
    path.write_text(source, encoding="utf-8")

    with pytest.raises(ValueError, match=r"duplicate|non-finite"):
        module.build(path)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("youtube_video_id", ""),
        ("published_date", 20260715),
        ("timestamp_start_seconds", -1),
        ("timestamp_end_seconds", 1.5),
        ("timestamp_start_seconds", 9_007_199_254_740_992),
        ("timestamp_end_seconds", 86_401),
    ],
)
def test_catalog_builder_rejects_invalid_required_field_types_and_ranges(
    tmp_path: Path,
    field: str,
    value: object,
) -> None:
    module = _load_script()
    contract = _contract()
    claims = contract["claims_by_id"]
    sources = contract["sources_by_id"]
    assert isinstance(claims, dict)
    assert isinstance(sources, dict)
    if field.startswith("timestamp_"):
        first = next(iter(claims.values()))
    else:
        first = next(iter(sources.values()))
    assert isinstance(first, dict)
    first[field] = value

    with pytest.raises(ValueError, match="must be"):
        module.build(_write(tmp_path / "invalid.json", contract))


def test_catalog_builder_rejects_non_official_source_identity(tmp_path: Path) -> None:
    module = _load_script()
    contract = _contract()
    sources = contract["sources_by_id"]
    assert isinstance(sources, dict)
    first = next(iter(sources.values()))
    assert isinstance(first, dict)
    first["channel_id"] = "UC0000000000000000000000"

    with pytest.raises(ValueError, match="non-official"):
        module.build(_write(tmp_path / "invalid-source.json", contract))


def test_catalog_check_failure_does_not_write_output(tmp_path: Path) -> None:
    output = tmp_path / "catalog.ts"
    original = b"sentinel bytes\n"
    output.write_bytes(original)

    completed = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--input",
            str(CONTRACT),
            "--output",
            str(output),
            "--check",
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode != 0
    assert output.read_bytes() == original
