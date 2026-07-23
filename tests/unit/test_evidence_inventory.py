from __future__ import annotations

import json
from pathlib import Path

from tools.evidence_inventory import ALLOWLIST, validate


def test_inventory_and_copied_hashes_validate_deterministically() -> None:
    validate(Path("evidence/inventory.json"), Path("evidence/inventory.sha256"), Path.cwd())
    validate(Path("evidence/inventory.json"), Path("evidence/inventory.sha256"), Path.cwd())
    inventory = json.loads(Path("evidence/inventory.json").read_text())
    assert tuple(item["source_relative_path"] for item in inventory["artifacts"]) == ALLOWLIST
    assert all(
        item["content_matches_head"] is False
        for item in inventory["artifacts"]
        if item["working_tree_status"] != "CLEAN"
    )
