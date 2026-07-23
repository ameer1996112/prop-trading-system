from __future__ import annotations

import asyncio
import hashlib
import threading
from pathlib import Path

import pytest

from prop_trading.adapters.tick_store import (
    ImmutableTickChunkWriter,
    TickSourceQualification,
)
from prop_trading.contracts.models import (
    TickChunkManifest,
    TickObservation,
    TickSourceClassification,
)


def _qualification(**changes: object) -> TickSourceQualification:
    values: dict[str, object] = {
        "fixture_only": True,
        "upstream_sequence_contract_verified": True,
        "licensing_verified": False,
        "reconnect_backfill_verified": False,
        "collector_coverage_verified": False,
        "clock_sync_verified": False,
        "clock_tolerance_ns": 100,
        "qualification_evidence_id": None,
        "storage_encryption_status": "FIXTURE_ONLY_NOT_CONFIGURED",
    }
    values.update(changes)
    return TickSourceQualification(**values)  # type: ignore[arg-type]


def _tick(
    sequence: int | None,
    ordinal: int,
    *,
    healthy: bool = True,
    feed_id: str = "fixture-eurusd",
    capability_id: str = "fixture-account-capability",
    receive_second: int | None = None,
    monotonic_ns: int | None = None,
    clock_offset_ns: int = 10,
) -> TickObservation:
    second = ordinal if receive_second is None else receive_second
    return TickObservation(
        schema_id="phase0.tick-observation.v1",
        feed_id=feed_id,
        account_capability_id=capability_id,
        upstream_sequence=sequence,
        broker_event_time=f"2026-07-22T00:00:{second:02d}Z",
        utc_receive_time=f"2026-07-22T00:00:{second:02d}Z",
        monotonic_receive_ns=1000 + ordinal if monotonic_ns is None else monotonic_ns,
        connection_generation=1,
        ingest_ordinal=ordinal,
        bid_ticks=108000 + ordinal,
        ask_ticks=108002 + ordinal,
        clock_offset_ns=clock_offset_ns,
        connection_healthy=healthy,
    )


@pytest.mark.asyncio
async def test_tick_chunk_is_atomic_append_only_checksum_bound_and_fixture_capped(
    tmp_path: Path,
) -> None:
    writer = ImmutableTickChunkWriter(tmp_path, _qualification())
    manifest = await writer.persist(
        chunk_id="fixture-chunk-a",
        source_version="1.0.0",
        observations=[_tick(100, 0), _tick(101, 1)],
    )
    published = tmp_path / "fixture-chunk-a"
    payload = (published / "observations.jsonl").read_bytes()
    stored_manifest = TickChunkManifest.model_validate_json(
        (published / "manifest.json").read_bytes()
    )
    assert manifest == stored_manifest
    assert manifest.feed_id == "fixture-eurusd"
    assert manifest.account_capability_id == "fixture-account-capability"
    assert manifest.source_classification is TickSourceClassification.CONTINUOUS_OBSERVED
    assert manifest.exact_replay_eligible is False
    assert manifest.payload_sha256 == hashlib.sha256(payload).hexdigest()
    with pytest.raises(FileExistsError):
        await writer.persist(
            chunk_id="fixture-chunk-a",
            source_version="1.0.0",
            observations=[_tick(100, 0)],
        )


@pytest.mark.asyncio
async def test_only_all_qualified_non_fixture_facts_can_be_sequence_complete(
    tmp_path: Path,
) -> None:
    writer = ImmutableTickChunkWriter(
        tmp_path,
        _qualification(
            fixture_only=False,
            licensing_verified=True,
            reconnect_backfill_verified=True,
            collector_coverage_verified=True,
            clock_sync_verified=True,
            qualification_evidence_id="capability-proof-a",
            storage_encryption_status="VERIFIED_AT_REST",
        ),
    )
    manifest = await writer.persist(
        chunk_id="qualified-synthetic-test",
        source_version="1.0.0",
        observations=[_tick(10, 0), _tick(11, 1)],
    )
    assert manifest.source_classification is TickSourceClassification.SEQUENCE_COMPLETE
    assert manifest.exact_replay_eligible is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "qualification_change",
    [
        {"licensing_verified": False},
        {"reconnect_backfill_verified": False},
        {"collector_coverage_verified": False},
        {"clock_sync_verified": False},
        {"fixture_only": True},
    ],
)
async def test_missing_promotion_fact_caps_classification(
    tmp_path: Path, qualification_change: dict[str, object]
) -> None:
    qualification = {
        "fixture_only": False,
        "licensing_verified": True,
        "reconnect_backfill_verified": True,
        "collector_coverage_verified": True,
        "clock_sync_verified": True,
        "qualification_evidence_id": "capability-proof-a",
        "storage_encryption_status": "VERIFIED_AT_REST",
    }
    qualification.update(qualification_change)
    writer = ImmutableTickChunkWriter(tmp_path, _qualification(**qualification))
    manifest = await writer.persist(
        chunk_id="capped-facts",
        source_version="1.0.0",
        observations=[_tick(10, 0), _tick(11, 1)],
    )
    assert manifest.source_classification is TickSourceClassification.CONTINUOUS_OBSERVED
    assert manifest.exact_replay_eligible is False


@pytest.mark.asyncio
async def test_mixed_feed_or_account_is_rejected_before_publication(tmp_path: Path) -> None:
    writer = ImmutableTickChunkWriter(tmp_path, _qualification())
    with pytest.raises(ValueError, match="exactly one feed"):
        await writer.persist(
            chunk_id="mixed-feed",
            source_version="1.0.0",
            observations=[_tick(1, 0), _tick(2, 1, feed_id="other-feed")],
        )
    with pytest.raises(ValueError, match="exactly one feed"):
        await writer.persist(
            chunk_id="mixed-account",
            source_version="1.0.0",
            observations=[_tick(1, 0), _tick(2, 1, capability_id="other-capability")],
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "observations",
    [
        [_tick(10, 1), _tick(11, 0)],
        [_tick(10, 0, monotonic_ns=1001), _tick(11, 1, monotonic_ns=1000)],
        [_tick(10, 0, receive_second=2), _tick(11, 1, receive_second=1)],
        [_tick(10, 0), _tick(11, 1, clock_offset_ns=101)],
        [_tick(10, 0), _tick(12, 1)],
    ],
)
async def test_bad_order_clock_or_sequence_is_incomplete(
    tmp_path: Path, observations: list[TickObservation]
) -> None:
    writer = ImmutableTickChunkWriter(tmp_path, _qualification())
    manifest = await writer.persist(
        chunk_id=f"invalid-{observations[0].ingest_ordinal}-{observations[1].upstream_sequence}",
        source_version="1.0.0",
        observations=observations,
    )
    assert manifest.source_classification is TickSourceClassification.INCOMPLETE
    assert manifest.exact_replay_eligible is False


@pytest.mark.asyncio
@pytest.mark.parametrize("chunk_id", ["../escape", "..", "/absolute", "a/b", "a\\b"])
async def test_chunk_id_cannot_escape_root(tmp_path: Path, chunk_id: str) -> None:
    writer = ImmutableTickChunkWriter(tmp_path, _qualification())
    with pytest.raises(ValueError, match="file-safe"):
        await writer.persist(
            chunk_id=chunk_id,
            source_version="1.0.0",
            observations=[_tick(1, 0)],
        )
    assert not (tmp_path.parent / "escape").exists()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure_phase", ["PAYLOAD_DURABLE", "STAGE_DURABLE"])
async def test_crash_orphan_is_recovered_or_quarantined_then_retry_publishes(
    tmp_path: Path, failure_phase: str
) -> None:
    def fail(phase: str) -> None:
        if phase == failure_phase:
            raise RuntimeError("simulated crash")

    first = ImmutableTickChunkWriter(tmp_path, _qualification(), publication_hook=fail)
    observations = [_tick(10, 0), _tick(11, 1)]
    with pytest.raises(RuntimeError, match="simulated crash"):
        await first.persist(
            chunk_id="retry-safe",
            source_version="1.0.0",
            observations=observations,
        )
    assert not (tmp_path / "retry-safe").exists()

    second = ImmutableTickChunkWriter(tmp_path, _qualification())
    manifest = await second.persist(
        chunk_id="retry-safe", source_version="1.0.0", observations=observations
    )
    assert (tmp_path / "retry-safe" / "manifest.json").is_file()
    assert manifest.exact_replay_eligible is False
    quarantined = list((tmp_path / ".quarantine").glob("retry-safe-orphan-*"))
    assert len(quarantined) == (1 if failure_phase == "PAYLOAD_DURABLE" else 0)


@pytest.mark.asyncio
async def test_concurrent_different_writers_publish_exactly_one_coherent_pair(
    tmp_path: Path,
) -> None:
    payload_durable = threading.Event()
    release_first = threading.Event()

    def hold_first(phase: str) -> None:
        if phase == "PAYLOAD_DURABLE":
            payload_durable.set()
            if not release_first.wait(timeout=5):
                raise TimeoutError("test did not release first publisher")

    first = ImmutableTickChunkWriter(tmp_path, _qualification(), publication_hook=hold_first)
    second = ImmutableTickChunkWriter(tmp_path, _qualification())
    first_task = asyncio.create_task(
        first.persist(
            chunk_id="concurrent-one-winner",
            source_version="1.0.0",
            observations=[_tick(10, 0), _tick(11, 1)],
        )
    )
    assert await asyncio.to_thread(payload_durable.wait, 2)
    second_task = asyncio.create_task(
        second.persist(
            chunk_id="concurrent-one-winner",
            source_version="1.0.0",
            observations=[_tick(20, 0), _tick(21, 1)],
        )
    )
    await asyncio.sleep(0.05)
    assert not second_task.done()
    release_first.set()
    results = await asyncio.gather(first_task, second_task, return_exceptions=True)
    successes = [item for item in results if isinstance(item, TickChunkManifest)]
    failures = [item for item in results if isinstance(item, BaseException)]
    assert len(successes) == 1
    assert len(failures) == 1
    assert isinstance(failures[0], FileExistsError)

    published = tmp_path / "concurrent-one-winner"
    payload = (published / "observations.jsonl").read_bytes()
    stored = TickChunkManifest.model_validate_json((published / "manifest.json").read_bytes())
    assert stored == successes[0]
    assert stored.payload_sha256 == hashlib.sha256(payload).hexdigest()
    assert stored.first_upstream_sequence == 10
    assert not list((tmp_path / ".quarantine").glob("concurrent-one-winner-*"))


@pytest.mark.asyncio
async def test_repeated_identical_partial_crashes_do_not_block_recovery(tmp_path: Path) -> None:
    def fail_after_payload(phase: str) -> None:
        if phase == "PAYLOAD_DURABLE":
            raise RuntimeError("repeatable crash")

    observations = [_tick(10, 0), _tick(11, 1)]
    for _ in range(2):
        crashing = ImmutableTickChunkWriter(
            tmp_path, _qualification(), publication_hook=fail_after_payload
        )
        with pytest.raises(RuntimeError, match="repeatable crash"):
            await crashing.persist(
                chunk_id="repeated-crash",
                source_version="1.0.0",
                observations=observations,
            )

    healthy = ImmutableTickChunkWriter(tmp_path, _qualification())
    manifest = await healthy.persist(
        chunk_id="repeated-crash",
        source_version="1.0.0",
        observations=observations,
    )
    payload = (tmp_path / "repeated-crash" / "observations.jsonl").read_bytes()
    assert manifest.payload_sha256 == hashlib.sha256(payload).hexdigest()
    assert len(list((tmp_path / ".quarantine").glob("repeated-crash-orphan-*"))) == 2
