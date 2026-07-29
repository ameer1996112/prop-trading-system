from __future__ import annotations

from pathlib import Path

import pytest
from detect_secrets.core.scan import scan_line
from detect_secrets.settings import default_settings
from scripts.check_lockfile_credentials import credential_urls, validate_lockfiles


def test_scanner_detects_credentials_even_on_audit_vocabulary_lines() -> None:
    first = "AKIA" + "A1B2C3D4E5F6G7H8"
    second = "ghp_" + "AbCdEf0123456789" * 2 + "AbCd"
    lines = (
        '{"sha256":"' + "a" * 64 + '","token":"' + first + '"}',
        "provider=Secrets Manager password=" + second,
    )
    with default_settings():
        first_findings = list(scan_line(lines[0]))
        second_findings = list(scan_line(lines[1]))
    assert first in {secret.secret_value for secret in first_findings}
    assert any(
        second in secret.secret_value or second.removeprefix("ghp_") in secret.secret_value
        for secret in second_findings
    )


def test_lockfile_scanner_rejects_userinfo_and_query_credentials(tmp_path: Path) -> None:
    for content in (
        'resolved = "'
        + "https:"
        + "//registry-"
        + "user:registry-"
        + "pass@registry.invalid/package"
        + '"\n',
        '{"resolved":"https://registry.invalid/package?integrity=sha256&token=planted"}',
        '{"note":"Secrets Manager","resolved":"https://registry.invalid/p?k=v&api-token=x"}',
        '{"resolved":"https://registry.invalid/p?apikey=x"}',
        '{"resolved":"https://registry.invalid/p?accessToken=x"}',
        '{"resolved":"https://registry.invalid/p?authToken=x"}',
        '{"resolved":"https://registry.invalid/p?sessionToken=x"}',
        '{"resolved":"https://registry.invalid/p?bearerToken=x"}',
        '{"resolved":"https://registry.invalid/p?sig=x"}',
        r'{"resolved":"https:\/\/escaped-user:escaped-pass@registry.invalid/p"}',
        r'{"resolved":"https:\/\/registry.invalid/p?to\u006ben=x"}',
    ):
        lockfile = tmp_path / "uv.lock"
        lockfile.write_text(content, encoding="utf-8")
        with pytest.raises(ValueError, match="credential-bearing"):
            validate_lockfiles([lockfile])
    assert credential_urls("https://registry.invalid/p?integrity=sha256-deadbeef") == []


def test_secret_recipe_is_fail_fast_and_has_dedicated_lockfile_scan() -> None:
    makefile = Path("Makefile").read_text(encoding="utf-8")
    recipe = makefile.split("secret-scan:", 1)[1].split("\nboundary-check:", 1)[0]
    assert "set -eu" in recipe
    assert r"\.worktrees" in makefile
    assert (
        "check_lockfile_credentials.py uv.lock $(CONSOLE)/package-lock.json "
        "$(EDGE)/package-lock.json"
    ) in recipe
    assert "uv\\.lock|package-lock" not in makefile
