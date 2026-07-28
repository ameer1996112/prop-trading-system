import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from prop_trading.contracts.rd_strategy_v3 import (
    RDStrategyRuleContractV3,
    load_rd_strategy_contract_v3,
)

CONTRACT_PATH = Path("config/phase0/rd-strategy-rule-contract-v3.json")


def test_v3_contract_restores_boc_as_a_distinct_active_model() -> None:
    contract = load_rd_strategy_contract_v3()

    assert contract.contract_version == "3.0.0"
    assert contract.producer_strategy_version == "3.0.0-contract3"
    assert contract.automation_policy.active_entry_models == (
        "BOC",
        "DIR_CLOSE",
        "HTF_FLIP",
    )
    assert contract.automation_policy.arbitration_policy_version == "rd-entry-arbitration-v3"
    assert contract.rules_by_id["ENTRY_BOC_HTF_TIMED"].automation == "PAPER_EVALUATE"
    assert contract.rules_by_id["ENTRY_BOC_DISCRETIONARY_5M"].automation == "SHADOW_ONLY"
    assert {
        claim_id: (
            contract.sources_by_id[claim.source_id].youtube_video_id,
            claim.timestamp_start_seconds,
            claim.timestamp_end_seconds,
        )
        for claim_id, claim in contract.claims_by_id.items()
        if claim_id
        in {
            "discretionary-break-2025-11",
            "reject-non-htf-break-2026-05",
            "htf-timed-boc-2026-06",
        }
    } == {
        "discretionary-break-2025-11": ("UqYlKtPjKvY", 144, 229),
        "reject-non-htf-break-2026-05": ("lo_7HDQK9WM", 4388, 4395),
        "htf-timed-boc-2026-06": ("zglv2r9xXnE", 679, 694),
    }
    assert "break-normalized-to-flip-2026-06" not in contract.claims_by_id
    assert contract.rules_by_id["ENTRY_BOC_HTF_TIMED"].source_claim_ids == (
        "discretionary-break-2025-11",
        "reject-non-htf-break-2026-05",
        "htf-timed-boc-2026-06",
    )


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("automation_policy", "real_execution_allowed"), True),
        (("automation_policy", "active_entry_models"), ["DIR_CLOSE", "HTF_FLIP"]),
        (
            ("rules_by_id", "ENTRY_BOC_DISCRETIONARY_5M", "automation"),
            "PAPER_EVALUATE",
        ),
        (("rules_by_id", "ENTRY_BOC_HTF_TIMED", "automation"), "SHADOW_ONLY"),
    ],
)
def test_v3_contract_rejects_unsafe_mutations(
    path: tuple[str, ...],
    value: object,
) -> None:
    payload = json.loads(CONTRACT_PATH.read_text())
    target = payload
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value

    with pytest.raises(ValidationError):
        RDStrategyRuleContractV3.model_validate_json(json.dumps(payload))


def test_v3_contract_rejects_a_non_paper_policy_for_an_active_model() -> None:
    payload = json.loads(CONTRACT_PATH.read_text())
    htf_timed_boc = payload["rules_by_id"]["ENTRY_BOC_HTF_TIMED"]
    htf_timed_boc["automation"] = "SHADOW_ONLY"
    htf_timed_boc["proof_eligibility"] = "NOT_ELIGIBLE"

    with pytest.raises(ValidationError, match="v3 rule evidence policy"):
        RDStrategyRuleContractV3.model_validate_json(json.dumps(payload))
