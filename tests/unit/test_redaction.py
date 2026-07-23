from __future__ import annotations

import json

from prop_trading.domain.redaction import redact, redact_structure


def _canary() -> str:
    return "canary" + "-credential-value-should-never-leak"


def test_authorization_headers_redact_the_complete_basic_or_bearer_value() -> None:
    canary = _canary()
    output = redact(
        f"Authorization: Bearer {canary}\nProxy-Authorization: Basic {canary}\nkeep=true"
    )
    assert canary not in output
    assert output == ("Authorization: [REDACTED]\nProxy-Authorization: [REDACTED]\nkeep=true")


def test_authorization_headers_redact_every_scheme_and_schemeless_value() -> None:
    canary = _canary()
    source = (
        f"Authorization: ApiKey {canary}\n"
        f"Authorization: Digest username=operator,response={canary},opaque=visible\n"
        f"Proxy-Authorization: Unknown-Scheme p={canary}; q=visible\n"
        f"Authorization: {canary}\n"
        "safe: visible"
    )
    output = redact(source)
    assert canary not in output
    assert "username=" not in output
    assert "opaque=" not in output
    assert "q=" not in output
    assert output.count("[REDACTED]") == 4
    assert output.endswith("safe: visible")


def test_prefixed_log_lines_redact_the_entire_authorization_suffix() -> None:
    canary = _canary()
    source = (
        f"ERROR request failed Authorization: Digest username=operator,response={canary}\n"
        f"trace Proxy-Authorization: Custom realm=desk,credential={canary}"
    )
    output = redact(source)
    assert canary not in output
    assert "username=" not in output
    assert "realm=" not in output
    assert output == (
        "ERROR request failed Authorization: [REDACTED]\ntrace Proxy-Authorization: [REDACTED]"
    )


def test_folded_authorization_continuations_are_consumed_for_lf_and_crlf() -> None:
    canary = _canary()
    for newline in ("\n", "\r\n"):
        source = (
            f"WARN Authorization: Digest username=operator,{newline}"
            f" response={canary},opaque=still-secret{newline}safe: visible"
        )
        output = redact(source)
        assert canary not in output
        assert "response=" not in output
        assert "opaque=" not in output
        assert output == f"WARN Authorization: [REDACTED]{newline}safe: visible"


def test_api_key_variants_and_multiline_occurrences_are_redacted() -> None:
    canary = _canary()
    output = redact(
        f"api_key={canary}\nx-api-key: {canary}\naccessToken={canary}\npassword={canary}"
    )
    assert canary not in output
    assert output.count("[REDACTED]") == 4


def test_nested_structures_and_json_bodies_are_redacted_without_mutation() -> None:
    canary = _canary()
    structured = {
        "safe": "visible",
        "nested": [{"authorization": f"Bearer {canary}"}, {"apiKey": canary}],
    }
    redacted = redact_structure(structured)
    assert canary in structured["nested"][0]["authorization"]
    assert canary not in json.dumps(redacted)
    body = json.dumps(structured)
    assert canary not in redact(body)
    assert json.loads(redact(body))["safe"] == "visible"


def test_url_query_userinfo_and_fragment_never_leak() -> None:
    canary = _canary()
    output = redact(
        f"first=https://user:{canary}@example.invalid/hook?token={canary}#{canary} "
        f"second=https://example.invalid/path?api_key={canary}"
    )
    assert canary not in output
    assert "user:" not in output
    assert output.count("[REDACTED]") >= 2


def test_seeded_assignment_and_url_canary_is_redacted() -> None:
    canary = _canary()
    output = redact(f"credential={canary} url=https://example.invalid/hook?token={canary}")
    assert canary not in output
    assert output.count("[REDACTED]") == 2
