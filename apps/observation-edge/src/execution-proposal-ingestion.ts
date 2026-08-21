import {
  deriveExecutionCandidateV1,
  type ExecutionCandidateV1,
  type ExecutionProposalV1,
  type ExecutionProposalV1ReviewedIdentity,
  ExecutionProposalV1ValidationError,
  validateExecutionProposalV1,
} from "./execution-proposal-v1";
import { parseStrictJson } from "./strict-json";
import type { Env } from "./types";

const SHA256 = /^[a-f0-9]{64}$/u;
const REVIEWED_IDENTITY_KEYS = [
  "ticker_id",
  "source_symbol",
  "source_feed",
  "detector_code_sha256",
  "settings_sha256",
  "provenance_sha256",
  "source_tick_capability_sha256",
  "source_tick_size",
  "buffer_policy_version",
] as const;
const CANDIDATE_TTL_SECONDS = 300;

export interface ExecutionProposalIngestionResponse {
  readonly schema_version: "rd-entry-execution-proposal-ingestion-v1";
  readonly status: "RECORDED";
  readonly execution_mode: "PAPER_ONLY";
  readonly event_id: string;
  readonly producer_instance_id: string;
  readonly producer_sequence: number;
  readonly proposal_sha256: string;
  readonly logical_candidate_id: string;
  readonly candidate_body_sha256: string;
  readonly paper_result: "VALIDATED_ONLY";
  readonly candidate_emission: "DISABLED" | "STORED";
  readonly candidate_dispatch: "DISABLED" | "ENABLED";
}

interface StoredEvent {
  readonly event_id: string;
  readonly proposal_sha256: string;
}

interface StoredResult {
  readonly status_code: number;
  readonly response_json: string;
}

interface StoredCheckpoint {
  readonly producer_sequence: number;
}

interface StoredCandidate {
  readonly candidate_body_sha256: string;
}

function responseHeaders(): Headers {
  return new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
}

function storedResponse(value: string, status: number): Response {
  return new Response(value, { status, headers: responseHeaders() });
}

function jsonResponse(value: unknown, status: number): Response {
  return storedResponse(JSON.stringify(value), status);
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (item) =>
    item.toString(16).padStart(2, "0"),
  ).join("");
}

function isReviewedIdentity(
  value: unknown,
): value is ExecutionProposalV1ReviewedIdentity {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const object = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(object).sort().join("\u0000") !==
    [...REVIEWED_IDENTITY_KEYS].sort().join("\u0000")
  ) {
    return false;
  }
  return (
    typeof object.ticker_id === "string" &&
    (object.source_symbol === "EURUSD" ||
      object.source_symbol === "GBPJPY" ||
      object.source_symbol === "USDJPY" ||
      object.source_symbol === "XAUUSD" ||
      object.source_symbol === "NAS100") &&
    typeof object.source_feed === "string" &&
    typeof object.source_tick_size === "string" &&
    object.buffer_policy_version === "rd-entry-wick-buffer-v1" &&
    typeof object.detector_code_sha256 === "string" &&
    SHA256.test(object.detector_code_sha256) &&
    typeof object.settings_sha256 === "string" &&
    SHA256.test(object.settings_sha256) &&
    typeof object.provenance_sha256 === "string" &&
    SHA256.test(object.provenance_sha256) &&
    typeof object.source_tick_capability_sha256 === "string" &&
    SHA256.test(object.source_tick_capability_sha256)
  );
}

function reviewedIdentities(
  env: Env,
): readonly ExecutionProposalV1ReviewedIdentity[] | null {
  const configured = env.RD_EXECUTION_PROPOSAL_V1_REVIEWED_IDENTITIES_JSON;
  if (configured === undefined || configured.length === 0) return null;
  try {
    const parsed = JSON.parse(configured) as unknown;
    const values = Array.isArray(parsed)
      ? parsed
      : parsed !== null && typeof parsed === "object"
        ? Object.values(parsed)
        : [];
    if (values.length === 0 || values.some((item) => !isReviewedIdentity(item))) {
      return null;
    }
    return values;
  } catch {
    return null;
  }
}

function candidateEmissionEnabled(env: Env): boolean {
  return env.RD_EXECUTION_CANDIDATE_EMISSION_ENABLED === "true";
}

function candidateDispatchEnabled(env: Env): boolean {
  return (
    env.RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED === "true" &&
    typeof env.RD_EXECUTION_RECEIVER_MANIFEST_SHA256 === "string" &&
    SHA256.test(env.RD_EXECUTION_RECEIVER_MANIFEST_SHA256) &&
    env.RD_EXECUTION_RECEIVER_MANIFEST_SHA256 !== "0".repeat(64)
  );
}

async function validatedProposalAndCandidate(
  value: unknown,
  identities: readonly ExecutionProposalV1ReviewedIdentity[],
): Promise<{
  readonly proposal: ExecutionProposalV1;
  readonly candidate: ExecutionCandidateV1;
} | null> {
  for (const identity of identities) {
    try {
      const proposal = validateExecutionProposalV1(value, identity);
      const candidate = await deriveExecutionCandidateV1(proposal, identity);
      return { proposal, candidate };
    } catch (error) {
      if (!(error instanceof ExecutionProposalV1ValidationError)) throw error;
    }
  }
  return null;
}

async function replayResponse(env: Env, eventId: string): Promise<Response | null> {
  const stored = await env.DB
    .prepare(
      `SELECT status_code, response_json
       FROM observation_execution_proposal_v1_paper_results
       WHERE event_id = ?`,
    )
    .bind(eventId)
    .first<StoredResult>();
  if (
    stored === null ||
    stored.status_code !== 202 ||
    typeof stored.response_json !== "string"
  ) {
    return null;
  }
  return storedResponse(stored.response_json, stored.status_code);
}

async function recordIncident(
  env: Env,
  proposal: ExecutionProposalV1,
  proposalSha256: string,
  incidentKind:
    | "SEQUENCE_GAP"
    | "OUT_OF_ORDER"
    | "BODY_CONFLICT"
    | "CANDIDATE_CONFLICT",
  expectedSequence: number,
  existingSha256: string | null,
  receivedAtEpoch: number,
): Promise<string> {
  const incidentId = await sha256(
    [
      "incident-v1",
      proposal.producer_instance_id,
      String(proposal.producer_sequence),
      incidentKind,
      proposalSha256,
      String(receivedAtEpoch),
      crypto.randomUUID(),
    ].join("\u0000"),
  );
  const incidentJson = JSON.stringify({
    schema_version: "rd-entry-execution-producer-incident-v1",
    execution_mode: "PAPER_ONLY",
    incident_id: incidentId,
    incident_kind: incidentKind,
    producer_instance_id: proposal.producer_instance_id,
    producer_sequence: proposal.producer_sequence,
    expected_sequence: expectedSequence,
    proposal_sha256: proposalSha256,
    existing_sha256: existingSha256,
    recorded_at_epoch: receivedAtEpoch,
  });
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO observation_execution_producer_incidents (
           incident_id, producer_instance_id, producer_sequence,
           incident_kind, expected_sequence, proposal_sha256,
           existing_sha256, incident_json, recorded_at_epoch
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        incidentId,
        proposal.producer_instance_id,
        proposal.producer_sequence,
        incidentKind,
        expectedSequence,
        proposalSha256,
        existingSha256,
        incidentJson,
        receivedAtEpoch,
      ),
  ]);
  return incidentId;
}

function quarantineResponse(
  code: string,
  incidentId: string,
  message: string,
): Response {
  return jsonResponse(
    { error: { code, message, quarantine_id: incidentId } },
    409,
  );
}

async function ingestValidatedExecutionProposalV1(
  env: Env,
  proposalValue: unknown,
  receivedAtEpoch: number,
): Promise<Response> {
  if (!Number.isSafeInteger(receivedAtEpoch) || receivedAtEpoch < 0) {
    return errorResponse(
      422,
      "EXECUTION_PROPOSAL_RECEIVED_AT_INVALID",
      "Proposal receipt time failed validation",
    );
  }
  if (env.DB === undefined || env.DB === null) {
    return errorResponse(
      503,
      "EXECUTION_PROPOSAL_STORAGE_UNAVAILABLE",
      "Proposal storage is unavailable",
    );
  }
  const identities = reviewedIdentities(env);
  if (identities === null) {
    return errorResponse(
      503,
      "EXECUTION_PROPOSAL_IDENTITIES_UNAVAILABLE",
      "Reviewed proposal identities are unavailable",
    );
  }

  let validated;
  try {
    validated = await validatedProposalAndCandidate(proposalValue, identities);
  } catch {
    validated = null;
  }
  if (validated === null) {
    return errorResponse(
      422,
      "EXECUTION_PROPOSAL_V1_INVALID",
      "Execution proposal failed strict validation",
    );
  }
  const { proposal, candidate } = validated;
  const proposalJson = JSON.stringify(proposal);
  const candidateJson = JSON.stringify(candidate);
  const proposalSha256 = await sha256(proposalJson);
  const eventId = await sha256(
    [
      "proposal-event-v1",
      proposal.producer_instance_id,
      String(proposal.producer_sequence),
      proposalSha256,
    ].join("\u0000"),
  );
  const existing = await env.DB
    .prepare(
      `SELECT event_id, proposal_sha256
       FROM observation_execution_proposal_v1_events
       WHERE producer_instance_id = ? AND producer_sequence = ?`,
    )
    .bind(proposal.producer_instance_id, proposal.producer_sequence)
    .first<StoredEvent>();
  if (existing !== null) {
    if (existing.proposal_sha256 === proposalSha256) {
      const replay = await replayResponse(env, existing.event_id);
      return replay ?? errorResponse(
        503,
        "EXECUTION_PROPOSAL_STORAGE_UNAVAILABLE",
        "Stored proposal result is unavailable",
      );
    }
    const incidentId = await recordIncident(
      env,
      proposal,
      proposalSha256,
      "BODY_CONFLICT",
      proposal.producer_sequence,
      existing.proposal_sha256,
      receivedAtEpoch,
    );
    return quarantineResponse(
      "EXECUTION_PROPOSAL_BODY_CONFLICT",
      incidentId,
      "Producer sequence was already used for different proposal content",
    );
  }

  const checkpoint = await env.DB
    .prepare(
      `SELECT producer_sequence
       FROM observation_execution_producer_checkpoints
       WHERE producer_instance_id = ?
       ORDER BY producer_sequence DESC
       LIMIT 1`,
    )
    .bind(proposal.producer_instance_id)
    .first<StoredCheckpoint>();
  const expectedSequence = (checkpoint?.producer_sequence ?? 0) + 1;
  if (proposal.producer_sequence !== expectedSequence) {
    const kind = proposal.producer_sequence > expectedSequence
      ? "SEQUENCE_GAP"
      : "OUT_OF_ORDER";
    const incidentId = await recordIncident(
      env,
      proposal,
      proposalSha256,
      kind,
      expectedSequence,
      null,
      receivedAtEpoch,
    );
    return quarantineResponse(
      kind === "SEQUENCE_GAP"
        ? "EXECUTION_PROPOSAL_SEQUENCE_GAP"
        : "EXECUTION_PROPOSAL_OUT_OF_ORDER",
      incidentId,
      "Producer sequence is not the next contiguous value",
    );
  }

  const emissionEnabled = candidateEmissionEnabled(env);
  const dispatchEnabled = candidateDispatchEnabled(env);
  if (emissionEnabled) {
    const storedCandidate = await env.DB
      .prepare(
        `SELECT candidate_body_sha256
         FROM observation_execution_candidate_v1_payloads
         WHERE logical_candidate_id = ?`,
      )
      .bind(candidate.logical_candidate_id)
      .first<StoredCandidate>();
    if (
      storedCandidate !== null &&
      storedCandidate.candidate_body_sha256 !== candidate.candidate_body_sha256
    ) {
      const incidentId = await recordIncident(
        env,
        proposal,
        proposalSha256,
        "CANDIDATE_CONFLICT",
        expectedSequence,
        storedCandidate.candidate_body_sha256,
        receivedAtEpoch,
      );
      return quarantineResponse(
        "EXECUTION_CANDIDATE_BODY_CONFLICT",
        incidentId,
        "Logical candidate was already used for different content",
      );
    }
  }

  const checkpointId = await sha256(
    [
      "producer-checkpoint-v1",
      proposal.producer_instance_id,
      String(proposal.producer_sequence),
      proposalSha256,
    ].join("\u0000"),
  );
  const expiresAtEpoch = Math.max(
    receivedAtEpoch + 1,
    proposal.observed_at_epoch + CANDIDATE_TTL_SECONDS,
  );
  const result: ExecutionProposalIngestionResponse = {
    schema_version: "rd-entry-execution-proposal-ingestion-v1",
    status: "RECORDED",
    execution_mode: "PAPER_ONLY",
    event_id: eventId,
    producer_instance_id: proposal.producer_instance_id,
    producer_sequence: proposal.producer_sequence,
    proposal_sha256: proposalSha256,
    logical_candidate_id: candidate.logical_candidate_id,
    candidate_body_sha256: candidate.candidate_body_sha256,
    paper_result: "VALIDATED_ONLY",
    candidate_emission: emissionEnabled ? "STORED" : "DISABLED",
    candidate_dispatch: dispatchEnabled ? "ENABLED" : "DISABLED",
  };
  const resultJson = JSON.stringify(result);
  const statements = [
    env.DB
      .prepare(
        `INSERT INTO observation_execution_proposal_v1_events (
           event_id, producer_instance_id, producer_sequence, proposal_sha256,
           proposal_json, logical_candidate_id, candidate_body_sha256,
           execution_mode, entry_model, liquidity_cohort, direction,
           entry_ticks, stop_ticks, risk_distance_ticks, target_ticks,
           received_at_epoch
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        eventId,
        proposal.producer_instance_id,
        proposal.producer_sequence,
        proposalSha256,
        proposalJson,
        candidate.logical_candidate_id,
        candidate.candidate_body_sha256,
        proposal.execution_mode,
        proposal.entry_model,
        proposal.liquidity_cohort,
        proposal.direction,
        proposal.entry_ticks,
        proposal.stop_ticks,
        proposal.risk_distance_ticks,
        proposal.target_ticks,
        receivedAtEpoch,
      ),
    env.DB
      .prepare(
        `INSERT INTO observation_execution_proposal_v1_paper_results (
           event_id, status_code, response_json, recorded_at_epoch
         ) VALUES (?, ?, ?, ?)`,
      )
      .bind(eventId, 202, resultJson, receivedAtEpoch),
    env.DB
      .prepare(
        `INSERT INTO observation_execution_producer_checkpoints (
           checkpoint_id, producer_instance_id, producer_sequence,
           proposal_sha256, recorded_at_epoch
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        checkpointId,
        proposal.producer_instance_id,
        proposal.producer_sequence,
        proposalSha256,
        receivedAtEpoch,
      ),
  ];
  if (emissionEnabled) {
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO observation_execution_candidate_v1_payloads (
             logical_candidate_id, candidate_body_sha256, event_id,
             execution_mode, payload_json, created_at_epoch, expires_at_epoch
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          candidate.logical_candidate_id,
          candidate.candidate_body_sha256,
          eventId,
          candidate.execution_mode,
          candidateJson,
          receivedAtEpoch,
          expiresAtEpoch,
        ),
      env.DB
        .prepare(
          `INSERT INTO observation_execution_candidate_v1_deliveries (
             logical_candidate_id, status, attempt_count,
             next_attempt_at_epoch, lease_owner, lease_expires_at_epoch,
             acknowledged_at_epoch, receiver_status, last_error,
             created_at_epoch, expires_at_epoch, updated_at_epoch
           ) VALUES (?, 'PENDING', 0, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
        )
        .bind(
          candidate.logical_candidate_id,
          receivedAtEpoch,
          receivedAtEpoch,
          expiresAtEpoch,
          receivedAtEpoch,
        ),
    );
  }

  try {
    await env.DB.batch(statements);
    return storedResponse(resultJson, 202);
  } catch {
    const concurrent = await env.DB
      .prepare(
        `SELECT event_id, proposal_sha256
         FROM observation_execution_proposal_v1_events
         WHERE producer_instance_id = ? AND producer_sequence = ?`,
      )
      .bind(proposal.producer_instance_id, proposal.producer_sequence)
      .first<StoredEvent>();
    if (concurrent?.proposal_sha256 === proposalSha256) {
      const replay = await replayResponse(env, concurrent.event_id);
      if (replay !== null) return replay;
    }
    return errorResponse(
      503,
      "EXECUTION_PROPOSAL_STORAGE_UNAVAILABLE",
      "Proposal storage transaction failed",
    );
  }
}

export async function ingestExecutionProposalV1(
  env: Env,
  proposalBytes: Uint8Array,
  receivedAtEpoch: number,
): Promise<Response> {
  let proposalValue: unknown;
  try {
    proposalValue = parseStrictJson(proposalBytes);
  } catch {
    return errorResponse(
      422,
      "EXECUTION_PROPOSAL_V1_INVALID",
      "Execution proposal failed strict validation",
    );
  }
  return ingestValidatedExecutionProposalV1(env, proposalValue, receivedAtEpoch);
}

/** Used by the authenticated observation route after its one strict parse. */
export async function ingestParsedExecutionProposalV1(
  env: Env,
  proposalValue: unknown,
  receivedAtEpoch: number,
): Promise<Response> {
  return ingestValidatedExecutionProposalV1(env, proposalValue, receivedAtEpoch);
}
