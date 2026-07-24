from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path

import pytest
from pydantic import ValidationError

from prop_trading.contracts.models import (
    RDStrategyRuleContract,
    RuleAutomation,
    RuleFidelity,
)

CONTRACT_PATH = Path("config/phase0/rd-strategy-rule-contract.json")
EDGE_VALIDATION_PATH = Path("apps/observation-edge/src/validation.ts")


def _payload() -> dict[str, object]:
    loaded: object = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def _rules(contract: RDStrategyRuleContract) -> dict[str, object]:
    return {rule.rule_id: rule for rule in contract.rules}


def test_frozen_rd_strategy_contract_is_paper_only_and_fail_closed() -> None:
    contract = RDStrategyRuleContract.model_validate_json(CONTRACT_PATH.read_bytes())
    rules = _rules(contract)

    assert contract.contract_version == "1.0.0"
    assert contract.producer_strategy_version == "1.2.0-contract1"
    assert contract.automation_policy.paper_only is True
    assert contract.automation_policy.real_execution_allowed is False
    assert contract.automation_policy.first_touch_action == "WAIT"
    assert contract.automation_policy.unknown_rule_action == "SHADOW_ONLY"
    assert contract.automation_policy.executable_entry_models == ["DIR_CLOSE"]
    assert contract.automation_policy.shadow_entry_models == ["HTF_FLIP"]
    assert contract.automation_policy.disabled_entry_models == ["BREAK_CANDLE"]

    assert rules["LIQ_OWN_EXTREME_SAME_LEG"].fidelity is RuleFidelity.EXACT
    assert rules["LIQ_STRICT_OWN_EXTREME_BREAK"].automation is RuleAutomation.EXECUTE
    assert rules["LIQ_DISTANCE_INFLUENCES_ZONE"].automation is RuleAutomation.SHADOW_ONLY
    assert rules["LIQ_ONE_CANDLE_EXCEPTION"].automation is RuleAutomation.SHADOW_ONLY
    assert rules["ZONE_FIRST_ENGAGEMENT"].automation is RuleAutomation.EXECUTE
    assert rules["ENTRY_BREAK_CANDLE_DISABLED"].automation is RuleAutomation.DISABLED
    assert rules["ENTRY_DIR_CLOSE"].automation is RuleAutomation.EXECUTE
    assert rules["ENTRY_HTF_FLIP"].automation is RuleAutomation.SHADOW_ONLY


def test_non_exact_rule_cannot_be_marked_executable() -> None:
    payload = _payload()
    rules = payload["rules"]
    assert isinstance(rules, list)
    distance_rule = next(
        rule
        for rule in rules
        if isinstance(rule, dict) and rule.get("rule_id") == "LIQ_DISTANCE_INFLUENCES_ZONE"
    )
    distance_rule["automation"] = "EXECUTE"

    with pytest.raises(ValidationError, match="EXACT fidelity"):
        RDStrategyRuleContract.model_validate_json(json.dumps(payload))


def test_entry_model_partition_cannot_enable_first_touch_or_break_candle() -> None:
    payload = _payload()
    unsafe_first_touch = deepcopy(payload)
    policy = unsafe_first_touch["automation_policy"]
    assert isinstance(policy, dict)
    policy["first_touch_action"] = "OPEN"
    with pytest.raises(ValidationError):
        RDStrategyRuleContract.model_validate_json(json.dumps(unsafe_first_touch))

    unsafe_break_candle = deepcopy(payload)
    policy = unsafe_break_candle["automation_policy"]
    assert isinstance(policy, dict)
    policy["executable_entry_models"] = ["DIR_CLOSE", "BREAK_CANDLE"]
    with pytest.raises(ValidationError):
        RDStrategyRuleContract.model_validate_json(json.dumps(unsafe_break_candle))


def test_strategy_evidence_must_reference_a_frozen_source() -> None:
    payload = _payload()
    rules = payload["rules"]
    assert isinstance(rules, list)
    first_rule = rules[0]
    assert isinstance(first_rule, dict)
    evidence = first_rule["evidence"]
    assert isinstance(evidence, list)
    first_evidence = evidence[0]
    assert isinstance(first_evidence, dict)
    first_evidence["source_id"] = "unknown-video"

    with pytest.raises(ValidationError, match="unknown source"):
        RDStrategyRuleContract.model_validate_json(json.dumps(payload))


def test_strategy_source_authorities_are_unique_and_chronological() -> None:
    duplicate_authority = _payload()
    duplicate_sources = duplicate_authority["sources"]
    assert isinstance(duplicate_sources, list)
    second_source = duplicate_sources[1]
    assert isinstance(second_source, dict)
    second_source["authority"] = "BASELINE"
    with pytest.raises(ValidationError, match="authorities must be unique"):
        RDStrategyRuleContract.model_validate_json(json.dumps(duplicate_authority))

    invalid_chronology = _payload()
    chronology_sources = invalid_chronology["sources"]
    assert isinstance(chronology_sources, list)
    historical = next(
        source
        for source in chronology_sources
        if isinstance(source, dict) and source.get("authority") == "HISTORICAL_ONLY"
    )
    historical["published_date"] = "2027-01-01"
    with pytest.raises(ValidationError, match="violate authority precedence"):
        RDStrategyRuleContract.model_validate_json(json.dumps(invalid_chronology))


def test_executable_rule_cannot_rely_only_on_historical_evidence() -> None:
    payload = _payload()
    sources = payload["sources"]
    rules = payload["rules"]
    assert isinstance(sources, list)
    assert isinstance(rules, list)
    historical = next(
        source
        for source in sources
        if isinstance(source, dict) and source.get("authority") == "HISTORICAL_ONLY"
    )
    historical_source_id = historical["source_id"]
    executable = next(
        rule for rule in rules if isinstance(rule, dict) and rule.get("automation") == "EXECUTE"
    )
    executable["evidence"] = [{"source_id": historical_source_id, "timestamp_seconds": 1}]

    with pytest.raises(ValidationError, match="only on historical evidence"):
        RDStrategyRuleContract.model_validate_json(json.dumps(payload))


def test_executable_rule_may_retain_historical_context_with_current_evidence() -> None:
    payload = _payload()
    sources = payload["sources"]
    rules = payload["rules"]
    assert isinstance(sources, list)
    assert isinstance(rules, list)
    historical = next(
        source
        for source in sources
        if isinstance(source, dict) and source.get("authority") == "HISTORICAL_ONLY"
    )
    executable = next(
        rule for rule in rules if isinstance(rule, dict) and rule.get("automation") == "EXECUTE"
    )
    evidence = executable["evidence"]
    assert isinstance(evidence, list)
    evidence.append({"source_id": historical["source_id"], "timestamp_seconds": 1})

    contract = RDStrategyRuleContract.model_validate_json(json.dumps(payload))

    assert contract.contract_version == "1.0.0"


def test_edge_rule_evidence_registry_matches_machine_contract() -> None:
    contract = RDStrategyRuleContract.model_validate_json(CONTRACT_PATH.read_bytes())
    expected = {
        rule.rule_id: rule.fidelity.value for rule in contract.rules if rule.open_requirement
    }
    source = EDGE_VALIDATION_PATH.read_text(encoding="utf-8")
    registry = source.split(
        "const OPEN_REQUIREMENT_FIDELITY = new Map<string, string>([", maxsplit=1
    )[1].split("]);", maxsplit=1)[0]
    actual = dict(re.findall(r'\["([^"]+)", "([^"]+)"\]', registry))

    assert actual == expected
