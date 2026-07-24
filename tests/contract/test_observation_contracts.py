from __future__ import annotations

from copy import deepcopy

import pytest
from pydantic import ValidationError

from prop_trading.contracts.models import (
    TradingViewIncrementalObservation,
    TradingViewObservationEnvelope,
    TradingViewSnapshotObservation,
)


def incremental_payload() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "strategy_id": "rd_liquidity_sd_5m_v1",
        "strategy_version": "1.0.0-phase1",
        "producer_instance_id": "pine-lab-01",
        "sequence": 1,
        "idempotency_key": "pine-lab-01:1",
        "symbol": "XAUUSD",
        "ticker_id": "OANDA:XAUUSD",
        "feed": "OANDA",
        "timeframe": "5",
        "timezone": "Etc/UTC",
        "bar_open_epoch": 1_710_000_000_000,
        "bar_close_epoch": 1_710_000_300_000,
        "detector_code_hash": "a" * 64,
        "settings_hash": "b" * 64,
        "kind": "incremental",
        "chunk_index": 0,
        "chunk_count": 1,
        "transitions": [
            {
                "transition_index": 0,
                "natural_key": {
                    "side": "DEMAND",
                    "zone_key": "demand|1710000000000",
                    "liquidity_key": "swing-low|1709999700000",
                    "formation_bar_close_epoch": 1_710_000_000_000,
                },
                "from_state": None,
                "to_state": "WAITING_FOR_ELIGIBILITY",
                "reason_code": "WAIT_SETUP_ELIGIBILITY",
                "zone": {
                    "top": 2150.25,
                    "bottom": 2149.75,
                    "origin_bar_open_epoch": 1_709_999_700_000,
                    "origin_bar_close_epoch": 1_710_000_000_000,
                },
                "liquidity": {
                    "price": 2149.50,
                    "origin_bar_open_epoch": 1_709_999_700_000,
                    "origin_bar_close_epoch": 1_710_000_000_000,
                },
                "source_candle": {
                    "open_epoch": 1_710_000_000_000,
                    "close_epoch": 1_710_000_300_000,
                    "open": 2150.00,
                    "high": 2151.00,
                    "low": 2149.50,
                    "close": 2150.50,
                },
            }
        ],
    }


def snapshot_payload() -> dict[str, object]:
    transition = deepcopy(incremental_payload()["transitions"][0])
    assert isinstance(transition, dict)
    transition.pop("transition_index")
    transition.pop("from_state")
    transition["state"] = transition.pop("to_state")
    payload = incremental_payload()
    payload.update(
        {
            "sequence": 0,
            "idempotency_key": "pine-lab-01:0",
            "kind": "snapshot",
            "last_confirmed_bar_close_epoch": 1_710_000_300_000,
            "active_setups": [transition],
        }
    )
    payload.pop("chunk_index")
    payload.pop("chunk_count")
    payload.pop("transitions")
    return payload


def test_exact_incremental_and_snapshot_shapes_validate() -> None:
    incremental = TradingViewIncrementalObservation.model_validate(incremental_payload())
    snapshot = TradingViewSnapshotObservation.model_validate(snapshot_payload())

    assert incremental.kind == "incremental"
    assert incremental.transitions[0].zone.top > incremental.transitions[0].zone.bottom
    assert snapshot.kind == "snapshot"
    assert snapshot.sequence == 0


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("producer_instance_id", "pine\\escape"),
        ("symbol", "XAU\nUSD"),
        ("ticker_id", "OANDA:\\XAUUSD"),
        ("feed", "OANDA\tDEMO"),
    ],
)
def test_wire_identifiers_reject_control_and_backslash_corruption(
    field: str,
    value: str,
) -> None:
    payload = incremental_payload()
    payload[field] = value
    if field == "producer_instance_id":
        payload["idempotency_key"] = f"{value}:1"

    with pytest.raises(ValidationError, match="identifier"):
        TradingViewIncrementalObservation.model_validate(payload)


def test_schema_hashes_and_derived_idempotency_are_exact() -> None:
    payload = incremental_payload()
    payload["schema_version"] = "1.1"
    with pytest.raises(ValidationError):
        TradingViewIncrementalObservation.model_validate(payload)

    payload = incremental_payload()
    payload["detector_code_hash"] = "A" * 64
    with pytest.raises(ValidationError):
        TradingViewIncrementalObservation.model_validate(payload)

    payload = incremental_payload()
    payload["idempotency_key"] = "chosen-by-client"
    with pytest.raises(ValidationError, match="producer_instance_id"):
        TradingViewIncrementalObservation.model_validate(payload)


def test_incremental_requires_single_chunk_and_contiguous_nonempty_transitions() -> None:
    payload = incremental_payload()
    payload["transitions"] = []
    with pytest.raises(ValidationError):
        TradingViewIncrementalObservation.model_validate(payload)

    payload = incremental_payload()
    transitions = deepcopy(payload["transitions"])
    assert isinstance(transitions, list)
    assert isinstance(transitions[0], dict)
    transitions[0]["transition_index"] = 1
    payload["transitions"] = transitions
    with pytest.raises(ValidationError, match="contiguous"):
        TradingViewIncrementalObservation.model_validate(payload)

    payload = incremental_payload()
    payload["chunk_count"] = 2
    with pytest.raises(ValidationError):
        TradingViewIncrementalObservation.model_validate(payload)


def test_epoch_geometry_ohlc_and_finite_number_invariants_are_enforced() -> None:
    payload = incremental_payload()
    payload["bar_close_epoch"] = payload["bar_open_epoch"]
    with pytest.raises(ValidationError, match="bar_close_epoch"):
        TradingViewIncrementalObservation.model_validate(payload)

    payload = incremental_payload()
    transitions = deepcopy(payload["transitions"])
    assert isinstance(transitions, list)
    assert isinstance(transitions[0], dict)
    zone = transitions[0]["zone"]
    assert isinstance(zone, dict)
    zone["top"] = zone["bottom"]
    payload["transitions"] = transitions
    with pytest.raises(ValidationError, match="zone top"):
        TradingViewIncrementalObservation.model_validate(payload)

    payload = incremental_payload()
    transitions = deepcopy(payload["transitions"])
    assert isinstance(transitions, list)
    assert isinstance(transitions[0], dict)
    candle = transitions[0]["source_candle"]
    assert isinstance(candle, dict)
    candle["high"] = 2140
    payload["transitions"] = transitions
    with pytest.raises(ValidationError, match="candle high"):
        TradingViewIncrementalObservation.model_validate(payload)

    payload = incremental_payload()
    transitions = deepcopy(payload["transitions"])
    assert isinstance(transitions, list)
    assert isinstance(transitions[0], dict)
    zone = transitions[0]["zone"]
    assert isinstance(zone, dict)
    zone["top"] = float("inf")
    payload["transitions"] = transitions
    with pytest.raises(ValidationError, match="finite"):
        TradingViewIncrementalObservation.model_validate(payload)


def test_snapshot_is_sequence_zero_and_allows_an_empty_active_set() -> None:
    payload = snapshot_payload()
    payload["sequence"] = 1
    payload["idempotency_key"] = "pine-lab-01:1"
    with pytest.raises(ValidationError):
        TradingViewSnapshotObservation.model_validate(payload)

    payload = snapshot_payload()
    payload["active_setups"] = []
    parsed = TradingViewSnapshotObservation.model_validate(payload)
    assert parsed.active_setups == []


def test_envelope_is_discriminated_and_secret_repr_is_redacted() -> None:
    envelope = TradingViewObservationEnvelope.model_validate(
        {"credential": "lab-secret", "payload": incremental_payload()}
    )
    assert isinstance(envelope.payload, TradingViewIncrementalObservation)
    assert "lab-secret" not in repr(envelope)

    invalid = incremental_payload()
    invalid["kind"] = "order"
    with pytest.raises(ValidationError):
        TradingViewObservationEnvelope.model_validate(
            {"credential": "lab-secret", "payload": invalid}
        )
