"""Local SQLite equivalence and VM-work checks; never connects to deployed D1."""

from __future__ import annotations

import json
import random
import re
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
EDGE = ROOT / "apps/observation-edge"

# Frozen pre-optimization ranking semantics, including ingest-order tie breaks.
LEGACY_DECISIONS_SQL = """
WITH ranked_selections AS (
  SELECT stored_selection.*, stored_selection.rowid AS ingest_ordinal,
    ROW_NUMBER() OVER (
      PARTITION BY stored_selection.setup_id, stored_selection.attempt_kind
      ORDER BY stored_selection.evaluated_at_epoch DESC, stored_selection.rowid DESC
    ) AS attempt_revision_rank
  FROM observation_entry_v3_selections AS stored_selection
)
SELECT
  selection.selection_id, selection.logical_selection_id, selection.event_id,
  selection.setup_id, selection.attempt_kind, selection.policy_action,
  selection.action, selection.effective_action_reason, selection.liquidity_cohort,
  selection.one_candle_enabled, selection.canonical_candidate_id,
  selection.canonical_evidence_id, selection.co_triggered_models_json,
  selection.evaluated_at_epoch, selection.selected_trigger_epoch,
  selection.selected_trigger_sequence, selection.entry_ticks, selection.stop_ticks,
  selection.target_ticks, selection.selection_json, event.symbol, event.tick_size
FROM ranked_selections AS selection
JOIN observation_entry_v3_events AS event ON event.event_id = selection.event_id
WHERE selection.attempt_revision_rank = 1
ORDER BY selection.evaluated_at_epoch DESC, selection.ingest_ordinal DESC
LIMIT ?
"""


def query(filename: str, name: str) -> str:
    source = (EDGE / "src" / filename).read_text(encoding="utf-8")
    match = re.search(rf"export const {name} = `([^`]+)`;", source)
    assert match is not None, name
    return match[1]


def migrated_database() -> sqlite3.Connection:
    database = sqlite3.connect(":memory:")
    database.execute("PRAGMA foreign_keys = ON")
    for migration in sorted((EDGE / "migrations").glob("[0-9][0-9][0-9][0-9]_*.sql")):
        database.executescript(migration.read_text(encoding="utf-8"))
    return database


def seed_decisions(database: sqlite3.Connection, count: int, shape: str) -> None:
    database.execute(
        """
      INSERT INTO observation_receipts (
        receipt_id, received_at, idempotency_key, payload_sha256,
        schema_version, strategy_id, strategy_version, producer_instance_id,
        sequence, symbol, ticker_id, feed, timeframe, kind
      ) VALUES ('fixture', '2026-09-02T00:00:00Z', 'fixture', ?, '3.1',
        'rd_liquidity_sd_5m_v1', '3.1.0-contract3', 'fixture', 1,
        'EURUSD', 'OANDA:EURUSD', 'OANDA', '5', 'incremental')
    """,
        ("a" * 64,),
    )
    database.execute(
        """
      INSERT INTO observation_entry_v3_events (
        event_id, receipt_id, producer_instance_id, producer_sequence,
        strategy_version, rule_contract_version, event_role, is_realtime,
        symbol, tick_size, detector_code_hash, settings_hash,
        validated_payload_json, payload_sha256, observed_at_epoch, recorded_at
      ) VALUES ('fixture', 'fixture', 'fixture', 1, '3.1.0-contract3', '3.1.0',
        'ENTRY_DECISION', 1, 'EURUSD', '0.00001', ?, ?, '{}', ?, 1,
        '2026-09-02T00:00:00Z')
    """,
        ("b" * 64, "c" * 64, "a" * 64),
    )
    rng = random.Random(173)
    for ordinal in range(count):
        epoch = 1 if shape == "all-equal" else rng.randrange(8) if shape == "ties" else ordinal
        setup = 0 if shape == "single" else ordinal % 100
        attempt = "RE_ENTRY" if (ordinal // 100) % 2 else "INITIAL"
        # Lexical selection IDs intentionally run opposite to ingest order.
        identifier = f"selection-{count - ordinal:08d}"
        database.execute(
            """
          INSERT INTO observation_entry_v3_selections (
            selection_id, logical_selection_id, event_id, setup_id, attempt_kind,
            policy_version, revision, reason, policy_action, action,
            co_triggered_models_json, evaluated_at_epoch, entry_ticks,
            stop_ticks, target_ticks, selection_json
          ) VALUES (?, ?, 'fixture', ?, ?, 'rd-entry-arbitration-v3', ?,
            'NO_CANDIDATE', 'NONE', 'NONE', '[]', ?, 100, 90, 120, '{}')
        """,
            (identifier, identifier, f"setup-{setup}", attempt, ordinal, epoch),
        )
    database.commit()


def measured_query(
    database: sqlite3.Connection,
    sql: str,
    parameters: tuple[object, ...],
) -> tuple[list[tuple[object, ...]], int]:
    steps = 0

    def progress() -> int:
        nonlocal steps
        steps += 100
        return 0

    database.set_progress_handler(progress, 100)
    try:
        rows = database.execute(sql, parameters).fetchall()
    finally:
        database.set_progress_handler(None, 0)
    return rows, steps


@pytest.mark.parametrize("shape", ["diverse", "ties", "single", "all-equal"])
def test_latest_decisions_preserve_revision_order_and_attempt_identity(shape: str) -> None:
    sql = query("rd-entry-queries-v3.ts", "LIST_ENTRY_V3_DECISIONS_SQL")
    with closing(migrated_database()) as database:
        seed_decisions(database, 2_000, shape)
        for limit in [0, 1, 20, 200]:
            assert (
                database.execute(sql, (limit,)).fetchall()
                == database.execute(
                    LEGACY_DECISIONS_SQL,
                    (limit,),
                ).fetchall()
            )
        assert database.execute("PRAGMA foreign_key_check").fetchall() == []


@pytest.mark.parametrize("count", [200, 2_000, 20_000])
@pytest.mark.parametrize("shape", ["diverse", "ties", "single", "all-equal"])
def test_latest_decisions_avoid_ranking_all_history(count: int, shape: str) -> None:
    sql = query("rd-entry-queries-v3.ts", "LIST_ENTRY_V3_DECISIONS_SQL")
    with closing(migrated_database()) as database:
        seed_decisions(database, count, shape)
        old_rows, old_steps = measured_query(database, LEGACY_DECISIONS_SQL, (20,))
        new_rows, new_steps = measured_query(database, sql, (20,))
        assert new_rows == old_rows
        print(
            f"decision shape={shape} rows={count}: "
            f"legacy_vm_steps={old_steps}, new_vm_steps={new_steps}"
        )
        assert new_steps < old_steps // 2
        plan = "\n".join(row[3] for row in database.execute(f"EXPLAIN QUERY PLAN {sql}", (20,)))
        assert "SEARCH" in plan
        assert "idx_observation_entry_v3_selections_attempt_order" in plan


def test_configured_readiness_matches_legacy_rows() -> None:
    old_sql = query("paper-readiness-queries.ts", "SELECT_PAPER_ACCOUNT_READINESS_METRIC_SQL")
    new_sql = query(
        "paper-readiness-queries.ts", "LIST_CONFIGURED_PAPER_ACCOUNT_READINESS_METRICS_SQL"
    )
    with closing(migrated_database()) as database:
        for index, balance in enumerate([5_000_000, 0, 10_000_000, 250_000]):
            account = f"paper-{index}"
            database.execute(
                """
              INSERT INTO paper_accounts VALUES (
                ?, 'PAPER_ONLY', ?, 'USD', 2, ?, ?, ?, '2026-09-02T00:00:00Z'
              )
            """,
                (account, account, balance, f"paper-account:{account}", "a" * 64),
            )
        requested = ["paper-2", "paper-missing", "paper-0", "paper-1"]
        expected = sorted(
            row for account in requested for row in database.execute(old_sql, (account,))
        )
        assert database.execute(new_sql, (json.dumps(requested),)).fetchall() == expected
        assert database.execute(new_sql, ("[]",)).fetchall() == []


def seed_readiness_history(database: sqlite3.Connection, count: int) -> list[str]:
    accounts = [f"history-{index}" for index in range(4)]
    for account in accounts:
        database.execute(
            """
          INSERT INTO paper_accounts VALUES (
            ?, 'PAPER_ONLY', ?, 'USD', 2, 5000000, ?, ?, '2026-09-02T00:00:00Z'
          )
        """,
            (account, account, f"paper-account:{account}", "a" * 64),
        )
    database.execute(
        """
      INSERT INTO paper_kill_switch_events (
        event_id, idempotency_key, payload_sha256, enabled, reason, changed_at
      ) VALUES ('fixture-off', 'fixture-off', ?, 0, 'TEST', '2026-09-02T00:00:00Z')
    """,
        ("b" * 64,),
    )
    today, yesterday = database.execute("SELECT date('now'), date('now', '-1 day')").fetchone()
    timestamps = [
        f"{today}T01:00:00Z",
        f"{yesterday}T23:59:59Z",
        f"{today}T00:00:00Z",
        f"{today}T03:00:00+03:00",
    ]
    for index in range(count + 1):
        intent = f"history-intent-{index}"
        database.execute(
            """
          INSERT INTO paper_trade_intents (
            intent_id, idempotency_key, payload_sha256, symbol, side,
            entry_price, stop_loss, take_profit, risk_bps, created_at
          ) VALUES (
            ?, ?, ?, 'EURUSD', 'BUY', '1.1', '1.0', '1.3', 1, ?
          )
        """,
            (intent, f"paper-intent:{intent}", "c" * 64, timestamps[0]),
        )
        # Shared allocations, unequal coverage and one still-open intent.
        for offset, account in enumerate(accounts):
            if index % 3 == offset:
                continue
            database.execute(
                """
              INSERT INTO paper_trade_allocations (
                allocation_id, intent_id, account_id, risk_amount_minor,
                balance_before_minor, created_at
              ) VALUES (?, ?, ?, ?, 5000000, ?)
            """,
                (f"{intent}-{account}", intent, account, 101 + offset, timestamps[0]),
            )
        if index != count:
            database.execute(
                """
              INSERT INTO paper_trade_settlements (
                settlement_id, intent_id, idempotency_key, payload_sha256,
                outcome_r_millis, exit_reason, settled_at
              ) VALUES (?, ?, ?, ?, ?, 'MANUAL', ?)
            """,
                (
                    f"settlement-{index}",
                    intent,
                    f"paper-settlement:{intent}",
                    "d" * 64,
                    [-1000, 1250, -500, 250][index % 4],
                    timestamps[index % 4],
                ),
            )
    for index, account in enumerate(accounts):
        database.execute(
            """
          INSERT INTO paper_ledger_entries VALUES (?, ?, 1, ?, ?, 'MANUAL_ADJUSTMENT', ?, ?)
        """,
            (
                f"manual-{index}",
                account,
                f"paper-ledger:{account}:1",
                "e" * 64,
                -6_000_000 if index == 0 else 123,
                timestamps[0],
            ),
        )
    database.commit()
    return accounts


@pytest.mark.parametrize("count", [20, 200, 1_000])
def test_readiness_history_computed_once_with_identical_results(count: int) -> None:
    old_sql = query("paper-readiness-queries.ts", "SELECT_PAPER_ACCOUNT_READINESS_METRIC_SQL")
    new_sql = query(
        "paper-readiness-queries.ts", "LIST_CONFIGURED_PAPER_ACCOUNT_READINESS_METRICS_SQL"
    )
    with closing(migrated_database()) as database:
        accounts = seed_readiness_history(database, count)
        old_rows: list[tuple[object, ...]] = []
        old_steps = 0
        for account in accounts:
            rows, steps = measured_query(database, old_sql, (account,))
            old_rows.extend(rows)
            old_steps += steps
        new_rows, new_steps = measured_query(database, new_sql, (json.dumps(accounts),))
        assert new_rows == old_rows
        assert new_rows[0][3] < 0  # Manual adjustment still affects balance.
        assert any(row[5] > 0 for row in new_rows)  # Still-open allocated risk.
        assert any(row[7] > 0 for row in new_rows)  # Historical drawdown retained.
        print(
            f"readiness settlements={count}: legacy_vm_steps={old_steps}, new_vm_steps={new_steps}"
        )
        assert new_steps < old_steps // 2
        assert database.execute("PRAGMA foreign_key_check").fetchall() == []
