"""Deterministic recursive redaction for logs, health details, and audit-safe messages."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit, urlunsplit

_REDACTED = "[REDACTED]"
_AUTHORIZATION_LINE = re.compile(
    r"(?im)(\b(?:authorization|proxy-authorization)\s*:\s*)[^\r\n]*"
    r"(?:(?:\r\n|\n|\r)[ \t]+[^\r\n]*)*"
)
_SENSITIVE_ASSIGNMENT = re.compile(
    r"(?i)(\b(?:api[-_ ]?key|x[-_ ]?api[-_ ]?key|authorization|proxy-authorization|"
    r"credential|password|secret|access[-_ ]?token|refresh[-_ ]?token|token)\b"
    r"\s*[:=]\s*)(?!\[REDACTED\])(?:bearer\s+|basic\s+)?"
    r"(?:\"[^\"\r\n]*\"|'[^'\r\n]*'|[^\s,;&}\]]+)"
)
_URL = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)


def _sensitive_key(key: object) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", str(key).casefold())
    return normalized in {
        "authorization",
        "proxyauthorization",
        "apikey",
        "xapikey",
        "credential",
        "credentials",
        "password",
        "secret",
        "token",
        "accesstoken",
        "refreshtoken",
    } or normalized.endswith(("password", "secret", "token", "apikey"))


def _redact_url(match: re.Match[str]) -> str:
    original = match.group(0)
    trailing = ""
    while original and original[-1] in ".,):;":
        trailing = original[-1] + trailing
        original = original[:-1]
    parsed = urlsplit(original)
    hostname = parsed.hostname or ""
    if ":" in hostname and not hostname.startswith("["):
        hostname = f"[{hostname}]"
    try:
        port = f":{parsed.port}" if parsed.port is not None else ""
    except ValueError:
        port = ""
    netloc = f"{hostname}{port}" if parsed.username is not None else parsed.netloc
    query = _REDACTED if parsed.query else ""
    fragment = _REDACTED if parsed.fragment else ""
    return urlunsplit((parsed.scheme, netloc, parsed.path, query, fragment)) + trailing


def redact_structure(value: Any) -> Any:
    """Return a recursively redacted JSON-like value without mutating the input."""
    if isinstance(value, Mapping):
        return {
            str(key): _REDACTED if _sensitive_key(key) else redact_structure(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_structure(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_structure(item) for item in value)
    if isinstance(value, str):
        return _redact_text(value, parse_json=False)
    return value


def _redact_text(text: str, *, parse_json: bool) -> str:
    if parse_json:
        try:
            parsed = json.loads(text)
        except (json.JSONDecodeError, TypeError):
            pass
        else:
            if isinstance(parsed, dict | list):
                return json.dumps(
                    redact_structure(parsed), ensure_ascii=False, separators=(",", ":")
                )
    without_authorization = _AUTHORIZATION_LINE.sub(rf"\1{_REDACTED}", text)
    without_assignments = _SENSITIVE_ASSIGNMENT.sub(rf"\1{_REDACTED}", without_authorization)
    return _URL.sub(_redact_url, without_assignments)


def redact(text: str) -> str:
    """Redact structured JSON, headers, assignments, URL userinfo/query, and every line."""
    return _redact_text(text, parse_json=True)
