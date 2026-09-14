"""Supplemental Pine source guards; these tests do not execute or compile Pine."""

from __future__ import annotations

import re
from hashlib import sha256
from pathlib import Path

import pytest
from scripts.generate_rd_v3_release import generate_release

ROOT = Path(__file__).resolve().parents[2]
LAB = ROOT / "scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine"
RELEASE = ROOT / "scripts/pinescript/SND_RD_5M_V3_RELEASE.pine"


def body(source: str, name: str) -> str:
    match = re.search(r"^" + name + r"\([^\n]*\) =>\n(.*?)(?=\n\S|\Z)", source, re.M | re.S)
    assert match is not None, f"missing Pine function {name}"
    return match[1]


@pytest.fixture(params=[LAB, RELEASE], ids=["lab", "release"])
def source(request: pytest.FixtureRequest) -> str:
    return request.param.read_text(encoding="utf-8")


def test_default_off_isolated_delivery_state(source: str) -> None:
    assert "emitSignalEvidenceV1 = input.bool(false," in source
    assert 'signalEvidenceV1ProducerTag = input.string("",' in source
    assert "isolated" in source
    assert "mix schemas" in source
    assert "varip int[] signalEvidenceV1SequenceState = array.new<int>(1, 0)" in source
    assert "varip int signalEvidenceV1ProducerStartedAt = timenow" in source
    identity = body(source, "signalEvidenceV1ProducerInstanceId")
    assert '"signal-evidence-v1:" + signalEvidenceV1ProducerTag' in identity
    assert "signalEvidenceV1ProducerStartedAt" in identity
    assert "substring" not in identity
    assert "Bounded" not in identity


def test_old_serialization_identical_for_explicit_stream_inputs(source: str) -> None:
    # Restoring only the old implicit argument and sequence prelude must reproduce
    # every old serialization byte, including field order, helpers and values.
    pure = body(source, "entryPayloadForStream")
    assert "array.set" not in pure
    assert "nextEntrySequence" not in pure
    restored = "    int producerSequence = nextEntrySequence()\n" + pure.replace(
        "producerInstanceId", "entryProducerInstanceId"
    )
    assert (
        sha256(restored.encode()).hexdigest()
        == "fa7590bdc3a28b827b6c4ea3727f8ab37f3139806df9c730c18618c8d2446f21"
    )
    assert body(source, "entryPayload") == (
        "    int producerSequence = nextEntrySequence()\n"
        "    entryPayloadForStream(attempt, zone, exitEvents, exitFollowup, "
        "entryProducerInstanceId, producerSequence)\n"
    )


@pytest.mark.parametrize(
    ("name", "digest"),
    [
        ("emitEntryPayload", "15c7374a9563fa1178bdda7ddfebba20bae7d62eadd193ac228f0223036e30e2"),
        ("nextEntrySequence", "db581ffb6fd14cef6f044729272ee9f6de790873dcfb1d9d7c78047b77ae6847"),
        (
            "currentEntrySequence",
            "02bd225b315ea932ad095dd231c7e08a426a2ca7f4e08619eaef28c5e459979f",
        ),
        ("priceTicks", "8570b28493cb77a930eec7257edc14adad5eaccc05715f92a5ed5cd609d34c98"),
    ],
)
def test_old_counter_on_oversize_and_market_sequence_unchanged(
    source: str, name: str, digest: str
) -> None:
    assert sha256(body(source, name).encode()).hexdigest() == digest


def test_frozen_formation_fields_and_exact_units(source: str) -> None:
    formation = body(source, "signalEvidenceV1FormationPayload")
    expected = {
        "setup_id": "jsonString(entrySetupId(zone))",
        "origin_epoch": "str.tostring(signalEvidenceV1EpochSeconds(zone.originTime))",
        "confirmation_epoch": "str.tostring(signalEvidenceV1EpochSeconds(zone.confirmationTime))",
        "direction": 'jsonString(zone.demand ? "LONG" : "SHORT")',
        "variant": "jsonString(zone.geometry)",
        "formation_source_id": "jsonString(zone.formationId)",
    }
    for field, raw in [("open", "Open"), ("high", "High"), ("low", "Low"), ("close", "Close")]:
        expected[f"origin_{field}_ticks"] = (
            f"str.tostring(signalEvidenceV1PriceTicks(zone.origin{raw}))"
        )
    for field, expression in expected.items():
        assert f'\\"{field}\\":\\"' not in formation
        assert f'\\"{field}\\":' in formation
        assert expression in formation
    assert len(re.findall(r'\\"[a-z_]+\\":', formation)) == 10
    epoch = body(source, "signalEvidenceV1EpochSeconds")
    assert "epochMilliseconds % 1000 == 0" in epoch
    assert "SIGNAL_EVIDENCE_V1_MAX_SAFE_INTEGER" in epoch
    ticks = body(source, "signalEvidenceV1PriceTicks")
    assert "priceTicks(price)" in ticks
    assert "math.sign(price - roundTripPrice) == 0" in ticks
    assert "SIGNAL_EVIDENCE_V1_MAX_SAFE_INTEGER" in ticks
    valid = body(source, "signalEvidenceV1FormationValid")
    for check in [
        "originEpoch % 300 == 0",
        "confirmationEpoch % 300 == 0",
        "originEpoch < confirmationEpoch",
        "confirmationEpoch <= attempt.core.engagementEpoch",
        "GEOMETRY_ACCURACY",
        "GEOMETRY_STANDARD",
        "zone.formationId, 1024",
        "attempt.core.zoneTopTicks",
        "attempt.core.zoneBottomTicks",
        "openTicks > closeTicks",
        "closeTicks > openTicks",
    ]:
        assert check in valid


def test_independent_emission_checks_before_alert_and_commits_after(source: str) -> None:
    emit = body(source, "emitSignalEvidenceV1ForAttempt")
    assert "if emitSignalEvidenceV1 and barstate.isrealtime" in emit
    assert "currentSequence >= SIGNAL_EVIDENCE_V1_MAX_SAFE_INTEGER" in emit
    for forbidden in [
        "entryCredential",
        "entryV3Credential",
        "emitEntryV3Events",
        "paperDecisionEmitted",
        "entrySequenceState",
        "tickSequence",
        "freq_once",
        "nextEntrySequence",
    ]:
        assert forbidden not in emit
    assert emit.index("signalEvidenceV1FormationValid") < emit.index("entryPayloadForStream")
    assert emit.index("str.length(envelope)") < emit.index("alert(envelope, alert.freq_all)")
    assert emit.index("alert(envelope, alert.freq_all)") < emit.index(
        "array.set(signalEvidenceV1SequenceState, 0, proposedSequence)"
    )
    assert source.count("array.set(signalEvidenceV1SequenceState") == 1
    assert source.count("emitSignalEvidenceV1ForAttempt(attempt, zone)") == 1
    decision = source[source.index("            if candidateChanged and bundleReady\n") :]
    assert decision.index("emitSignalEvidenceV1ForAttempt(attempt, zone)") < decision.index(
        "            if bundleReady\n"
    )
    assert "emitSignalEvidence" not in body(source, "monitorAttemptExit")
    assert "log.error(envelope)" not in emit
    assert "log.info(envelope)" not in emit
    assert re.findall(r"log.error\((.*?)\)", emit) == [
        '"SIGNAL_EVIDENCE_V1_SEQUENCE_INVALID"',
        '"SIGNAL_EVIDENCE_V1_IDENTIFIER_INVALID"',
        '"SIGNAL_EVIDENCE_V1_SOURCE_INVALID"',
        '"SIGNAL_EVIDENCE_V1_FORMATION_INVALID"',
        '"SIGNAL_EVIDENCE_V1_ENVELOPE_TOO_LARGE"',
    ]


def test_credential_free_closed_envelope(source: str) -> None:
    envelope = body(source, "signalEvidenceV1Envelope")
    assert re.findall(r'\\"([a-z_]+)\\":', envelope) == [
        "schema_version",
        "observation",
        "formations",
    ]
    assert "TradeOpsSignalEvidenceInputV1" in envelope
    assert "credential" not in envelope.lower()
    assert "[" in envelope
    assert "signalEvidenceV1FormationPayload(zone)" in envelope


def test_source_prerequisites_reject_before_sequence_commit(source: str) -> None:
    valid = body(source, "signalEvidenceV1SourceValid")
    assert "reviewedProducerHashesValid()" in valid
    assert "attempt.core.commonRulesPass" in valid
    assert "str.length(tickSize) <= 64" in valid
    assert "math.sign(syminfo.mintick - str.tonumber(tickSize)) == 0" in valid
    emit = body(source, "emitSignalEvidenceV1ForAttempt")
    assert emit.index("signalEvidenceV1SourceValid(attempt)") < emit.index("entryPayloadForStream")


def test_stream_ids_obey_the_inner_wire_backslash_exclusion(source: str) -> None:
    helper = body(source, "signalEvidenceV1StreamIdentifierSafe")
    assert "signalEvidenceV1IdentifierSafe(value, 256)" in helper
    assert 'not str.contains(value, "\\\\")' in helper
    emit = body(source, "emitSignalEvidenceV1ForAttempt")
    for value in ["signalEvidenceV1ProducerTag", "producerInstanceId", "eventId"]:
        assert f"signalEvidenceV1StreamIdentifierSafe({value})" in emit
    # Formation diagnostics permit the complete printable ASCII set independently.
    assert 'str.match(value, "^[!-~]+$") == value' in body(source, "signalEvidenceV1IdentifierSafe")


def test_reversing_only_declared_task_changes_restores_full_baseline(source: str) -> None:
    # The RELEASE baseline is exactly the version at main commit 528ad8f,
    # including its reviewed ACC, raw-audit, ladder and qualified replay fixes.
    # LAB now authors that same behavior, retaining its panel/z-order sections;
    # its obsolete debug-label block/input was removed because it overwrote the
    # shared raw-audit labels. Reversing ONLY evidence must preserve this baseline.
    expected = (
        "1fea269c62cfa9cff9d261b77e96b4fc657a42eb0490e76abe072ccdbf8b157c"
        if 'indicator("SND RD 5M V3 THREE ENTRY LAB"' in source
        else "c3141e1a4616ca3fbebcceea3590cebf8522907c0bc45e11a7cbef7eaef9316f"
    )
    restored = re.sub(r"^const int SIGNAL_EVIDENCE_V1_.*\n", "", source, flags=re.M)
    restored = re.sub(
        r"^// Enable only in an isolated future alert configuration\."
        r"[\s\S]*?(?=^entryV3Credential =)",
        "",
        restored,
        flags=re.M,
    )
    restored = re.sub(r"^varip .* signalEvidenceV1.*\n", "", restored, flags=re.M)
    restored = re.sub(
        r"^signalEvidenceV1IdentifierSafe\([\s\S]*?(?=^executionProposalV1ProducerInstanceId\()",
        "",
        restored,
        flags=re.M,
    )
    restored = restored.replace(
        "                emitSignalEvidenceV1ForAttempt(attempt, zone)\n", ""
    )
    restored = re.sub(r"^entryPayload\([^\n]*\) =>\n.*?(?=\n\S)", "", restored, flags=re.M | re.S)
    restored = restored.replace("\n\nemitEntryPayload(", "\nemitEntryPayload(")
    restored = restored.replace(
        "entryPayloadForStream(EntryAttempt attempt, RawZone zone, string exitEvents, "
        "bool exitFollowup, string producerInstanceId, int producerSequence) =>\n",
        "entryPayload(EntryAttempt attempt, RawZone zone, string exitEvents, "
        "bool exitFollowup) =>\n    int producerSequence = nextEntrySequence()\n",
    )
    restored = restored.replace("producerInstanceId", "entryProducerInstanceId")
    assert sha256(restored.encode()).hexdigest() == expected


def test_release_matches_actual_generator_and_no_strategy_orders() -> None:
    lab = LAB.read_text(encoding="utf-8")
    assert RELEASE.read_text(encoding="utf-8") == generate_release(lab)
    assert not re.search(r"\bstrategy\.(entry|order|exit|close|close_all)\s*\(", lab)
