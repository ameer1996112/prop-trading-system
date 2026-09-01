from pathlib import Path
import re


PINE = Path("scripts/pinescript/SND_RD_5M_V3_RELEASE.pine")


def source() -> str:
    assert PINE.exists(), "released Pine source must be versioned with the prop system"
    return PINE.read_text(encoding="utf-8")


def test_direction_badge_is_separated_from_the_entry_price_marker() -> None:
    pine = source()

    assert '(attempt.core.demand ? "LONG" : "SHORT") + " · PAPER"' in pine
    assert "label.new(bar_index, attempt.core.demand ? low : high" in pine
    assert "yloc = attempt.core.demand ? yloc.belowbar : yloc.abovebar" in pine
    assert (
        "style = attempt.core.demand ? label.style_label_up : label.style_label_down"
        in pine
    )


def test_entry_stop_and_target_remain_distinct_right_edge_price_markers() -> None:
    pine = source()

    assert 'label.new(ladderRightBar, entryPrice, "ENTRY  "' in pine
    assert 'label.new(ladderRightBar, stopPrice, "SL  "' in pine
    assert 'label.new(ladderRightBar, targetPrice, "TP  "' in pine
    assert "line.new(bar_index, entryPrice, ladderRightBar, entryPrice" in pine
    assert "line.new(bar_index, stopPrice, ladderRightBar, stopPrice" in pine
    assert "line.new(bar_index, targetPrice, ladderRightBar, targetPrice" in pine


def test_visual_change_preserves_release_alert_surface() -> None:
    pine = source()

    assert 'const string ENTRY_SCHEMA_VERSION = "3.1"' in pine
    assert 'const string ENTRY_EXECUTION_MODE = "PAPER_ONLY"' in pine
    assert pine.count("alert(") == 3
    assert pine.count("alert(envelope, alert.freq_all)") == 2
    assert pine.count("alert(envelope, alert.freq_once_per_bar_close)") == 1


def test_ingress_credentials_remain_hidden_from_tradingview_display() -> None:
    pine = source()

    for credential in (
        "setupExportCredential",
        "entryV3Credential",
        "executionProposalV1Credential",
    ):
        assert re.search(
            rf"{credential} = input\.string\([^\n]*display = display\.none\)",
            pine,
        ), f"{credential} must not be shown in TradingView's status line or Data Window"
