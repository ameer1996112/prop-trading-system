from __future__ import annotations

import argparse
import json
from pathlib import Path


OFFICIAL_CHANNEL_ID = "UC54xbL96tU58iez3YbTVTAg"
OFFICIAL_CHANNEL_HANDLE = "@RD_Forex"


def build(source: Path) -> str:
    root = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(root, dict) or root.get("contract_version") != "2.0.0":
        raise ValueError("expected RD contract 2.0.0")
    sources = root.get("sources_by_id")
    claims = root.get("claims_by_id")
    if not isinstance(sources, dict) or not isinstance(claims, dict):
        raise ValueError("source and claim maps are required")

    rows: list[dict[str, object]] = []
    for claim_id in sorted(claims):
        claim = claims[claim_id]
        if not isinstance(claim_id, str) or not isinstance(claim, dict):
            raise ValueError(f"invalid claim: {claim_id}")
        source_id = claim.get("source_id")
        source_record = sources.get(source_id) if isinstance(source_id, str) else None
        if not isinstance(source_record, dict):
            raise ValueError(f"unknown claim source: {claim_id}")
        if (
            source_record.get("channel_id") != OFFICIAL_CHANNEL_ID
            or source_record.get("channel_handle") != OFFICIAL_CHANNEL_HANDLE
        ):
            raise ValueError(f"non-official source: {claim_id}")
        target = claim.get("target_claim_id")
        if target is not None and (
            not isinstance(target, str) or target not in claims
        ):
            raise ValueError(f"unknown claim target: {claim_id}")
        rows.append(
            {
                "claim_id": claim_id,
                "source_id": source_id,
                "youtube_video_id": source_record["youtube_video_id"],
                "published_date": source_record["published_date"],
                "title_snapshot": source_record["title_snapshot"],
                "channel_id": source_record["channel_id"],
                "channel_handle": source_record["channel_handle"],
                "timestamp_start_seconds": claim["timestamp_start_seconds"],
                "timestamp_end_seconds": claim["timestamp_end_seconds"],
                "relationship": claim["relationship"],
                "target_claim_id": target,
                "summary": claim["summary"],
            }
        )

    encoded = json.dumps(
        rows,
        ensure_ascii=False,
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
