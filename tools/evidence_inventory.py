#!/usr/bin/env python3
"""Validate or recapture the explicit Phase 0 legacy evidence inventory."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from collections.abc import Sequence
from pathlib import Path
from typing import Any

ALLOWLIST = (
    "scripts/pinescript/indicators/SND_RD_5M_V1_LAB.pine",
    "src/core/rd_setup_contract.py",
    "src/api_rd_setups.py",
    "src/services/rd_setup_handoff.py",
    "migrations/086_rd_setup_phase1.sql",
    "tests/test_api_rd_setups.py",
    "tests/test_rd_setup_handoff.py",
    "scripts/pinescript/tests/test_snd_rd_5m_v1_setup_producer_static.py",
    "scripts/pinescript/tests/test_evidence_manifest.py",
)
DISPOSITIONS = {"PORT", "REWRITE_WITH_NEGATIVE_ORACLE", "REJECT"}
STATUSES = {"CLEAN", "MODIFIED", "UNTRACKED"}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("inventory root must be an object")
    return value


def validate(inventory_path: Path, hash_path: Path, repository_root: Path) -> None:
    inventory_bytes = inventory_path.read_bytes()
    expected_hash = hash_path.read_text(encoding="ascii").strip().split()[0]
    actual_hash = hashlib.sha256(inventory_bytes).hexdigest()
    if actual_hash != expected_hash:
        raise ValueError("inventory detached SHA-256 does not match")
    inventory = _load(inventory_path)
    if inventory.get("schema_id") != "phase0.legacy-evidence-inventory.v1":
        raise ValueError("unexpected inventory schema")
    if inventory.get("capture_scope") != "EXPLICIT_ALLOWLIST_ONLY":
        raise ValueError("inventory scope is not the explicit allowlist")
    if inventory.get("source_repository_dirty_for_authorized_paths") is not True:
        raise ValueError("dirty authorized source paths must be recorded truthfully")
    artifacts = inventory.get("artifacts")
    if not isinstance(artifacts, list):
        raise ValueError("artifacts must be a list")
    relative_paths = [item.get("source_relative_path") for item in artifacts]
    if tuple(relative_paths) != ALLOWLIST:
        raise ValueError("inventory path set/order differs from the explicit allowlist")
    for item in artifacts:
        _validate_item(item, repository_root)


def _validate_item(item: dict[str, Any], repository_root: Path) -> None:
    digest = item.get("working_content_sha256")
    head_digest = item.get("head_content_sha256")
    status = item.get("working_tree_status")
    if not isinstance(digest, str) or len(digest) != 64:
        raise ValueError("invalid working content SHA-256")
    if head_digest is not None and (not isinstance(head_digest, str) or len(head_digest) != 64):
        raise ValueError("invalid HEAD content SHA-256")
    if status not in STATUSES or item.get("disposition") not in DISPOSITIONS:
        raise ValueError("invalid status or disposition")
    if status != "CLEAN" and item.get("content_matches_head") is not False:
        raise ValueError("dirty/untracked artifact cannot claim to match HEAD")
    if status == "UNTRACKED" and head_digest is not None:
        raise ValueError("untracked artifact cannot claim HEAD content")
    defects = item.get("known_defects")
    if (
        not isinstance(defects, list)
        or not defects
        or not all(isinstance(x, str) and x for x in defects)
    ):
        raise ValueError("known defects must be a non-empty string list")
    copied = item.get("copied_artifact")
    if copied is not None:
        if (
            copied.get("claimed_commit") is not None
            or copied.get("copied_from_working_tree") is not True
        ):
            raise ValueError("dirty copy must not claim a commit")
        destination = repository_root / copied["destination"]
        if _sha256(destination) != copied["sha256"] or copied["sha256"] != digest:
            raise ValueError(f"copied artifact hash mismatch: {destination}")


def check_source(inventory_path: Path, source_root: Path) -> None:
    inventory = _load(inventory_path)
    for item in inventory["artifacts"]:
        source = source_root / item["source_relative_path"]
        if _sha256(source) != item["working_content_sha256"]:
            raise ValueError(f"legacy working bytes changed: {source}")
    result = subprocess.run(
        ["git", "-C", str(source_root), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    )
    if result.stdout.strip() != inventory["source_repository_head"]:
        raise ValueError("legacy HEAD changed since inventory capture")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--inventory", type=Path, required=True)
    validate_parser.add_argument("--hash-file", type=Path, required=True)
    validate_parser.add_argument("--repository-root", type=Path, required=True)
    source_parser = subparsers.add_parser("check-source")
    source_parser.add_argument("--inventory", type=Path, required=True)
    source_parser.add_argument("--source-root", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "validate":
        validate(args.inventory, args.hash_file, args.repository_root)
    elif args.command == "check-source":
        check_source(args.inventory, args.source_root)
    else:
        raise AssertionError("unknown command")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
