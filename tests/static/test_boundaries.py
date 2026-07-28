from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest
from scripts.static_boundary_check import (
    CONFIGURATION_FILES,
    FORBIDDEN_IDENTIFIERS,
    RUNTIME_ROOTS,
    check,
)

from prop_trading.config import Settings


def test_domain_has_no_framework_imports() -> None:
    forbidden = {"fastapi", "pydantic", "sqlalchemy", "alembic", "httpx"}
    for path in Path("src/prop_trading/domain").glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        imports = {
            alias.name.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import | ast.ImportFrom)
            for alias in (
                node.names if isinstance(node, ast.Import) else [ast.alias(name=node.module or "")]
            )
        }
        assert not imports.intersection(forbidden), path


def test_runtime_settings_accept_only_observation_ingress_not_broker_credentials() -> None:
    fields = set(Settings.model_fields)
    assert fields == {
        "app_environment",
        "operation_mode",
        "database_dsn",
        "database_host",
        "database_port",
        "database_name",
        "database_user",
        "database_password_file",
        "phase0_evidence_path",
        "tradingview_observation_ingress_enabled",
        "tradingview_observation_credential_sha256",
        "tradingview_observation_max_body_bytes",
    }
    assert not any("broker" in field or "account" in field or "token" in field for field in fields)


def test_source_tree_has_no_ai_dependency_or_decision_path() -> None:
    dependency_text = Path("pyproject.toml").read_text(encoding="utf-8").lower()
    for package in ("openai", "anthropic", "langchain", "llamaindex"):
        assert package not in dependency_text


def test_contract_v3_has_no_live_execution_surface() -> None:
    contract = json.loads(
        Path("config/phase0/rd-strategy-rule-contract-v3.json").read_text(encoding="utf-8")
    )
    assert contract["automation_policy"]["paper_only"] is True
    assert contract["automation_policy"]["real_execution_allowed"] is False


def test_v3_files_do_not_contain_broker_actions() -> None:
    assert {
        "place_order",
        "broker_secret",
        "metatrader_login",
        "live_order",
    }.issubset(FORBIDDEN_IDENTIFIERS)


def test_global_boundary_checker_covers_v3_edge_runtime() -> None:
    assert Path("apps/observation-edge/src") in RUNTIME_ROOTS
    assert Path("apps/observation-edge/wrangler.jsonc") in CONFIGURATION_FILES


def _write_boundary_fixture(root: Path, runtime_source: str, wrangler: dict[str, object]) -> None:
    contract = root / "config/phase0/rd-strategy-rule-contract-v3.json"
    contract.parent.mkdir(parents=True)
    contract.write_text(
        json.dumps(
            {
                "automation_policy": {
                    "paper_only": True,
                    "real_execution_allowed": False,
                }
            }
        ),
        encoding="utf-8",
    )
    source = root / "apps/observation-edge/src/fixture-v3.ts"
    source.parent.mkdir(parents=True)
    source.write_text(runtime_source, encoding="utf-8")
    wrangler_path = root / "apps/observation-edge/wrangler.jsonc"
    wrangler_path.write_text(json.dumps(wrangler), encoding="utf-8")


def test_boundary_scanner_rejects_forbidden_identifiers_with_punctuation(
    tmp_path: Path,
) -> None:
    _write_boundary_fixture(
        tmp_path,
        "live_order(); broker_secret, metatrader_login;",
        {
            "vars": {},
            "secrets": {
                "required": [
                    "RD_ENTRY_V3_DETECTOR_CODE_HASH",
                    "RD_ENTRY_V3_SETTINGS_HASH",
                ]
            },
        },
    )

    with pytest.raises(SystemExit) as failure:
        check(tmp_path)

    message = str(failure.value)
    for identifier in ("live_order", "broker_secret", "metatrader_login"):
        assert identifier in message


def test_boundary_scanner_checks_deployed_wrangler_configuration(tmp_path: Path) -> None:
    _write_boundary_fixture(
        tmp_path,
        "const executionMode = 'PAPER_ONLY';",
        {
            "vars": {"LIVE_ACCOUNT": "forbidden"},
            "secrets": {
                "required": [
                    "RD_ENTRY_V3_DETECTOR_CODE_HASH",
                    "RD_ENTRY_V3_SETTINGS_HASH",
                ]
            },
        },
    )

    with pytest.raises(SystemExit, match="LIVE_ACCOUNT"):
        check(tmp_path)


def test_boundary_scanner_does_not_flag_paper_or_no_live_prose(tmp_path: Path) -> None:
    _write_boundary_fixture(
        tmp_path,
        "// Paper-only accounting has no live order or broker login surface.",
        {
            "vars": {},
            "secrets": {
                "required": [
                    "RD_ENTRY_V3_DETECTOR_CODE_HASH",
                    "RD_ENTRY_V3_SETTINGS_HASH",
                ]
            },
        },
    )

    check(tmp_path)


def test_wrangler_requires_reviewed_hash_secrets_without_empty_var_overrides() -> None:
    wrangler = json.loads(Path("apps/observation-edge/wrangler.jsonc").read_text(encoding="utf-8"))
    reviewed_hash_names = {
        "RD_ENTRY_V3_DETECTOR_CODE_HASH",
        "RD_ENTRY_V3_SETTINGS_HASH",
    }

    assert reviewed_hash_names.isdisjoint(wrangler["vars"])
    assert reviewed_hash_names.issubset(wrangler["secrets"]["required"])


def test_rollout_verifies_required_hash_secret_bindings_before_pine_emission() -> None:
    runbook = Path("docs/runbooks/rd-three-entry-paper-rollout.md").read_text(encoding="utf-8")

    for required_step in (
        "npx wrangler secret bulk",
        "npx wrangler secret list",
        "PAPER_CONFIGURATION_UNAVAILABLE",
        "PROMOTION_IDENTITY_MISMATCH",
        "paper kill switch",
    ):
        assert required_step in runbook
    assert runbook.index("npx wrangler secret list") < runbook.index(
        "Enable **Emit contract-v3 entry events**"
    )
