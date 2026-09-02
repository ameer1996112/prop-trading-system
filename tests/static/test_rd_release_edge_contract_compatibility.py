"""Guard the canonical 3.1 Pine envelope against the strict edge wire contract."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PINE = ROOT / "scripts/pinescript/SND_RD_5M_V3_RELEASE.pine"
EDGE_WIRE = ROOT / "apps/observation-edge/src/rd-entry-wire-v3.ts"


def pine_function_body(name: str) -> str:
    lines = PINE.read_text(encoding="utf-8").splitlines()
    signature = f"{name}("
    start = next(index for index, line in enumerate(lines) if line.startswith(signature))
    body: list[str] = [lines[start]]
    for line in lines[start + 1 :]:
        if line and not line.startswith(" "):
            break
        body.append(line)
    return "\n".join(body)


def edge_string_list(name: str) -> set[str]:
    source = EDGE_WIRE.read_text(encoding="utf-8")
    match = re.search(
        rf"const {re.escape(name)} = \[(.*?)\] as const;",
        source,
        flags=re.DOTALL,
    )
    assert match is not None, f"edge wire contract list missing: {name}"
    return set(re.findall(r'"([A-Za-z0-9_]+)"', match.group(1))) | set().union(
        *(
            edge_string_list(dependency)
            for dependency in re.findall(r"\.\.\.([A-Z0-9_]+)", match.group(1))
        )
    )


def pine_json_keys(body: str) -> set[str]:
    return set(re.findall(r'\\"([a-z0-9_]+)\\":', body))


def object_fragment(body: str, key: str, next_key: str) -> str:
    start = body.index(f'\\"{key}\\":{{')
    end = body.index(f'\\"{next_key}\\":', start)
    return body[start:end]


def test_release_declares_the_canonical_31_paper_only_identity() -> None:
    source = PINE.read_text(encoding="utf-8")

    assert 'const string ENTRY_SCHEMA_VERSION = "3.1"' in source
    assert 'const string ENTRY_STRATEGY_ID = "rd_liquidity_sd_5m_v1"' in source
    assert 'const string ENTRY_STRATEGY_VERSION = "3.1.0-contract3"' in source
    assert 'const string ENTRY_RULE_CONTRACT_VERSION = "3.1.0"' in source
    assert 'const string ENTRY_EXECUTION_MODE = "PAPER_ONLY"' in source
    assert "enableOneCandleLiquidity = input.bool(false" in source


def test_release_serializers_exactly_match_edge_strict_object_keys() -> None:
    serializer_contracts = {
        "entryPayload": "TOP_LEVEL_KEYS",
        "entryCandidatePayload": "CANDIDATE_KEYS",
        "entryEvidencePayload": "EVIDENCE_KEYS",
        "entrySelectionPayload": "SELECTION_KEYS",
        "entryMarketEventPayload": "MARKET_EVENT_KEYS",
    }
    for serializer, edge_list in serializer_contracts.items():
        assert pine_json_keys(pine_function_body(serializer)) == edge_string_list(edge_list)

    setup_bundle = pine_function_body("entrySetupBundlePayload")
    assert all(f'\\"{key}\\":' in setup_bundle for key in edge_string_list("SETUP_BUNDLE_KEYS"))
    assert pine_json_keys(object_fragment(setup_bundle, "setup", "candidates")) - {
        "setup"
    } == edge_string_list("SETUP_KEYS_V31")
    trade_plan = setup_bundle.split('\\"trade_plan\\":{', maxsplit=1)[1]
    assert pine_json_keys(trade_plan) == edge_string_list("TRADE_PLAN_KEYS")
    assert pine_json_keys(pine_function_body("orderedCandlePayload")) == edge_string_list(
        "CANDLE_KEYS"
    )
    assert pine_json_keys(
        PINE.read_text(encoding="utf-8")
        .split("string exitEvent =", maxsplit=1)[1]
        .split("attempt.core.stopEventEmitted", maxsplit=1)[0]
    ) == edge_string_list("EXIT_EVENT_KEYS")


def test_release_emits_every_edge_required_common_rule_id() -> None:
    source = PINE.read_text(encoding="utf-8")
    edge_rules = edge_string_list("REQUIRED_COMMON_RULE_IDS_V3")
    pine_rules = set(re.findall(r'\\"rule_id\\":\\"([A-Z0-9_]+)\\"', source))

    assert pine_rules == edge_rules
