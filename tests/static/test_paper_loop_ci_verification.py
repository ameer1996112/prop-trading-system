from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_paper_loop_target_bootstraps_only_locked_dependencies() -> None:
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")

    assert "verify-paper-loop: bootstrap-paper-loop verify-paper-loop-core" in makefile
    assert "uv sync --locked --python 3.12" in makefile
    assert "npm ci --ignore-scripts --no-audit --no-fund" in makefile


def test_phase0_ci_cannot_omit_the_paper_loop_proof() -> None:
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
    workflow = (ROOT / ".github/workflows/phase0.yml").read_text(encoding="utf-8")

    assert "verify-observation-core:" in makefile
    assert (
        "verify-paper-loop-core"
        in makefile.split("verify-observation-core:", 1)[1].split("\n", 1)[0]
    )
    assert "- name: Verify paper-only schema-3.1 loop" in workflow
    assert workflow.count("run: make verify-paper-loop-core") == 1
    assert workflow.count("run: make verify-observation-remainder-core") == 1
    remainder = makefile.split("verify-observation-remainder-core:", 1)[1].split("\n", 1)[0]
    assert "verify-paper-loop-core" not in remainder
    assert "PAPER LOOP VERIFICATION PASSED — all actions remain PAPER_ONLY" in makefile
