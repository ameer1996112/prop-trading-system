import {
  POLICY_VERSION_V3,
  validateEntryArbitrationInputV3,
  validateEntryEvaluationV3,
  validateOrderedCandleV3,
  type BocProofV3,
  type EntryArbitrationInputV3,
  type EntryEvaluationV3,
  type EntryTriggerProofV3,
} from "./rd-entry-domain-v3";

export interface RdEntryOracleVectorCaseV3 {
  readonly case_id: string;
  readonly input: EntryArbitrationInputV3;
  readonly edge_input: EntryArbitrationInputV3;
  readonly expected: EntryEvaluationV3;
}

export interface RdEntryOracleVectorDocumentV3 {
  readonly schema_id: "phase0.rd-entry-arbitration-vectors.v3";
  readonly rule_contract_version: "3.0.0";
  readonly arbitration_policy_version: typeof POLICY_VERSION_V3;
  readonly cases: readonly RdEntryOracleVectorCaseV3[];
}

function fail(message: string): never {
  throw new TypeError(message);
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  name: string,
): void {
  if (
    Object.keys(value).sort().join("\u0000") !==
    [...keys].sort().join("\u0000")
  ) {
    fail(`${name} has unknown or missing fields`);
  }
}

function integer(value: unknown, name: string, minimum?: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (minimum !== undefined && value < minimum)
  ) {
    return fail(`${name} must be a safe integer`);
  }
  return value;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") return fail(`${name} must be a boolean`);
  return value;
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) return fail(`${name} must be an array`);
  return value;
}

function contexts(value: unknown, name: string): void {
  const result = array(value, name);
  if (
    result.length > 3 ||
    result.some((item) => item !== 15 && item !== 30 && item !== 60) ||
    new Set(result).size !== result.length ||
    result.join() !== [...result].sort((a, b) => Number(a) - Number(b)).join()
  ) {
    fail(`${name} must be sorted unique supported HTF contexts`);
  }
}

function validateCandle(value: unknown, name: string): void {
  const result = object(value, name);
  exactKeys(
    result,
    [
      "open_epoch",
      "close_epoch",
      "open_ticks",
      "high_ticks",
      "low_ticks",
      "close_ticks",
    ],
    name,
  );
  validateOrderedCandleV3(result as unknown as Parameters<
    typeof validateOrderedCandleV3
  >[0], name);
}

function validateBocProof(value: unknown): void {
  const proof = object(value, "boc_proof");
  exactKeys(
    proof,
    [
      "reference_candle",
      "trigger_candle_open_epoch",
      "trigger_epoch",
      "trigger_sequence",
      "trigger_ticks",
      "htf_boundary_epoch",
      "htf_context_minutes",
      "proof_plane",
      "replayability",
      "fidelity",
      "coverage_start_epoch",
      "coverage_end_epoch",
      "is_realtime",
    ],
    "boc_proof",
  );
  validateCandle(proof.reference_candle, "boc_proof.reference_candle");
  const reference = proof.reference_candle as {
    open_epoch: number;
    close_epoch: number;
  };
  const triggerOpen = integer(
    proof.trigger_candle_open_epoch,
    "trigger_candle_open_epoch",
    0,
  );
  const triggerEpoch = integer(proof.trigger_epoch, "trigger_epoch", 0);
  integer(proof.trigger_sequence, "trigger_sequence", 0);
  integer(proof.trigger_ticks, "trigger_ticks");
  if (proof.htf_boundary_epoch !== null) {
    integer(proof.htf_boundary_epoch, "htf_boundary_epoch", 0);
  }
  contexts(proof.htf_context_minutes, "htf_context_minutes");
  integer(proof.coverage_start_epoch, "coverage_start_epoch", 0);
  integer(proof.coverage_end_epoch, "coverage_end_epoch", 0);
  boolean(proof.is_realtime, "is_realtime");
  if (
    reference.close_epoch - reference.open_epoch !== 300 ||
    reference.open_epoch % 300 !== 0 ||
    triggerOpen % 300 !== 0 ||
    reference.close_epoch > triggerOpen ||
    triggerEpoch < triggerOpen ||
    triggerEpoch >= triggerOpen + 300
  ) {
    fail("BOC proof violates aligned five-minute causality");
  }
}

function validateFlipProof(value: unknown): void {
  const proof = object(value, "htf_flip_proof");
  exactKeys(
    proof,
    [
      "event_anchor_epoch",
      "trigger_epoch",
      "trigger_sequence",
      "trigger_ticks",
      "htf_open_ticks",
      "htf_context_minutes",
      "proof_plane",
      "replayability",
      "fidelity",
      "coverage_start_epoch",
      "coverage_end_epoch",
      "is_realtime",
      "contact_candle",
      "recross_candle",
      "coverage_gap_detected",
      "full_lifecycle_ordered",
      "destination_seen_before_contact",
      "ambiguity_codes",
    ],
    "htf_flip_proof",
  );
  const anchor = integer(proof.event_anchor_epoch, "event_anchor_epoch", 0);
  const trigger = integer(proof.trigger_epoch, "trigger_epoch", 0);
  integer(proof.trigger_sequence, "trigger_sequence", 0);
  integer(proof.trigger_ticks, "trigger_ticks");
  integer(proof.htf_open_ticks, "htf_open_ticks");
  contexts(proof.htf_context_minutes, "htf_context_minutes");
  integer(proof.coverage_start_epoch, "coverage_start_epoch", 0);
  integer(proof.coverage_end_epoch, "coverage_end_epoch", 0);
  boolean(proof.is_realtime, "is_realtime");
  boolean(proof.coverage_gap_detected, "coverage_gap_detected");
  boolean(proof.full_lifecycle_ordered, "full_lifecycle_ordered");
  boolean(
    proof.destination_seen_before_contact,
    "destination_seen_before_contact",
  );
  array(proof.ambiguity_codes, "ambiguity_codes");
  if (proof.contact_candle !== null) {
    validateCandle(proof.contact_candle, "contact_candle");
    const contact = proof.contact_candle as { open_epoch: number };
    if (anchor > contact.open_epoch) fail("HTF anchor must precede contact");
  }
  if (proof.recross_candle !== null) {
    validateCandle(proof.recross_candle, "recross_candle");
    if (proof.contact_candle === null) {
      fail("recross candle requires contact candle");
    }
  }
  const values = proof.htf_context_minutes as number[];
  if (values.some((context) => trigger >= anchor + context * 60)) {
    fail("HTF trigger must remain inside every context");
  }
}

function validateInput(value: unknown): EntryArbitrationInputV3 {
  const input = object(value, "input");
  exactKeys(
    input,
    [
      "setup_id",
      "direction",
      "zone_top_ticks",
      "zone_bottom_ticks",
      "zone_engaged_epoch",
      "common_fidelity",
      "setup_invalidated",
      "boc_proof",
      "directional_close",
      "confirmed_bar",
      "close_trigger_sequence",
      "htf_flip_proof",
      "observed_at_epoch",
      "policy_version",
      "revision",
      "evaluated_at_epoch",
      "opened_selection_seed",
    ],
    "input",
  );
  if (typeof input.setup_id !== "string" || input.setup_id.length === 0) {
    fail("setup_id must be non-empty");
  }
  if (input.direction !== "LONG" && input.direction !== "SHORT") {
    fail("direction is unsupported");
  }
  const top = integer(input.zone_top_ticks, "zone_top_ticks");
  const bottom = integer(input.zone_bottom_ticks, "zone_bottom_ticks");
  if (top <= bottom) fail("zone geometry is inverted");
  if (input.zone_engaged_epoch !== null) {
    integer(input.zone_engaged_epoch, "zone_engaged_epoch", 0);
  }
  boolean(input.setup_invalidated, "setup_invalidated");
  const directionalClose = boolean(
    input.directional_close,
    "directional_close",
  );
  if (input.boc_proof !== null) validateBocProof(input.boc_proof);
  if (input.confirmed_bar !== null) {
    validateCandle(input.confirmed_bar, "confirmed_bar");
    const bar = input.confirmed_bar as {
      open_epoch: number;
      close_epoch: number;
    };
    if (bar.close_epoch - bar.open_epoch !== 300) {
      fail("confirmed bar must span five minutes");
    }
  }
  if (directionalClose !== (input.confirmed_bar !== null)) {
    fail("directional close and confirmed bar must pair");
  }
  if (input.htf_flip_proof !== null) validateFlipProof(input.htf_flip_proof);
  integer(input.close_trigger_sequence, "close_trigger_sequence", 0);
  integer(input.observed_at_epoch, "observed_at_epoch", 0);
  integer(input.revision, "revision", 0);
  integer(input.evaluated_at_epoch, "evaluated_at_epoch", 0);
  if (input.policy_version !== POLICY_VERSION_V3) {
    fail("policy version is unsupported");
  }
  if (input.opened_selection_seed !== null) {
    const seed = object(input.opened_selection_seed, "opened_selection_seed");
    exactKeys(
      seed,
      [
        "confirmed_bar",
        "trigger_sequence",
        "revision",
        "evaluated_at_epoch",
      ],
      "opened_selection_seed",
    );
    validateCandle(seed.confirmed_bar, "opened_selection_seed.confirmed_bar");
    integer(seed.trigger_sequence, "opened trigger sequence", 0);
    integer(seed.revision, "opened revision", 0);
    integer(seed.evaluated_at_epoch, "opened evaluation epoch", 0);
  }
  const parsed = input as unknown as EntryArbitrationInputV3;
  validateEntryArbitrationInputV3(parsed);
  return parsed;
}

export function parseEntryV3Vector(
  raw: unknown,
): RdEntryOracleVectorCaseV3 {
  const vector = object(raw, "vector");
  const vectorKeys =
    Object.hasOwn(vector, "edge_input")
      ? ["case_id", "input", "edge_input", "expected"]
      : ["case_id", "input", "expected"];
  exactKeys(vector, vectorKeys, "vector");
  if (typeof vector.case_id !== "string" || vector.case_id.length === 0) {
    fail("case_id must be non-empty");
  }
  const input = validateInput(vector.input);
  if (
    Object.hasOwn(vector, "edge_input") &&
    JSON.stringify(vector.edge_input) !== JSON.stringify(vector.input)
  ) {
    fail("edge_input must alias input exactly");
  }
  const expected = object(vector.expected, "expected") as unknown as EntryEvaluationV3;
  validateEntryEvaluationV3(expected);
  if (
    expected.selection.setup_id !== input.setup_id ||
    expected.candidates.some((item) => item.setup_id !== input.setup_id)
  ) {
    fail("case setup identity is inconsistent");
  }
  return { case_id: vector.case_id, input, edge_input: input, expected };
}

export function parseEntryV3VectorDocument(
  raw: Uint8Array | string | unknown,
): RdEntryOracleVectorDocumentV3 {
  const decoded =
    raw instanceof Uint8Array
      ? JSON.parse(new TextDecoder().decode(raw))
      : typeof raw === "string"
        ? JSON.parse(raw)
        : raw;
  const document = object(decoded, "vector document");
  exactKeys(
    document,
    [
      "schema_id",
      "rule_contract_version",
      "arbitration_policy_version",
      "cases",
    ],
    "vector document",
  );
  if (
    document.schema_id !== "phase0.rd-entry-arbitration-vectors.v3" ||
    document.rule_contract_version !== "3.0.0" ||
    document.arbitration_policy_version !== POLICY_VERSION_V3
  ) {
    fail("vector document versions are unsupported");
  }
  const values = array(document.cases, "cases");
  if (values.length !== 13) fail("vector document must contain 13 cases");
  const cases = values.map(parseEntryV3Vector);
  if (new Set(cases.map((item) => item.case_id)).size !== cases.length) {
    fail("vector case IDs must be unique");
  }
  return {
    schema_id: "phase0.rd-entry-arbitration-vectors.v3",
    rule_contract_version: "3.0.0",
    arbitration_policy_version: POLICY_VERSION_V3,
    cases,
  };
}

export type {
  BocProofV3,
  EntryArbitrationInputV3,
  EntryTriggerProofV3,
};
