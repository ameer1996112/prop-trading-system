"""Frozen Phase 0 Pydantic contracts.

These models describe evidence and observation only. They deliberately model no account
onboarding, broker command, order, or position mutation.
"""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from functools import lru_cache
from importlib import metadata, resources
from itertools import pairwise
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)

from prop_trading.domain.canonical import (
    canonical_json_bytes,
    validate_canonical_value,
    validate_fixed_decimal,
)


def _validate_utc_timestamp(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise ValueError("timestamp must be a real UTC calendar instant") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise ValueError("timestamp must use UTC Z notation")
    return value


def _validate_local_date(value: str) -> str:
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("local period date must be a real calendar date") from exc
    return value


def _validate_local_time(value: str) -> str:
    try:
        time.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("local reset time must be a real wall-clock time") from exc
    return value


_UTC_TIMESTAMP_PARTS = re.compile(
    r"^(?P<whole>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})"
    r"(?:\.(?P<fraction>[0-9]{1,9}))?Z$"
)
_UTC_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_FIVE_MINUTES_NS = 300_000_000_000


def _utc_nanoseconds(value: str) -> int:
    """Return an exact ordering key without truncating 7-9 fractional digits."""
    match = _UTC_TIMESTAMP_PARTS.fullmatch(value)
    if match is None:  # UtcTimestamp validation owns the user-facing error.
        raise ValueError("timestamp is outside the UTC timestamp profile")
    whole = datetime.fromisoformat(match.group("whole") + "+00:00")
    delta = whole - _UTC_EPOCH
    whole_seconds = delta.days * 86_400 + delta.seconds
    fraction = (match.group("fraction") or "").ljust(9, "0")
    return whole_seconds * 1_000_000_000 + int(fraction or "0")


Identifier = Annotated[str, Field(min_length=1, max_length=160, pattern=r"^[A-Za-z0-9_.:@|+/-]+$")]
VersionLabel = Annotated[
    str, Field(min_length=1, max_length=64, pattern=r"^[0-9]+\.[0-9]+\.[0-9]+$")
]
Sha256 = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
UtcTimestamp = Annotated[
    str,
    Field(pattern=r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$"),
    AfterValidator(_validate_utc_timestamp),
]
LocalDate = Annotated[
    str,
    Field(pattern=r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"),
    AfterValidator(_validate_local_date),
]
LocalTime = Annotated[
    str,
    Field(pattern=r"^[0-9]{2}:[0-9]{2}:[0-9]{2}$"),
    AfterValidator(_validate_local_time),
]
CanonicalDetail = str | int | bool | None
SafeInteger = Annotated[int, Field(ge=-9_007_199_254_740_991, le=9_007_199_254_740_991)]
_TZDB_PACKAGE_VERSION = metadata.version("tzdata")
_IANA_ZONE_PATTERN = re.compile(r"^[A-Za-z0-9._+-]+(?:/[A-Za-z0-9._+-]+)+$")

REQUIRED_ALERT_PAYLOAD_FAMILIES = frozenset(
    {"HEARTBEAT", "CHECKPOINT_CHUNK", "CHECKPOINT_OVERFLOW"}
)
REQUIRED_ACTION_GRANT_BINDINGS = frozenset(
    {
        "jti",
        "subject",
        "session",
        "role",
        "challenge_evidence",
        "action",
        "account_id",
        "resource_version",
        "safety_epoch",
        "request_body_digest",
    }
)


class ContractModel(BaseModel):
    """Strict immutable base for all serialized contracts."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class EvidenceStatus(StrEnum):
    VERIFIED = "VERIFIED"
    UNVERIFIED = "UNVERIFIED"
    BLOCKED = "BLOCKED"


class SourceWorkingTreeStatus(StrEnum):
    CLEAN = "CLEAN"
    MODIFIED = "MODIFIED"
    UNTRACKED = "UNTRACKED"


class AlertMode(StrEnum):
    CANONICAL = "CANONICAL"
    DIAGNOSTIC = "DIAGNOSTIC"


class RuleFidelity(StrEnum):
    EXACT = "EXACT"
    CALIBRATED = "CALIBRATED"
    DISCRETIONARY = "DISCRETIONARY"
    UNRESOLVED = "UNRESOLVED"


class RuleAutomation(StrEnum):
    EXECUTE = "EXECUTE"
    SHADOW_ONLY = "SHADOW_ONLY"
    DISABLED = "DISABLED"
    RISK_LAYER = "RISK_LAYER"


class StreamOperationalState(StrEnum):
    OBSERVATION_ONLY = "OBSERVATION_ONLY"
    GAP_FROZEN = "GAP_FROZEN"
    CHECKPOINT_ASSEMBLING = "CHECKPOINT_ASSEMBLING"
    ACTIVE_FOR_NEW_LIFECYCLES = "ACTIVE_FOR_NEW_LIFECYCLES"


class TickSourceClassification(StrEnum):
    SEQUENCE_COMPLETE = "SEQUENCE_COMPLETE"
    CONTINUOUS_OBSERVED = "CONTINUOUS_OBSERVED"
    INCOMPLETE = "INCOMPLETE"


class HealthState(StrEnum):
    ALIVE = "ALIVE"
    DEGRADED = "DEGRADED"
    UNKNOWN = "UNKNOWN"
    BLOCKED = "BLOCKED"


class GateId(StrEnum):
    OPTIMIZER_1_INPUTS = "optimizer_1_inputs"
    TRADINGVIEW_ALERT_CONFIGURATION = "tradingview_alert_configuration"
    COMMITTED_CLEAN_PINE_PROVENANCE = "committed_clean_pine_provenance"
    MANAGED_SECRET_WORKLOAD_IDENTITY = "managed_secret_workload_identity"
    OIDC_MFA = "oidc_mfa"
    TELEMETRY = "telemetry"
    INDEPENDENT_DEAD_MAN = "independent_dead_man"
    TRANSACTIONAL_EMAIL = "transactional_email"
    METAAPI_DEMO_ONLY_TENANT = "metaapi_demo_only_tenant"
    METAAPI_COMMON_CURSOR_BARRIER = "metaapi_common_cursor_barrier"
    LICENSED_TICK_SOURCE = "licensed_tick_source"
    SEQUENCE_COMPLETE_TICKS = "sequence_complete_ticks"
    FIVE_DAY_TICK_PILOT = "five_day_tick_pilot"


class SourceProvenance(ContractModel):
    source_path: str = Field(min_length=1)
    source_repository_head: Sha256 | Annotated[str, Field(pattern=r"^[a-f0-9]{40}$")]
    source_working_tree_status: SourceWorkingTreeStatus
    working_content_sha256: Sha256
    head_content_sha256: Sha256 | None
    content_matches_head: bool
    committed_clean: bool

    @model_validator(mode="after")
    def _clean_claim_is_consistent(self) -> SourceProvenance:
        hashes_match = (
            self.head_content_sha256 is not None
            and self.head_content_sha256 == self.working_content_sha256
        )
        is_clean = self.source_working_tree_status is SourceWorkingTreeStatus.CLEAN
        if is_clean and not hashes_match:
            raise ValueError("CLEAN status requires equal non-null working and HEAD hashes")
        if (
            self.source_working_tree_status is SourceWorkingTreeStatus.UNTRACKED
            and self.head_content_sha256 is not None
        ):
            raise ValueError("UNTRACKED provenance cannot have a HEAD content hash")
        if self.content_matches_head != hashes_match:
            raise ValueError("content_matches_head is derived solely from equal non-null hashes")
        if self.committed_clean != (is_clean and hashes_match):
            raise ValueError(
                "committed_clean is derived and requires CLEAN status plus equal non-null hashes"
            )
        return self


class FeedContext(ContractModel):
    exchange_qualified_ticker: Identifier
    feed: Identifier
    tick_size: str
    timezone: str = Field(min_length=1, max_length=64)
    chart_type: Literal["CANDLES"]
    session_setting: Literal["REGULAR", "EXTENDED"]
    confirmed_timeframe_minutes: Literal[5]

    @field_validator("tick_size")
    @classmethod
    def _tick_size_is_fixed(cls, value: str) -> str:
        validate_fixed_decimal(value, scale=5, non_negative=True)
        if value == "0.00000":
            raise ValueError("tick_size must be positive")
        return value


class StrategyManifest(ContractModel):
    schema_id: Literal["phase0.strategy-manifest.v1"]
    manifest_id: Identifier
    strategy_id: Literal["rd_liquidity_sd_5m_v1"]
    strategy_version: VersionLabel | None
    pine: SourceProvenance
    decision_matrix_version: VersionLabel | None
    optimizer_1_evidence_id: Identifier | None
    optimizer_1_settings_sha256: Sha256 | None
    feed_context: FeedContext | None
    webhook_contract_version: VersionLabel
    producer_identity: Identifier | None
    stream_generation: int | None = Field(default=None, ge=1, le=9_007_199_254_740_991)
    checkpoint_cadence_confirmed_bars: Literal[12]
    heartbeat_every_confirmed_bar: Literal[True]
    heartbeat_slo_seconds: int = Field(ge=1, le=600)
    approved_alert_manifest_id: Identifier
    alert_recreation_evidence_id: Identifier | None
    alert_mode: Literal[AlertMode.CANONICAL]
    activation_status: EvidenceStatus

    @model_validator(mode="after")
    def _verified_manifest_is_complete(self) -> StrategyManifest:
        if self.activation_status is EvidenceStatus.VERIFIED and (
            self.strategy_version is None
            or self.decision_matrix_version is None
            or self.optimizer_1_evidence_id is None
            or self.optimizer_1_settings_sha256 is None
            or self.feed_context is None
            or self.producer_identity is None
            or self.stream_generation is None
            or self.alert_recreation_evidence_id is None
            or not self.pine.committed_clean
        ):
            raise ValueError("verified strategy manifest is missing activation evidence")
        return self


class RDStrategySource(ContractModel):
    source_id: Identifier
    youtube_video_id: Identifier
    published_date: LocalDate
    authority: Literal[
        "BASELINE",
        "LATEST_OVERRIDE",
        "COMPATIBLE_GAP_FILL",
        "HISTORICAL_ONLY",
    ]
    title: str = Field(min_length=1, max_length=240)


class RDStrategyEvidenceRef(ContractModel):
    source_id: Identifier
    timestamp_seconds: int = Field(ge=0, le=86_400)


class RDStrategyRule(ContractModel):
    rule_id: Identifier
    category: Literal["ZONE", "LIQUIDITY", "ENTRY", "MANAGEMENT", "RISK", "TIMEFRAME"]
    fidelity: RuleFidelity
    automation: RuleAutomation
    open_requirement: bool
    summary: str = Field(min_length=1, max_length=1_000)
    evidence: list[RDStrategyEvidenceRef] = Field(min_length=1, max_length=12)
    unresolved_terms: list[str] = Field(default_factory=list, max_length=24)

    @model_validator(mode="after")
    def _execution_requires_exact_fidelity(self) -> RDStrategyRule:
        if self.automation is RuleAutomation.EXECUTE and self.fidelity is not RuleFidelity.EXACT:
            raise ValueError("executable strategy rules must have EXACT fidelity")
        return self


class RDDistanceGuidance(ContractModel):
    profile_id: Identifier
    symbol_patterns: list[Identifier] = Field(min_length=1, max_length=24)
    confirmed_timeframe_minutes: Literal[5]
    unit: Literal["PIP", "VISUAL_CONTEXT"]
    guidance_min: str | None
    guidance_max: str | None
    fidelity: Literal[
        RuleFidelity.CALIBRATED,
        RuleFidelity.DISCRETIONARY,
        RuleFidelity.UNRESOLVED,
    ]
    automation: Literal[RuleAutomation.SHADOW_ONLY]
    summary: str = Field(min_length=1, max_length=1_000)
    evidence: list[RDStrategyEvidenceRef] = Field(min_length=1, max_length=12)

    @field_validator("guidance_min", "guidance_max")
    @classmethod
    def _guidance_is_fixed_decimal(cls, value: str | None) -> str | None:
        if value is not None:
            validate_fixed_decimal(value, scale=2, non_negative=True)
        return value

    @model_validator(mode="after")
    def _guidance_range_is_ordered(self) -> RDDistanceGuidance:
        if (self.guidance_min is None) != (self.guidance_max is None):
            raise ValueError("distance guidance min and max must both be present or absent")
        guidance_min = self.guidance_min
        guidance_max = self.guidance_max
        if (
            guidance_min is not None
            and guidance_max is not None
            and Decimal(guidance_min) > Decimal(guidance_max)
        ):
            raise ValueError("distance guidance min must not exceed max")
        if self.unit == "VISUAL_CONTEXT" and self.guidance_min is not None:
            raise ValueError("visual-context distance guidance cannot claim numeric bounds")
        return self


class RDStrategyAutomationPolicy(ContractModel):
    paper_only: Literal[True]
    real_execution_allowed: Literal[False]
    first_touch_action: Literal["WAIT"]
    unknown_rule_action: Literal["SHADOW_ONLY"]
    ambiguous_same_bar_order_action: Literal["SHADOW_ONLY"]
    required_decision_fidelity: Literal[RuleFidelity.EXACT]
    executable_entry_models: list[Literal["DIR_CLOSE"]]
    shadow_entry_models: list[Literal["HTF_FLIP"]]
    disabled_entry_models: list[Literal["BREAK_CANDLE"]]

    @model_validator(mode="after")
    def _entry_model_partition_is_frozen(self) -> RDStrategyAutomationPolicy:
        if self.executable_entry_models != ["DIR_CLOSE"]:
            raise ValueError("DIR_CLOSE is the only executable entry model")
        if self.shadow_entry_models != ["HTF_FLIP"]:
            raise ValueError("HTF_FLIP must remain shadow-only")
        if self.disabled_entry_models != ["BREAK_CANDLE"]:
            raise ValueError("BREAK_CANDLE must remain disabled")
        return self


class RDStrategyRuleContract(ContractModel):
    schema_id: Literal["phase0.rd-strategy-rule-contract.v1"]
    contract_id: Identifier
    contract_version: VersionLabel
    strategy_id: Literal["rd_liquidity_sd_5m_v1"]
    producer_strategy_version: Annotated[
        str,
        Field(
            min_length=1,
            max_length=64,
            pattern=r"^[0-9]+\.[0-9]+\.[0-9]+-(?:paper|contract)[0-9]+$",
        ),
    ]
    confirmed_timeframe_minutes: Literal[5]
    sources: list[RDStrategySource] = Field(min_length=4, max_length=12)
    rules: list[RDStrategyRule] = Field(min_length=1, max_length=128)
    distance_guidance: list[RDDistanceGuidance] = Field(min_length=1, max_length=64)
    automation_policy: RDStrategyAutomationPolicy

    @model_validator(mode="after")
    def _references_and_identifiers_are_closed(self) -> RDStrategyRuleContract:
        source_ids = [source.source_id for source in self.sources]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("strategy source IDs must be unique")
        youtube_video_ids = [source.youtube_video_id for source in self.sources]
        if len(youtube_video_ids) != len(set(youtube_video_ids)):
            raise ValueError("strategy source videos must be unique")
        sources_by_authority = {source.authority: source for source in self.sources}
        required_authorities = {
            "BASELINE",
            "LATEST_OVERRIDE",
            "COMPATIBLE_GAP_FILL",
            "HISTORICAL_ONLY",
        }
        if len(sources_by_authority) != len(self.sources):
            raise ValueError("strategy source authorities must be unique")
        if set(sources_by_authority) != required_authorities:
            raise ValueError("strategy source authority set must be complete")
        precedence_dates = [
            date.fromisoformat(sources_by_authority["LATEST_OVERRIDE"].published_date),
            date.fromisoformat(sources_by_authority["BASELINE"].published_date),
            date.fromisoformat(sources_by_authority["COMPATIBLE_GAP_FILL"].published_date),
            date.fromisoformat(sources_by_authority["HISTORICAL_ONLY"].published_date),
        ]
        if any(newer <= older for newer, older in pairwise(precedence_dates)):
            raise ValueError("strategy source dates violate authority precedence")
        rule_ids = [rule.rule_id for rule in self.rules]
        if len(rule_ids) != len(set(rule_ids)):
            raise ValueError("strategy rule IDs must be unique")
        profile_ids = [profile.profile_id for profile in self.distance_guidance]
        if len(profile_ids) != len(set(profile_ids)):
            raise ValueError("distance profile IDs must be unique")
        known_sources = set(source_ids)
        evidence_refs = [
            evidence.source_id for rule in self.rules for evidence in rule.evidence
        ] + [
            evidence.source_id
            for profile in self.distance_guidance
            for evidence in profile.evidence
        ]
        if not set(evidence_refs).issubset(known_sources):
            raise ValueError("strategy evidence references an unknown source")
        authority_by_source = {source.source_id: source.authority for source in self.sources}
        for rule in self.rules:
            if rule.automation is RuleAutomation.EXECUTE and all(
                authority_by_source[evidence.source_id] == "HISTORICAL_ONLY"
                for evidence in rule.evidence
            ):
                raise ValueError(
                    "executable strategy rules cannot rely only on historical evidence"
                )
        return self


class ApprovedAlertManifest(ContractModel):
    schema_id: Literal["phase0.approved-alert-manifest.v1"]
    manifest_id: Identifier
    strategy_manifest_id: Identifier
    payload_contract_version: VersionLabel
    expected_payload_families: list[Literal["HEARTBEAT", "CHECKPOINT_CHUNK", "CHECKPOINT_OVERFLOW"]]
    mode: Literal[AlertMode.CANONICAL]
    canonical_export_enabled: Literal[True]
    diagnostics_enabled: Literal[False]
    max_active_setups: int = Field(ge=1, le=1024)
    max_checkpoint_chunks: int = Field(ge=1, le=64)
    max_chunk_bytes: int = Field(ge=256, le=65_536)
    max_canonical_setup_bytes: int = Field(ge=128, le=16_384)
    incomplete_checkpoint_after_seconds: Literal[720]
    redacted_destination_evidence_id: Identifier | None
    message_structure_evidence_id: Identifier | None
    recreation_evidence_id: Identifier | None
    evidence_status: EvidenceStatus

    @field_validator("expected_payload_families")
    @classmethod
    def _families_are_exact(cls, value: list[str]) -> list[str]:
        if len(value) != len(REQUIRED_ALERT_PAYLOAD_FAMILIES) or set(value) != set(
            REQUIRED_ALERT_PAYLOAD_FAMILIES
        ):
            raise ValueError("payload families must be the exact unique frozen family set")
        return value

    @model_validator(mode="after")
    def _verified_alert_has_operator_evidence(self) -> ApprovedAlertManifest:
        if self.evidence_status is EvidenceStatus.VERIFIED and (
            self.redacted_destination_evidence_id is None
            or self.message_structure_evidence_id is None
            or self.recreation_evidence_id is None
        ):
            raise ValueError(
                "verified alert requires redacted configuration and recreation evidence"
            )
        return self


class HeartbeatMetadata(ContractModel):
    schema_id: Literal["phase0.heartbeat.v1"]
    manifest_id: Identifier
    producer_identity: Identifier
    stream_generation: int = Field(ge=1, le=9_007_199_254_740_991)
    sequence: int = Field(ge=1, le=9_007_199_254_740_991)
    confirmed_bar_close: UtcTimestamp
    timeframe_minutes: Literal[5]
    kind: Literal["HEARTBEAT"]


class CheckpointChunkMetadata(ContractModel):
    schema_id: Literal["phase0.checkpoint-chunk.v1"]
    manifest_id: Identifier
    producer_identity: Identifier
    stream_generation: int = Field(ge=1, le=9_007_199_254_740_991)
    checkpoint_id: Identifier
    covers_through_sequence: int = Field(ge=1, le=9_007_199_254_740_991)
    logical_sequence: int = Field(ge=1, le=9_007_199_254_740_991)
    confirmed_bar_close: UtcTimestamp
    full_set_count: int = Field(ge=0, le=1024)
    full_set_sha256: Sha256
    chunk_index: int = Field(ge=0, le=63)
    chunk_count: int = Field(ge=1, le=64)
    chunk_bytes: int = Field(ge=0, le=65_536)
    chunk_sha256: Sha256
    first_setup_identity: Sha256 | None = None
    last_setup_identity: Sha256 | None = None
    staged_only: Literal[True]

    @model_validator(mode="after")
    def _index_is_declared(self) -> CheckpointChunkMetadata:
        if self.chunk_index >= self.chunk_count:
            raise ValueError("chunk_index must be less than chunk_count")
        if (self.first_setup_identity is None) != (self.last_setup_identity is None):
            raise ValueError("chunk identity bounds must be both present or both absent")
        if self.logical_sequence != self.covers_through_sequence:
            raise ValueError("logical_sequence must equal covers_through_sequence")
        return self


class SetupSide(StrEnum):
    DEMAND = "DEMAND"
    SUPPLY = "SUPPLY"


class ActiveSetupNaturalKey(ContractModel):
    side: SetupSide
    zone_key: Identifier
    liquidity_key: Identifier
    formation_bar_close: UtcTimestamp


class ActiveZoneGeometry(ContractModel):
    top_ticks: SafeInteger
    bottom_ticks: SafeInteger
    origin_open: UtcTimestamp
    origin_close: UtcTimestamp

    @model_validator(mode="after")
    def _geometry_is_possible(self) -> ActiveZoneGeometry:
        if self.top_ticks <= self.bottom_ticks:
            raise ValueError("zone top_ticks must be greater than bottom_ticks")
        if (
            _utc_nanoseconds(self.origin_close) - _utc_nanoseconds(self.origin_open)
            != _FIVE_MINUTES_NS
        ):
            raise ValueError("zone origin bar must be exactly 300 seconds")
        return self


class ActiveLiquidityGeometry(ContractModel):
    price_ticks: SafeInteger
    origin_open: UtcTimestamp
    origin_close: UtcTimestamp

    @model_validator(mode="after")
    def _geometry_is_possible(self) -> ActiveLiquidityGeometry:
        if (
            _utc_nanoseconds(self.origin_close) - _utc_nanoseconds(self.origin_open)
            != _FIVE_MINUTES_NS
        ):
            raise ValueError("liquidity origin bar must be exactly 300 seconds")
        return self


class ActiveSourceCandle(ContractModel):
    open_time: UtcTimestamp
    close_time: UtcTimestamp
    open_ticks: SafeInteger
    high_ticks: SafeInteger
    low_ticks: SafeInteger
    close_ticks: SafeInteger

    @model_validator(mode="after")
    def _candle_is_possible(self) -> ActiveSourceCandle:
        if _utc_nanoseconds(self.close_time) - _utc_nanoseconds(self.open_time) != _FIVE_MINUTES_NS:
            raise ValueError("source candle must be exactly 300 seconds")
        if self.high_ticks < max(self.open_ticks, self.close_ticks, self.low_ticks):
            raise ValueError("source candle high_ticks is inconsistent")
        if self.low_ticks > min(self.open_ticks, self.close_ticks, self.high_ticks):
            raise ValueError("source candle low_ticks is inconsistent")
        return self


class CheckpointActiveSetup(ContractModel):
    """Full observation-only active body emitted by the authorized detector contract."""

    natural_key: ActiveSetupNaturalKey
    state: Literal["WAITING_FOR_ELIGIBILITY", "ARMED"]
    reason_code: Literal["WAIT_SETUP_ELIGIBILITY", "ARM_SETUP_AFTER_LIQUIDITY"]
    zone: ActiveZoneGeometry
    liquidity: ActiveLiquidityGeometry
    source_candle: ActiveSourceCandle

    @model_validator(mode="after")
    def _matches_negative_oracle(self) -> CheckpointActiveSetup:
        expected_reason = (
            "WAIT_SETUP_ELIGIBILITY"
            if self.state == "WAITING_FOR_ELIGIBILITY"
            else "ARM_SETUP_AFTER_LIQUIDITY"
        )
        if self.reason_code != expected_reason:
            raise ValueError("active setup state and detector reason_code disagree")
        if (
            self.natural_key.side is SetupSide.DEMAND
            and self.liquidity.price_ticks > self.zone.top_ticks
        ):
            raise ValueError("demand liquidity must not be above its zone")
        if (
            self.natural_key.side is SetupSide.SUPPLY
            and self.liquidity.price_ticks < self.zone.bottom_ticks
        ):
            raise ValueError("supply liquidity must not be below its zone")
        return self


def _setup_order_key(setup: CheckpointActiveSetup) -> tuple[str, str, str, str]:
    key = setup.natural_key
    return (key.side.value, key.zone_key, key.liquidity_key, key.formation_bar_close)


def _setup_identity(setup: CheckpointActiveSetup) -> str:
    natural_key_bytes = canonical_json_bytes(setup.natural_key.model_dump(mode="json"))
    return hashlib.sha256(natural_key_bytes).hexdigest()


class CheckpointChunkBody(ContractModel):
    """Typed body whose ordering, count, byte length, and digest are executable invariants."""

    schema_id: Literal["phase0.checkpoint-chunk-body.v1"]
    metadata: CheckpointChunkMetadata
    setups: list[CheckpointActiveSetup] = Field(max_length=1024)

    @model_validator(mode="after")
    def _body_matches_metadata(self) -> CheckpointChunkBody:
        checkpoint_close = _utc_nanoseconds(self.metadata.confirmed_bar_close)
        for setup in self.setups:
            if _utc_nanoseconds(setup.natural_key.formation_bar_close) > checkpoint_close:
                raise ValueError("setup formation bar cannot be after checkpoint confirmed bar")
            if _utc_nanoseconds(setup.source_candle.close_time) != checkpoint_close:
                raise ValueError(
                    "checkpoint source candle close must equal metadata confirmed_bar_close"
                )
        dumped_setups = [item.model_dump(mode="json") for item in self.setups]
        body_bytes = canonical_json_bytes(dumped_setups)
        digest = hashlib.sha256(body_bytes).hexdigest()
        natural_keys = [_setup_order_key(item) for item in self.setups]
        identities = [_setup_identity(item) for item in self.setups]
        if natural_keys != sorted(natural_keys) or len(natural_keys) != len(set(natural_keys)):
            raise ValueError("checkpoint setups must have unique canonical natural-key ordering")
        if len(identities) != len(set(identities)):
            raise ValueError("checkpoint setup identities derived from natural keys must be unique")
        if self.metadata.chunk_bytes != len(body_bytes):
            raise ValueError("chunk_bytes does not match canonical checkpoint body bytes")
        if self.metadata.chunk_sha256 != digest:
            raise ValueError("chunk_sha256 does not match canonical checkpoint body")
        expected_first = identities[0] if identities else None
        expected_last = identities[-1] if identities else None
        if (
            self.metadata.first_setup_identity != expected_first
            or self.metadata.last_setup_identity != expected_last
        ):
            raise ValueError("chunk identity bounds do not match checkpoint natural keys")
        if len(self.setups) > self.metadata.full_set_count:
            raise ValueError("checkpoint chunk count exceeds declared full set count")
        if self.metadata.chunk_count == 1 and (
            len(self.setups) != self.metadata.full_set_count
            or self.metadata.full_set_sha256 != digest
        ):
            raise ValueError("single checkpoint chunk must digest the entire declared full set")
        return self


class GapTaintDeclaration(ContractModel):
    schema_id: Literal["phase0.gap-taint.v1"]
    gap_id: Identifier
    producer_identity: Identifier
    stream_generation: int = Field(ge=1, le=9_007_199_254_740_991)
    last_contiguous_sequence: int | None = Field(default=None, ge=0, le=9_007_199_254_740_991)
    first_observed_after_gap: int | None = Field(default=None, ge=1, le=9_007_199_254_740_991)
    conflicting_sequence: int | None = Field(default=None, ge=0, le=9_007_199_254_740_991)
    previous_stream_generation: int | None = Field(default=None, ge=1, le=9_007_199_254_740_991)
    affected_checkpoint_id: Identifier | None = None
    detection_reason: Literal[
        "SEQUENCE_GAP",
        "CONFLICTING_DUPLICATE",
        "UNPLANNED_GENERATION_RESET",
        "CHECKPOINT_TIMEOUT",
    ]
    allocations_frozen: Literal[True]
    pre_gap_setups_permanently_tainted: Literal[True]
    recovery_checkpoint_setups_permanently_tainted: Literal[True]
    retrospective_execution_forbidden: Literal[True]
    recovery_state: Literal[
        StreamOperationalState.GAP_FROZEN, StreamOperationalState.ACTIVE_FOR_NEW_LIFECYCLES
    ]
    recovery_checkpoint_id: Identifier | None

    @model_validator(mode="after")
    def _reason_has_truthful_evidence(self) -> GapTaintDeclaration:
        if self.detection_reason == "SEQUENCE_GAP":
            if (
                self.last_contiguous_sequence is None
                or self.first_observed_after_gap is None
                or self.first_observed_after_gap <= self.last_contiguous_sequence + 1
            ):
                raise ValueError("SEQUENCE_GAP must identify a positive missing sequence width")
        elif self.detection_reason == "CONFLICTING_DUPLICATE":
            if self.conflicting_sequence is None:
                raise ValueError("CONFLICTING_DUPLICATE requires the conflicting sequence")
        elif self.detection_reason == "UNPLANNED_GENERATION_RESET":
            if (
                self.previous_stream_generation is None
                or self.previous_stream_generation == self.stream_generation
            ):
                raise ValueError("generation reset requires a distinct previous stream generation")
        elif self.affected_checkpoint_id is None:
            raise ValueError("CHECKPOINT_TIMEOUT requires the affected checkpoint identifier")
        if (
            self.recovery_state is StreamOperationalState.ACTIVE_FOR_NEW_LIFECYCLES
            and self.recovery_checkpoint_id is None
        ):
            raise ValueError("recovery requires a complete checkpoint identifier")
        return self


class RiskPeriodBoundary(ContractModel):
    local_period_date: LocalDate
    scheduled_local_label: str = Field(min_length=1, max_length=64)
    utc_start: UtcTimestamp
    utc_end: UtcTimestamp
    resolution: Literal["EXACT", "GAP_FORWARD", "FOLD_EARLY"]
    utc_offset: str = Field(pattern=r"^[+-][0-9]{2}:[0-9]{2}$")

    @field_validator("utc_offset")
    @classmethod
    def _offset_is_real(cls, value: str) -> str:
        hours, minutes = (int(item) for item in value[1:].split(":"))
        if hours > 23 or minutes > 59:
            raise ValueError("UTC offset must be a real signed hours/minutes value")
        return value

    @model_validator(mode="after")
    def _period_has_positive_duration(self) -> RiskPeriodBoundary:
        if _utc_nanoseconds(self.utc_start) >= _utc_nanoseconds(self.utc_end):
            raise ValueError("risk period utc_start must be before utc_end")
        return self


@lru_cache(maxsize=64)
def _load_bundled_zone(zone_name: str) -> ZoneInfo:
    if _IANA_ZONE_PATTERN.fullmatch(zone_name) is None or any(
        part in {"", ".", ".."} for part in zone_name.split("/")
    ):
        raise ValueError("IANA timezone name is unsupported or unsafe")
    resource = resources.files("tzdata.zoneinfo")
    for part in zone_name.split("/"):
        resource = resource.joinpath(part)
    try:
        with resource.open("rb") as zone_file:
            return ZoneInfo.from_file(zone_file, key=zone_name)
    except (FileNotFoundError, IsADirectoryError, ValueError) as exc:
        raise ValueError("IANA timezone is absent from the pinned bundled tzdb") from exc


def _valid_local_candidates(naive: datetime, zone: ZoneInfo) -> list[tuple[datetime, datetime]]:
    candidates: list[tuple[datetime, datetime]] = []
    seen_utc: set[datetime] = set()
    for fold in (0, 1):
        aware = naive.replace(tzinfo=zone, fold=fold)
        instant = aware.astimezone(UTC)
        if instant.astimezone(zone).replace(tzinfo=None) == naive and instant not in seen_utc:
            seen_utc.add(instant)
            candidates.append((aware, instant))
    return candidates


def _resolve_local_boundary(
    local_date: date, local_reset: time, zone: ZoneInfo
) -> tuple[datetime, datetime, str]:
    naive = datetime.combine(local_date, local_reset)
    candidates = _valid_local_candidates(naive, zone)
    if len(candidates) == 1:
        aware, instant = candidates[0]
        return aware, instant, "EXACT"
    if len(candidates) == 2:
        aware, instant = candidates[0]
        return aware, instant, "FOLD_EARLY"
    for seconds in range(1, 86_401):
        forwarded = naive + timedelta(seconds=seconds)
        candidates = _valid_local_candidates(forwarded, zone)
        if candidates:
            aware, instant = candidates[0]
            return aware, instant, "GAP_FORWARD"
    raise ValueError("pinned tzdb has no valid instant within a day of the reset")


def _utc_label(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _offset_label(value: datetime) -> str:
    offset = value.utcoffset()
    if offset is None:
        raise ValueError("derived local boundary has no UTC offset")
    total_minutes = int(offset.total_seconds() // 60)
    sign = "+" if total_minutes >= 0 else "-"
    absolute = abs(total_minutes)
    return f"{sign}{absolute // 60:02d}:{absolute % 60:02d}"


class RulePackResetMetadata(ContractModel):
    schema_id: Literal["phase0.rule-pack-reset.v1"]
    rule_pack_id: Identifier
    rule_pack_version: VersionLabel
    iana_timezone: str = Field(min_length=1, max_length=64)
    tzdb_version: str = Field(min_length=1, max_length=32)
    local_reset_time: LocalTime
    nonexistent_local_time_policy: Literal["NEXT_VALID_INSTANT"]
    ambiguous_local_time_policy: Literal["FIRST_OCCURRENCE_FOLD_0"]
    utc_period_semantics: Literal["HALF_OPEN"]
    uniqueness_scope: Literal["account_id,rule_pack_version,local_period_date"]
    boundaries: list[RiskPeriodBoundary] = Field(min_length=1)

    @model_validator(mode="after")
    def _boundaries_are_derived_from_pinned_tzdb(self) -> RulePackResetMetadata:
        if self.tzdb_version != _TZDB_PACKAGE_VERSION:
            raise ValueError(
                f"tzdb_version must match bundled tzdata package {_TZDB_PACKAGE_VERSION}"
            )
        zone = _load_bundled_zone(self.iana_timezone)
        reset_time = time.fromisoformat(self.local_reset_time)
        dates = [date.fromisoformat(item.local_period_date) for item in self.boundaries]
        if len(dates) != len(set(dates)):
            raise ValueError("risk period local dates must be unique")
        for item, local_date in zip(self.boundaries, dates, strict=True):
            aware_start, instant_start, resolution = _resolve_local_boundary(
                local_date, reset_time, zone
            )
            _, instant_end, _ = _resolve_local_boundary(
                local_date + timedelta(days=1), reset_time, zone
            )
            expected_label = (
                f"{local_date.isoformat()}T{self.local_reset_time} {self.iana_timezone}"
            )
            if item.scheduled_local_label != expected_label:
                raise ValueError("scheduled local label does not match date, reset time, and zone")
            if item.utc_start != _utc_label(instant_start) or item.utc_end != _utc_label(
                instant_end
            ):
                raise ValueError("stored UTC period does not match the pinned tzdb derivation")
            if item.utc_offset != _offset_label(aware_start):
                raise ValueError("stored UTC offset does not match the pinned tzdb derivation")
            if item.resolution != resolution:
                raise ValueError(
                    "stored reset resolution does not match the pinned tzdb derivation"
                )
        for left, right in zip(self.boundaries, self.boundaries[1:], strict=False):
            if date.fromisoformat(right.local_period_date) != date.fromisoformat(
                left.local_period_date
            ) + timedelta(days=1):
                raise ValueError("risk period local dates must be ordered and consecutive")
            if _utc_nanoseconds(left.utc_end) != _utc_nanoseconds(right.utc_start):
                raise ValueError("risk period UTC boundaries must be exactly adjacent")
        return self


class RequirementEvidence(ContractModel):
    requirement: Identifier
    satisfied: bool
    source: str = Field(min_length=1, max_length=500)
    note: str = Field(min_length=1, max_length=1000)


class ProviderCapabilityEvidence(ContractModel):
    """Untrusted evidence claim; only a gate-specific trusted verifier can accept it."""

    schema_id: Literal["phase0.provider-capability.v1"]
    evidence_id: Identifier
    gate_id: GateId
    provider: str = Field(min_length=1, max_length=160)
    capability_version: VersionLabel
    status: EvidenceStatus = Field(
        description=(
            "Documentary claim only. It is never gate authority without safe artifact re-hash "
            "and trusted approval-signature verification."
        )
    )
    observed_at: UtcTimestamp | None
    official_sources: list[str]
    requirements: list[RequirementEvidence]
    details: dict[str, CanonicalDetail]
    artifact_sha256: Sha256 | None

    @field_validator("requirements")
    @classmethod
    def _requirement_names_are_unique(
        cls, value: list[RequirementEvidence]
    ) -> list[RequirementEvidence]:
        names = [item.requirement for item in value]
        if len(names) != len(set(names)):
            raise ValueError("provider requirements must be unique")
        return value

    @field_validator("details")
    @classmethod
    def _details_are_canonical(
        cls, value: dict[str, CanonicalDetail]
    ) -> dict[str, CanonicalDetail]:
        validate_canonical_value(value)
        return value

    @model_validator(mode="after")
    def _verified_evidence_has_proof(self) -> ProviderCapabilityEvidence:
        if self.status is EvidenceStatus.VERIFIED and (
            self.observed_at is None
            or self.artifact_sha256 is None
            or not self.official_sources
            or not self.requirements
            or not all(item.satisfied for item in self.requirements)
        ):
            raise ValueError("VERIFIED evidence requires complete documentary and artifact proof")
        return self


class Phase0EvidenceRegistry(ContractModel):
    schema_id: Literal["phase0.evidence-registry.v1"]
    release_id: Identifier
    evidence: list[ProviderCapabilityEvidence]

    @field_validator("evidence")
    @classmethod
    def _evidence_ids_are_unique(
        cls, value: list[ProviderCapabilityEvidence]
    ) -> list[ProviderCapabilityEvidence]:
        ids = [item.evidence_id for item in value]
        if len(ids) != len(set(ids)):
            raise ValueError("evidence IDs must be unique")
        return value


class GateResult(ContractModel):
    gate_id: GateId
    status: Literal[EvidenceStatus.VERIFIED, EvidenceStatus.BLOCKED]
    evidence_id: Identifier | None
    missing_requirements: list[Identifier]
    reason: str = Field(min_length=1, max_length=1000)


class Phase0GateReport(ContractModel):
    schema_id: Literal["phase0.gate-report.v1"]
    release_id: Identifier
    input_sha256: Sha256
    overall_status: Literal[EvidenceStatus.VERIFIED, EvidenceStatus.BLOCKED]
    gates: list[GateResult]


class ActionGrantProtocol(ContractModel):
    schema_id: Literal["phase0.action-grant-protocol.v1"]
    opaque_token_bits: Literal[256]
    challenge_max_age_seconds: Literal[120]
    grant_expiry_seconds: Literal[60]
    stored_form: Literal["SHA256_HASH_ONLY"]
    single_use: Literal[True]
    required_bindings: list[
        Literal[
            "jti",
            "subject",
            "session",
            "role",
            "challenge_evidence",
            "action",
            "account_id",
            "resource_version",
            "safety_epoch",
            "request_body_digest",
        ]
    ]
    consume_with_command_transaction: Literal[True]
    wildcard_binding_forbidden: Literal[True]

    @field_validator("required_bindings")
    @classmethod
    def _bindings_are_exact(cls, value: list[str]) -> list[str]:
        if len(value) != len(REQUIRED_ACTION_GRANT_BINDINGS) or set(value) != set(
            REQUIRED_ACTION_GRANT_BINDINGS
        ):
            raise ValueError("required bindings must be the exact unique frozen binding set")
        return value


class CapacityEnvelope(ContractModel):
    schema_id: Literal["phase0.capacity-envelope.v1"]
    executor_processes: Literal[4]
    account_slots_per_process: Literal[2]
    global_account_claims: Literal[8]
    claims_per_account: Literal[1]
    executor_database_connections: Literal[12]
    total_pool_provider_limit_percent: Literal[75]
    recovery_reserve_percent: Literal[25]
    per_account_queue_warn: Literal[24]
    global_queue_warn: Literal[192]
    per_account_queue_reject: Literal[32]
    global_queue_reject: Literal[256]
    safety_work_priority: Literal[True]
    entry_fairness: Literal["OLDEST_ELIGIBLE_ROUND_ROBIN"]


class TickObservation(ContractModel):
    schema_id: Literal["phase0.tick-observation.v1"]
    feed_id: Identifier
    account_capability_id: Identifier
    upstream_sequence: int | None = Field(default=None, ge=0, le=9_007_199_254_740_991)
    broker_event_time: UtcTimestamp
    utc_receive_time: UtcTimestamp
    monotonic_receive_ns: int = Field(ge=0, le=9_007_199_254_740_991)
    connection_generation: int = Field(ge=1, le=9_007_199_254_740_991)
    ingest_ordinal: int = Field(ge=0, le=9_007_199_254_740_991)
    bid_ticks: int = Field(ge=1, le=9_007_199_254_740_991)
    ask_ticks: int = Field(ge=1, le=9_007_199_254_740_991)
    clock_offset_ns: int = Field(ge=-9_007_199_254_740_991, le=9_007_199_254_740_991)
    connection_healthy: bool

    @model_validator(mode="after")
    def _spread_is_non_negative(self) -> TickObservation:
        if self.ask_ticks < self.bid_ticks:
            raise ValueError("ask_ticks must be greater than or equal to bid_ticks")
        return self


class TickChunkManifest(ContractModel):
    schema_id: Literal["phase0.tick-chunk-manifest.v1"]
    chunk_id: Identifier
    feed_id: Identifier
    account_capability_id: Identifier
    source_classification: TickSourceClassification
    source_version: VersionLabel
    observation_schema_id: Literal["phase0.tick-observation.v1"]
    row_count: int = Field(ge=1, le=10_000_000)
    first_upstream_sequence: int | None = Field(default=None, ge=0)
    last_upstream_sequence: int | None = Field(default=None, ge=0)
    first_broker_event_time: UtcTimestamp
    last_broker_event_time: UtcTimestamp
    first_utc_receive_time: UtcTimestamp
    last_utc_receive_time: UtcTimestamp
    connection_generation_start: int = Field(ge=1)
    connection_generation_end: int = Field(ge=1)
    clock_offset_min_ns: int
    clock_offset_max_ns: int
    clock_tolerance_ns: int = Field(ge=0, le=9_007_199_254_740_991)
    all_connections_healthy: bool
    ingest_order_verified: bool
    monotonic_receive_order_verified: bool
    utc_receive_order_verified: bool
    clock_tolerance_verified: bool
    fixture_only: bool
    upstream_sequence_contract_verified: bool
    licensing_verified: bool
    reconnect_backfill_verified: bool
    collector_coverage_verified: bool
    clock_sync_verified: bool
    qualification_evidence_id: Identifier | None
    exact_replay_eligible: bool
    payload_sha256: Sha256
    storage_encryption_status: Literal["FIXTURE_ONLY_NOT_CONFIGURED", "VERIFIED_AT_REST"]
    immutable: Literal[True]

    @model_validator(mode="after")
    def _classification_has_sequence_proof(self) -> TickChunkManifest:
        exact_facts = (
            self.first_upstream_sequence is not None,
            self.last_upstream_sequence is not None,
            self.first_upstream_sequence is not None
            and self.last_upstream_sequence is not None
            and self.last_upstream_sequence - self.first_upstream_sequence + 1 == self.row_count,
            self.connection_generation_start == self.connection_generation_end,
            self.all_connections_healthy,
            self.ingest_order_verified,
            self.monotonic_receive_order_verified,
            self.utc_receive_order_verified,
            self.clock_tolerance_verified,
            not self.fixture_only,
            self.upstream_sequence_contract_verified,
            self.licensing_verified,
            self.reconnect_backfill_verified,
            self.collector_coverage_verified,
            self.clock_sync_verified,
            self.qualification_evidence_id is not None,
            self.storage_encryption_status == "VERIFIED_AT_REST",
        )
        derived_eligibility = all(exact_facts)
        if self.exact_replay_eligible != derived_eligibility:
            raise ValueError("exact_replay_eligible must be derived from all qualification facts")
        if (
            self.source_classification is TickSourceClassification.SEQUENCE_COMPLETE
            and not derived_eligibility
        ):
            raise ValueError("SEQUENCE_COMPLETE requires every exact-replay qualification fact")
        return self


_WIRE_IDENTIFIER_PATTERN = re.compile(r"^[\x21-\x5b\x5d-\x7e]+$")
_MAX_OBSERVATIONS_PER_MESSAGE = 1024


def _validate_wire_identifier(value: str) -> str:
    """Reject escaped/control corruption while allowing exchange-qualified tickers."""
    if _WIRE_IDENTIFIER_PATTERN.fullmatch(value) is None:
        raise ValueError(
            "identifier must contain printable non-whitespace ASCII and must not contain backslash"
        )
    return value


def _validate_finite_decimal(value: object) -> Decimal:
    """Convert a JSON number without permitting strings, booleans, NaN, or infinity."""
    if isinstance(value, bool) or not isinstance(value, int | float | Decimal):
        raise ValueError("market value must be a JSON number")
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("market value must be Decimal-compatible") from exc
    if not decimal_value.is_finite():
        raise ValueError("market value must be finite")
    return decimal_value


WireIdentifier = Annotated[
    str,
    Field(min_length=1, max_length=256),
    AfterValidator(_validate_wire_identifier),
]
ObservationEpoch = Annotated[int, Field(ge=0, le=9_007_199_254_740_991)]
FiniteMarketNumber = Annotated[
    Decimal,
    BeforeValidator(_validate_finite_decimal),
    Field(max_digits=38, decimal_places=18, allow_inf_nan=False),
]


class ObservationNaturalKey(ContractModel):
    side: Literal["DEMAND", "SUPPLY"]
    zone_key: WireIdentifier
    liquidity_key: WireIdentifier
    formation_bar_close_epoch: ObservationEpoch


class ObservationZone(ContractModel):
    top: FiniteMarketNumber
    bottom: FiniteMarketNumber
    origin_bar_open_epoch: ObservationEpoch
    origin_bar_close_epoch: ObservationEpoch

    @model_validator(mode="after")
    def _geometry_is_ordered(self) -> ObservationZone:
        if self.top <= self.bottom:
            raise ValueError("zone top must be greater than bottom")
        if self.origin_bar_close_epoch <= self.origin_bar_open_epoch:
            raise ValueError("zone origin close epoch must be after open epoch")
        return self


class ObservationLiquidity(ContractModel):
    price: FiniteMarketNumber
    origin_bar_open_epoch: ObservationEpoch
    origin_bar_close_epoch: ObservationEpoch

    @model_validator(mode="after")
    def _origin_is_ordered(self) -> ObservationLiquidity:
        if self.origin_bar_close_epoch <= self.origin_bar_open_epoch:
            raise ValueError("liquidity origin close epoch must be after open epoch")
        return self


class ObservationSourceCandle(ContractModel):
    open_epoch: ObservationEpoch
    close_epoch: ObservationEpoch
    open: FiniteMarketNumber
    high: FiniteMarketNumber
    low: FiniteMarketNumber
    close: FiniteMarketNumber

    @model_validator(mode="after")
    def _candle_is_ordered(self) -> ObservationSourceCandle:
        if self.close_epoch <= self.open_epoch:
            raise ValueError("source candle close epoch must be after open epoch")
        if self.high < max(self.open, self.close, self.low):
            raise ValueError("source candle high is inconsistent")
        if self.low > min(self.open, self.close, self.high):
            raise ValueError("source candle low is inconsistent")
        return self


class ObservationTransition(ContractModel):
    transition_index: int = Field(ge=0, le=_MAX_OBSERVATIONS_PER_MESSAGE - 1)
    natural_key: ObservationNaturalKey
    from_state: WireIdentifier | None
    to_state: WireIdentifier
    reason_code: WireIdentifier
    zone: ObservationZone
    liquidity: ObservationLiquidity
    source_candle: ObservationSourceCandle

    @model_validator(mode="after")
    def _epochs_are_causal(self) -> ObservationTransition:
        if self.natural_key.formation_bar_close_epoch > self.source_candle.close_epoch:
            raise ValueError("setup formation epoch cannot follow transition source candle")
        if self.zone.origin_bar_close_epoch > self.source_candle.close_epoch:
            raise ValueError("zone origin cannot follow transition source candle")
        if self.liquidity.origin_bar_close_epoch > self.source_candle.close_epoch:
            raise ValueError("liquidity origin cannot follow transition source candle")
        return self


class ObservationActiveSetup(ContractModel):
    natural_key: ObservationNaturalKey
    state: WireIdentifier
    reason_code: WireIdentifier
    zone: ObservationZone
    liquidity: ObservationLiquidity
    source_candle: ObservationSourceCandle

    @model_validator(mode="after")
    def _epochs_are_causal(self) -> ObservationActiveSetup:
        if self.natural_key.formation_bar_close_epoch > self.source_candle.close_epoch:
            raise ValueError("setup formation epoch cannot follow active setup source candle")
        if self.zone.origin_bar_close_epoch > self.source_candle.close_epoch:
            raise ValueError("zone origin cannot follow active setup source candle")
        if self.liquidity.origin_bar_close_epoch > self.source_candle.close_epoch:
            raise ValueError("liquidity origin cannot follow active setup source candle")
        return self


class TradingViewObservationCommon(ContractModel):
    schema_version: Literal["1.0"]
    strategy_id: Literal["rd_liquidity_sd_5m_v1"]
    strategy_version: Literal["1.0.0-phase1"]
    producer_instance_id: WireIdentifier
    sequence: ObservationEpoch
    idempotency_key: WireIdentifier
    symbol: WireIdentifier
    ticker_id: WireIdentifier
    feed: WireIdentifier
    timeframe: Literal["5"]
    timezone: WireIdentifier
    bar_open_epoch: ObservationEpoch
    bar_close_epoch: ObservationEpoch
    detector_code_hash: Sha256
    settings_hash: Sha256

    @model_validator(mode="after")
    def _common_fields_are_consistent(self) -> TradingViewObservationCommon:
        expected_idempotency_key = f"{self.producer_instance_id}:{self.sequence}"
        if self.idempotency_key != expected_idempotency_key:
            raise ValueError("idempotency_key must equal producer_instance_id + ':' + sequence")
        if self.bar_close_epoch <= self.bar_open_epoch:
            raise ValueError("bar_close_epoch must be after bar_open_epoch")
        return self


class TradingViewIncrementalObservation(TradingViewObservationCommon):
    sequence: int = Field(ge=1, le=9_007_199_254_740_991)
    kind: Literal["incremental"]
    chunk_index: Literal[0]
    chunk_count: Literal[1]
    transitions: list[ObservationTransition] = Field(
        min_length=1,
        max_length=_MAX_OBSERVATIONS_PER_MESSAGE,
    )

    @model_validator(mode="after")
    def _transition_set_is_ordered(self) -> TradingViewIncrementalObservation:
        indices = [transition.transition_index for transition in self.transitions]
        if indices != list(range(len(self.transitions))):
            raise ValueError("transition_index values must be contiguous and zero-based")
        if any(
            transition.source_candle.close_epoch > self.bar_close_epoch
            for transition in self.transitions
        ):
            raise ValueError("transition source candle cannot follow observation bar close")
        return self


class TradingViewSnapshotObservation(TradingViewObservationCommon):
    sequence: Literal[0]
    kind: Literal["snapshot"]
    last_confirmed_bar_close_epoch: ObservationEpoch
    active_setups: list[ObservationActiveSetup] = Field(
        max_length=_MAX_OBSERVATIONS_PER_MESSAGE,
    )

    @model_validator(mode="after")
    def _snapshot_epochs_are_ordered(self) -> TradingViewSnapshotObservation:
        if self.last_confirmed_bar_close_epoch > self.bar_close_epoch:
            raise ValueError("last confirmed bar close cannot follow observation bar close")
        if any(
            setup.source_candle.close_epoch > self.last_confirmed_bar_close_epoch
            for setup in self.active_setups
        ):
            raise ValueError("active setup source candle cannot follow last confirmed bar")
        return self


TradingViewObservationPayload = Annotated[
    TradingViewIncrementalObservation | TradingViewSnapshotObservation,
    Field(discriminator="kind"),
]


class TradingViewObservationEnvelope(ContractModel):
    credential: SecretStr = Field(min_length=1, max_length=1024)
    payload: TradingViewObservationPayload


class ObservationReceiptStatus(StrEnum):
    RECEIVED = "RECEIVED"
    DUPLICATE = "DUPLICATE"


class ObservationReceipt(ContractModel):
    receipt_id: WireIdentifier
    received_at: UtcTimestamp
    idempotency_key: WireIdentifier
    payload_sha256: Sha256
    schema_version: Literal["1.0"]
    strategy_id: Literal["rd_liquidity_sd_5m_v1"]
    strategy_version: Literal["1.0.0-phase1"]
    producer_instance_id: WireIdentifier
    sequence: ObservationEpoch
    symbol: WireIdentifier
    ticker_id: WireIdentifier
    feed: WireIdentifier
    timeframe: Literal["5"]
    kind: Literal["incremental", "snapshot"]
    status: ObservationReceiptStatus


class ObservationReceiptList(ContractModel):
    mode: Literal["OBSERVATION_ONLY"]
    ingress_enabled: bool
    items: list[ObservationReceipt] = Field(max_length=200)
    count: int = Field(ge=0, le=200)

    @model_validator(mode="after")
    def _count_matches_items(self) -> ObservationReceiptList:
        if self.count != len(self.items):
            raise ValueError("count must equal the number of returned receipt items")
        return self


SCHEMA_MODELS: dict[str, type[ContractModel]] = {
    "action-grant-protocol-v1": ActionGrantProtocol,
    "approved-alert-manifest-v1": ApprovedAlertManifest,
    "capacity-envelope-v1": CapacityEnvelope,
    "checkpoint-chunk-body-v1": CheckpointChunkBody,
    "checkpoint-chunk-v1": CheckpointChunkMetadata,
    "gap-taint-v1": GapTaintDeclaration,
    "gate-report-v1": Phase0GateReport,
    "heartbeat-v1": HeartbeatMetadata,
    "provider-capability-v1": ProviderCapabilityEvidence,
    "rule-pack-reset-v1": RulePackResetMetadata,
    "rd-strategy-rule-contract-v1": RDStrategyRuleContract,
    "strategy-manifest-v1": StrategyManifest,
    "tick-chunk-manifest-v1": TickChunkManifest,
    "tick-observation-v1": TickObservation,
}
