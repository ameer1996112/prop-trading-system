"""Reject authenticated or credential-bearing registry URLs in source-controlled lockfiles."""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Iterator, Sequence
from itertools import chain
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

_URL = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
_SENSITIVE_QUERY_KEY = re.compile(
    r"(?:^|[-_.])(?:auth|authorization|credential|key|password|secret|signature|token)(?:$|[-_.])",
    re.IGNORECASE,
)
_NORMALIZED_SENSITIVE_QUERY_KEYS = frozenset(
    {
        "accesstoken",
        "apikey",
        "auth",
        "authorization",
        "awsaccesskeyid",
        "clientsecret",
        "credential",
        "credentials",
        "key",
        "password",
        "passwd",
        "privatekey",
        "pwd",
        "refreshtoken",
        "secret",
        "sig",
        "signature",
        "token",
        "xamzcredential",
        "xamzsignature",
    }
)
_NORMALIZED_SENSITIVE_QUERY_SUFFIXES = (
    "credential",
    "password",
    "passwd",
    "secret",
    "signature",
    "token",
)


def _sensitive_query_key(key: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", key.casefold())
    return (
        normalized in _NORMALIZED_SENSITIVE_QUERY_KEYS
        or normalized.endswith(_NORMALIZED_SENSITIVE_QUERY_SUFFIXES)
        or _SENSITIVE_QUERY_KEY.search(key) is not None
    )


def _json_strings(text: str) -> Iterator[str]:
    try:
        root = json.loads(text)
    except (json.JSONDecodeError, RecursionError):
        return
    pending: list[object] = [root]
    while pending:
        value = pending.pop()
        if isinstance(value, str):
            yield value
        elif isinstance(value, list):
            pending.extend(value)
        elif isinstance(value, dict):
            pending.extend(value.keys())
            pending.extend(value.values())


def credential_urls(text: str) -> list[str]:
    rejected: list[str] = []
    seen: set[str] = set()
    for scan_text in chain((text,), _json_strings(text)):
        for match in _URL.finditer(scan_text):
            candidate = match.group(0).rstrip(",)]}")
            parsed = urlsplit(candidate)
            query_has_credential = any(
                _sensitive_query_key(key) and bool(value)
                for key, value in parse_qsl(parsed.query, keep_blank_values=True)
            )
            if (
                parsed.username is not None or parsed.password is not None or query_has_credential
            ) and candidate not in seen:
                rejected.append(candidate)
                seen.add(candidate)
    return rejected


def validate_lockfiles(paths: Sequence[Path]) -> None:
    for path in paths:
        if not path.is_file():
            raise ValueError(f"required lockfile is absent: {path}")
        matches = credential_urls(path.read_text(encoding="utf-8"))
        if matches:
            raise ValueError(f"credential-bearing registry URL in lockfile: {path}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("lockfiles", nargs="+", type=Path)
    args = parser.parse_args(argv)
    try:
        validate_lockfiles(args.lockfiles)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    print(f"lockfile credential scan: {len(args.lockfiles)} lockfiles, 0 credential URLs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
