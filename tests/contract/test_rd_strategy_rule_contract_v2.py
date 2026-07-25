import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from prop_trading.contracts.rd_strategy_v2 import RDStrategyRuleContractV2

CONTRACT = Path("config/phase0/rd-strategy-rule-contract-v2.json")
OFFICIAL_CHANNEL = "UC54xbL96tU58iez3YbTVTAg"
PROHIBITED_VIDEOS = {"LCydpj3CaHo", "rO5els-o3Oo"}


def payload() -> dict[str, object]:
    loaded: object = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def test_v2_policy_is_closed_and_paper_only() -> None:
    contract = RDStrategyRuleContractV2.model_validate_json(CONTRACT.read_bytes())
    assert contract.contract_version == "2.0.0"
    assert contract.producer_strategy_version == "2.0.0-contract2"
    assert contract.base_contract_sha256 == (
        "289cbf0bd1a59f3e3ca3ec12450f27bb326d210ec1e2444e17e7f90d10f17e28"
    )
    assert contract.automation_policy.paper_only is True
    assert contract.automation_policy.real_execution_allowed is False
    assert contract.automation_policy.active_entry_models == (
        "DIR_CLOSE",
        "HTF_FLIP",
    )
    assert contract.automation_policy.legacy_entry_models == (
        "LEGACY_BREAK_CANDLE",
        "LEGACY_REJECTION_RESPECT",
    )
    assert contract.automation_policy.htf_context_minutes == (15, 30, 60)
    assert (
        contract.automation_policy.arbitration_policy_version
        == "rd-entry-arbitration-v2"
    )


def test_v2_sources_are_official_and_exclude_third_parties() -> None:
    contract = RDStrategyRuleContractV2.model_validate_json(CONTRACT.read_bytes())
    assert all(source.channel_id == OFFICIAL_CHANNEL for source in contract.sources_by_id.values())
    assert all(source.channel_handle == "@RD_Forex" for source in contract.sources_by_id.values())
    assert PROHIBITED_VIDEOS.isdisjoint(
        source.youtube_video_id for source in contract.sources_by_id.values()
    )


def test_narrowing_must_target_an_older_known_claim() -> None:
    value = payload()
    claims = value["claims_by_id"]
    assert isinstance(claims, dict)
    claim = claims["break-normalized-to-flip-2026-06"]
    assert isinstance(claim, dict)
    claim["target_claim_id"] = "missing-claim"
    with pytest.raises(ValidationError, match="target"):
        RDStrategyRuleContractV2.model_validate(value)
