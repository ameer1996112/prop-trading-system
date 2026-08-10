import { readFileSync } from "node:fs";

import { canonicalStringify, sha256Hex } from "../../src/canonical";

const proposalVector = JSON.parse(
  readFileSync(
    new URL("../../../../contracts/vectors/rd-entry-execution-proposal-v1.json", import.meta.url),
    "utf8",
  ),
) as {
  readonly accept_cases: readonly { readonly proposal: Record<string, unknown> }[];
};

async function v2CandidateFromProposal(index: number): Promise<Record<string, unknown>> {
  const proposal = structuredClone(proposalVector.accept_cases[index]!.proposal);
  const engagement = proposal.engagement_candle as Record<string, unknown>;
  const sourceBar = proposal.source_bar as Record<string, unknown>;
  engagement.open_epoch = 1_786_391_400;
  engagement.close_epoch = 1_786_391_700;
  sourceBar.open_epoch = 1_786_391_700;
  sourceBar.close_epoch = 1_786_392_000;
  proposal.observed_at_epoch = 1_786_392_001;
  proposal.strategy_version = "rd-entry-execution-proposal-v2";
  proposal.zone_active_from_epoch = 1_786_391_100;

  const identity = {
    strategy_version: "rd-entry-execution-proposal-v2",
    wire_version: "ExecutionCandidateV2",
    ticker_id: proposal.ticker_id,
    setup_id: proposal.setup_id,
    setup_revision: proposal.setup_revision,
    selection_id: proposal.selection_id,
    source_bar_close_epoch: sourceBar.close_epoch,
  };
  const logicalCandidateId = await sha256Hex(canonicalStringify(identity));
  const body: Record<string, unknown> = {
    ...proposal,
    schema_version: "ExecutionCandidateV2",
    proposal_schema_version: "rd-entry-execution-proposal-v2",
    logical_candidate_id: logicalCandidateId,
  };
  const candidateBodySha256 = await sha256Hex(canonicalStringify(body));
  return {
    ...body,
    candidate_body_sha256: candidateBodySha256,
  };
}

export async function v2LongCandidateFixture(): Promise<Record<string, unknown>> {
  return v2CandidateFromProposal(0);
}

export async function v2ShortCandidateFixture(): Promise<Record<string, unknown>> {
  return v2CandidateFromProposal(1);
}

export async function v2ShortGeometryCandidateFixture(): Promise<Record<string, unknown>> {
  const candidate = await v2ShortCandidateFixture();
  const sourceBar = {
    open_epoch: 1_786_391_700,
    close_epoch: 1_786_392_000,
    open_ticks: 1100,
    high_ticks: 1120,
    low_ticks: 990,
    close_ticks: 1000,
    closed: true,
  };
  const body: Record<string, unknown> = {
    ...candidate,
    schema_version: "ExecutionCandidateV2",
    proposal_schema_version: "rd-entry-execution-proposal-v2",
    strategy_version: "rd-entry-execution-proposal-v2",
    ticker_id: "EURUSD",
    source_symbol: "EURUSD",
    source_tick_size: "0.00001",
    direction: "SHORT",
    zone_top_ticks: 1110,
    zone_bottom_ticks: 1050,
    engagement_candle: {
      open_epoch: 1_786_391_400,
      close_epoch: 1_786_391_700,
      open_ticks: 1080,
      high_ticks: 1120,
      low_ticks: 1040,
      close_ticks: 1070,
      closed: true,
    },
    source_bar: sourceBar,
    wick_reference: "HIGH",
    wick_reference_ticks: 1120,
    buffer_ticks: 2,
    entry_ticks: 1000,
    stop_ticks: 1122,
    risk_distance_ticks: 122,
    target_ticks: 512,
  };
  const logicalCandidateId = await sha256Hex(canonicalStringify({
    strategy_version: body.strategy_version,
    wire_version: body.schema_version,
    ticker_id: body.ticker_id,
    setup_id: candidate.setup_id,
    setup_revision: candidate.setup_revision,
    selection_id: candidate.selection_id,
    source_bar_close_epoch: sourceBar.close_epoch,
  }));
  const { candidate_body_sha256: _oldDigest, ...unsignedBody } = body;
  const finalizedBody = { ...unsignedBody, logical_candidate_id: logicalCandidateId };
  return {
    ...finalizedBody,
    candidate_body_sha256: await sha256Hex(canonicalStringify(finalizedBody)),
  };
}

export type BrokerCapabilityFixtureOverrides = Readonly<Record<string, unknown>>;

export async function brokerCapabilityFixture(
  overrides: BrokerCapabilityFixtureOverrides = {},
): Promise<Record<string, unknown>> {
  const base = {
    schema_version: "BrokerSymbolCapabilityV1",
    account_profile_sha256: "3".repeat(64),
    source_symbol: "EURUSD",
    broker_symbol: "EURUSD",
    source_tick_size: "0.00001",
    broker_tick_size: "0.00001",
    buffer_policy_version: "rd-entry-wick-buffer-v1",
    source_buffer_ticks: 2,
    broker_buffer_ticks: 2,
    divergence_tolerance_source_ticks: 3,
  };
  const body = { ...base, ...overrides };
  const capabilitySha256 = await sha256Hex(canonicalStringify(body));
  return {
    ...body,
    capability_sha256: overrides.capability_sha256 ?? capabilitySha256,
  };
}

export function brokerBarEvidenceFixture(
  bars: readonly Record<string, unknown>[],
  capability: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const lastBar = bars.at(-1);
  if (lastBar === undefined || typeof lastBar.close_epoch !== "number") {
    throw new Error("TEST_BROKER_EVIDENCE_INVALID");
  }
  return {
    schema_version: "BrokerBarEvidenceV1",
    evidence_id: "broker-evidence-reconstruction-v1",
    installation_id: "broker-installation-v1",
    account_id: "broker-account-v1",
    account_profile_sha256: "3".repeat(64),
    source_symbol: capability.source_symbol,
    broker_symbol: capability.broker_symbol,
    symbol_capability_sha256: capability.capability_sha256,
    timeframe: "M5",
    reconciliation_cursor: "broker-reconstruction-cursor-v1",
    reconciliation_sha256: "4".repeat(64),
    bars,
    observed_at_epoch: lastBar.close_epoch + 1,
  };
}

type JsonSchema = Readonly<Record<string, unknown>>;

function schemaObject(value: unknown): JsonSchema {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TEST_SCHEMA_INVALID");
  }
  return value as JsonSchema;
}

function schemaTypeMatches(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "string") return typeof value === "string";
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number";
  if (type === "boolean") return typeof value === "boolean";
  throw new Error("TEST_SCHEMA_UNSUPPORTED");
}

function schemaReference(schema: JsonSchema, root: JsonSchema): JsonSchema {
  const reference = schema.$ref;
  if (typeof reference !== "string" || !reference.startsWith("#/$defs/")) {
    throw new Error("TEST_SCHEMA_UNSUPPORTED");
  }
  const definition = schemaObject(root.$defs)[reference.slice("#/$defs/".length)];
  return schemaObject(definition);
}

function schemaValidationErrors(schema: JsonSchema, value: unknown, path: string, root: JsonSchema): string[] {
  if (schema.$ref !== undefined) return schemaValidationErrors(schemaReference(schema, root), value, path, root);
  const errors: string[] = [];
  const declaredType = schema.type;
  if (typeof declaredType === "string" && !schemaTypeMatches(value, declaredType)) {
    return [`${path}: expected ${declaredType}`];
  }
  if (Array.isArray(declaredType) && !declaredType.some((type) => (
    typeof type === "string" && schemaTypeMatches(value, type)
  ))) {
    return [`${path}: expected one allowed type`];
  }
  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    errors.push(`${path}: value does not match const`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((allowed) => Object.is(value, allowed))) {
    errors.push(`${path}: value is not in enum`);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${path}: shorter than minLength`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${path}: longer than maxLength`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path}: does not match pattern`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path}: less than minimum`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path}: greater than maximum`);
  }
  if (schema.not !== undefined && schemaValidationErrors(schemaObject(schema.not), value, path, root).length === 0) {
    errors.push(`${path}: matches forbidden schema`);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const properties = schema.properties === undefined ? {} : schemaObject(schema.properties);
    const required = schema.required;
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key !== "string") throw new Error("TEST_SCHEMA_INVALID");
        if (!(key in object)) errors.push(`${path}.${key}: required property is missing`);
      }
    }
    for (const [key, item] of Object.entries(object)) {
      const propertySchema = properties[key];
      if (propertySchema === undefined) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key}: additional property is not allowed`);
      } else {
        errors.push(...schemaValidationErrors(schemaObject(propertySchema), item, `${path}.${key}`, root));
      }
    }
  }
  if (Array.isArray(schema.allOf)) {
    for (const clause of schema.allOf) errors.push(...schemaValidationErrors(schemaObject(clause), value, path, root));
  }
  if (schema.if !== undefined && schemaValidationErrors(schemaObject(schema.if), value, path, root).length === 0 && schema.then !== undefined) {
    errors.push(...schemaValidationErrors(schemaObject(schema.then), value, path, root));
  }
  return errors;
}

export function validateJsonSchemaPayload(schema: unknown, payload: unknown): readonly string[] {
  const root = schemaObject(schema);
  return schemaValidationErrors(root, payload, "$", root);
}
