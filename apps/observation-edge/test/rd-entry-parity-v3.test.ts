import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { evaluateEntryV3Bundle } from "../src/rd-entry-arbitrator-v3";
import {
  parseEntryV3Vector,
  parseEntryV3VectorDocument,
} from "../src/rd-entry-vector-contract-v3";

const VECTOR_BYTES = readFileSync(
  new URL(
    "../../../contracts/vectors/rd-entry-arbitration-v3.json",
    import.meta.url,
  ),
);
const vectors = parseEntryV3VectorDocument(VECTOR_BYTES);

describe("RD entry v3 Python/TypeScript parity", () => {
  it.each(vectors.cases)("$case_id matches the Python oracle", async (raw) => {
    const vector = parseEntryV3Vector(raw);
    const actual = await evaluateEntryV3Bundle(vector.edge_input);

    expect(actual).toEqual(vector.expected);
  });

  it("rejects an HTF anchor after contact", () => {
    const raw = JSON.parse(VECTOR_BYTES.toString("utf8")) as {
      cases: Array<Record<string, unknown>>;
    };
    const vector = structuredClone(
      raw.cases.find((item) => item.case_id === "flip_before_boc"),
    ) as Record<string, unknown>;
    const input = vector.input as Record<string, unknown>;
    const proof = input.htf_flip_proof as Record<string, unknown>;
    const contact = proof.contact_candle as { open_epoch: number };
    proof.event_anchor_epoch = contact.open_epoch + 1;

    expect(() => parseEntryV3Vector(vector)).toThrow(TypeError);
  });

  it("rejects a paper selection backed by blocked evidence", () => {
    const raw = JSON.parse(VECTOR_BYTES.toString("utf8")) as {
      cases: Array<Record<string, unknown>>;
    };
    const vector = structuredClone(
      raw.cases.find((item) => item.case_id === "strict_long_boc_only"),
    ) as Record<string, unknown>;
    const expected = vector.expected as {
      candidates: Array<Record<string, unknown>>;
    };
    expected.candidates[0]!.state = "BLOCKED";

    expect(() => parseEntryV3Vector(vector)).toThrow(TypeError);
  });

  it("retains a replayability mismatch as blocked unresolved evidence", async () => {
    const base = vectors.cases.find(
      (item) => item.case_id === "strict_long_boc_only",
    )!;
    const input = {
      ...structuredClone(base.edge_input),
      boc_proof: {
        ...structuredClone(base.edge_input.boc_proof!),
        proof_plane: "LOWER_TIMEFRAME_REPLAY",
        replayability: "LIVE_EXACT_NON_REPLAYABLE",
        is_realtime: false,
      },
    } as const;

    const result = await evaluateEntryV3Bundle(input);
    expect(result.candidates[0]!.state).toBe("BLOCKED");
    expect(result.evidence[0]).toMatchObject({
      fidelity: "UNRESOLVED",
      failed_rule_ids: ["EVIDENCE_REPLAYABILITY_MISMATCH"],
    });
    expect(result.selection).toMatchObject({
      canonical_candidate_id: null,
      canonical_evidence_id: null,
      canonical_model: null,
      fidelity: null,
      action: "SHADOW_ONLY",
      reason: "NO_EXACT_CANDIDATE",
    });
  });
});
