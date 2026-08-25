from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXECUTION_EDGE = ROOT / "apps" / "execution-edge"
EXECUTION_WRANGLER = EXECUTION_EDGE / "wrangler.jsonc"
OBSERVATION_WRANGLER = ROOT / "apps" / "observation-edge" / "wrangler.jsonc"


def test_public_reconstruction_artifact_executes_through_focused_vitest() -> None:
    result = subprocess.run(
        [
            "npm",
            "test",
            "--",
            "--run",
            "test/broker-geometry-reconstruction-v1.test.ts",
            "-t",
            "Task 5 boundary executes the public reconstruction artifact",
        ],
        cwd=EXECUTION_EDGE,
        env={**os.environ, "CI": "1"},
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Task 5 boundary executes the public reconstruction artifact" in result.stdout
    assert re.search(r"Tests\s+1 passed", result.stdout) is not None, result.stdout


def test_checked_in_runtime_defaults_remain_false_and_dry_run() -> None:
    execution = json.loads(EXECUTION_WRANGLER.read_text(encoding="utf-8"))
    observation = json.loads(OBSERVATION_WRANGLER.read_text(encoding="utf-8"))

    assert execution["vars"]["CANDIDATE_INBOX_ENABLED"] == "false"
    assert execution["vars"]["AGENT_SYNC_ENABLED"] == "false"
    assert execution["vars"]["EXECUTION_AUTHORITY_ENABLED"] == "false"
    assert execution["vars"]["EXECUTION_MODE_CEILING"] == "DRY_RUN"
    assert observation["vars"]["RD_EXECUTION_CANDIDATE_EMISSION_ENABLED"] == "false"
    assert observation["vars"]["RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED"] == "false"
