"""Crash-recoverable, append-only tick chunks for fixture-driven foundation tests."""

from __future__ import annotations

import asyncio
import fcntl
import hashlib
import os
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from itertools import pairwise
from pathlib import Path
from typing import Literal

from prop_trading.contracts.models import (
    TickChunkManifest,
    TickObservation,
    TickSourceClassification,
)
from prop_trading.domain.canonical import canonical_json_bytes

_SAFE_CHUNK_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


@dataclass(frozen=True, slots=True)
class TickSourceQualification:
    """Facts that cap, rather than assert, a chunk's promotion eligibility."""

    fixture_only: bool
    upstream_sequence_contract_verified: bool
    licensing_verified: bool
    reconnect_backfill_verified: bool
    collector_coverage_verified: bool
    clock_sync_verified: bool
    clock_tolerance_ns: int
    qualification_evidence_id: str | None
    storage_encryption_status: Literal["FIXTURE_ONLY_NOT_CONFIGURED", "VERIFIED_AT_REST"]

    def __post_init__(self) -> None:
        if self.clock_tolerance_ns < 0:
            raise ValueError("clock_tolerance_ns must be non-negative")


@dataclass(frozen=True, slots=True)
class _ObservationFacts:
    ingest_order: bool
    monotonic_receive_order: bool
    utc_receive_order: bool
    clock_tolerance: bool
    sequence_contiguous: bool
    all_connections_healthy: bool
    one_connection_generation: bool


def _write_exclusive(path: Path, content: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(descriptor)


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value[:-1] + "+00:00")


def _observation_facts(
    observations: list[TickObservation], qualification: TickSourceQualification
) -> _ObservationFacts:
    ordinals = [item.ingest_ordinal for item in observations]
    monotonic_times = [item.monotonic_receive_ns for item in observations]
    receive_times = [_parse_utc(item.utc_receive_time) for item in observations]
    sequences = [item.upstream_sequence for item in observations]
    sequence_values = [item for item in sequences if item is not None]
    return _ObservationFacts(
        ingest_order=all(right == left + 1 for left, right in pairwise(ordinals)),
        monotonic_receive_order=all(right > left for left, right in pairwise(monotonic_times)),
        utc_receive_order=all(right >= left for left, right in pairwise(receive_times)),
        clock_tolerance=all(
            abs(item.clock_offset_ns) <= qualification.clock_tolerance_ns for item in observations
        ),
        sequence_contiguous=len(sequence_values) == len(observations)
        and all(right == left + 1 for left, right in pairwise(sequence_values)),
        all_connections_healthy=all(item.connection_healthy for item in observations),
        one_connection_generation=len({item.connection_generation for item in observations}) == 1,
    )


def _exact_qualification(facts: _ObservationFacts, qualification: TickSourceQualification) -> bool:
    return all(
        (
            facts.ingest_order,
            facts.monotonic_receive_order,
            facts.utc_receive_order,
            facts.clock_tolerance,
            facts.sequence_contiguous,
            facts.all_connections_healthy,
            facts.one_connection_generation,
            not qualification.fixture_only,
            qualification.upstream_sequence_contract_verified,
            qualification.licensing_verified,
            qualification.reconnect_backfill_verified,
            qualification.collector_coverage_verified,
            qualification.clock_sync_verified,
            qualification.qualification_evidence_id is not None,
            qualification.storage_encryption_status == "VERIFIED_AT_REST",
        )
    )


def _classify(
    facts: _ObservationFacts, qualification: TickSourceQualification
) -> TickSourceClassification:
    observation_failure = not all(
        (
            facts.ingest_order,
            facts.monotonic_receive_order,
            facts.utc_receive_order,
            facts.clock_tolerance,
            facts.all_connections_healthy,
            facts.one_connection_generation,
        )
    )
    if observation_failure:
        return TickSourceClassification.INCOMPLETE
    if not facts.sequence_contiguous and qualification.upstream_sequence_contract_verified:
        return TickSourceClassification.INCOMPLETE
    if _exact_qualification(facts, qualification):
        return TickSourceClassification.SEQUENCE_COMPLETE
    return TickSourceClassification.CONTINUOUS_OBSERVED


class ImmutableTickChunkWriter:
    """Publish a complete chunk directory atomically; final directories are immutable."""

    def __init__(
        self,
        root: Path,
        qualification: TickSourceQualification,
        *,
        publication_hook: Callable[[str], None] | None = None,
    ) -> None:
        self._root = root
        self._qualification = qualification
        self._publication_hook = publication_hook

    async def persist(
        self,
        *,
        chunk_id: str,
        source_version: str,
        observations: list[TickObservation],
    ) -> TickChunkManifest:
        if not observations:
            raise ValueError("a tick chunk must contain observations")
        if _SAFE_CHUNK_ID.fullmatch(chunk_id) is None:
            raise ValueError("chunk_id is not file-safe")
        feed_ids = {item.feed_id for item in observations}
        capability_ids = {item.account_capability_id for item in observations}
        if len(feed_ids) != 1 or len(capability_ids) != 1:
            raise ValueError("a chunk must contain exactly one feed and account capability")
        payload = b"".join(
            canonical_json_bytes(item.model_dump(mode="json")) + b"\n" for item in observations
        )
        digest = hashlib.sha256(payload).hexdigest()
        facts = _observation_facts(observations, self._qualification)
        classification = _classify(facts, self._qualification)
        sequences = [item.upstream_sequence for item in observations]
        first_sequence = sequences[0] if all(item is not None for item in sequences) else None
        last_sequence = sequences[-1] if all(item is not None for item in sequences) else None
        manifest = TickChunkManifest(
            schema_id="phase0.tick-chunk-manifest.v1",
            chunk_id=chunk_id,
            feed_id=next(iter(feed_ids)),
            account_capability_id=next(iter(capability_ids)),
            source_classification=classification,
            source_version=source_version,
            observation_schema_id="phase0.tick-observation.v1",
            row_count=len(observations),
            first_upstream_sequence=first_sequence,
            last_upstream_sequence=last_sequence,
            first_broker_event_time=observations[0].broker_event_time,
            last_broker_event_time=observations[-1].broker_event_time,
            first_utc_receive_time=observations[0].utc_receive_time,
            last_utc_receive_time=observations[-1].utc_receive_time,
            connection_generation_start=observations[0].connection_generation,
            connection_generation_end=observations[-1].connection_generation,
            clock_offset_min_ns=min(item.clock_offset_ns for item in observations),
            clock_offset_max_ns=max(item.clock_offset_ns for item in observations),
            clock_tolerance_ns=self._qualification.clock_tolerance_ns,
            all_connections_healthy=facts.all_connections_healthy,
            ingest_order_verified=facts.ingest_order,
            monotonic_receive_order_verified=facts.monotonic_receive_order,
            utc_receive_order_verified=facts.utc_receive_order,
            clock_tolerance_verified=facts.clock_tolerance,
            fixture_only=self._qualification.fixture_only,
            upstream_sequence_contract_verified=(
                self._qualification.upstream_sequence_contract_verified
            ),
            licensing_verified=self._qualification.licensing_verified,
            reconnect_backfill_verified=self._qualification.reconnect_backfill_verified,
            collector_coverage_verified=self._qualification.collector_coverage_verified,
            clock_sync_verified=self._qualification.clock_sync_verified,
            qualification_evidence_id=self._qualification.qualification_evidence_id,
            exact_replay_eligible=_exact_qualification(facts, self._qualification),
            payload_sha256=digest,
            storage_encryption_status=self._qualification.storage_encryption_status,
            immutable=True,
        )
        manifest_bytes = canonical_json_bytes(manifest.model_dump(mode="json")) + b"\n"
        await asyncio.to_thread(self._publish_directory, chunk_id, payload, manifest_bytes)
        return manifest

    def _resolved_paths(self, chunk_id: str) -> tuple[Path, Path, Path, Path]:
        self._root.mkdir(mode=0o700, parents=True, exist_ok=True)
        root = self._root.resolve()
        staging_root = root / ".staging"
        quarantine_root = root / ".quarantine"
        staging_root.mkdir(mode=0o700, exist_ok=True)
        quarantine_root.mkdir(mode=0o700, exist_ok=True)
        final = root / chunk_id
        stage = staging_root / chunk_id
        if final.resolve().parent != root or stage.resolve().parent != staging_root:
            raise ValueError("resolved chunk paths must remain under the configured root")
        return root, staging_root, quarantine_root, final

    def _publish_directory(self, chunk_id: str, payload: bytes, manifest_bytes: bytes) -> None:
        root, staging_root, quarantine_root, final = self._resolved_paths(chunk_id)
        lock_root = root / ".locks"
        lock_root.mkdir(mode=0o700, exist_ok=True)
        lock_path = lock_root / f"{chunk_id}.lock"
        if lock_path.resolve().parent != lock_root.resolve():
            raise ValueError("resolved lock path must remain under the configured root")
        lock_descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(lock_descriptor, fcntl.LOCK_EX)
            self._publish_locked(
                chunk_id, payload, manifest_bytes, root, staging_root, quarantine_root, final
            )
        finally:
            fcntl.flock(lock_descriptor, fcntl.LOCK_UN)
            os.close(lock_descriptor)

    def _publish_locked(
        self,
        chunk_id: str,
        payload: bytes,
        manifest_bytes: bytes,
        root: Path,
        staging_root: Path,
        quarantine_root: Path,
        final: Path,
    ) -> None:
        stage = staging_root / chunk_id
        if final.exists():
            raise FileExistsError(f"immutable chunk already exists: {chunk_id}")
        if stage.exists():
            payload_path = stage / "observations.jsonl"
            manifest_path = stage / "manifest.json"
            if (
                payload_path.is_file()
                and manifest_path.is_file()
                and payload_path.read_bytes() == payload
                and manifest_path.read_bytes() == manifest_bytes
            ):
                stage.rename(final)
                _fsync_directory(root)
                self._verify_final(final, payload, manifest_bytes)
                return
            # Holding the per-chunk process lock establishes that no conforming writer owns it.
            self._quarantine(stage, quarantine_root)
        stage.mkdir(mode=0o700)
        try:
            _write_exclusive(stage / "observations.jsonl", payload)
            if self._publication_hook is not None:
                self._publication_hook("PAYLOAD_DURABLE")
            _write_exclusive(stage / "manifest.json", manifest_bytes)
            _fsync_directory(stage)
            if self._publication_hook is not None:
                self._publication_hook("STAGE_DURABLE")
            stage.rename(final)
            _fsync_directory(root)
            self._verify_final(final, payload, manifest_bytes)
        except BaseException:
            _fsync_directory(staging_root)
            raise

    @staticmethod
    def _verify_final(final: Path, expected_payload: bytes, expected_manifest: bytes) -> None:
        payload_path = final / "observations.jsonl"
        manifest_path = final / "manifest.json"
        if not payload_path.is_file() or not manifest_path.is_file():
            raise OSError("published tick chunk is missing payload or manifest")
        payload = payload_path.read_bytes()
        manifest_bytes = manifest_path.read_bytes()
        manifest = TickChunkManifest.model_validate_json(manifest_bytes)
        if payload != expected_payload or manifest_bytes != expected_manifest:
            raise OSError("published tick chunk differs from this writer's immutable pair")
        if hashlib.sha256(payload).hexdigest() != manifest.payload_sha256:
            raise OSError("published tick manifest payload hash does not match final payload bytes")

    @staticmethod
    def _quarantine(stage: Path, quarantine_root: Path) -> None:
        fingerprint = hashlib.sha256()
        for path in sorted(stage.glob("*")):
            fingerprint.update(path.name.encode())
            if path.is_file():
                fingerprint.update(path.read_bytes())
        destination = quarantine_root / f"{stage.name}-orphan-{fingerprint.hexdigest()[:16]}"
        collision = 0
        while destination.exists():
            collision += 1
            destination = quarantine_root / (
                f"{stage.name}-orphan-{fingerprint.hexdigest()[:16]}-{collision}"
            )
        stage.rename(destination)
        _fsync_directory(quarantine_root)
