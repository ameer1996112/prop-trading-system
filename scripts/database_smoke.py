"""Real PostgreSQL proof for the narrow exact-byte evidence-ledger append boundary."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from collections.abc import Sequence
from pathlib import Path
from urllib.parse import quote_plus

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from prop_trading.adapters.database import EvidenceLedgerRepository, create_database_engine
from prop_trading.contracts.models import ProviderCapabilityEvidence
from prop_trading.domain.canonical import canonical_json_bytes


async def _must_reject(
    engine_url: str,
    statement: str,
    parameters: dict[str, object] | None = None,
    *,
    expected_message: str | None = None,
) -> None:
    engine = create_database_engine(engine_url)
    try:
        try:
            async with engine.begin() as connection:
                await connection.execute(text("SET ROLE phase0_runtime"))
                await connection.execute(text(statement), parameters or {})
        except SQLAlchemyError as exc:
            if expected_message is not None and expected_message not in str(exc):
                raise AssertionError(
                    f"rejection did not contain {expected_message!r}: {exc}"
                ) from exc
            return
        raise AssertionError(f"phase0_runtime unexpectedly executed: {statement}")
    finally:
        await engine.dispose()


async def _owner_trigger_must_reject(engine_url: str, statement: str) -> None:
    engine = create_database_engine(engine_url)
    try:
        try:
            async with engine.begin() as connection:
                await connection.execute(text(statement))
        except SQLAlchemyError as exc:
            if "append-only" not in str(exc):
                raise AssertionError(
                    "owner mutation failed for a reason other than the trigger"
                ) from exc
            return
        raise AssertionError(f"owner bypassed append-only trigger: {statement}")
    finally:
        await engine.dispose()


async def _assert_runtime_privileges(engine_url: str) -> None:
    engine = create_database_engine(engine_url)
    try:
        async with engine.connect() as connection:
            privileges = (
                (
                    await connection.execute(
                        text(
                            """
                        SELECT
                          has_table_privilege(
                            'phase0_runtime', 'public.phase0_evidence_records', 'SELECT'
                          ) AS can_select,
                          has_table_privilege(
                            'phase0_runtime', 'public.phase0_evidence_records', 'INSERT'
                          ) AS can_insert,
                          has_function_privilege(
                            'phase0_runtime',
                            'public.phase0_append_evidence(text,text,text,text)',
                            'EXECUTE'
                          ) AS can_append,
                          has_schema_privilege(
                            'phase0_runtime', 'public', 'CREATE'
                          ) AS can_create,
                          NOT EXISTS (
                            SELECT 1
                            FROM pg_auth_members membership
                            JOIN pg_roles member_role ON member_role.oid = membership.member
                            WHERE member_role.rolname = 'phase0_runtime'
                          ) AS has_no_memberships,
                          (
                            SELECT NOT (
                              rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR
                              rolinherit OR rolreplication OR rolbypassrls
                            )
                            FROM pg_roles WHERE rolname = 'phase0_runtime'
                          ) AS has_safe_attributes
                        """
                        )
                    )
                )
                .mappings()
                .one()
            )
        expected = {
            "can_select": True,
            "can_insert": False,
            "can_append": True,
            "can_create": False,
            "has_no_memberships": True,
            "has_safe_attributes": True,
        }
        if dict(privileges) != expected:
            raise AssertionError(f"unexpected phase0_runtime privileges: {dict(privileges)}")
    finally:
        await engine.dispose()


async def _run(args: argparse.Namespace) -> None:
    password = args.password_file.read_text(encoding="utf-8").strip()
    if not password:
        raise ValueError("smoke password file is empty")
    engine_url = f"postgresql+asyncpg://phase0:{quote_plus(password)}@127.0.0.1:{args.port}/phase0"
    registry = json.loads(args.evidence.read_text(encoding="utf-8"))
    evidence = ProviderCapabilityEvidence.model_validate_json(
        json.dumps(registry["evidence"][0], ensure_ascii=False)
    )
    canonical_bytes = canonical_json_bytes(evidence.model_dump(mode="json"))
    canonical_text = canonical_bytes.decode("utf-8")
    expected_sha = hashlib.sha256(canonical_bytes).hexdigest()

    await _assert_runtime_privileges(engine_url)

    await _must_reject(
        engine_url,
        """
        INSERT INTO public.phase0_evidence_records (
          evidence_id, gate_id, canonical_payload_text, canonical_sha256, source_note, recorded_at
        ) VALUES (
          'forged', 'optimizer_1_inputs', '{}', :forged_hash, 'forged',
          '2000-01-01T00:00:00Z'
        )
        """,
        {"forged_hash": "0" * 64},
    )
    await _must_reject(
        engine_url,
        """
        INSERT INTO public.phase0_evidence_records (
          evidence_id, gate_id, canonical_payload_text, source_note
        ) VALUES (
          'direct-runtime-insert', 'optimizer_1_inputs', '{}', 'must lack INSERT'
        )
        """,
    )
    await _must_reject(
        engine_url,
        """
        INSERT INTO public.phase0_evidence_records (
          evidence_id, gate_id, canonical_payload_text, source_note, recorded_at
        ) VALUES (
          'forged-runtime-time', 'optimizer_1_inputs', '{}', 'must lack INSERT',
          '2000-01-01T00:00:00Z'
        )
        """,
    )

    missing_schema = evidence.model_dump(mode="json")
    missing_schema_id = evidence.evidence_id + "-missing-schema"
    missing_schema["evidence_id"] = missing_schema_id
    del missing_schema["schema_id"]
    missing_schema_text = canonical_json_bytes(missing_schema).decode("utf-8")
    await _must_reject(
        engine_url,
        "SELECT * FROM public.phase0_append_evidence(:id, :gate, :payload, :note)",
        {
            "id": missing_schema_id,
            "gate": evidence.gate_id.value,
            "payload": missing_schema_text,
            "note": "must reject absent schema identifier",
        },
        expected_message="schema_id",
    )

    noncanonical = evidence.model_dump(mode="json")
    noncanonical_id = evidence.evidence_id + "-noncanonical"
    noncanonical["evidence_id"] = noncanonical_id
    noncanonical_text = canonical_json_bytes(noncanonical).decode("utf-8") + " "
    await _must_reject(
        engine_url,
        "SELECT * FROM public.phase0_append_evidence(:id, :gate, :payload, :note)",
        {
            "id": noncanonical_id,
            "gate": evidence.gate_id.value,
            "payload": noncanonical_text,
            "note": "must reject noncanonical bytes",
        },
        expected_message="exact canonical JSON",
    )

    engine = create_database_engine(engine_url)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("SET ROLE phase0_runtime"))
            result = await EvidenceLedgerRepository().append(
                connection, evidence, source_note="container exact-byte integration proof"
            )
        if result.canonical_payload_text != canonical_text:
            raise AssertionError("ledger did not preserve authoritative canonical UTF-8 text")
        if result.canonical_sha256 != expected_sha:
            raise AssertionError("PostgreSQL-generated SHA-256 differs from exact submitted bytes")
        if result.payload != evidence.model_dump(mode="json"):
            raise AssertionError("derived JSON projection differs from typed evidence")
        if result.recorded_at.tzinfo is None:
            raise AssertionError("recorded_at is not a database-controlled timezone-aware instant")
    finally:
        await engine.dispose()

    await _must_reject(
        engine_url,
        "SELECT * FROM public.phase0_append_evidence(:id, :gate, :payload, :note)",
        {
            "id": "forged-envelope-id",
            "gate": evidence.gate_id.value,
            "payload": canonical_text,
            "note": "must fail envelope binding",
        },
        expected_message="evidence envelope identifier",
    )

    gate_mismatch = evidence.model_dump(mode="json")
    gate_mismatch_id = evidence.evidence_id + "-gate-mismatch"
    gate_mismatch["evidence_id"] = gate_mismatch_id
    gate_mismatch_text = canonical_json_bytes(gate_mismatch).decode("utf-8")
    await _must_reject(
        engine_url,
        "SELECT * FROM public.phase0_append_evidence(:id, :gate, :payload, :note)",
        {
            "id": gate_mismatch_id,
            "gate": "tradingview_alert_configuration",
            "payload": gate_mismatch_text,
            "note": "must fail gate envelope binding",
        },
        expected_message="gate envelope identifier",
    )
    await _must_reject(
        engine_url,
        "UPDATE public.phase0_evidence_records SET source_note = 'mutated'",
    )
    await _must_reject(engine_url, "DELETE FROM public.phase0_evidence_records")
    await _must_reject(engine_url, "TRUNCATE public.phase0_evidence_records")
    await _owner_trigger_must_reject(
        engine_url, "UPDATE public.phase0_evidence_records SET source_note = 'owner mutation'"
    )
    await _owner_trigger_must_reject(engine_url, "DELETE FROM public.phase0_evidence_records")
    await _owner_trigger_must_reject(engine_url, "TRUNCATE public.phase0_evidence_records")
    print(
        "database smoke: runtime privilege set is SELECT+append without INSERT; direct forged "
        "hash/timestamp writes rejected; typed append exact "
        f"sha256={expected_sha}; schema/envelope mismatch and UPDATE/DELETE/TRUNCATE rejected"
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--password-file", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args(argv)
    asyncio.run(_run(args))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
