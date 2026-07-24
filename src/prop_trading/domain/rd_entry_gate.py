"""Deterministic fail-closed gate for RD five-minute paper entry decisions."""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

RD_RULE_CONTRACT_VERSION = "1.0.0"
RD_PRODUCER_STRATEGY_VERSION = "1.2.0-contract1"
RD_CONFIRMED_TIMEFRAME_MINUTES = 5

_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SYMBOL_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9._:-]{0,63}$")
_DISTANCE_PATTERN = re.compile(r"^(?:0|[1-9][0-9]{0,11})\.[0-9]{1,8}$")


class RuleFidelity(StrEnum):
    EXACT = "EXACT"
    CALIBRATED = "CALIBRATED"
    DISCRETIONARY = "DISCRETIONARY"
    UNRESOLVED = "UNRESOLVED"


class EntryModel(StrEnum):
    DIR_CLOSE = "DIR_CLOSE"
    HTF_FLIP = "HTF_FLIP"
    BREAK_CANDLE = "BREAK_CANDLE"


class LiquidityKind(StrEnum):
    NORMAL = "NORMAL"
    ONE_CANDLE = "ONE_CANDLE"
    INTERNAL = "INTERNAL"


class EntryGateAction(StrEnum):
    PAPER_OPEN = "PAPER_OPEN"
    WAIT = "WAIT"
    SHADOW_ONLY = "SHADOW_ONLY"
    REJECT = "REJECT"


@dataclass(frozen=True, slots=True)
class RuleDecision:
    rule_id: str
    passed: bool
    fidelity: RuleFidelity


@dataclass(frozen=True, slots=True)
class EntryGateRequest:
    contract_version: str
    producer_strategy_version: str
    symbol: str
    feed_id: str
    confirmed_timeframe_minutes: int
    distance_profile_id: str
    distance_observation_id: str
    liquidity_distance: str | None
    zone_engaged: bool
    entry_model: EntryModel | None
    directional_close_confirmed: bool
    liquidity_kind: LiquidityKind
    multiple_liquidity_candidates: bool
    stale_move_detected: bool
    replacement_liquidity_qualified: bool
    at_htf_boundary: bool
    ambiguous_same_bar_order: bool
    rule_decisions: tuple[RuleDecision, ...]


@dataclass(frozen=True, slots=True)
class EntryGateDecision:
    action: EntryGateAction
    reason_code: str
    entry_model: EntryModel | None


COMMON_REQUIRED_RULE_IDS = frozenset(
    {
        "TIMEFRAME_FIVE_MINUTE_ONLY",
        "ZONE_ORIGIN_OPPOSITE_CANDLE",
        "ZONE_ACCURACY_BOUNDS",
        "ZONE_FRESH_UNTAPPED",
        "ZONE_FIRST_ENGAGEMENT",
        "ZONE_PRE_ENTRY_CLOSE_OUTSIDE",
        "LIQ_OWN_EXTREME_SAME_LEG",
        "LIQ_STRICT_OWN_EXTREME_BREAK",
        "LIQ_ACTUAL_EXTREME_SWEPT",
        "LIQ_EVENT_ORDER",
        "LIQ_DISTANCE_INFLUENCES_ZONE",
        "MANAGEMENT_STOP_TRIGGER_CANDLE",
        "MANAGEMENT_TP_BE_TABLE",
        "RISK_SESSION_PROFILE",
    }
)

CONTRACT_OPEN_REQUIREMENT_RULE_IDS = frozenset(
    {
        "TIMEFRAME_FIVE_MINUTE_ONLY",
        "ZONE_ORIGIN_OPPOSITE_CANDLE",
        "ZONE_ACCURACY_BOUNDS",
        "ZONE_FRESH_UNTAPPED",
        "ZONE_FIRST_ENGAGEMENT",
        "ZONE_PRE_ENTRY_CLOSE_OUTSIDE",
        "LIQ_NORMAL_TWO_OPPOSITE_CANDLES",
        "LIQ_ONE_CANDLE_EXCEPTION",
        "LIQ_OWN_EXTREME_SAME_LEG",
        "LIQ_STRICT_OWN_EXTREME_BREAK",
        "LIQ_ACTUAL_EXTREME_SWEPT",
        "LIQ_EVENT_ORDER",
        "LIQ_INTERNAL_REBREAK",
        "LIQ_DISTANCE_INFLUENCES_ZONE",
        "LIQ_REPLACEMENT_AFTER_STALE_MOVE",
        "LIQ_MULTIPLE_CANDIDATE_ARBITRATION",
        "ENTRY_DIR_CLOSE",
        "ENTRY_HTF_FLIP",
        "ENTRY_HTF_BOUNDARY_CAUTION",
        "MANAGEMENT_STOP_TRIGGER_CANDLE",
        "MANAGEMENT_TP_BE_TABLE",
        "RISK_SESSION_PROFILE",
    }
)

CONTRACT_NON_OPEN_RULE_IDS = frozenset(
    {
        "ZONE_POST_ENTRY_NO_RETROACTIVE_INVALIDATION",
        "ENTRY_BREAK_CANDLE_DISABLED",
        "RISK_SCHEDULED_HIGH_IMPACT_NEWS",
    }
)

CONTRACT_RULE_IDS = CONTRACT_OPEN_REQUIREMENT_RULE_IDS | CONTRACT_NON_OPEN_RULE_IDS

CONTRACT_EXACT_EXECUTABLE_RULE_IDS = frozenset(
    {
        "TIMEFRAME_FIVE_MINUTE_ONLY",
        "ZONE_ORIGIN_OPPOSITE_CANDLE",
        "ZONE_FRESH_UNTAPPED",
        "ZONE_FIRST_ENGAGEMENT",
        "ZONE_PRE_ENTRY_CLOSE_OUTSIDE",
        "LIQ_NORMAL_TWO_OPPOSITE_CANDLES",
        "LIQ_OWN_EXTREME_SAME_LEG",
        "LIQ_STRICT_OWN_EXTREME_BREAK",
        "LIQ_ACTUAL_EXTREME_SWEPT",
        "LIQ_EVENT_ORDER",
        "ENTRY_DIR_CLOSE",
    }
)

CONTRACT_DISTANCE_PROFILE_SYMBOL_PATTERNS: dict[str, tuple[str, ...]] = {
    "gbpjpy-5m-guidance": ("GBPJPY",),
    "eurusd-5m-guidance": ("EURUSD",),
    "usdjpy-5m-example-guidance": ("USDJPY",),
    "gold-index-visual-distance": ("XAU", "GOLD", "NAS100", "US100", "USTEC"),
    "unlisted-symbol-distance": (),
}

NUMERIC_DISTANCE_PROFILE_IDS = frozenset(
    {
        "gbpjpy-5m-guidance",
        "eurusd-5m-guidance",
        "usdjpy-5m-example-guidance",
    }
)


def _response_entry_model(request: object) -> EntryModel | None:
    if type(request) is EntryGateRequest and type(request.entry_model) is EntryModel:
        return request.entry_model
    return None


def _request_shape_error(request: object) -> str | None:
    if type(request) is not EntryGateRequest:
        return "REQUEST_TYPE"

    string_fields = {
        "contract_version": request.contract_version,
        "producer_strategy_version": request.producer_strategy_version,
        "feed_id": request.feed_id,
        "distance_observation_id": request.distance_observation_id,
    }
    for field_name, string_value in string_fields.items():
        if type(string_value) is not str or not _IDENTIFIER_PATTERN.fullmatch(string_value):
            return field_name.upper()

    if type(request.symbol) is not str or not _SYMBOL_PATTERN.fullmatch(request.symbol):
        return "SYMBOL"
    if (
        type(request.confirmed_timeframe_minutes) is not int
        or request.confirmed_timeframe_minutes != RD_CONFIRMED_TIMEFRAME_MINUTES
    ):
        return "CONFIRMED_TIMEFRAME_MINUTES"
    if (
        type(request.distance_profile_id) is not str
        or request.distance_profile_id not in CONTRACT_DISTANCE_PROFILE_SYMBOL_PATTERNS
    ):
        return "DISTANCE_PROFILE_ID"
    if request.liquidity_distance is not None and (
        type(request.liquidity_distance) is not str
        or not _DISTANCE_PATTERN.fullmatch(request.liquidity_distance)
        or Decimal(request.liquidity_distance) <= 0
    ):
        return "LIQUIDITY_DISTANCE"
    if (
        request.distance_profile_id in NUMERIC_DISTANCE_PROFILE_IDS
        and request.liquidity_distance is None
    ):
        return "LIQUIDITY_DISTANCE"
    if request.entry_model is not None and type(request.entry_model) is not EntryModel:
        return "ENTRY_MODEL"
    if type(request.liquidity_kind) is not LiquidityKind:
        return "LIQUIDITY_KIND"

    boolean_fields = {
        "zone_engaged": request.zone_engaged,
        "directional_close_confirmed": request.directional_close_confirmed,
        "multiple_liquidity_candidates": request.multiple_liquidity_candidates,
        "stale_move_detected": request.stale_move_detected,
        "replacement_liquidity_qualified": request.replacement_liquidity_qualified,
        "at_htf_boundary": request.at_htf_boundary,
        "ambiguous_same_bar_order": request.ambiguous_same_bar_order,
    }
    for field_name, boolean_value in boolean_fields.items():
        if type(boolean_value) is not bool:
            return field_name.upper()

    if type(request.rule_decisions) is not tuple or len(request.rule_decisions) > 128:
        return "RULE_DECISIONS"
    for decision in request.rule_decisions:
        if type(decision) is not RuleDecision:
            return "RULE_DECISION_TYPE"
        if type(decision.rule_id) is not str or not _IDENTIFIER_PATTERN.fullmatch(decision.rule_id):
            return "RULE_DECISION_RULE_ID"
        if type(decision.passed) is not bool:
            return "RULE_DECISION_PASSED"
        if type(decision.fidelity) is not RuleFidelity:
            return "RULE_DECISION_FIDELITY"
    return None


def _distance_profile_matches_symbol(*, profile_id: str, symbol: str) -> bool:
    selected_patterns = CONTRACT_DISTANCE_PROFILE_SYMBOL_PATTERNS[profile_id]
    listed_patterns = {
        pattern
        for candidate_profile_id, patterns in CONTRACT_DISTANCE_PROFILE_SYMBOL_PATTERNS.items()
        if candidate_profile_id != "unlisted-symbol-distance"
        for pattern in patterns
    }
    if profile_id == "unlisted-symbol-distance":
        return not any(pattern in symbol for pattern in listed_patterns)
    return any(pattern in symbol for pattern in selected_patterns)


def required_rule_ids(request: EntryGateRequest) -> frozenset[str]:
    """Return the closed rule set required by this setup shape."""
    required = set(COMMON_REQUIRED_RULE_IDS)
    if request.liquidity_kind is LiquidityKind.ONE_CANDLE:
        required.add("LIQ_ONE_CANDLE_EXCEPTION")
    else:
        required.add("LIQ_NORMAL_TWO_OPPOSITE_CANDLES")
    if request.liquidity_kind is LiquidityKind.INTERNAL:
        required.add("LIQ_INTERNAL_REBREAK")
    if request.multiple_liquidity_candidates:
        required.add("LIQ_MULTIPLE_CANDIDATE_ARBITRATION")
    if request.stale_move_detected:
        required.add("LIQ_REPLACEMENT_AFTER_STALE_MOVE")
    if request.at_htf_boundary:
        required.add("ENTRY_HTF_BOUNDARY_CAUTION")
    if request.entry_model is EntryModel.DIR_CLOSE:
        required.add("ENTRY_DIR_CLOSE")
    elif request.entry_model is EntryModel.HTF_FLIP:
        required.add("ENTRY_HTF_FLIP")
    return frozenset(required)


def evaluate_rd_entry(request: object) -> EntryGateDecision:
    """Evaluate one paper-entry candidate without performing I/O or execution."""
    response_entry_model = _response_entry_model(request)
    shape_error = _request_shape_error(request)
    if shape_error is not None:
        return EntryGateDecision(
            EntryGateAction.REJECT,
            f"REJECT_MALFORMED_REQUEST:{shape_error}",
            response_entry_model,
        )

    assert type(request) is EntryGateRequest
    if (
        request.contract_version != RD_RULE_CONTRACT_VERSION
        or request.producer_strategy_version != RD_PRODUCER_STRATEGY_VERSION
    ):
        return EntryGateDecision(
            EntryGateAction.REJECT,
            "REJECT_CONTRACT_VERSION_MISMATCH",
            request.entry_model,
        )

    if request.replacement_liquidity_qualified and not request.stale_move_detected:
        return EntryGateDecision(
            EntryGateAction.REJECT,
            "REJECT_REPLACEMENT_WITHOUT_STALE_MOVE",
            request.entry_model,
        )
    if request.stale_move_detected and not request.replacement_liquidity_qualified:
        return EntryGateDecision(
            EntryGateAction.REJECT,
            "REJECT_STALE_MOVE_WITHOUT_QUALIFIED_REPLACEMENT",
            request.entry_model,
        )

    decisions: dict[str, RuleDecision] = {}
    for decision in request.rule_decisions:
        if decision.rule_id in decisions:
            return EntryGateDecision(
                EntryGateAction.REJECT,
                f"REJECT_DUPLICATE_RULE_DECISION:{decision.rule_id}",
                request.entry_model,
            )
        decisions[decision.rule_id] = decision

    required = required_rule_ids(request)
    failed = sorted(
        rule_id for rule_id in required if rule_id in decisions and not decisions[rule_id].passed
    )
    if failed:
        return EntryGateDecision(
            EntryGateAction.REJECT,
            f"REJECT_RULE_FAILED:{failed[0]}",
            request.entry_model,
        )

    unknown = sorted(set(decisions).difference(CONTRACT_RULE_IDS))
    if unknown:
        return EntryGateDecision(
            EntryGateAction.SHADOW_ONLY,
            f"SHADOW_UNKNOWN_RULE_DECISION:{unknown[0]}",
            request.entry_model,
        )

    if request.ambiguous_same_bar_order:
        return EntryGateDecision(
            EntryGateAction.SHADOW_ONLY,
            "SHADOW_AMBIGUOUS_SAME_BAR_ORDER",
            request.entry_model,
        )

    if not _distance_profile_matches_symbol(
        profile_id=request.distance_profile_id,
        symbol=request.symbol,
    ):
        return EntryGateDecision(
            EntryGateAction.SHADOW_ONLY,
            "SHADOW_DISTANCE_PROFILE_SYMBOL_MISMATCH",
            request.entry_model,
        )

    if not request.zone_engaged:
        return EntryGateDecision(
            EntryGateAction.WAIT,
            "WAIT_ZONE_ENGAGEMENT",
            request.entry_model,
        )

    if request.entry_model is None:
        return EntryGateDecision(
            EntryGateAction.WAIT,
            "WAIT_ENTRY_CONFIRMATION",
            None,
        )

    if request.entry_model is EntryModel.DIR_CLOSE and not request.directional_close_confirmed:
        return EntryGateDecision(
            EntryGateAction.WAIT,
            "WAIT_DIRECTIONAL_CLOSE",
            request.entry_model,
        )

    if request.entry_model is EntryModel.BREAK_CANDLE:
        return EntryGateDecision(
            EntryGateAction.REJECT,
            "REJECT_BREAK_CANDLE_DISABLED",
            request.entry_model,
        )

    missing = sorted(required.difference(decisions))
    if missing:
        return EntryGateDecision(
            EntryGateAction.SHADOW_ONLY,
            f"SHADOW_MISSING_RULE_DECISION:{missing[0]}",
            request.entry_model,
        )

    non_exact = sorted(
        rule_id for rule_id in required if decisions[rule_id].fidelity is not RuleFidelity.EXACT
    )
    if non_exact:
        return EntryGateDecision(
            EntryGateAction.SHADOW_ONLY,
            f"SHADOW_NON_EXACT_RULE:{non_exact[0]}",
            request.entry_model,
        )

    if request.entry_model is EntryModel.HTF_FLIP:
        return EntryGateDecision(
            EntryGateAction.SHADOW_ONLY,
            "SHADOW_HTF_REPLAY_REQUIRED",
            request.entry_model,
        )

    contract_blocked = sorted(required.difference(CONTRACT_EXACT_EXECUTABLE_RULE_IDS))
    if contract_blocked:
        return EntryGateDecision(
            EntryGateAction.SHADOW_ONLY,
            f"SHADOW_CONTRACT_RULE_NOT_EXECUTABLE:{contract_blocked[0]}",
            request.entry_model,
        )

    return EntryGateDecision(
        EntryGateAction.PAPER_OPEN,
        "PAPER_OPEN_EXACT_DIR_CLOSE",
        request.entry_model,
    )
