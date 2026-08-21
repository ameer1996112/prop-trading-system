import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  deriveExecutionCandidateV1,
  validateExecutionProposalV1,
  type ExecutionProposalV1,
} from "../src/execution-proposal-v1";
import { parseStrictJson } from "../src/strict-json";

interface VectorOperation {
  readonly op: "add" | "set";
  readonly path: readonly string[];
  readonly value: unknown;
}

interface AcceptVector {
  readonly case_id: string;
  readonly reviewed_binding_id: string;
  readonly proposal: Record<string, unknown>;
  readonly expected_logical_candidate_id: string;
  readonly expected_candidate_body_sha256: string;
}

interface RejectVector {
  readonly case_id: string;
  readonly base_case_id: string;
  readonly reviewed_binding_id: string | null;
  readonly proposal_operations: readonly VectorOperation[];
  readonly reviewed_binding_operations?: readonly VectorOperation[];
  readonly probe_type_cast_bypass?: true;
  readonly expected_error_code: string;
}

interface ConflictVector {
  readonly case_id: string;
  readonly base_case_id: string;
  readonly reviewed_binding_id: string;
  readonly conflicting_proposal_operations: readonly VectorOperation[];
  readonly expected_logical_candidate_id: string;
  readonly expected_base_candidate_body_sha256: string;
  readonly expected_conflicting_candidate_body_sha256: string;
  readonly expected_outcome: "QUARANTINE_CONFLICT";
}

interface VectorDocument {
  readonly vector_version: string;
  readonly reviewed_bindings: Readonly<
    Record<string, Record<string, unknown>>
  >;
  readonly accept_cases: readonly AcceptVector[];
  readonly reject_cases: readonly RejectVector[];
  readonly conflict_cases: readonly ConflictVector[];
}

interface ContractSchema {
  readonly title: string;
  readonly additionalProperties: boolean;
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, Record<string, unknown>>>;
  readonly $defs: Readonly<Record<string, Record<string, unknown>>>;
  readonly description: string;
}

interface SupplementalRejection {
  readonly case_id: string;
  readonly coverage: string;
  readonly operations: readonly VectorOperation[];
}

const supplementalRejections: readonly SupplementalRejection[] = [
  {
    case_id: "supplemental_wrong_schema_version",
    coverage: "closed.schema_version",
    operations: [{ op: "set", path: ["schema_version"], value: "3.1" }],
  },
  {
    case_id: "supplemental_wrong_strategy_version",
    coverage: "closed.strategy_version",
    operations: [{ op: "set", path: ["strategy_version"], value: "3.1" }],
  },
  {
    case_id: "supplemental_live_execution_mode",
    coverage: "closed.execution_mode",
    operations: [{ op: "set", path: ["execution_mode"], value: "LIVE" }],
  },
  {
    case_id: "supplemental_historical_delivery",
    coverage: "closed.delivery_kind",
    operations: [{ op: "set", path: ["delivery_kind"], value: "HISTORICAL" }],
  },
  {
    case_id: "supplemental_gap_integrity",
    coverage: "closed.ingest_integrity",
    operations: [{ op: "set", path: ["ingest_integrity"], value: "GAP_DETECTED" }],
  },
  {
    case_id: "supplemental_wrong_timeframe",
    coverage: "closed.timeframe",
    operations: [{ op: "set", path: ["timeframe"], value: "M15" }],
  },
  {
    case_id: "supplemental_boc_model",
    coverage: "closed.entry_model.BOC",
    operations: [{ op: "set", path: ["entry_model"], value: "BOC" }],
  },
  {
    case_id: "supplemental_htf_flip_model",
    coverage: "closed.entry_model.HTF_FLIP",
    operations: [{ op: "set", path: ["entry_model"], value: "HTF_FLIP" }],
  },
  {
    case_id: "supplemental_one_candle_cohort",
    coverage: "closed.liquidity_cohort",
    operations: [{ op: "set", path: ["liquidity_cohort"], value: "ONE_CANDLE" }],
  },
  {
    case_id: "supplemental_inexact_selection",
    coverage: "closed.selection_fidelity",
    operations: [{ op: "set", path: ["selection_fidelity"], value: "SHADOW" }],
  },
  {
    case_id: "supplemental_shadow_action",
    coverage: "closed.selection_action.SHADOW_ONLY",
    operations: [{ op: "set", path: ["selection_action"], value: "SHADOW_ONLY" }],
  },
  {
    case_id: "supplemental_nonreplayable_evidence",
    coverage: "closed.evidence_replayability",
    operations: [{ op: "set", path: ["evidence_replayability"], value: "NON_REPLAYABLE" }],
  },
  {
    case_id: "supplemental_wrong_buffer_policy",
    coverage: "closed.buffer_policy_version",
    operations: [{ op: "set", path: ["buffer_policy_version"], value: "rd-entry-wick-buffer-v2" }],
  },
  {
    case_id: "supplemental_stale_observation",
    coverage: "timing.stale",
    operations: [{ op: "set", path: ["observed_at_epoch"], value: 1800000331 }],
  },
  {
    case_id: "supplemental_wrong_wick_direction",
    coverage: "geometry.wick_direction",
    operations: [{ op: "set", path: ["wick_reference"], value: "HIGH" }],
  },
  {
    case_id: "supplemental_wrong_wick_reference",
    coverage: "geometry.wick_reference",
    operations: [{ op: "set", path: ["wick_reference_ticks"], value: 1001 }],
  },
];

const frozenVectorCoverage = {
  "binding.feed": ["binding_source_feed_mismatch"],
  "binding.tick_size": ["binding_tick_size_mismatch"],
  "binding.hashes": [
    "binding_detector_hash_mismatch",
    "binding_settings_hash_mismatch",
    "binding_provenance_hash_mismatch",
    "binding_tick_capability_hash_mismatch",
  ],
  "number.unsafe_integer": ["unsafe_integer"],
  "geometry.non_4r": ["wrong_4r"],
  "delivery.historical": ["historical_delivery"],
  "shape.unknown_key": ["unknown_field"],
} as const;

const requiredNegativeBoundary = [
  "closed.schema_version",
  "closed.strategy_version",
  "closed.execution_mode",
  "closed.delivery_kind",
  "closed.ingest_integrity",
  "closed.timeframe",
  "closed.entry_model.BOC",
  "closed.entry_model.HTF_FLIP",
  "closed.liquidity_cohort",
  "closed.selection_fidelity",
  "closed.selection_action.SHADOW_ONLY",
  "closed.evidence_replayability",
  "closed.buffer_policy_version",
  "timing.stale",
  "geometry.wick_direction",
  "geometry.wick_reference",
  "binding.feed",
  "binding.tick_size",
  "binding.hashes",
  "number.unsafe_integer",
  "geometry.non_4r",
  "delivery.historical",
  "shape.unknown_key",
] as const;

const vectorUrl = new URL(
  "../../../contracts/vectors/rd-entry-execution-proposal-v1.json",
  import.meta.url,
);
const vectors = JSON.parse(readFileSync(vectorUrl, "utf8")) as VectorDocument;

function cloneObject(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}

function applyOperations(
  value: Record<string, unknown>,
  operations: readonly VectorOperation[],
): Record<string, unknown> {
  const result = cloneObject(value);
  for (const operation of operations) {
    if (operation.path.length === 0) throw new Error("VECTOR_PATH_EMPTY");
    let target = result;
    for (const segment of operation.path.slice(0, -1)) {
      const child = target[segment];
      if (child === null || typeof child !== "object" || Array.isArray(child)) {
        throw new Error("VECTOR_PATH_INVALID");
      }
      target = child as Record<string, unknown>;
    }
    const leaf = operation.path.at(-1);
    if (leaf === undefined) throw new Error("VECTOR_PATH_EMPTY");
    if (operation.op === "set" && !(leaf in target)) {
      throw new Error("VECTOR_SET_TARGET_MISSING");
    }
    if (operation.op === "add" && leaf in target) {
      throw new Error("VECTOR_ADD_TARGET_EXISTS");
    }
    target[leaf] = structuredClone(operation.value);
  }
  return result;
}

function acceptVector(caseId: string): AcceptVector {
  const item = vectors.accept_cases.find((candidate) =>
    candidate.case_id === caseId
  );
  if (item === undefined) throw new Error("VECTOR_BASE_CASE_MISSING");
  return item;
}

function reviewedBinding(
  bindingId: string | null,
  operations: readonly VectorOperation[] = [],
): Record<string, unknown> | undefined {
  if (bindingId === null) return undefined;
  const binding = vectors.reviewed_bindings[bindingId];
  if (binding === undefined) throw new Error("VECTOR_BINDING_MISSING");
  return applyOperations(binding, operations);
}

function rejectedProposal(item: RejectVector): Record<string, unknown> {
  return applyOperations(
    acceptVector(item.base_case_id).proposal,
    item.proposal_operations,
  );
}

function readSchema(relativePath: string): ContractSchema {
  return JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
  ) as ContractSchema;
}

function encodedJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function proposalBytesWithIntegerToken(
  proposal: Record<string, unknown>,
  field: string,
  replacementToken: string,
): Uint8Array {
  const source = JSON.stringify(proposal);
  const current = JSON.stringify(proposal[field]);
  const marker = `${JSON.stringify(field)}:${current}`;
  if (!source.includes(marker)) throw new Error("RAW_FIELD_MARKER_MISSING");
  return new TextEncoder().encode(
    source.replace(marker, `${JSON.stringify(field)}:${replacementToken}`),
  );
}

describe("rd-entry-execution-proposal-v1", () => {
  it("replays every committed cross-runtime acceptance vector", async () => {
    expect(vectors.accept_cases.length).toBeGreaterThanOrEqual(2);

    for (const item of vectors.accept_cases) {
      const binding = reviewedBinding(item.reviewed_binding_id);
      expect(validateExecutionProposalV1(item.proposal, binding)).toEqual(
        item.proposal,
      );
      const candidate = await deriveExecutionCandidateV1(
        item.proposal,
        binding,
      );
      expect(candidate.logical_candidate_id, item.case_id).toBe(
        item.expected_logical_candidate_id,
      );
      expect(candidate.candidate_body_sha256, item.case_id).toBe(
        item.expected_candidate_body_sha256,
      );
    }
  });

  it.each(vectors.reject_cases)(
    "rejects committed cross-runtime vector $case_id",
    async (item) => {
      const binding = reviewedBinding(
        item.reviewed_binding_id,
        item.reviewed_binding_operations,
      );
      await expect(
        deriveExecutionCandidateV1(rejectedProposal(item), binding),
      ).rejects.toThrow(item.expected_error_code);
    },
  );

  it.each(supplementalRejections)(
    "rejects supplemental runtime boundary $case_id",
    (item) => {
      const base = acceptVector("long_eurusd_same_engagement_close");
      expect(() =>
        validateExecutionProposalV1(
          applyOperations(base.proposal, item.operations),
          reviewedBinding(base.reviewed_binding_id),
        )
      ).toThrow("EXECUTION_PROPOSAL_V1_INVALID");
    },
  );

  it("documents complete frozen-vector plus supplemental negative coverage", () => {
    const vectorCaseIds = new Set(
      vectors.reject_cases.map((item) => item.case_id),
    );
    for (const caseIds of Object.values(frozenVectorCoverage)) {
      for (const caseId of caseIds) expect(vectorCaseIds.has(caseId)).toBe(true);
    }

    const actualCoverage = new Set([
      ...supplementalRejections.map((item) => item.coverage),
      ...Object.keys(frozenVectorCoverage),
    ]);
    expect(actualCoverage).toEqual(new Set(requiredNegativeBoundary));
    expect(actualCoverage.size).toBe(requiredNegativeBoundary.length);
  });

  it("accepts strict raw JSON bytes for both proposal and reviewed identity", async () => {
    const accepted = acceptVector("long_eurusd_same_engagement_close");
    const binding = reviewedBinding(accepted.reviewed_binding_id);
    if (binding === undefined) throw new Error("VECTOR_BINDING_MISSING");

    expect(
      validateExecutionProposalV1(
        encodedJson(accepted.proposal),
        encodedJson(binding),
      ),
    ).toEqual(accepted.proposal);
    expect(
      validateExecutionProposalV1(
        parseStrictJson(encodedJson(accepted.proposal)),
        parseStrictJson(encodedJson(binding)),
      ),
    ).toEqual(accepted.proposal);
    await expect(
      deriveExecutionCandidateV1(
        encodedJson(accepted.proposal),
        encodedJson(binding),
      ),
    ).resolves.toMatchObject({
      logical_candidate_id: accepted.expected_logical_candidate_id,
      candidate_body_sha256: accepted.expected_candidate_body_sha256,
    });
  });

  it("rejects duplicate keys through the raw-byte public API", () => {
    const accepted = acceptVector("long_eurusd_same_engagement_close");
    const binding = reviewedBinding(accepted.reviewed_binding_id);
    if (binding === undefined) throw new Error("VECTOR_BINDING_MISSING");
    const source = JSON.stringify(accepted.proposal);
    const duplicateProposal = source.replace(
      "{",
      '{"schema_version":"rd-entry-execution-proposal-v1",',
    );
    const duplicateBinding = JSON.stringify(binding).replace(
      "{",
      '{"ticker_id":"OANDA:EURUSD",',
    );

    expect(() =>
      validateExecutionProposalV1(
        new TextEncoder().encode(duplicateProposal),
        binding,
      )
    ).toThrow("EXECUTION_PROPOSAL_V1_INVALID");
    expect(() =>
      validateExecutionProposalV1(
        accepted.proposal,
        new TextEncoder().encode(duplicateBinding),
      )
    ).toThrow("EXECUTION_PROPOSAL_V1_INVALID");
  });

  it.each([
    ["unsafe", "9007199254740992"],
    ["fractional", "7.0"],
    ["exponent", "7e0"],
  ])("rejects %s integer tokens through raw bytes", (_kind, token) => {
    const accepted = acceptVector("long_eurusd_same_engagement_close");
    expect(() =>
      validateExecutionProposalV1(
        proposalBytesWithIntegerToken(
          accepted.proposal,
          "producer_sequence",
          token,
        ),
        reviewedBinding(accepted.reviewed_binding_id),
      )
    ).toThrow("EXECUTION_PROPOSAL_V1_INVALID");
  });

  it("checks every reviewed-identity field by exact equality", () => {
    const firstBinding = Object.values(vectors.reviewed_bindings)[0];
    if (firstBinding === undefined) throw new Error("VECTOR_BINDING_MISSING");
    const mismatchFields = vectors.reject_cases.flatMap((item) =>
      (item.reviewed_binding_operations ?? []).map((operation) =>
        operation.path.join("."),
      )
    );

    expect(new Set(mismatchFields)).toEqual(new Set(Object.keys(firstBinding)));
  });

  it("cannot bypass runtime geometry validation with a TypeScript cast", async () => {
    const item = vectors.reject_cases.find((candidate) =>
      candidate.probe_type_cast_bypass === true
    );
    if (item === undefined) throw new Error("VECTOR_BYPASS_PROBE_MISSING");
    const forged = rejectedProposal(item) as unknown as ExecutionProposalV1;

    await expect(
      deriveExecutionCandidateV1(
        forged,
        reviewedBinding(
          item.reviewed_binding_id,
          item.reviewed_binding_operations,
        ),
      ),
    ).rejects.toThrow(item.expected_error_code);
  });

  it.each(vectors.conflict_cases)(
    "preserves logical identity and exposes body conflict for $case_id",
    async (item) => {
      const base = acceptVector(item.base_case_id);
      const binding = reviewedBinding(item.reviewed_binding_id);
      const first = await deriveExecutionCandidateV1(base.proposal, binding);
      const conflicting = await deriveExecutionCandidateV1(
        applyOperations(
          base.proposal,
          item.conflicting_proposal_operations,
        ),
        binding,
      );

      expect(first.logical_candidate_id).toBe(
        item.expected_logical_candidate_id,
      );
      expect(conflicting.logical_candidate_id).toBe(
        item.expected_logical_candidate_id,
      );
      expect(first.candidate_body_sha256).toBe(
        item.expected_base_candidate_body_sha256,
      );
      expect(conflicting.candidate_body_sha256).toBe(
        item.expected_conflicting_candidate_body_sha256,
      );
      expect(conflicting.candidate_body_sha256).not.toBe(
        first.candidate_body_sha256,
      );
      expect(item.expected_outcome).toBe("QUARANTINE_CONFLICT");
    },
  );

  it("ships separate strict proposal and candidate schemas", async () => {
    const proposalSchema = readSchema(
      "../../../contracts/schema/rd-entry-execution-proposal-v1.schema.json",
    );
    const candidateSchema = readSchema(
      "../../../contracts/schema/execution-candidate-v1.schema.json",
    );
    const accepted = vectors.accept_cases[0];
    if (accepted === undefined) throw new Error("VECTOR_ACCEPT_CASE_MISSING");
    const candidate = await deriveExecutionCandidateV1(
      accepted.proposal,
      reviewedBinding(accepted.reviewed_binding_id),
    );

    expect(proposalSchema.additionalProperties).toBe(false);
    expect(candidateSchema.additionalProperties).toBe(false);
    expect(candidateSchema.title).toBe("ExecutionCandidateV1");
    expect(new Set(candidateSchema.required)).toEqual(
      new Set(Object.keys(candidate)),
    );
    expect(new Set(Object.keys(candidateSchema.properties))).toEqual(
      new Set(candidateSchema.required),
    );
    expect(candidateSchema.properties.schema_version).toEqual({
      const: "ExecutionCandidateV1",
    });
    expect(candidateSchema.properties.proposal_schema_version).toEqual({
      const: vectors.vector_version,
    });
    expect(candidateSchema.properties.execution_mode).toEqual({
      const: "PAPER_ONLY",
    });
    expect(candidateSchema.properties.logical_candidate_id).toEqual({
      $ref: "#/$defs/sha256",
    });
    expect(candidateSchema.properties.candidate_body_sha256).toEqual({
      $ref: "#/$defs/sha256",
    });
    expect(candidateSchema.$defs.closedM5Candle?.additionalProperties).toBe(
      false,
    );
    expect(
      (
        candidateSchema.$defs.closedM5Candle?.properties as
          | Record<string, unknown>
          | undefined
      )?.closed,
    ).toEqual({ const: true });

    for (const [key, value] of Object.entries(candidate)) {
      if (key.endsWith("_ticks") && typeof value === "number") {
        expect(
          candidateSchema.properties[key]?.$ref,
          `${key} must be an integer-tick schema field`,
        ).toMatch(/^#\/\$defs\/(?:safeInteger|positiveSafeInteger)$/u);
      }
    }
    expect(
      Object.keys(candidateSchema.properties).some((key) =>
        /account|broker|credential|secret|order|command/iu.test(key)
      ),
    ).toBe(false);
    expect(candidateSchema.description).toContain(
      "Runtime validation against the exact reviewed identity",
    );
  });

  it("pins canonical tick-size limits identically in both schemas", () => {
    const proposalSchema = readSchema(
      "../../../contracts/schema/rd-entry-execution-proposal-v1.schema.json",
    );
    const candidateSchema = readSchema(
      "../../../contracts/schema/execution-candidate-v1.schema.json",
    );
    const proposalTickSize = proposalSchema.properties.source_tick_size;
    const candidateTickSize = candidateSchema.properties.source_tick_size;
    if (proposalTickSize === undefined || candidateTickSize === undefined) {
      throw new Error("TICK_SIZE_SCHEMA_MISSING");
    }

    expect(proposalTickSize).toEqual(candidateTickSize);
    expect(proposalTickSize.maxLength).toBe(32);
    expect(new RegExp(String(proposalTickSize.pattern), "u").test("0.1")).toBe(
      true,
    );
  });
});
