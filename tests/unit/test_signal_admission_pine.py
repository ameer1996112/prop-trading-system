"""Behavior and source-parity guards for the opt-in Pine admission wrapper.

TradingView's native compiler is not available in CI.  The serialization test
below executes the concatenation authored in Pine; the remaining guards pin the
observable emission branches and validation ordering until native compilation.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
LAB = ROOT / "scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine"
RELEASE = ROOT / "scripts/pinescript/SND_RD_5M_V3_RELEASE.pine"


def body(source: str, name: str) -> str:
    match = re.search(r"^" + name + r"\([^\n]*\) =>\n(.*?)(?=\n\S|\Z)", source, re.M | re.S)
    assert match is not None, f"missing Pine function {name}"
    return match[1]


def evaluate_concat(function_body: str, values: dict[str, object]) -> str:
    expression = "".join(line.strip() for line in function_body.splitlines())
    parts = re.split(r"\s*\+\s*", expression)
    output: list[str] = []
    for part in parts:
        if part.startswith('"'):
            output.append(json.loads(part))
        elif match := re.fullmatch(r"jsonString\((\w+)\)", part):
            output.append(json.dumps(values[match.group(1)], separators=(",", ":")))
        elif match := re.fullmatch(r"str\.tostring\((\w+)\)", part):
            output.append(str(values[match.group(1)]))
        else:
            output.append(str(values[part]))
    return "".join(output)


def extracted_transport_accepts(
    source: str, *, credential: str, registration_id: str, generation: int
) -> bool:
    """Execute the literal bounds and character classes authored in Pine."""
    maximum = int(
        re.search(
            r"^const int SIGNAL_EVIDENCE_V1_MAX_SAFE_INTEGER = (\d+)$", source, re.M
        ).group(1)
    )
    identifier = body(source, "signalAdmissionV1IdentifierSafe")
    credential_check = body(source, "signalAdmissionV1CredentialSafe")
    identifier_pattern = re.search(r'str\.match\(value, "(.*?)"\)', identifier).group(1)
    credential_pattern = re.search(
        r'str\.match\(value, "(.*?)"\)', credential_check
    ).group(1)
    return (
        0 < generation <= maximum
        and 0 < len(registration_id) <= 160
        and re.fullmatch(identifier_pattern, registration_id) is not None
        and "\\" not in registration_id
        and 0 < len(credential) <= 1024
        and re.fullmatch(credential_pattern, credential) is not None
    )


@pytest.fixture(params=[LAB, RELEASE], ids=["lab", "release"])
def source(request: pytest.FixtureRequest) -> str:
    return request.param.read_text(encoding="utf-8")


def test_transport_is_separately_disabled(source: str) -> None:
    assert "signalAdmissionTransportEnabled = input.bool(false," in source
    assert "emitSignalEvidenceV1 = input.bool(false," in source
    assert "TradeOpsSignalAdmissionRequestV1" in source


def test_outer_envelope_serializes_inner_as_object_and_escapes_strings(source: str) -> None:
    serialized = evaluate_concat(
        body(source, "signalAdmissionV1Envelope"),
        {
            "credential": 'secret "quoted" \\ value',
            "registrationId": 'registration"id',
            "generation": 7,
            "evidence": '{"schema_version":"TradeOpsSignalEvidenceInputV1"}',
        },
    )
    assert json.loads(serialized) == {
        "schema_version": "TradeOpsSignalAdmissionRequestV1",
        "credential": 'secret "quoted" \\ value',
        "registration_id": 'registration"id',
        "generation": 7,
        "evidence": {"schema_version": "TradeOpsSignalEvidenceInputV1"},
    }
    assert '"evidence":{"schema_version"' in serialized


def test_transport_validation_covers_frozen_bounds_without_trimming(source: str) -> None:
    valid = body(source, "signalAdmissionV1TransportValid")
    assert "signalAdmissionGeneration > 0" in valid
    assert "signalAdmissionGeneration <= SIGNAL_EVIDENCE_V1_MAX_SAFE_INTEGER" in valid
    assert "signalAdmissionV1IdentifierSafe(signalAdmissionRegistrationId)" in valid
    assert "signalAdmissionV1CredentialSafe(signalAdmissionCredential)" in valid
    credential = body(source, "signalAdmissionV1CredentialSafe")
    assert "length > 0 and length <= 1024" in credential
    assert 'str.match(value, "^[ -~]+$") == value' in credential
    assert "trim" not in credential.lower()
    identifier = body(source, "signalAdmissionV1IdentifierSafe")
    assert "length > 0 and length <= 160" in identifier
    assert 'str.match(value, "^[ -~]+$") == value' in identifier
    assert 'not str.contains(value, "\\\\")' in identifier


@pytest.mark.parametrize(
    ("credential", "registration_id", "generation", "accepted"),
    [
        (" local fixture secret ", "desk one", 1, True),
        ('quote"and\\slash', 'registration"id', 9_007_199_254_740_991, True),
        ("secret", "registration", 0, False),
        ("secret", "registration", 9_007_199_254_740_992, False),
        ("", "registration", 1, False),
        ("x" * 1025, "registration", 1, False),
        ("secret\nvalue", "registration", 1, False),
        ("secret", "", 1, False),
        ("secret", "x" * 161, 1, False),
        ("secret", "registration\\id", 1, False),
        ("secret", "registration\n", 1, False),
    ],
)
def test_transport_input_boundary_matrix(
    source: str,
    credential: str,
    registration_id: str,
    generation: int,
    accepted: bool,
) -> None:
    assert extracted_transport_accepts(
        source,
        credential=credential,
        registration_id=registration_id,
        generation=generation,
    ) is accepted


def test_invalid_transport_is_redacted_and_cannot_fall_back(source: str) -> None:
    emit = body(source, "emitSignalEvidenceV1ForAttempt")
    enabled = emit.index("if signalAdmissionTransportEnabled")
    invalid = emit.index('log.error("SIGNAL_ADMISSION_V1_TRANSPORT_INVALID")')
    wrapping = emit.index("signalAdmissionV1Envelope(")
    legacy = emit.index("alert(envelope, alert.freq_all)")
    assert enabled < invalid < wrapping < legacy
    assert "signalAdmissionCredential" not in "".join(re.findall(r"log\.error\((.*?)\)", emit))
    assert re.search(r"^ {20}else\n {24}alert\(envelope, alert\.freq_all\)$", emit, re.M)
    assert emit.count("alert(envelope, alert.freq_all)") == 1
    assert emit.count("alert(transportEnvelope, alert.freq_all)") == 1


def test_inner_and_outer_oversize_reject_before_single_sequence_commit(source: str) -> None:
    emit = body(source, "emitSignalEvidenceV1ForAttempt")
    inner = emit.index("str.length(envelope) >= SIGNAL_EVIDENCE_V1_MAX_PAYLOAD_CHARS")
    frozen_inner = emit.index(
        "signalAdmissionV1AsciiBytesSafe(envelope, SIGNAL_ADMISSION_V1_MAX_EVIDENCE_BYTES)"
    )
    outer = emit.index(
        "signalAdmissionV1AsciiBytesSafe(transportEnvelope, SIGNAL_ADMISSION_V1_MAX_PAYLOAD_BYTES)"
    )
    transport_alert = emit.index("alert(transportEnvelope, alert.freq_all)")
    legacy_alert = emit.index("alert(envelope, alert.freq_all)")
    commit = emit.index("array.set(signalEvidenceV1SequenceState, 0, proposedSequence)")
    assert inner < frozen_inner < outer < transport_alert < commit
    assert inner < legacy_alert < commit
    assert source.count("array.set(signalEvidenceV1SequenceState") == 1
    assert "const int SIGNAL_EVIDENCE_V1_MAX_PAYLOAD_CHARS = 35000" in source
    assert "const int SIGNAL_ADMISSION_V1_MAX_EVIDENCE_BYTES = 262144" in source
    assert "const int SIGNAL_ADMISSION_V1_MAX_PAYLOAD_BYTES = 278528" in source
    byte_check = body(source, "signalAdmissionV1AsciiBytesSafe")
    assert 'str.match(value, "^[ -~]+$") == value' in byte_check
    assert "str.length(value) <= maximumBytes" in byte_check


def test_transport_requires_evidence_and_preserves_default_off_alert(source: str) -> None:
    emit = body(source, "emitSignalEvidenceV1ForAttempt")
    assert "if signalAdmissionTransportEnabled and not emitSignalEvidenceV1" in emit
    assert 'log.error("SIGNAL_ADMISSION_V1_REQUIRES_EVIDENCE")' in emit
    assert "else if emitSignalEvidenceV1 and barstate.isrealtime" in emit
    assert re.search(r"^ {20}else\n {24}alert\(envelope, alert\.freq_all\)$", emit, re.M)
