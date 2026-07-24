from __future__ import annotations

import json
from dataclasses import replace
from itertools import product
from pathlib import Path

import pytest

from prop_trading.contracts.models import RDStrategyRuleContract
from prop_trading.domain.rd_entry_gate import (
    COMMON_REQUIRED_RULE_IDS,
    CONTRACT_DISTANCE_PROFILE_SYMBOL_PATTERNS,
    CONTRACT_EXACT_EXECUTABLE_RULE_IDS,
    CONTRACT_OPEN_REQUIREMENT_RULE_IDS,
    CONTRACT_RULE_IDS,
    RD_CONFIRMED_TIMEFRAME_MINUTES,
    RD_PRODUCER_STRATEGY_VERSION,
    RD_RULE_CONTRACT_VERSION,
    EntryGateAction,
    EntryGateRequest,
    EntryModel,
    LiquidityKind,
    RuleDecision,
    RuleFidelity,
    evaluate_rd_entry,
    required_rule_ids,
)

FIXTURE_PATH = Path("tests/fixtures/rd_strategy_entry_cases.json")
CONTRACT_PATH = Path("config/phase0/rd-strategy-rule-contract.json")


def _fixture() -> dict[str, object]:
    loaded: object = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def _cases() -> list[dict[str, object]]:
    cases = _fixture()["cases"]
    assert isinstance(cases, list)
    return [case for case in cases if isinstance(case, dict)]


def _strict_bool(values: dict[str, object], key: str) -> bool:
    value = values[key]
    assert type(value) is bool
    return value


def _strict_int(values: dict[str, object], key: str) -> int:
    value = values[key]
    assert type(value) is int
    return value


def _strict_str(values: dict[str, object], key: str) -> str:
    value = values[key]
    assert type(value) is str
    return value


def _request_for_case(case: dict[str, object]) -> EntryGateRequest:
    fixture = _fixture()
    defaults = fixture["default_request"]
    default_decisions = fixture["default_rule_decisions"]
    assert isinstance(defaults, dict)
    assert isinstance(default_decisions, dict)

    request_overrides = case.get("request_overrides", {})
    assert isinstance(request_overrides, dict)
    request_values = defaults | request_overrides
    decision_values = {
        rule_id: dict(decision)
        for rule_id, decision in default_decisions.items()
        if isinstance(rule_id, str) and isinstance(decision, dict)
    }
    remove_rules = case.get("remove_rules", [])
    assert isinstance(remove_rules, list)
    for rule_id in remove_rules:
        assert isinstance(rule_id, str)
        decision_values.pop(rule_id, None)
    rule_overrides = case.get("rule_overrides", {})
    assert isinstance(rule_overrides, dict)
    for rule_id, override in rule_overrides.items():
        assert isinstance(rule_id, str)
        assert isinstance(override, dict)
        decision_values[rule_id] = dict(override)

    entry_model_value = request_values["entry_model"]
    assert entry_model_value is None or type(entry_model_value) is str
    liquidity_distance_value = request_values["liquidity_distance"]
    assert liquidity_distance_value is None or type(liquidity_distance_value) is str
    liquidity_kind_value = _strict_str(request_values, "liquidity_kind")
    return EntryGateRequest(
        contract_version=_strict_str(request_values, "contract_version"),
        producer_strategy_version=_strict_str(
            request_values,
            "producer_strategy_version",
        ),
        symbol=_strict_str(request_values, "symbol"),
        feed_id=_strict_str(request_values, "feed_id"),
        confirmed_timeframe_minutes=_strict_int(
            request_values,
            "confirmed_timeframe_minutes",
        ),
        distance_profile_id=_strict_str(request_values, "distance_profile_id"),
        distance_observation_id=_strict_str(
            request_values,
            "distance_observation_id",
        ),
        liquidity_distance=liquidity_distance_value,
        zone_engaged=_strict_bool(request_values, "zone_engaged"),
        entry_model=None if entry_model_value is None else EntryModel(str(entry_model_value)),
        directional_close_confirmed=_strict_bool(
            request_values,
            "directional_close_confirmed",
        ),
        liquidity_kind=LiquidityKind(liquidity_kind_value),
        multiple_liquidity_candidates=_strict_bool(
            request_values,
            "multiple_liquidity_candidates",
        ),
        stale_move_detected=_strict_bool(request_values, "stale_move_detected"),
        replacement_liquidity_qualified=_strict_bool(
            request_values,
            "replacement_liquidity_qualified",
        ),
        at_htf_boundary=_strict_bool(request_values, "at_htf_boundary"),
        ambiguous_same_bar_order=_strict_bool(
            request_values,
            "ambiguous_same_bar_order",
        ),
        rule_decisions=tuple(
            RuleDecision(
                rule_id=rule_id,
                passed=_strict_bool(decision, "passed"),
                fidelity=RuleFidelity(_strict_str(decision, "fidelity")),
            )
            for rule_id, decision in sorted(decision_values.items())
        ),
    )


@pytest.mark.parametrize("case", _cases(), ids=lambda case: str(case["case_id"]))
def test_rd_entry_gate_golden_cases(case: dict[str, object]) -> None:
    decision = evaluate_rd_entry(_request_for_case(case))

    assert decision.action is EntryGateAction(str(case["expected_action"]))
    assert decision.reason_code == case["expected_reason"]


def test_rule_gate_versions_and_rule_ids_match_the_frozen_contract() -> None:
    contract = RDStrategyRuleContract.model_validate_json(CONTRACT_PATH.read_bytes())
    contract_rule_ids = {rule.rule_id for rule in contract.rules}
    contract_open_requirements = {rule.rule_id for rule in contract.rules if rule.open_requirement}
    contract_exact_executable = {
        rule.rule_id
        for rule in contract.rules
        if rule.open_requirement
        and rule.fidelity.value == "EXACT"
        and rule.automation.value == "EXECUTE"
    }

    assert contract.contract_version == RD_RULE_CONTRACT_VERSION
    assert contract.producer_strategy_version == RD_PRODUCER_STRATEGY_VERSION
    assert contract.confirmed_timeframe_minutes == RD_CONFIRMED_TIMEFRAME_MINUTES
    assert contract_rule_ids == CONTRACT_RULE_IDS
    assert contract_open_requirements == CONTRACT_OPEN_REQUIREMENT_RULE_IDS
    assert {profile.profile_id for profile in contract.distance_guidance} == set(
        CONTRACT_DISTANCE_PROFILE_SYMBOL_PATTERNS
    )
    assert COMMON_REQUIRED_RULE_IDS.issubset(contract_rule_ids)
    assert contract_exact_executable == CONTRACT_EXACT_EXECUTABLE_RULE_IDS


def test_current_frozen_contract_cannot_authorize_a_paper_open() -> None:
    for case in _cases():
        decision = evaluate_rd_entry(_request_for_case(case))
        assert decision.action is not EntryGateAction.PAPER_OPEN


def test_request_shapes_cover_every_open_requirement_rule() -> None:
    base_request = _request_for_case(_cases()[2])
    covered: set[str] = set()

    for liquidity_kind in LiquidityKind:
        for entry_model in (*EntryModel, None):
            for multiple_candidates, stale_move, at_boundary in product(
                (False, True),
                repeat=3,
            ):
                request = replace(
                    base_request,
                    liquidity_kind=liquidity_kind,
                    entry_model=entry_model,
                    multiple_liquidity_candidates=multiple_candidates,
                    stale_move_detected=stale_move,
                    replacement_liquidity_qualified=stale_move,
                    at_htf_boundary=at_boundary,
                )
                covered.update(required_rule_ids(request))

    assert covered == CONTRACT_OPEN_REQUIREMENT_RULE_IDS


def test_duplicate_rule_decisions_fail_closed() -> None:
    case = _cases()[2]
    request = _request_for_case(case)
    duplicate = request.rule_decisions[0]
    request = replace(
        request,
        rule_decisions=(*request.rule_decisions, duplicate),
    )

    decision = evaluate_rd_entry(request)

    assert decision.action is EntryGateAction.REJECT
    assert decision.reason_code.startswith("REJECT_DUPLICATE_RULE_DECISION:")


def test_all_well_shaped_request_combinations_cannot_paper_open() -> None:
    base_request = _request_for_case(_cases()[2])
    boolean_combinations = product((False, True), repeat=7)

    for (
        zone_engaged,
        directional_close_confirmed,
        multiple_liquidity_candidates,
        stale_move_detected,
        replacement_liquidity_qualified,
        at_htf_boundary,
        ambiguous_same_bar_order,
    ) in boolean_combinations:
        for liquidity_kind in LiquidityKind:
            for entry_model in (*EntryModel, None):
                request = replace(
                    base_request,
                    zone_engaged=zone_engaged,
                    directional_close_confirmed=directional_close_confirmed,
                    multiple_liquidity_candidates=multiple_liquidity_candidates,
                    stale_move_detected=stale_move_detected,
                    replacement_liquidity_qualified=replacement_liquidity_qualified,
                    at_htf_boundary=at_htf_boundary,
                    ambiguous_same_bar_order=ambiguous_same_bar_order,
                    liquidity_kind=liquidity_kind,
                    entry_model=entry_model,
                )

                decision = evaluate_rd_entry(request)

                assert decision.action is not EntryGateAction.PAPER_OPEN


@pytest.mark.parametrize(
    ("field_name", "bad_value"),
    [
        ("contract_version", 1),
        ("producer_strategy_version", 1),
        ("symbol", "gbpjpy"),
        ("feed_id", ""),
        ("confirmed_timeframe_minutes", True),
        ("confirmed_timeframe_minutes", 15),
        ("distance_profile_id", "future-profile"),
        ("distance_observation_id", ""),
        ("liquidity_distance", 8.0),
        ("liquidity_distance", "0.00"),
        ("liquidity_distance", None),
        ("zone_engaged", 1),
        ("entry_model", "DIR_CLOSE"),
        ("directional_close_confirmed", 1),
        ("liquidity_kind", "NORMAL"),
        ("multiple_liquidity_candidates", 0),
        ("stale_move_detected", 0),
        ("replacement_liquidity_qualified", 0),
        ("at_htf_boundary", 0),
        ("ambiguous_same_bar_order", 0),
        ("rule_decisions", []),
    ],
)
def test_malformed_request_fields_reject(
    field_name: str,
    bad_value: object,
) -> None:
    request = replace(
        _request_for_case(_cases()[2]),
        **{field_name: bad_value},  # type: ignore[arg-type]
    )

    decision = evaluate_rd_entry(request)

    assert decision.action is EntryGateAction.REJECT
    assert decision.reason_code.startswith("REJECT_MALFORMED_REQUEST:")


@pytest.mark.parametrize(
    "bad_decision",
    [
        {"rule_id": "TIMEFRAME_FIVE_MINUTE_ONLY", "passed": True, "fidelity": "EXACT"},
        RuleDecision(rule_id="", passed=True, fidelity=RuleFidelity.EXACT),
        RuleDecision(
            rule_id="TIMEFRAME_FIVE_MINUTE_ONLY",
            passed=1,  # type: ignore[arg-type]
            fidelity=RuleFidelity.EXACT,
        ),
        RuleDecision(
            rule_id="TIMEFRAME_FIVE_MINUTE_ONLY",
            passed=True,
            fidelity="EXACT",  # type: ignore[arg-type]
        ),
    ],
)
def test_malformed_rule_decisions_reject(bad_decision: object) -> None:
    request = replace(
        _request_for_case(_cases()[2]),
        rule_decisions=(bad_decision,),  # type: ignore[arg-type]
    )

    decision = evaluate_rd_entry(request)

    assert decision.action is EntryGateAction.REJECT
    assert decision.reason_code.startswith("REJECT_MALFORMED_REQUEST:")


def test_non_request_object_rejects() -> None:
    decision = evaluate_rd_entry({"entry_model": "DIR_CLOSE"})

    assert decision.action is EntryGateAction.REJECT
    assert decision.reason_code == "REJECT_MALFORMED_REQUEST:REQUEST_TYPE"
    assert decision.entry_model is None


def test_unlisted_symbol_requires_unlisted_distance_profile() -> None:
    base_request = _request_for_case(_cases()[2])
    mismatched_request = replace(base_request, symbol="AUDCAD")
    matched_request = replace(
        mismatched_request,
        distance_profile_id="unlisted-symbol-distance",
        liquidity_distance=None,
    )

    mismatch = evaluate_rd_entry(mismatched_request)
    matched = evaluate_rd_entry(matched_request)

    assert mismatch.action is EntryGateAction.SHADOW_ONLY
    assert mismatch.reason_code == "SHADOW_DISTANCE_PROFILE_SYMBOL_MISMATCH"
    assert matched.action is EntryGateAction.SHADOW_ONLY
    assert matched.reason_code.startswith("SHADOW_CONTRACT_RULE_NOT_EXECUTABLE:")
