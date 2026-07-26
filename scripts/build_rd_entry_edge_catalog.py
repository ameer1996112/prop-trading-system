from __future__ import annotations

import argparse
import json
import math
import re
from datetime import date
from pathlib import Path
from typing import NoReturn

OFFICIAL_CHANNEL_ID = "UC54xbL96tU58iez3YbTVTAg"
OFFICIAL_CHANNEL_HANDLE = "@RD_Forex"
MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAX_TIMESTAMP_SECONDS = 86_400
IDENTIFIER = re.compile(r"^[A-Za-z0-9_.:@|+/-]+$")
LOCAL_DATE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
YOUTUBE_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
RELATIONSHIPS = {"SUPPORTS", "NARROWS", "SUPERSEDES"}
SOURCE_KEYS = {
    "youtube_video_id",
    "published_date",
    "title_snapshot",
    "channel_id",
    "channel_handle",
}
CLAIM_KEYS = {
    "source_id",
    "timestamp_start_seconds",
    "timestamp_end_seconds",
    "relationship",
    "target_claim_id",
    "summary",
}


def _reject_constant(value: str) -> NoReturn:
    raise ValueError(f"non-finite JSON number is not allowed: {value}")


def _finite_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError(f"non-finite JSON number is not allowed: {value}")
    return parsed


def _strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON object key: {key}")
        result[key] = value
    return result


def _closed_text(value: object, name: str) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError(f"{name} must be a non-empty closed string")
    return value


def _bounded_text(value: object, name: str, maximum: int) -> str:
    parsed = _closed_text(value, name)
    if len(parsed) > maximum:
        raise ValueError(f"{name} exceeds {maximum} characters")
    return parsed


def _identifier(value: object, name: str) -> str:
    parsed = _bounded_text(value, name, 160)
    if IDENTIFIER.fullmatch(parsed) is None:
        raise ValueError(f"{name} must be an identifier")
    return parsed


def _safe_non_negative_integer(
    value: object,
    name: str,
    *,
    maximum: int = MAX_SAFE_INTEGER,
) -> int:
    if type(value) is not int or value < 0 or value > maximum:
        raise ValueError(f"{name} must be a non-negative safe integer")
    return value


def _load_contract(source: Path) -> dict[str, object]:
    loaded: object = json.loads(
        source.read_text(encoding="utf-8"),
        object_pairs_hook=_strict_object,
        parse_constant=_reject_constant,
        parse_float=_finite_float,
    )
    if not isinstance(loaded, dict):
        raise ValueError("RD contract must be an object")
    return loaded


def _validated_source(source_id: str, value: object) -> dict[str, object]:
    if not isinstance(value, dict) or set(value) != SOURCE_KEYS:
        raise ValueError(f"invalid source record: {source_id}")
    youtube_video_id = _closed_text(
        value["youtube_video_id"],
        f"{source_id}.youtube_video_id",
    )
    if YOUTUBE_VIDEO_ID.fullmatch(youtube_video_id) is None:
        raise ValueError(f"{source_id}.youtube_video_id is invalid")
    published_date = _closed_text(
        value["published_date"],
        f"{source_id}.published_date",
    )
    if LOCAL_DATE.fullmatch(published_date) is None:
        raise ValueError(f"{source_id}.published_date is invalid")
    try:
        date.fromisoformat(published_date)
    except ValueError as exc:
        raise ValueError(f"{source_id}.published_date is invalid") from exc
    title_snapshot = _bounded_text(
        value["title_snapshot"],
        f"{source_id}.title_snapshot",
        240,
    )
    channel_id = _closed_text(value["channel_id"], f"{source_id}.channel_id")
    channel_handle = _closed_text(
        value["channel_handle"],
        f"{source_id}.channel_handle",
    )
    if channel_id != OFFICIAL_CHANNEL_ID or channel_handle != OFFICIAL_CHANNEL_HANDLE:
        raise ValueError(f"non-official source: {source_id}")
    return {
        "youtube_video_id": youtube_video_id,
        "published_date": published_date,
        "title_snapshot": title_snapshot,
        "channel_id": channel_id,
        "channel_handle": channel_handle,
    }


def build(source: Path) -> str:
    root = _load_contract(source)
    if root.get("contract_version") != "2.0.0":
        raise ValueError("expected RD contract 2.0.0")
    sources = root.get("sources_by_id")
    claims = root.get("claims_by_id")
    if not isinstance(sources, dict) or not isinstance(claims, dict):
        raise ValueError("source and claim maps are required")
    validated_sources: dict[str, dict[str, object]] = {}
    for source_id, source_record in sources.items():
        closed_source_id = _identifier(source_id, "source_id")
        validated_sources[closed_source_id] = _validated_source(
            closed_source_id,
            source_record,
        )
    video_ids = [source_record["youtube_video_id"] for source_record in validated_sources.values()]
    if len(video_ids) != len(set(video_ids)):
        raise ValueError("strategy source videos must be unique")

    rows: list[dict[str, object]] = []
    for claim_id in sorted(claims):
        claim = claims[claim_id]
        closed_claim_id = _identifier(claim_id, "claim_id")
        if not isinstance(claim, dict) or set(claim) != CLAIM_KEYS:
            raise ValueError(f"invalid claim: {claim_id}")
        source_id = _identifier(
            claim["source_id"],
            f"{claim_id}.source_id",
        )
        source_record = validated_sources.get(source_id)
        if source_record is None:
            raise ValueError(f"unknown claim source: {claim_id}")
        start = _safe_non_negative_integer(
            claim["timestamp_start_seconds"],
            f"{claim_id}.timestamp_start_seconds",
            maximum=MAX_TIMESTAMP_SECONDS,
        )
        end = _safe_non_negative_integer(
            claim["timestamp_end_seconds"],
            f"{claim_id}.timestamp_end_seconds",
            maximum=MAX_TIMESTAMP_SECONDS,
        )
        if end == 0 or end <= start:
            raise ValueError(f"{claim_id} timestamp range must increase")
        relationship = _closed_text(
            claim["relationship"],
            f"{claim_id}.relationship",
        )
        if relationship not in RELATIONSHIPS:
            raise ValueError(f"{claim_id}.relationship is invalid")
        target = claim["target_claim_id"]
        if target is not None and (
            _identifier(target, f"{claim_id}.target_claim_id") not in claims or target == claim_id
        ):
            raise ValueError(f"unknown claim target: {claim_id}")
        if (relationship == "SUPPORTS") != (target is None):
            raise ValueError(f"{claim_id} relationship target is inconsistent")
        summary = _bounded_text(claim["summary"], f"{claim_id}.summary", 1_000)
        rows.append(
            {
                "claim_id": closed_claim_id,
                "source_id": source_id,
                "youtube_video_id": source_record["youtube_video_id"],
                "published_date": source_record["published_date"],
                "title_snapshot": source_record["title_snapshot"],
                "channel_id": source_record["channel_id"],
                "channel_handle": source_record["channel_handle"],
                "timestamp_start_seconds": start,
                "timestamp_end_seconds": end,
                "relationship": relationship,
                "target_claim_id": target,
                "summary": summary,
            }
        )

    encoded = json.dumps(
        rows,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return f"export const SOURCE_CLAIM_CATALOG = {encoded} as const;\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = build(args.input)
    if args.check:
        if not args.output.is_file():
            raise SystemExit(f"missing generated file: {args.output}")
        if args.output.read_text(encoding="utf-8") != expected:
            raise SystemExit(f"generated file is stale: {args.output}")
        return 0
    args.output.write_text(expected, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
