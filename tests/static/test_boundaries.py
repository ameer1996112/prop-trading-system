from __future__ import annotations

import ast
from pathlib import Path

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


def test_runtime_settings_cannot_accept_broker_or_account_credentials() -> None:
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
    }
    assert not any("broker" in field or "account" in field or "token" in field for field in fields)


def test_source_tree_has_no_ai_dependency_or_decision_path() -> None:
    dependency_text = Path("pyproject.toml").read_text(encoding="utf-8").lower()
    for package in ("openai", "anthropic", "langchain", "llamaindex"):
        assert package not in dependency_text
