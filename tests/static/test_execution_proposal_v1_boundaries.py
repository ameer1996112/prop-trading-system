from __future__ import annotations

import json
import re
from hashlib import sha256
from pathlib import Path


PINE = Path("scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine")
WORKER = Path("apps/observation-edge/src/index.ts")
INGESTION = Path("apps/observation-edge/src/execution-proposal-ingestion.ts")
DISPATCHER = Path("apps/observation-edge/src/observation-outbox-dispatcher.ts")
MIGRATION = Path(
    "apps/observation-edge/migrations/0030_observation_execution_proposal_v1.sql"
)
WRANGLER = Path("apps/observation-edge/wrangler.jsonc")
V1_SCHEMA_BYTES = {
    Path("contracts/schema/rd-entry-execution-proposal-v1.schema.json"): (
        "fc4e48c143fbb798d76d24f600e3eb5fb8b6861224e8f33f5107a4b1ab8e7e8e"
    ),
    Path("contracts/schema/execution-candidate-v1.schema.json"): (
        "9b679687d0b2e56795d4e675160c29a6d7c2d6d744886ea4187fd8fe6c61ac85"
    ),
    Path("contracts/vectors/rd-entry-execution-proposal-v1.json"): (
        "befa7307332e6ed3604910e59a660529632298d10f783c314025c9d341773076"
    ),
}


def section(text: str, start: str, end: str) -> str:
    start_at = text.index(start)
    return text[start_at : text.index(end, start_at)]


def test_both_execution_authority_flags_are_independent_and_default_false() -> None:
    pine = PINE.read_text(encoding="utf-8")
    wrangler = json.loads(WRANGLER.read_text(encoding="utf-8"))

    assert (
        'emitExecutionProposalV1 = input.bool(false, '
        '"Emit execution proposal v1", group = "Automation")'
    ) in pine
    assert (
        'emitEntryV3Events = input.bool(false, "Emit contract-v3 entry events", '
        'group = "Automation")'
    ) in pine
    assert (
        'executionProposalV1Credential = input.string("", '
        '"Execution proposal v1 credential", group = "Automation")'
    ) in pine
    assert (
        'executionProposalV1ProvenanceSha256 = input.string("", '
        '"Execution proposal v1 provenance SHA-256", group = "Automation")'
    ) in pine
    assert (
        'executionProposalV1SourceTickCapabilitySha256 = input.string("", '
        '"Execution proposal v1 source tick capability SHA-256", '
        'group = "Automation")'
    ) in pine
    assert wrangler["vars"]["RD_EXECUTION_CANDIDATE_EMISSION_ENABLED"] == "false"
    assert wrangler["vars"]["RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED"] == "false"
    assert wrangler["vars"]["RD_EXECUTION_RECEIVER_MANIFEST_SHA256"] == (
        "INERT_NOT_CONFIGURED"
    )


def test_pine_proposal_is_closed_realtime_exact_dir_close_only() -> None:
    pine = PINE.read_text(encoding="utf-8")
    v3_emitter = section(
        pine,
        "emitEntryPayload(",
        "executionProposalV1Eligible(",
    )
    eligibility = section(
        pine,
        "executionProposalV1Eligible(",
        "executionProposalV1ClosedCandle(",
    )
    emitter = section(
        pine,
        "emitExecutionProposalV1ForAttempt(",
        "drawActionableEntry(",
    )
    closed_candle = section(
        pine,
        "executionProposalV1ClosedCandle(",
        "executionProposalV1Payload(",
    )

    for invariant in (
        "barstate.isrealtime",
        "barstate.isconfirmed",
        "attempt.directionalClose.closeEmitted",
        "attempt.core.liquidityCohort == LIQUIDITY_COHORT_TWO_PLUS",
        "attempt.core.commonRulesPass",
        "executionProposalV1ReviewedHashesValid()",
        "executionProposalV1SupportedSymbol()",
        "attempt.core.engagementEpoch - attempt.core.referenceOpenEpoch == 300",
        "attempt.directionalClose.closeEventEpoch - attempt.directionalClose.closeOpenEpoch == 300",
        "attempt.core.engagementEpoch <= attempt.directionalClose.closeEventEpoch",
        "observedAtEpoch >= attempt.directionalClose.closeEventEpoch",
        "observedAtEpoch <= attempt.directionalClose.closeEventEpoch + 30",
    ):
        assert invariant in eligibility
    assert '\\"closed\\":true' in closed_candle
    assert "executionProposalV1Payload(" in emitter
    assert v3_emitter.count("alert(") == 2
    assert emitter.count("alert(") == 1
    assert emitter.count("alert(envelope, alert.freq_all)") == 1
    assert "alert(envelope, alert.freq_once_per_bar_close)" not in emitter
    assert pine.count("alert(") == 3
    assert "executionProposalV1CredentialSafe()" in eligibility
    assert "nextSequence = array.get(executionProposalV1SequenceState, 0) + 1" in emitter
    assert emitter.index("str.length(envelope) < EXECUTION_PROPOSAL_V1_MAX_PAYLOAD_CHARS") < emitter.index(
        "array.set(executionProposalV1SequenceState, 0, nextSequence)"
    )


def test_pine_proposal_serializes_frozen_geometry_and_exact_four_r() -> None:
    pine = PINE.read_text(encoding="utf-8")
    payload = section(
        pine,
        "executionProposalV1Payload(",
        "emitExecutionProposalV1ForAttempt(",
    )

    for literal in (
        '"rd-entry-execution-proposal-v1"',
        '"PAPER_ONLY"',
        '"LIVE"',
        '"LIVE_CONTIGUOUS"',
        '"M5"',
        '"DIR_CLOSE"',
        '"TWO_PLUS_CANDLES"',
        '"EXACT"',
        '"PAPER_ELIGIBLE"',
        '"REPLAYABLE"',
        '"rd-entry-wick-buffer-v1"',
    ):
        assert literal in payload
    for frozen_field in (
        "attempt.core.referenceOpenEpoch",
        "attempt.core.referenceOpenTicks",
        "attempt.core.referenceHighTicks",
        "attempt.core.referenceLowTicks",
        "attempt.core.referenceCloseTicks",
        "attempt.directionalClose.closeOpenEpoch",
        "attempt.directionalClose.closeEventEpoch",
        "attempt.directionalClose.closeOpenTicks",
        "attempt.directionalClose.closeHighTicks",
        "attempt.directionalClose.closeLowTicks",
        "attempt.directionalClose.closeCloseTicks",
    ):
        assert frozen_field in payload
    assert "wickReferenceTicks = attempt.core.demand ? attempt.core.referenceLowTicks : attempt.core.referenceHighTicks" in payload
    assert "stopTicks = attempt.core.demand ? wickReferenceTicks - bufferTicks : wickReferenceTicks + bufferTicks" in payload
    assert "riskDistanceTicks = math.abs(entryTicks - stopTicks)" in payload
    assert "targetTicks = attempt.core.demand ? entryTicks + riskDistanceTicks * 4 : entryTicks - riskDistanceTicks * 4" in payload
    assert '\\"setup_revision\\":1' in payload

    schema = json.loads(
        Path("contracts/schema/rd-entry-execution-proposal-v1.schema.json").read_text(
            encoding="utf-8"
        )
    )
    serialized_keys = set(re.findall(r'\\\"([a-z0-9_]+)\\\"', payload))
    assert serialized_keys == set(schema["required"])


def test_pine_proposal_requires_canonical_exact_dir_close_selection() -> None:
    pine = PINE.read_text(encoding="utf-8")
    selection = section(
        pine,
        "executionProposalV1DirCloseSelected(",
        "executionProposalV1Eligible(",
    )
    eligibility = section(
        pine,
        "executionProposalV1Eligible(",
        "executionProposalV1ClosedCandle(",
    )

    for invariant in (
        "attempt.core.commonRulesPass and executionProposalV1ReviewedHashesValid()",
        'attempt.boc.bocFidelity == "EXACT"',
        "attempt.boc.bocTriggerCausal",
        "attempt.directionalClose.closeEmitted",
        'attempt.flip.flipFidelity == "EXACT"',
        "attempt.flip.flipTriggerCausal",
        "attempt.flip.flipLifecycleCausal",
        "attempt.boc.bocEventEpoch == attempt.directionalClose.closeEventEpoch",
        "attempt.boc.bocEventSequence == attempt.directionalClose.closeEventSequence",
        "attempt.flip.flipEventEpoch == attempt.directionalClose.closeEventEpoch",
        "attempt.flip.flipEventSequence == attempt.directionalClose.closeEventSequence",
        "attempt.boc.bocEventTicks != attempt.directionalClose.closeEventTicks",
        "attempt.flip.flipEventTicks != attempt.directionalClose.closeEventTicks",
    ):
        assert invariant in selection
    assert "executionProposalV1DirCloseSelected(attempt)" in eligibility
    for forbidden in (
        ":=",
        "array.set(",
        "entrySelectionPayload(",
        "entrySelectedFacts(",
        "entryPlanFacts(",
        "paperDecisionEmitted",
    ):
        assert forbidden not in selection

    def dir_close_selected(
        close: tuple[int, int, int] | None,
        boc: tuple[int, int, int] | None = None,
        flip: tuple[int, int, int] | None = None,
    ) -> bool:
        if close is None:
            return False
        close_clock = close[:2]
        exact_candidates = [
            (clock, model)
            for model, candidate in (("BOC", boc), ("DIR_CLOSE", close), ("HTF_FLIP", flip))
            if candidate is not None
            for clock in (candidate[:2],)
        ]
        canonical_model = min(exact_candidates)[1]
        same_event = [candidate for candidate in (boc, close, flip) if candidate is not None and candidate[:2] == close_clock]
        price_conflict = any(candidate[2] != close[2] for candidate in same_event)
        return canonical_model == "DIR_CLOSE" and len(same_event) == 1 and not price_conflict

    close = (1_800_000_300, 20, 1100)
    assert dir_close_selected(close)
    assert not dir_close_selected(close, boc=(1_800_000_299, 19, 1099))
    assert not dir_close_selected(close, flip=(1_800_000_299, 19, 1099))
    assert dir_close_selected(close, boc=(1_800_000_301, 21, 1101))
    assert not dir_close_selected(close, boc=(1_800_000_300, 20, 1100))
    assert not dir_close_selected(close, flip=(1_800_000_300, 20, 1101))


def test_proposal_path_cannot_mutate_or_promote_legacy_v3() -> None:
    pine = PINE.read_text(encoding="utf-8")
    plan = section(pine, "entryPlanFacts(", "entryHasPaperEligibleSelection(")
    v3_payload = section(pine, "entryPayload(", "emitEntryPayload(")
    proposal = section(
        pine,
        "executionProposalV1DirCloseSelected(",
        "drawActionableEntry(",
    )
    main = section(
        pine,
        "// Entry candidates are evaluated after",
        "// These named conditions are deliberately separate",
    )

    assert "entryStopTicks" in plan
    assert "entryTargetTicks" in plan
    assert "executionProposal" not in plan
    assert "executionProposal" not in v3_payload
    for forbidden in (
        "entryPlanFacts(",
        "entryStopTicks",
        "entryTargetTicks",
        "paperDecisionEmitted :=",
        "core.entryTicks :=",
        "core.stopTicks :=",
        "core.targetTicks :=",
        "drawActionableEntry(",
        "drawActionableExit(",
        "monitorAttemptExit(",
    ):
        assert forbidden not in proposal
    assert main.index("emitEntryPayload(") < main.index("monitorAttemptExit(")
    assert main.index("monitorAttemptExit(") < main.index(
        "emitExecutionProposalV1ForAttempt(attempt)"
    )
    bundle_ready = section(
        main,
        "            if bundleReady\n",
        "            array.set(entryAttempts, attemptIndex, attempt)",
    )
    assert bundle_ready.count("emitExecutionProposalV1ForAttempt(attempt)") == 1
    assert "\n                emitExecutionProposalV1ForAttempt(attempt)" in bundle_ready
    assert "\n            emitExecutionProposalV1ForAttempt(attempt)" not in main
    assert main.index("emitExecutionProposalV1ForAttempt(attempt)") < main.index(
        "array.set(entryAttempts, attemptIndex, attempt)"
    )


def test_observation_edge_remains_account_free_and_private_transport_only() -> None:
    worker = WORKER.read_text(encoding="utf-8")
    boundary = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (INGESTION, DISPATCHER, MIGRATION)
    ).lower()

    for account_surface in (
        r"\baccount_id\b",
        r"\baccount_number\b",
        r"\bbroker_account\b",
        r"\bfirm_rule\b",
        r"\bposition_id\b",
        r"\border_id\b",
        r"\bmt5\b",
    ):
        assert re.search(account_surface, boundary) is None
    assert "/api/v1/tradingview/observations" in worker
    for forbidden_route in (
        "/api/v1/execution",
        "/api/v1/instructions",
        "/api/v1/dispatcher",
        "/api/v1/receiver",
    ):
        assert forbidden_route not in worker
    assert "receiveExecutionCandidateV1" not in worker


def test_v1_contract_bytes_are_frozen_while_v2_reconstruction_is_paper_only() -> None:
    for path, expected_digest in V1_SCHEMA_BYTES.items():
        assert sha256(path.read_bytes()).hexdigest() == expected_digest

    v2_proposal = json.loads(
        Path("contracts/schema/rd-entry-execution-proposal-v2.schema.json").read_text(
            encoding="utf-8"
        )
    )
    v2_candidate = json.loads(
        Path("contracts/schema/execution-candidate-v2.schema.json").read_text(
            encoding="utf-8"
        )
    )
    reconstruction = json.loads(
        Path("contracts/schema/broker-geometry-reconstruction-v1.schema.json").read_text(
            encoding="utf-8"
        )
    )
    vector = json.loads(
        Path("contracts/vectors/broker-geometry-reconstruction-v1.json").read_text(
            encoding="utf-8"
        )
    )

    assert v2_proposal["properties"]["execution_mode"] == {"const": "PAPER_ONLY"}
    assert v2_candidate["properties"]["execution_mode"] == {"const": "PAPER_ONLY"}
    assert reconstruction["properties"]["authority"] == {"const": "PAPER_ONLY"}
    assert reconstruction["properties"]["real_execution_allowed"] == {"const": False}
    assert reconstruction["properties"]["command"] == {"const": None}
    for case in vector["cases"]:
        assert case["expected"]["authority"] == "PAPER_ONLY"
        assert case["expected"]["real_execution_allowed"] is False
        assert case["expected"]["command"] is None
