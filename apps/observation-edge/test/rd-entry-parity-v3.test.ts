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

function rawVector(caseId: string): Record<string, unknown> {
  const raw = JSON.parse(VECTOR_BYTES.toString("utf8")) as {
    cases: Array<Record<string, unknown>>;
  };
  return structuredClone(
    raw.cases.find((item) => item.case_id === caseId),
  ) as Record<string, unknown>;
}

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

  it("rejects a public evaluation with an unsupported policy version", async () => {
    const base = vectors.cases.find(
      (item) => item.case_id === "strict_long_boc_only",
    )!;
    await expect(
      evaluateEntryV3Bundle({
        ...base.edge_input,
        policy_version: "rd-entry-arbitration-v2",
      } as unknown as typeof base.edge_input),
    ).rejects.toThrow(TypeError);
  });

  it("rejects observations after the arbitration evaluation epoch", async () => {
    const base = vectors.cases.find(
      (item) => item.case_id === "strict_long_boc_only",
    )!;
    await expect(
      evaluateEntryV3Bundle({
        ...base.edge_input,
        observed_at_epoch: base.edge_input.evaluated_at_epoch + 1,
      }),
    ).rejects.toThrow(TypeError);
  });

  it("rejects vector records observed after selection evaluation", () => {
    const raw = JSON.parse(VECTOR_BYTES.toString("utf8")) as {
      cases: Array<Record<string, unknown>>;
    };
    const vector = structuredClone(
      raw.cases.find((item) => item.case_id === "strict_long_boc_only"),
    ) as Record<string, unknown>;
    const expected = vector.expected as {
      candidates: Array<Record<string, unknown>>;
      selection: { evaluated_at_epoch: number };
    };
    expected.candidates[0]!.observed_at_epoch =
      expected.selection.evaluated_at_epoch + 1;

    expect(() => parseEntryV3Vector(vector)).toThrow(TypeError);
  });

  it.each([
    ["BOC tier", "boc_tier", "UNKNOWN_TIER"],
    ["ambiguity code", "ambiguity_codes", ["UNKNOWN_AMBIGUITY"]],
  ])("rejects a vector with an unknown %s", (_name, field, replacement) => {
    const raw = JSON.parse(VECTOR_BYTES.toString("utf8")) as {
      cases: Array<Record<string, unknown>>;
    };
    const vector = structuredClone(
      raw.cases.find((item) => item.case_id === "strict_long_boc_only"),
    ) as Record<string, unknown>;
    const expected = vector.expected as {
      candidates: Array<Record<string, unknown>>;
      evidence: Array<Record<string, unknown>>;
    };
    if (field === "boc_tier") {
      expected.candidates[0]!.boc_tier = replacement;
      expected.evidence[0]!.boc_tier = replacement;
    } else {
      expected.evidence[0]![field] = replacement;
    }

    expect(() => parseEntryV3Vector(vector)).toThrow(TypeError);
  });

  it.each([
    ["HTF threshold", "htf_open_ticks", 109],
    ["event anchor", "event_anchor_epoch", 1500],
    ["trigger sequence", "trigger_sequence", 6],
    ["HTF contexts", "htf_context_minutes", [15]],
  ])(
    "binds the flip input %s to expected evidence",
    (_name, field, replacement) => {
      const vector = rawVector("flip_before_boc");
      const input = vector.input as Record<string, unknown>;
      const proof = input.htf_flip_proof as Record<string, unknown>;
      proof[field] = replacement;

      expect(() => parseEntryV3Vector(vector)).toThrow(TypeError);
    },
  );

  it.each([
    ["contact_candle", "close_ticks", 106],
    ["recross_candle", "open_ticks", 109],
  ])(
    "binds the input %s %s to the retained expected lifecycle",
    (candleName, field, replacement) => {
      const vector = rawVector("flip_before_boc");
      const input = vector.input as Record<string, unknown>;
      const proof = input.htf_flip_proof as Record<string, unknown>;
      const candle = proof[candleName] as Record<string, unknown>;
      candle[field] = replacement;

      expect(() => parseEntryV3Vector(vector)).toThrow(TypeError);
    },
  );

  it("binds the input direction to every expected candidate", () => {
    const vector = rawVector("flip_before_boc");
    const input = vector.input as Record<string, unknown>;
    input.direction = "SHORT";

    expect(() => parseEntryV3Vector(vector)).toThrow(TypeError);
  });

  it("binds input evaluation facts to the expected selection", () => {
    const vector = rawVector("flip_before_boc");
    const input = vector.input as Record<string, unknown>;
    input.evaluated_at_epoch = 2500;

    expect(() => parseEntryV3Vector(vector)).toThrow(TypeError);
  });

  it("requires one expected evidence record for every observed model", () => {
    const vector = rawVector(
      "close_fallback_after_blocked_aggressive_models",
    );
    const expected = vector.expected as {
      candidates: Array<Record<string, unknown>>;
      evidence: Array<Record<string, unknown>>;
    };
    const flip = expected.candidates.find(
      (candidate) => candidate.model === "HTF_FLIP",
    )!;
    expected.evidence = expected.evidence.filter(
      (evidence) => evidence.candidate_id !== flip.candidate_id,
    );

    expect(() => parseEntryV3Vector(vector)).toThrow(TypeError);
  });

  it("binds canonical source claims to the candidate model", () => {
    const vector = rawVector("flip_before_boc");
    const expected = vector.expected as {
      candidates: Array<Record<string, unknown>>;
    };
    const flip = expected.candidates.find(
      (candidate) => candidate.model === "HTF_FLIP",
    )!;
    flip.source_claim_ids = ["htf-flip-2024-03"];

    expect(() => parseEntryV3Vector(vector)).toThrow(TypeError);
  });

  it("rejects a flip trigger tick different from its recross market close", () => {
    const vector = rawVector("flip_before_boc");
    const input = vector.input as Record<string, unknown>;
    const proof = input.htf_flip_proof as Record<string, unknown>;
    proof.trigger_ticks = 112;

    expect(() => parseEntryV3Vector(vector)).toThrow(TypeError);
  });

  it("co-triggers BOC and flip at one actual tick above the HTF threshold", async () => {
    const vector = vectors.cases.find(
      (item) => item.case_id === "boc_flip_same_event",
    )!;
    const result = await evaluateEntryV3Bundle(vector.input);
    const flip = result.evidence.find(
      (evidence) =>
        result.candidates.find(
          (candidate) => candidate.candidate_id === evidence.candidate_id,
        )?.model === "HTF_FLIP",
    )!;

    expect(flip.observed_trigger_ticks).toBe(111);
    expect(flip.recross_candle?.close_ticks).toBe(111);
    expect(flip.htf_open_ticks).toBe(110);
    expect(result.selection).toMatchObject({
      reason: "CO_TRIGGER_SAME_EVENT",
      action: "PAPER_ELIGIBLE",
      co_triggered_models: ["BOC", "HTF_FLIP"],
    });
  });

  it("blocks a LONG flip whose wick crosses but actual close does not", async () => {
    const base = vectors.cases.find(
      (item) => item.case_id === "flip_before_boc",
    )!;
    const proof = structuredClone(base.input.htf_flip_proof!);
    const input = {
      ...structuredClone(base.input),
      boc_proof: null,
      htf_flip_proof: {
        ...proof,
        trigger_ticks: 109,
        recross_candle: {
          ...proof.recross_candle!,
          close_ticks: 109,
        },
      },
    };

    const result = await evaluateEntryV3Bundle(input);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      model: "HTF_FLIP",
      state: "BLOCKED",
    });
    expect(result.evidence[0]).toMatchObject({
      observed_trigger_ticks: 109,
      htf_open_ticks: 110,
      failed_rule_ids: ["HTF_FLIP_OPEN_NOT_RECROSSED"],
    });
  });

  it("blocks a SHORT flip whose wrong-side wick hides a non-crossing close", async () => {
    const base = vectors.cases.find(
      (item) => item.case_id === "flip_before_boc",
    )!;
    const input = {
      ...structuredClone(base.input),
      direction: "SHORT" as const,
      boc_proof: null,
      htf_flip_proof: {
        ...structuredClone(base.input.htf_flip_proof!),
        htf_open_ticks: 99,
        trigger_ticks: 100,
        recross_candle: {
          open_epoch: 1801,
          close_epoch: 1802,
          open_ticks: 99,
          high_ticks: 101,
          low_ticks: 98,
          close_ticks: 100,
        },
      },
    };

    const result = await evaluateEntryV3Bundle(input);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      model: "HTF_FLIP",
      direction: "SHORT",
      state: "BLOCKED",
    });
    expect(result.evidence[0]).toMatchObject({
      observed_trigger_ticks: 100,
      htf_open_ticks: 99,
      failed_rule_ids: ["HTF_FLIP_OPEN_NOT_RECROSSED"],
    });
  });
});
