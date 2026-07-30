import { parseStrictJson } from "./strict-json";
import {
  INSERT_RECEIPT_SQL,
  INSERT_SETUP_EVIDENCE_SQL,
  LIST_RECEIPTS_SQL,
  LIST_SETUP_EVIDENCE_SQL,
  SELECT_RECEIPT_SQL,
} from "./queries";
import { extractSetupEvidence } from "./setup-evidence";
import {
  accountCanonicalCommand,
  ledgerCanonicalCommand,
  PaperContractError,
  validatePaperAccountCreate,
  validatePaperAccountId,
  validatePaperLedgerAppend,
} from "./paper-ledger-contract";
import {
  INSERT_PAPER_ACCOUNT_SQL,
  INSERT_PAPER_LEDGER_ENTRY_SQL,
  LIST_PAPER_ACCOUNT_PROJECTIONS_SQL,
  LIST_PAPER_LEDGER_ENTRIES_SQL,
  SELECT_PAPER_ACCOUNT_BY_IDEMPOTENCY_SQL,
  SELECT_PAPER_ACCOUNT_PROJECTION_SQL,
  SELECT_PAPER_LEDGER_ENTRY_BY_IDEMPOTENCY_SQL,
} from "./paper-ledger-queries";
import {
  PaperSimulatorContractError,
  pnlRemainsSafe,
  tradeIntentCanonicalCommand,
  tradeSettlementCanonicalCommand,
  validatePaperIntentId,
  validatePaperTradeIntent,
  validatePaperTradeSettlement,
} from "./paper-simulator-contract";
import {
  INSERT_AUTOMATED_PAPER_TRADE_INTENT_SQL,
  INSERT_PAPER_TRADE_ALLOCATION_SQL,
  INSERT_PAPER_TRADE_INTENT_SQL,
  INSERT_PAPER_TRADE_SETTLEMENT_SQL,
  LIST_PAPER_SIMULATION_ACCOUNT_STATS_SQL,
  LIST_PAPER_SIMULATION_ROWS_SQL,
  LIST_PAPER_TRADE_ALLOCATIONS_SQL,
  SELECT_PAPER_TRADE_INTENT_SQL,
  SELECT_PAPER_TRADE_SETTLEMENT_SQL,
} from "./paper-simulator-queries";
import {
  PaperReadinessContractError,
  validatePaperKillSwitchCommand,
} from "./paper-readiness-contract";
import {
  INSERT_PAPER_KILL_SWITCH_EVENT_SQL,
  INSERT_BLOCKED_PAPER_AUTOMATION_INTENT_SQL,
  LIST_PAPER_ACCOUNT_READINESS_METRICS_SQL,
  SELECT_LATEST_PAPER_AUTOMATION_RECEIPT_SQL,
  SELECT_LATEST_PAPER_KILL_SWITCH_SQL,
  SELECT_BLOCKED_PAPER_AUTOMATION_INTENT_SQL,
  SELECT_PAPER_ACCOUNT_READINESS_METRIC_SQL,
  SELECT_PAPER_KILL_SWITCH_BY_IDEMPOTENCY_SQL,
  SELECT_PAPER_OPEN_INTENT_HEALTH_SQL,
} from "./paper-readiness-queries";
import {
  evaluatePaperReadiness,
  paperAccountAllowsNewOpen,
  PAPER_READINESS_THRESHOLDS,
} from "./paper-readiness";
import type {
  CanonicalValue,
  Env,
  ObservationReceipt,
  ObservationSetupEvidence,
  PaperAccountCreateCommand,
  PaperAccountProjection,
  PaperAutomationCommand,
  PaperLedgerAppendCommand,
  PaperReadinessAccountInput,
  PaperReadinessLatestReceipt,
  PaperReadinessOpenHealth,
  PaperSimulationAccountStat,
  PaperSimulationRow,
  PaperTradeIntentCommand,
  PaperTradeSettlementCommand,
  ReceiptMetadata,
  SetupEvidenceInsert,
  StoredPaperAccount,
  StoredBlockedPaperAutomationIntent,
  StoredPaperLedgerEntry,
  StoredPaperKillSwitchEvent,
  StoredPaperTradeAllocation,
  StoredPaperTradeIntent,
  StoredPaperTradeSettlement,
  StoredReceipt,
  StoredSetupEvidence,
} from "./types";
import {
  canonicalStringify,
  ObservationValidationError,
  validateObservationEnvelope,
} from "./validation";
import {
  EntryV2MessageTooLargeError,
  EntryV2ValidationError,
} from "./rd-entry-wire";
import { INSERT_MARKET_BAR_HEARTBEAT_SQL } from "./rd-entry-queries";
import { RD_ENTRY_PROMOTION_BINDING } from "./generated/rd-entry-promotion-binding";
import {
  appendEntryV2Observation,
  canonicalPaperSelectionConfigured,
  EntryStoreConflict,
  EntryStoreIdempotencyConflict,
  type EntryCodeIdentity,
} from "./rd-entry-store";
import {
  appendEntryV3Observation,
  EntryV3StoreConflict,
} from "./rd-entry-store-v3";
import {
  LIST_ENTRY_V3_DECISION_CANDIDATES_SQL,
  LIST_ENTRY_V3_DECISION_EVIDENCE_SQL,
  LIST_ENTRY_V3_DECISION_MEMBERS_SQL,
  LIST_ENTRY_V3_DECISION_PAPER_SQL,
  LIST_ENTRY_V3_DECISION_PARITY_SQL,
  LIST_ENTRY_V3_DECISION_SHADOW_SQL,
  LIST_ENTRY_V3_DECISIONS_SQL,
} from "./rd-entry-queries-v3";
import {
  validateEntryCandidateV3,
  validateEntryEvaluationV3,
  validateEntryEvidenceV3,
  validateSelectionShapeV3,
  type EntryCandidateEvidenceV3,
  type EntryCandidateV3,
  type EntrySelectionV3,
  type SelectionActionV3,
} from "./rd-entry-domain-v3";

export {
  canonicalPaperSelectionConfigured,
  type EntryCodeIdentity,
};

const DEFAULT_MAX_BODY_BYTES = 262_144;
const MIN_MAX_BODY_BYTES = 1_024;
const MAX_MAX_BODY_BYTES = 1_048_576;
const PAPER_MAX_BODY_BYTES = 16_384;
const MAX_DECISION_RESPONSE_BYTES = 1_048_576;
const MAX_STORED_DECISION_JSON_BYTES = 65_536;
const MAX_DECISION_CANDIDATES = 3;
const MAX_DECISION_EVIDENCE = 3;
const MAX_DECISION_MEMBERS = 6;
const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const SHA256 = /^[a-f0-9]{64}$/;

class BodyTooLargeError extends Error {}
class MalformedBodyError extends Error {}
class StorageUnavailableError extends Error {}

function responseHeaders(): Headers {
  return new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(),
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function ingressConfigured(env: Env): boolean {
  return (
    env.TRADINGVIEW_OBSERVATION_INGRESS_ENABLED === "true" &&
    typeof env.TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256 === "string" &&
    SHA256.test(env.TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256)
  );
}

function paperLedgerConfigured(env: Env): boolean {
  return (
    env.PAPER_LEDGER_ENABLED === "true" &&
    typeof env.PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256 === "string" &&
    SHA256.test(env.PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256)
  );
}

function bodyLimit(env: Env): number | null {
  const configured = env.TRADINGVIEW_OBSERVATION_MAX_BODY_BYTES;
  if (configured === undefined || configured === "") {
    return DEFAULT_MAX_BODY_BYTES;
  }
  if (!/^[0-9]+$/.test(configured)) {
    return null;
  }
  const parsed = Number(configured);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_MAX_BODY_BYTES ||
    parsed > MAX_MAX_BODY_BYTES
  ) {
    return null;
  }
  return parsed;
}

async function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^[0-9]+$/.test(declared)) {
      throw new MalformedBodyError();
    }
    const declaredBytes = Number(declared);
    if (!Number.isSafeInteger(declaredBytes)) {
      throw new MalformedBodyError();
    }
    if (declaredBytes > maximumBytes) {
      throw new BodyTooLargeError();
    }
  }

  if (request.body === null) {
    throw new MalformedBodyError();
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    total += result.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(result.value);
  }
  if (total === 0) {
    throw new MalformedBodyError();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function constantTimeHexEqual(expected: string, presented: string): boolean {
  if (expected.length !== 64 || presented.length !== 64) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < 64; index += 1) {
    difference |= expected.charCodeAt(index) ^ presented.charCodeAt(index);
  }
  return difference === 0;
}

async function requirePaperAuthorization(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (!paperLedgerConfigured(env)) {
    return errorResponse(
      503,
      "PAPER_LEDGER_DISABLED",
      "Paper ledger is disabled",
    );
  }
  const authorization = request.headers.get("authorization");
  const match =
    authorization === null
      ? null
      : /^Bearer ([\x21-\x7e]{1,1024})$/.exec(authorization);
  if (match === null) {
    return errorResponse(
      401,
      "INVALID_PAPER_CREDENTIAL",
      "Paper ledger credential was rejected",
    );
  }
  const credential = match[1];
  const expected = env.PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256;
  if (credential === undefined || expected === undefined) {
    return errorResponse(
      401,
      "INVALID_PAPER_CREDENTIAL",
      "Paper ledger credential was rejected",
    );
  }
  const presentedDigest = await sha256Hex(credential);
  if (!constantTimeHexEqual(expected, presentedDigest)) {
    return errorResponse(
      401,
      "INVALID_PAPER_CREDENTIAL",
      "Paper ledger credential was rejected",
    );
  }
  return null;
}

async function readPaperBody(request: Request): Promise<ReturnType<typeof parseStrictJson>> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new MalformedBodyError();
  }
  return parseStrictJson(await readBoundedBody(request, PAPER_MAX_BODY_BYTES));
}

function receipt(record: StoredReceipt, status: "RECEIVED" | "DUPLICATE"): ObservationReceipt {
  return {
    receipt_id: record.receipt_id,
    received_at: record.received_at,
    idempotency_key: record.idempotency_key,
    payload_sha256: record.payload_sha256,
    schema_version: record.schema_version,
    strategy_id: record.strategy_id,
    strategy_version: record.strategy_version,
    producer_instance_id: record.producer_instance_id,
    sequence: record.sequence,
    symbol: record.symbol,
    ticker_id: record.ticker_id,
    feed: record.feed,
    timeframe: record.timeframe,
    kind: record.kind,
    status,
  };
}

async function appendReceipt(
  env: Env,
  metadata: ReceiptMetadata,
  payloadSha256: string,
): Promise<{ readonly record: StoredReceipt; readonly inserted: boolean }> {
  if (env.DB === undefined || env.DB === null) {
    throw new StorageUnavailableError();
  }
  const receiptId = crypto.randomUUID();
  const receivedAt = new Date().toISOString();
  try {
    const insertion = await env.DB
      .prepare(INSERT_RECEIPT_SQL)
      .bind(
        receiptId,
        receivedAt,
        metadata.idempotencyKey,
        payloadSha256,
        metadata.schemaVersion,
        metadata.strategyId,
        metadata.strategyVersion,
        metadata.producerInstanceId,
        metadata.sequence,
        metadata.symbol,
        metadata.tickerId,
        metadata.feed,
        metadata.timeframe,
        metadata.kind,
      )
      .run();
    const record = await env.DB
      .prepare(SELECT_RECEIPT_SQL)
      .bind(metadata.idempotencyKey)
      .first<StoredReceipt>();
    if (record === null) {
      throw new StorageUnavailableError();
    }
    return {
      record,
      inserted: Number(insertion.meta.changes ?? 0) === 1,
    };
  } catch (error) {
    if (error instanceof StorageUnavailableError) {
      throw error;
    }
    const record = await env.DB
      .prepare(SELECT_RECEIPT_SQL)
      .bind(metadata.idempotencyKey)
      .first<StoredReceipt>();
    if (record !== null) {
      return { record, inserted: false };
    }
    throw new StorageUnavailableError();
  }
}

function insertReceiptStatement(
  env: Env,
  receiptId: string,
  receivedAt: string,
  metadata: ReceiptMetadata,
  payloadSha256: string,
): D1PreparedStatement {
  return env.DB
    .prepare(INSERT_RECEIPT_SQL)
    .bind(
      receiptId,
      receivedAt,
      metadata.idempotencyKey,
      payloadSha256,
      metadata.schemaVersion,
      metadata.strategyId,
      metadata.strategyVersion,
      metadata.producerInstanceId,
      metadata.sequence,
      metadata.symbol,
      metadata.tickerId,
      metadata.feed,
      metadata.timeframe,
      metadata.kind,
    );
}

function insertSetupEvidenceStatement(
  env: Env,
  receiptId: string,
  recordedAt: string,
  evidenceItems: readonly SetupEvidenceInsert[],
): D1PreparedStatement {
  const serializedEvidence = evidenceItems.map((evidence) => ({
    evidenceId: crypto.randomUUID(),
    ...evidence,
  }));
  return env.DB
    .prepare(INSERT_SETUP_EVIDENCE_SQL)
    .bind(
      receiptId,
      recordedAt,
      JSON.stringify(serializedEvidence),
    );
}

function insertLegacyHeartbeatStatement(
  env: Env,
  receiptId: string,
  recordedAt: string,
  metadata: ReceiptMetadata,
  canonicalPayload: Readonly<Record<string, CanonicalValue>>,
): D1PreparedStatement | null {
  const barOpenMilliseconds = canonicalPayload.bar_open_epoch;
  const barCloseMilliseconds = canonicalPayload.bar_close_epoch;
  const detectorCodeHash = canonicalPayload.detector_code_hash;
  const settingsHash = canonicalPayload.settings_hash;
  if (
    metadata.schemaVersion !== "1.2" ||
    typeof barOpenMilliseconds !== "number" ||
    typeof barCloseMilliseconds !== "number" ||
    !Number.isSafeInteger(barOpenMilliseconds) ||
    !Number.isSafeInteger(barCloseMilliseconds) ||
    barOpenMilliseconds < 0 ||
    barOpenMilliseconds % 1_000 !== 0 ||
    barCloseMilliseconds % 1_000 !== 0 ||
    barCloseMilliseconds - barOpenMilliseconds !== 300_000 ||
    typeof detectorCodeHash !== "string" ||
    !SHA256.test(detectorCodeHash) ||
    typeof settingsHash !== "string" ||
    !SHA256.test(settingsHash)
  ) {
    return null;
  }
  return env.DB
    .prepare(INSERT_MARKET_BAR_HEARTBEAT_SQL)
    .bind(
      receiptId,
      null,
      "1.2",
      "LEGACY_REFERENCE",
      metadata.producerInstanceId,
      metadata.sequence,
      metadata.strategyVersion,
      metadata.symbol,
      metadata.tickerId,
      metadata.feed,
      metadata.timeframe,
      barOpenMilliseconds / 1_000,
      barCloseMilliseconds / 1_000,
      detectorCodeHash,
      settingsHash,
      recordedAt,
    );
}

async function appendContractReceipt(
  env: Env,
  metadata: ReceiptMetadata,
  payloadSha256: string,
  evidenceItems: readonly SetupEvidenceInsert[],
  canonicalPayload: Readonly<Record<string, CanonicalValue>>,
): Promise<{ readonly record: StoredReceipt; readonly inserted: boolean }> {
  if (env.DB === undefined || env.DB === null) {
    throw new StorageUnavailableError();
  }
  const existing = await env.DB
    .prepare(SELECT_RECEIPT_SQL)
    .bind(metadata.idempotencyKey)
    .first<StoredReceipt>();
  if (existing !== null) {
    return { record: existing, inserted: false };
  }

  const receiptId = crypto.randomUUID();
  const receivedAt = new Date().toISOString();
  const heartbeat = insertLegacyHeartbeatStatement(
    env,
    receiptId,
    receivedAt,
    metadata,
    canonicalPayload,
  );
  let results: D1Result[];
  try {
    results = await env.DB.batch([
      insertReceiptStatement(
        env,
        receiptId,
        receivedAt,
        metadata,
        payloadSha256,
      ),
      ...(heartbeat === null ? [] : [heartbeat]),
      ...(evidenceItems.length === 0
        ? []
        : [
            insertSetupEvidenceStatement(
              env,
              receiptId,
              receivedAt,
              evidenceItems,
            ),
          ]),
    ]);
  } catch {
    const raced = await env.DB
      .prepare(SELECT_RECEIPT_SQL)
      .bind(metadata.idempotencyKey)
      .first<StoredReceipt>();
    if (raced !== null) {
      return { record: raced, inserted: false };
    }
    throw new StorageUnavailableError();
  }

  const record = await env.DB
    .prepare(SELECT_RECEIPT_SQL)
    .bind(metadata.idempotencyKey)
    .first<StoredReceipt>();
  if (
    record === null ||
    record.receipt_id !== receiptId ||
    Number(results[0]?.meta.changes ?? 0) !== 1
  ) {
    throw new StorageUnavailableError();
  }
  return { record, inserted: true };
}

type PreparedPaperAutomation = {
  readonly statements: readonly D1PreparedStatement[];
  readonly opened: number;
  readonly settled: number;
  readonly duplicates: number;
  readonly blocked: number;
  readonly conflicts: number;
};

function killSwitchEventIsSafe(
  value: StoredPaperKillSwitchEvent,
): boolean {
  return (
    Number.isSafeInteger(value.control_sequence) &&
    value.control_sequence >= 1 &&
    typeof value.event_id === "string" &&
    value.event_id.length > 0 &&
    typeof value.idempotency_key === "string" &&
    value.idempotency_key.length > 0 &&
    SHA256.test(value.payload_sha256) &&
    (value.enabled === 0 || value.enabled === 1) &&
    typeof value.reason === "string" &&
    value.reason.length >= 3 &&
    value.reason.length <= 240 &&
    Number.isFinite(Date.parse(value.changed_at))
  );
}

async function latestPaperKillSwitch(
  env: Env,
): Promise<StoredPaperKillSwitchEvent> {
  const event = await env.DB
    .prepare(SELECT_LATEST_PAPER_KILL_SWITCH_SQL)
    .first<StoredPaperKillSwitchEvent>();
  if (event === null || !killSwitchEventIsSafe(event)) {
    throw new StorageUnavailableError();
  }
  return event;
}

function blockedPaperIntentIsSafe(
  value: StoredBlockedPaperAutomationIntent,
): boolean {
  return (
    typeof value.intent_id === "string" &&
    value.intent_id.length > 0 &&
    typeof value.source_receipt_id === "string" &&
    value.source_receipt_id.length > 0 &&
    SHA256.test(value.payload_sha256) &&
    (value.reason_code === "KILL_SWITCH_ENABLED" ||
      value.reason_code === "RISK_LIMIT_REACHED" ||
      value.reason_code === "SAFETY_GATE_RACE" ||
      value.reason_code === "ACCOUNT_NOT_FOUND" ||
      value.reason_code === "NON_POSITIVE_BALANCE") &&
    Number.isFinite(Date.parse(value.blocked_at))
  );
}

async function selectBlockedPaperIntent(
  env: Env,
  intentId: string,
): Promise<StoredBlockedPaperAutomationIntent | null> {
  const blocked = await env.DB
    .prepare(SELECT_BLOCKED_PAPER_AUTOMATION_INTENT_SQL)
    .bind(intentId)
    .first<StoredBlockedPaperAutomationIntent>();
  if (blocked !== null && !blockedPaperIntentIsSafe(blocked)) {
    throw new StorageUnavailableError();
  }
  return blocked;
}

async function preparePaperAutomation(
  env: Env,
  commands: readonly PaperAutomationCommand[],
  receiptId: string,
  recordedAt: string,
  forceBlockOpens = false,
): Promise<PreparedPaperAutomation | Response> {
  if (commands.length > 0 && !paperLedgerConfigured(env)) {
    return errorResponse(
      503,
      "PAPER_AUTOMATION_DISABLED",
      "Paper automation is disabled",
    );
  }
  const statements: D1PreparedStatement[] = [];
  let opened = 0;
  let settled = 0;
  let duplicates = 0;
  let blocked = 0;
  let conflicts = 0;
  const candidateRiskByAccount = new Map<string, number>();
  const candidatePositionsByAccount = new Map<string, number>();
  let killSwitch: StoredPaperKillSwitchEvent | null = null;
  let killSwitchUnavailable = false;
  if (commands.some((command) => command.action === "OPEN")) {
    try {
      killSwitch = await latestPaperKillSwitch(env);
    } catch {
      killSwitchUnavailable = true;
    }
  }

  for (const command of commands) {
    if (command.action === "OPEN") {
      const intent = command.intent;
      const payloadSha256 = await sha256Hex(
        canonicalStringify(tradeIntentCanonicalCommand(intent)),
      );
      const existing = await selectPaperTradeBundle(env, intent.intent_id);
      if (existing !== null) {
        if (existing.intent.payload_sha256 !== payloadSha256) {
          blocked += 1;
          conflicts += 1;
          continue;
        }
        duplicates += 1;
        continue;
      }
      const terminalBlocked = await selectBlockedPaperIntent(
        env,
        intent.intent_id,
      );
      if (terminalBlocked !== null) {
        if (terminalBlocked.payload_sha256 !== payloadSha256) {
          blocked += 1;
          conflicts += 1;
          continue;
        }
        blocked += 1;
        continue;
      }
      let blockReason:
        | StoredBlockedPaperAutomationIntent["reason_code"]
        | null = forceBlockOpens || killSwitchUnavailable
        ? "SAFETY_GATE_RACE"
        : killSwitch?.enabled === 1
          ? "KILL_SWITCH_ENABLED"
          : null;
      const pendingMetrics: Array<{
        readonly accountId: string;
        readonly metric: PaperReadinessAccountInput;
        readonly riskAmount: number;
      }> = [];
      if (blockReason === null) {
        const accountResults = await env.DB.batch(
          intent.account_ids.map((accountId) =>
            env.DB
              .prepare(SELECT_PAPER_ACCOUNT_READINESS_METRIC_SQL)
              .bind(accountId),
          ),
        );
        for (let index = 0; index < intent.account_ids.length; index += 1) {
          const accountId = intent.account_ids[index];
          const metric =
            (accountResults[index]?.results[0] as
              | PaperReadinessAccountInput
              | undefined) ?? null;
          if (accountId === undefined) {
            throw new StorageUnavailableError();
          }
          if (metric === null) {
            blockReason = "ACCOUNT_NOT_FOUND";
            break;
          }
          if (!paperReadinessAccountInputIsSafe(metric)) {
            blockReason = "SAFETY_GATE_RACE";
            break;
          }
          const riskBigInt =
            (BigInt(metric.balance_minor) * BigInt(intent.risk_bps)) /
            10_000n;
          if (riskBigInt <= 0n) {
            blockReason = "NON_POSITIVE_BALANCE";
            break;
          }
          if (riskBigInt > BigInt(MAX_SAFE_INTEGER)) {
            blockReason = "RISK_LIMIT_REACHED";
            break;
          }
          const riskAmount = Number(riskBigInt);
          const pendingRisk =
            (candidateRiskByAccount.get(accountId) ?? 0) + riskAmount;
          const pendingPositions =
            (candidatePositionsByAccount.get(accountId) ?? 0) + 1;
          if (
            !paperAccountAllowsNewOpen(
              metric,
              pendingRisk,
              pendingPositions,
            )
          ) {
            blockReason = "RISK_LIMIT_REACHED";
            break;
          }
          pendingMetrics.push({ accountId, metric, riskAmount });
        }
      }
      if (blockReason !== null) {
        statements.push(
          env.DB
            .prepare(INSERT_BLOCKED_PAPER_AUTOMATION_INTENT_SQL)
            .bind(
              intent.intent_id,
              receiptId,
              payloadSha256,
              blockReason,
              recordedAt,
            ),
        );
        blocked += 1;
        continue;
      }
      for (const pending of pendingMetrics) {
        candidateRiskByAccount.set(
          pending.accountId,
          (candidateRiskByAccount.get(pending.accountId) ?? 0) +
            pending.riskAmount,
        );
        candidatePositionsByAccount.set(
          pending.accountId,
          (candidatePositionsByAccount.get(pending.accountId) ?? 0) + 1,
        );
      }

      statements.push(
        env.DB
          .prepare(INSERT_AUTOMATED_PAPER_TRADE_INTENT_SQL)
          .bind(
            intent.intent_id,
            paperIntentIdempotencyKey(intent.intent_id),
            payloadSha256,
            intent.symbol,
            intent.side,
            intent.entry_price,
            intent.stop_loss,
            intent.take_profit,
            intent.risk_bps,
            receiptId,
            recordedAt,
          ),
        ...intent.account_ids.map((accountId) =>
          env.DB
            .prepare(INSERT_PAPER_TRADE_ALLOCATION_SQL)
            .bind(
              intent.risk_bps,
              accountId,
              intent.intent_id,
              payloadSha256,
              crypto.randomUUID(),
              accountId,
              recordedAt,
            ),
        ),
      );
      opened += 1;
      continue;
    }

    const payloadSha256 = await sha256Hex(
      canonicalStringify(
        tradeSettlementCanonicalCommand(
          command.intent_id,
          command.settlement,
        ),
      ),
    );
    const existing = await selectPaperTradeBundle(env, command.intent_id);
    if (existing === null) {
      const blockedIntent = await selectBlockedPaperIntent(
        env,
        command.intent_id,
      );
      if (blockedIntent !== null) {
        blocked += 1;
        continue;
      }
      blocked += 1;
      conflicts += 1;
      continue;
    }
    if (existing.settlement !== null) {
      if (existing.settlement.payload_sha256 !== payloadSha256) {
        blocked += 1;
        conflicts += 1;
        continue;
      }
      duplicates += 1;
      continue;
    }

    let settlementBlocked = false;
    const projectionResults = await env.DB.batch(
      existing.allocations.map((allocation) =>
        env.DB
          .prepare(SELECT_PAPER_ACCOUNT_PROJECTION_SQL)
          .bind(allocation.account_id),
      ),
    );
    for (let index = 0; index < existing.allocations.length; index += 1) {
      const allocation = existing.allocations[index];
      const projection =
        (projectionResults[index]?.results[0] as
          | PaperAccountProjection
          | undefined) ?? null;
      if (
        allocation === undefined
      ) {
        throw new StorageUnavailableError();
      }
      if (projection === null || !projectionIsSafe(projection)) {
        settlementBlocked = true;
        break;
      }
      const pnlMinor = simulationPnlMinor(
        allocation.risk_amount_minor,
        command.settlement.outcome_r_millis,
      );
      if (!balanceRemainsSafe(projection.balance_minor, pnlMinor)) {
        settlementBlocked = true;
        break;
      }
    }
    if (settlementBlocked) {
      blocked += 1;
      conflicts += 1;
      continue;
    }

    statements.push(
      env.DB
        .prepare(INSERT_PAPER_TRADE_SETTLEMENT_SQL)
        .bind(
          crypto.randomUUID(),
          command.intent_id,
          paperSettlementIdempotencyKey(command.intent_id),
          payloadSha256,
          command.settlement.outcome_r_millis,
          command.settlement.exit_reason,
          recordedAt,
        ),
    );
    settled += 1;
  }

  return {
    statements,
    opened,
    settled,
    duplicates,
    blocked,
    conflicts,
  };
}

function automatedReceiptReplayResponse(
  record: StoredReceipt,
  payloadSha256: string,
  commandCount: number,
): Response {
  if (record.payload_sha256 !== payloadSha256) {
    return errorResponse(
      409,
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was already used for different observation content",
    );
  }
  return jsonResponse(
    {
      ...receipt(record, "DUPLICATE"),
      paper_automation: {
        status: "DUPLICATE",
        opened: 0,
        settled: 0,
        duplicates: commandCount,
        blocked: 0,
        conflicts: 0,
      },
    },
    200,
  );
}

function automationBatchRaceIsRetryable(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    message.includes("unique constraint") ||
    message.includes("paper safety gate blocked allocation") ||
    message.includes("paper intent id already blocked") ||
    message.includes("paper intent id already live")
  );
}

async function appendAutomatedObservation(
  env: Env,
  metadata: ReceiptMetadata,
  payloadSha256: string,
  commands: readonly PaperAutomationCommand[],
): Promise<Response> {
  if (env.DB === undefined || env.DB === null) {
    throw new StorageUnavailableError();
  }
  const existing = await env.DB
    .prepare(SELECT_RECEIPT_SQL)
    .bind(metadata.idempotencyKey)
    .first<StoredReceipt>();
  if (existing !== null) {
    return automatedReceiptReplayResponse(
      existing,
      payloadSha256,
      commands.length,
    );
  }

  const receiptId = crypto.randomUUID();
  const receivedAt = new Date().toISOString();
  const prepared = await preparePaperAutomation(
    env,
    commands,
    receiptId,
    receivedAt,
  );
  if (prepared instanceof Response) {
    return prepared;
  }
  let applied = prepared;
  let results: D1Result[];
  const applyBatch = async (
    candidate: PreparedPaperAutomation,
  ): Promise<D1Result[]> =>
    env.DB.batch([
      insertReceiptStatement(
        env,
        receiptId,
        receivedAt,
        metadata,
        payloadSha256,
      ),
      ...candidate.statements,
    ]);
  try {
    results = await applyBatch(applied);
  } catch (error) {
    const raced = await env.DB
      .prepare(SELECT_RECEIPT_SQL)
      .bind(metadata.idempotencyKey)
      .first<StoredReceipt>();
    if (raced !== null) {
      return automatedReceiptReplayResponse(
        raced,
        payloadSha256,
        commands.length,
      );
    }
    if (!automationBatchRaceIsRetryable(error)) {
      throw error;
    }
    const forceBlockOpens = String(error).includes(
      "paper safety gate blocked allocation",
    );
    const fallback = await preparePaperAutomation(
      env,
      commands,
      receiptId,
      receivedAt,
      forceBlockOpens,
    );
    if (fallback instanceof Response) return fallback;
    applied = fallback;
    try {
      results = await applyBatch(applied);
    } catch (retryError) {
      const retryReceipt = await env.DB
        .prepare(SELECT_RECEIPT_SQL)
        .bind(metadata.idempotencyKey)
        .first<StoredReceipt>();
      if (retryReceipt !== null) {
        return automatedReceiptReplayResponse(
          retryReceipt,
          payloadSha256,
          commands.length,
        );
      }
      throw retryError;
    }
  }
  const record = await env.DB
    .prepare(SELECT_RECEIPT_SQL)
    .bind(metadata.idempotencyKey)
    .first<StoredReceipt>();
  if (record === null || record.payload_sha256 !== payloadSha256) {
    throw new StorageUnavailableError();
  }
  const inserted = Number(results[0]?.meta.changes ?? 0) === 1;
  return jsonResponse(
    {
      ...receipt(record, inserted ? "RECEIVED" : "DUPLICATE"),
      paper_automation: {
        status:
          commands.length === 0
            ? "NONE"
            : applied.blocked > 0
              ? applied.opened > 0 || applied.settled > 0
                ? "PARTIAL"
                : "BLOCKED"
              : "APPLIED",
        opened: applied.opened,
        settled: applied.settled,
        duplicates: applied.duplicates,
        blocked: applied.blocked,
        conflicts: applied.conflicts,
      },
    },
    inserted ? 202 : 200,
  );
}

async function postObservation(request: Request, env: Env): Promise<Response> {
  if (!ingressConfigured(env)) {
    return errorResponse(
      503,
      "INGRESS_DISABLED",
      "TradingView observation ingress is disabled",
    );
  }
  const maximumBytes = bodyLimit(env);
  if (maximumBytes === null) {
    return errorResponse(
      503,
      "INGRESS_UNAVAILABLE",
      "TradingView observation ingress is unavailable",
    );
  }
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return errorResponse(
      422,
      "INVALID_OBSERVATION",
      "Observation body is malformed",
    );
  }

  let body: Uint8Array;
  try {
    body = await readBoundedBody(request, maximumBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse(
        413,
        "BODY_TOO_LARGE",
        "Observation body exceeds the configured byte limit",
      );
    }
    return errorResponse(
      422,
      "INVALID_OBSERVATION",
      "Observation body is malformed",
    );
  }

  let observation;
  try {
    observation = await validateObservationEnvelope(
      parseStrictJson(body),
      body,
      env.RD_ENTRY_V3_DETECTOR_CODE_HASH !== undefined &&
        env.RD_ENTRY_V3_SETTINGS_HASH !== undefined
        ? {
            detector_code_hash: env.RD_ENTRY_V3_DETECTOR_CODE_HASH,
            settings_hash: env.RD_ENTRY_V3_SETTINGS_HASH,
          }
        : undefined,
    );
  } catch (error) {
    if (error instanceof EntryV2MessageTooLargeError) {
      return errorResponse(
        error.status,
        error.code,
        "Schema 2.0 observation body exceeds the compact wire limit",
      );
    }
    if (
      error instanceof ObservationValidationError ||
      error instanceof EntryV2ValidationError ||
      error instanceof Error
    ) {
      return errorResponse(
        422,
        "INVALID_OBSERVATION",
        "Observation envelope failed validation",
      );
    }
    return errorResponse(
      422,
      "INVALID_OBSERVATION",
      "Observation envelope failed validation",
    );
  }

  const presentedDigest = await sha256Hex(observation.credential);
  const observationDigest = env.TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256;
  const automationDigest =
    env.TRADINGVIEW_PAPER_AUTOMATION_CREDENTIAL_SHA256;
  const observationCredentialMatches =
    observationDigest !== undefined &&
    constantTimeHexEqual(observationDigest, presentedDigest);
  const automationCredentialMatches =
    observation.metadata.schemaVersion === "1.1" &&
    automationDigest !== undefined &&
    SHA256.test(automationDigest) &&
    constantTimeHexEqual(automationDigest, presentedDigest);
  if (!observationCredentialMatches && !automationCredentialMatches) {
    return errorResponse(
      401,
      "INVALID_CREDENTIAL",
      "Observation credential was rejected",
    );
  }

  const payloadSha256 = await sha256Hex(
    canonicalStringify(observation.canonicalPayload),
  );
  try {
    if (observation.version === "entry-v2") {
      let result;
      try {
        result = await appendEntryV2Observation(
          env,
          observation,
          payloadSha256,
        );
      } catch (error) {
        if (error instanceof EntryStoreIdempotencyConflict) {
          return errorResponse(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for different observation content",
          );
        }
        if (error instanceof EntryStoreConflict) {
          return jsonResponse(
            {
              error: {
                code: error.code,
                quarantine_id: error.quarantineId,
              },
              execution: "DISABLED",
            },
            409,
          );
        }
        throw error;
      }
      if (result.status === "CONFLICT") {
        return jsonResponse(
          {
            error: {
              code: result.conflictCode,
              quarantine_id: result.quarantineId,
              batch_id: result.batchId,
            },
            execution: "DISABLED",
          },
          409,
        );
      }
      return jsonResponse(
        {
          ...receipt(
            result.record,
            result.inserted ? "RECEIVED" : "DUPLICATE",
          ),
          assembly: {
            batch_id: result.batchId,
            status: result.assemblyStatus,
            missing_chunk_indexes: result.missingChunkIndexes,
          },
          evaluation_count: result.evaluations.length,
          parity: {
            matches: result.evaluations.filter(
              (item) => item.parityStatus === "MATCH",
            ).length,
            mismatches: result.evaluations.filter(
              (item) => item.parityStatus === "MISMATCH",
            ).length,
            not_provided: result.evaluations.filter(
              (item) => item.parityStatus === "NOT_PROVIDED",
            ).length,
          },
          canonical_paper_enabled:
            canonicalPaperSelectionConfigured(
              env,
              observation.batchMetadata,
            ),
          execution: "DISABLED",
        },
        result.inserted ? 202 : 200,
      );
    }
    if (observation.version === "entry-v3") {
      try {
        const result = await appendEntryV3Observation(
          env,
          observation,
          payloadSha256,
        );
        return jsonResponse(
          {
            status: result.inserted ? "RECEIVED" : "DUPLICATE",
            event_id: result.eventId,
            evaluations: result.evaluations.map((item) => ({
              setup_id: item.evaluation.selection.setup_id,
              selection_id: item.evaluation.selection.selection_id,
              canonical_model: item.evaluation.selection.canonical_model,
              co_triggered_models:
                item.evaluation.selection.co_triggered_models,
              policy_action: item.evaluation.selection.action,
              action: item.effectiveAction,
              effective_action_reason: item.effectiveActionReason,
              parity_status: item.parityStatus,
              parity_mismatch_reason: item.parityMismatchReason,
            })),
            paper_intent_ids: result.paperIntentIds,
            execution: "PAPER_ONLY",
          },
          result.inserted ? 202 : 200,
        );
      } catch (error) {
        if (error instanceof EntryV3StoreConflict) {
          return errorResponse(
            409,
            error.code,
            "Version 3 observation identity conflicts with stored content",
          );
        }
        throw error;
      }
    }
    if (observation.metadata.schemaVersion === "1.1") {
      return await appendAutomatedObservation(
        env,
        observation.metadata,
        payloadSha256,
        observation.paperCommands,
      );
    }
    const result =
      observation.metadata.schemaVersion === "1.2"
        ? await appendContractReceipt(
            env,
            observation.metadata,
            payloadSha256,
            extractSetupEvidence(observation.canonicalPayload),
            observation.canonicalPayload,
          )
        : await appendReceipt(env, observation.metadata, payloadSha256);
    if (!result.inserted && result.record.payload_sha256 !== payloadSha256) {
      return errorResponse(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was already used for different observation content",
      );
    }
    const status = result.inserted ? "RECEIVED" : "DUPLICATE";
    return jsonResponse(receipt(result.record, status), result.inserted ? 202 : 200);
  } catch {
    return errorResponse(
      503,
      "INGRESS_UNAVAILABLE",
      "TradingView observation ingress is unavailable",
    );
  }
}

function parseLimit(url: URL): number | null {
  const values = url.searchParams.getAll("limit");
  if (values.length === 0) {
    return 50;
  }
  if (values.length !== 1 || !/^[0-9]+$/.test(values[0] ?? "")) {
    return null;
  }
  const limit = Number(values[0]);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    return null;
  }
  return limit;
}

function parseExactDecisionLimit(url: URL): number | null {
  if (
    [...url.searchParams.keys()].some((key) => key !== "limit") ||
    url.searchParams.getAll("limit").length !== 1
  ) {
    return null;
  }
  const raw = url.searchParams.get("limit") ?? "";
  if (!/^[0-9]+$/u.test(raw)) return null;
  const limit = Number(raw);
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= 200
    ? limit
    : null;
}

interface DecisionSelectionRow {
  readonly selection_id: string;
  readonly logical_selection_id: string;
  readonly event_id: string;
  readonly setup_id: string;
  readonly attempt_kind: "INITIAL" | "RE_ENTRY";
  readonly policy_action: SelectionActionV3;
  readonly action: SelectionActionV3;
  readonly effective_action_reason:
    | "PROMOTION_IDENTITY_MISMATCH"
    | "PAPER_CONFIGURATION_UNAVAILABLE"
    | "NOT_SELECTED_ALREADY_OPEN"
    | null;
  readonly liquidity_cohort: "ONE_CANDLE" | "TWO_PLUS_CANDLES";
  readonly one_candle_enabled: number;
  readonly canonical_candidate_id: string | null;
  readonly canonical_evidence_id: string | null;
  readonly co_triggered_models_json: string;
  readonly evaluated_at_epoch: number;
  readonly selected_trigger_epoch: number | null;
  readonly selected_trigger_sequence: number | null;
  readonly entry_ticks: number;
  readonly stop_ticks: number;
  readonly target_ticks: number;
  readonly selection_json: string;
  readonly symbol: string;
  readonly tick_size: string;
}

interface DecisionCandidateRow {
  readonly selection_id: string;
  readonly member_object_id: string;
  readonly candidate_id: string;
  readonly logical_candidate_id: string;
  readonly event_id: string;
  readonly setup_id: string;
  readonly candidate_json: string;
}

interface DecisionEvidenceRow {
  readonly selection_id: string;
  readonly member_object_id: string;
  readonly evidence_id: string;
  readonly logical_evidence_id: string;
  readonly event_id: string;
  readonly candidate_id: string;
  readonly logical_candidate_id: string;
  readonly evidence_json: string;
}

interface DecisionMemberRow {
  readonly selection_id: string;
  readonly object_kind: "CANDIDATE" | "EVIDENCE";
  readonly object_id: string;
}

interface DecisionParityRow {
  readonly event_id: string;
  readonly selection_id: string;
  readonly parity_status: "MATCH" | "MISMATCH" | "NOT_PROVIDED";
  readonly mismatch_reason:
    | "CANDIDATE_IDENTITIES"
    | "EVIDENCE_IDENTITIES"
    | "SELECTED_CANDIDATE"
    | "REASON"
    | "ACTION"
    | "MULTIPLE"
    | null;
}

interface DecisionPaperRow {
  readonly selection_id: string;
  readonly opened_decision_id: string;
  readonly opened_selection_id: string;
  readonly opened_canonical_model: "BOC" | "DIR_CLOSE" | "HTF_FLIP";
  readonly opened_reason: EntrySelectionV3["reason"];
  readonly opened_evaluated_at_epoch: number;
  readonly intent_id: string;
  readonly entry_price: string;
  readonly stop_loss: string;
  readonly take_profit: string;
  readonly trade_state: "OPEN" | "SETTLED";
}

interface DecisionShadowRow {
  readonly selection_id: string;
  readonly candidate_id: string;
  readonly state: "OPEN" | "STOPPED" | "TARGET_HIT" | "AMBIGUOUS";
  readonly outcome_r_millis: number | null;
  readonly liquidity_cohort: "ONE_CANDLE" | "TWO_PLUS_CANDLES";
  readonly one_candle_enabled: number;
}

function validateStoredDecisionCohort(
  liquidityCohort: unknown,
  oneCandleEnabled: unknown,
): void {
  if (
    (liquidityCohort !== "ONE_CANDLE" &&
      liquidityCohort !== "TWO_PLUS_CANDLES") ||
    (oneCandleEnabled !== 0 && oneCandleEnabled !== 1) ||
    (liquidityCohort === "ONE_CANDLE" && oneCandleEnabled !== 1)
  ) {
    throw new StorageUnavailableError();
  }
}

function parseStoredDecisionJson<T>(
  value: string,
  validate: (parsed: T) => void,
): T {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).byteLength > MAX_STORED_DECISION_JSON_BYTES
  ) {
    throw new StorageUnavailableError();
  }
  const parsed = JSON.parse(value) as T;
  validate(parsed);
  return parsed;
}

function decisionCandidateView(
  candidate: EntryCandidateV3,
  evidence: EntryCandidateEvidenceV3,
): Record<string, unknown> {
  if (evidence.candidate_id !== candidate.candidate_id) {
    throw new StorageUnavailableError();
  }
  const referenceCandle =
    evidence.boc_tier === null
      ? null
      : {
          open_epoch: evidence.reference_candle_open_epoch,
          open_ticks: evidence.reference_candle_open_ticks,
          high_ticks: evidence.reference_candle_high_ticks,
          low_ticks: evidence.reference_candle_low_ticks,
          close_ticks: evidence.reference_candle_close_ticks,
        };
  return {
    candidate_id: candidate.candidate_id,
    model: candidate.model,
    state: candidate.state,
    direction: candidate.direction,
    event_anchor_epoch: candidate.event_anchor_epoch,
    trigger_ordinal: candidate.trigger_ordinal,
    boc_tier: candidate.boc_tier,
    reference_candle_open_epoch: candidate.reference_candle_open_epoch,
    source_claim_ids: [...candidate.source_claim_ids],
    evidence: {
      evidence_id: evidence.evidence_id,
      candidate_id: evidence.candidate_id,
      observed_trigger_epoch: evidence.observed_trigger_epoch,
      trigger_sequence: evidence.trigger_sequence,
      observed_trigger_ticks: evidence.observed_trigger_ticks,
      fidelity: evidence.fidelity,
      proof_plane: evidence.proof_plane,
      replayability: evidence.replayability,
      htf_context_minutes: [...evidence.htf_context_minutes],
      coverage_start_epoch: evidence.coverage_start_epoch,
      coverage_end_epoch: evidence.coverage_end_epoch,
      ambiguity_codes: [...evidence.ambiguity_codes],
      passed_rule_ids: [...evidence.passed_rule_ids],
      failed_rule_ids: [...evidence.failed_rule_ids],
      reference_candle: referenceCandle,
      contact_candle: evidence.contact_candle,
      recross_candle: evidence.recross_candle,
    },
  };
}

function decisionSelectionView(
  selection: EntrySelectionV3,
  row: DecisionSelectionRow,
): Record<string, unknown> {
  if (
    selection.setup_id !== row.setup_id ||
    selection.action !== row.policy_action ||
    selection.evaluated_at_epoch !== row.evaluated_at_epoch
  ) {
    throw new StorageUnavailableError();
  }
  return {
    selection_id: selection.selection_id,
    setup_id: selection.setup_id,
    policy_version: selection.policy_version,
    revision: selection.revision,
    candidate_ids_considered: [...selection.candidate_ids_considered],
    canonical_candidate_id: selection.canonical_candidate_id,
    canonical_evidence_id: selection.canonical_evidence_id,
    canonical_model: selection.canonical_model,
    reason: selection.reason,
    fidelity: selection.fidelity,
    policy_action: row.policy_action,
    action: row.action,
    effective_action_reason: row.effective_action_reason,
    liquidity_cohort: row.liquidity_cohort,
    one_candle_enabled: row.one_candle_enabled === 1,
    co_triggered_models: [...selection.co_triggered_models],
    evaluated_at_epoch: selection.evaluated_at_epoch,
    selected_trigger_epoch: row.selected_trigger_epoch,
    selected_trigger_sequence: row.selected_trigger_sequence,
  };
}

async function listRdEntryDecisions(
  request: Request,
  env: Env,
): Promise<Response> {
  const authorizationError = await requirePaperAuthorization(request, env);
  if (authorizationError !== null) return authorizationError;
  const limit = parseExactDecisionLimit(new URL(request.url));
  if (limit === null) {
    return errorResponse(
      422,
      "INVALID_LIMIT",
      "Entry decision limit must be supplied once as an integer between 1 and 200",
    );
  }
  try {
    const selectionResult = await env.DB
      .prepare(LIST_ENTRY_V3_DECISIONS_SQL)
      .bind(limit)
      .all<DecisionSelectionRow>();
    const selectionRows = selectionResult.results;
    if (selectionRows.length === 0) {
      return jsonResponse({
        schema_version: "1.0",
        mode: "PAPER_ONLY",
        count: 0,
        items: [],
      });
    }
    const storageIds = selectionRows.map((row) => row.selection_id);
    if (
      storageIds.length > limit ||
      new Set(storageIds).size !== storageIds.length
    ) {
      throw new StorageUnavailableError();
    }
    const ids = JSON.stringify(storageIds);
    const candidateLimit =
      selectionRows.length * MAX_DECISION_CANDIDATES + 1;
    const evidenceLimit =
      selectionRows.length * MAX_DECISION_EVIDENCE + 1;
    const memberLimit = selectionRows.length * MAX_DECISION_MEMBERS + 1;
    const relationLimit = selectionRows.length + 1;
    const [
      memberResult,
      candidateResult,
      evidenceResult,
      parityResult,
      paperResult,
      shadowResult,
    ] = await env.DB.batch([
      env.DB
        .prepare(LIST_ENTRY_V3_DECISION_MEMBERS_SQL)
        .bind(ids, memberLimit),
      env.DB
        .prepare(LIST_ENTRY_V3_DECISION_CANDIDATES_SQL)
        .bind(ids, candidateLimit),
      env.DB
        .prepare(LIST_ENTRY_V3_DECISION_EVIDENCE_SQL)
        .bind(ids, evidenceLimit),
      env.DB
        .prepare(LIST_ENTRY_V3_DECISION_PARITY_SQL)
        .bind(ids, relationLimit),
      env.DB
        .prepare(LIST_ENTRY_V3_DECISION_PAPER_SQL)
        .bind(ids, relationLimit),
      env.DB
        .prepare(LIST_ENTRY_V3_DECISION_SHADOW_SQL)
        .bind(ids, relationLimit),
    ]);
    const memberRows =
      (memberResult?.results as unknown as DecisionMemberRow[] | undefined) ??
      [];
    const candidateRows =
      (candidateResult?.results as unknown as DecisionCandidateRow[] | undefined) ??
      [];
    const evidenceRows =
      (evidenceResult?.results as unknown as DecisionEvidenceRow[] | undefined) ??
      [];
    const parityRows =
      (parityResult?.results as unknown as DecisionParityRow[] | undefined) ?? [];
    const paperRows =
      (paperResult?.results as unknown as DecisionPaperRow[] | undefined) ?? [];
    const shadowRows =
      (shadowResult?.results as unknown as DecisionShadowRow[] | undefined) ?? [];
    if (
      memberRows.length >= memberLimit ||
      candidateRows.length >= candidateLimit ||
      evidenceRows.length >= evidenceLimit ||
      parityRows.length >= relationLimit ||
      paperRows.length >= relationLimit ||
      shadowRows.length >= relationLimit
    ) {
      throw new StorageUnavailableError();
    }

    const membersBySelection = new Map<string, DecisionMemberRow[]>();
    const candidatesBySelection = new Map<string, DecisionCandidateRow[]>();
    const evidenceBySelection = new Map<string, DecisionEvidenceRow[]>();
    for (const row of memberRows) {
      const current = membersBySelection.get(row.selection_id) ?? [];
      current.push(row);
      membersBySelection.set(row.selection_id, current);
    }
    for (const row of candidateRows) {
      const current = candidatesBySelection.get(row.selection_id) ?? [];
      current.push(row);
      candidatesBySelection.set(row.selection_id, current);
    }
    for (const row of evidenceRows) {
      const current = evidenceBySelection.get(row.selection_id) ?? [];
      current.push(row);
      evidenceBySelection.set(row.selection_id, current);
    }
    const parityBySelection = new Map(
      parityRows.map((row) => [row.selection_id, row]),
    );
    const paperBySelection = new Map(
      paperRows.map((row) => [row.selection_id, row]),
    );
    const shadowBySelection = new Map(
      shadowRows.map((row) => [row.selection_id, row]),
    );
    if (
      parityRows.length !== selectionRows.length ||
      parityBySelection.size !== selectionRows.length ||
      paperBySelection.size !== paperRows.length ||
      shadowBySelection.size !== shadowRows.length
    ) {
      throw new StorageUnavailableError();
    }

    const items = selectionRows.map((row) => {
      validateStoredDecisionCohort(
        row.liquidity_cohort,
        row.one_candle_enabled,
      );
      if (
        !Number.isSafeInteger(row.entry_ticks) ||
        !Number.isSafeInteger(row.stop_ticks) ||
        !Number.isSafeInteger(row.target_ticks) ||
        typeof row.tick_size !== "string" ||
        row.tick_size.length < 1 ||
        row.tick_size.length > 32 ||
        typeof row.symbol !== "string" ||
        row.symbol.length < 1 ||
        row.symbol.length > 64
      ) {
        throw new StorageUnavailableError();
      }
      const selection = parseStoredDecisionJson<EntrySelectionV3>(
        row.selection_json,
        validateSelectionShapeV3,
      );
      if (
        selection.selection_id !== row.logical_selection_id ||
        selection.setup_id !== row.setup_id
      ) {
        throw new StorageUnavailableError();
      }
      const storedMembers = membersBySelection.get(row.selection_id) ?? [];
      const storedCandidates = candidatesBySelection.get(row.selection_id) ?? [];
      const storedEvidence = evidenceBySelection.get(row.selection_id) ?? [];
      if (
        storedCandidates.length < 1 ||
        storedCandidates.length > MAX_DECISION_CANDIDATES ||
        storedEvidence.length !== storedCandidates.length ||
        storedEvidence.length > MAX_DECISION_EVIDENCE ||
        storedMembers.length !== storedCandidates.length + storedEvidence.length
      ) {
        throw new StorageUnavailableError();
      }
      const candidateRowsByStorageId = new Map<string, DecisionCandidateRow>();
      const candidateStorageIdByLogicalId = new Map<string, string>();
      const candidates = storedCandidates.map((item) => {
        const candidate = parseStoredDecisionJson<EntryCandidateV3>(
          item.candidate_json,
          validateEntryCandidateV3,
        );
        if (
          candidate.candidate_id !== item.logical_candidate_id ||
          candidate.setup_id !== row.setup_id ||
          item.candidate_id !== item.member_object_id ||
          item.event_id !== row.event_id ||
          item.setup_id !== row.setup_id ||
          candidateRowsByStorageId.has(item.candidate_id) ||
          candidateStorageIdByLogicalId.has(candidate.candidate_id)
        ) {
          throw new StorageUnavailableError();
        }
        candidateRowsByStorageId.set(item.candidate_id, item);
        candidateStorageIdByLogicalId.set(
          candidate.candidate_id,
          item.candidate_id,
        );
        return candidate;
      });
      const evidenceByCandidate = new Map<string, EntryCandidateEvidenceV3>();
      const evidenceRowsByStorageId = new Map<string, DecisionEvidenceRow>();
      const evidenceStorageIdByLogicalId = new Map<string, string>();
      for (const item of storedEvidence) {
        const evidence = parseStoredDecisionJson<EntryCandidateEvidenceV3>(
          item.evidence_json,
          validateEntryEvidenceV3,
        );
        const owningCandidate = candidateRowsByStorageId.get(item.candidate_id);
        if (
          evidence.evidence_id !== item.logical_evidence_id ||
          evidence.candidate_id !== item.logical_candidate_id ||
          item.evidence_id !== item.member_object_id ||
          item.event_id !== row.event_id ||
          owningCandidate === undefined ||
          owningCandidate.logical_candidate_id !== evidence.candidate_id ||
          evidenceByCandidate.has(evidence.candidate_id) ||
          evidenceRowsByStorageId.has(item.evidence_id) ||
          evidenceStorageIdByLogicalId.has(evidence.evidence_id)
        ) {
          throw new StorageUnavailableError();
        }
        evidenceByCandidate.set(evidence.candidate_id, evidence);
        evidenceRowsByStorageId.set(item.evidence_id, item);
        evidenceStorageIdByLogicalId.set(
          evidence.evidence_id,
          item.evidence_id,
        );
      }
      const expectedMembers = new Set([
        ...candidateRowsByStorageId.keys(),
        ...evidenceRowsByStorageId.keys(),
      ]);
      if (
        new Set(storedMembers.map((member) => member.object_id)).size !==
          storedMembers.length ||
        storedMembers.some(
          (member) =>
            !expectedMembers.has(member.object_id) ||
            (member.object_kind === "CANDIDATE") !==
              candidateRowsByStorageId.has(member.object_id),
        )
      ) {
        throw new StorageUnavailableError();
      }
      const considered = new Set(selection.candidate_ids_considered);
      if (
        considered.size !== candidates.length ||
        candidates.some((candidate) => !considered.has(candidate.candidate_id))
      ) {
        throw new StorageUnavailableError();
      }
      if (
        typeof row.co_triggered_models_json !== "string" ||
        new TextEncoder().encode(row.co_triggered_models_json).byteLength > 128
      ) {
        throw new StorageUnavailableError();
      }
      const rawCoTriggeredModels = JSON.parse(row.co_triggered_models_json) as unknown;
      if (
        !Array.isArray(rawCoTriggeredModels) ||
        rawCoTriggeredModels.length !== selection.co_triggered_models.length ||
        rawCoTriggeredModels.some(
          (model, index) => model !== selection.co_triggered_models[index],
        )
      ) {
        throw new StorageUnavailableError();
      }
      if (
        (selection.canonical_candidate_id === null) !==
          (row.canonical_candidate_id === null) ||
        (selection.canonical_evidence_id === null) !==
          (row.canonical_evidence_id === null) ||
        (selection.canonical_candidate_id !== null &&
          candidateStorageIdByLogicalId.get(
            selection.canonical_candidate_id,
          ) !== row.canonical_candidate_id) ||
        (selection.canonical_evidence_id !== null &&
          evidenceStorageIdByLogicalId.get(
            selection.canonical_evidence_id,
          ) !== row.canonical_evidence_id)
      ) {
        throw new StorageUnavailableError();
      }
      const canonicalEvidence =
        selection.canonical_evidence_id === null
          ? null
          : storedEvidence
              .map((item) =>
                parseStoredDecisionJson<EntryCandidateEvidenceV3>(
                  item.evidence_json,
                  validateEntryEvidenceV3,
                ),
              )
              .find(
                (evidence) =>
                  evidence.evidence_id === selection.canonical_evidence_id,
              ) ?? null;
      if (
        canonicalEvidence === null
          ? row.selected_trigger_epoch !== null ||
            row.selected_trigger_sequence !== null
          : canonicalEvidence.observed_trigger_epoch !==
              row.selected_trigger_epoch ||
            canonicalEvidence.trigger_sequence !==
              row.selected_trigger_sequence
      ) {
        throw new StorageUnavailableError();
      }
      validateEntryEvaluationV3({
        candidates: [...candidates].sort((left, right) =>
          left.candidate_id.localeCompare(right.candidate_id),
        ),
        evidence: [...evidenceByCandidate.values()].sort((left, right) =>
          left.evidence_id.localeCompare(right.evidence_id),
        ),
        selection,
      });
      const directions = new Set(candidates.map((candidate) => candidate.direction));
      const parity = parityBySelection.get(row.selection_id);
      if (
        directions.size !== 1 ||
        parity === undefined ||
        parity.event_id !== row.event_id
      ) {
        throw new StorageUnavailableError();
      }
      const paper = paperBySelection.get(row.selection_id) ?? null;
      const shadow = shadowBySelection.get(row.selection_id) ?? null;
      if (shadow !== null) {
        validateStoredDecisionCohort(
          shadow.liquidity_cohort,
          shadow.one_candle_enabled,
        );
      }
      if (
        (paper !== null &&
          (paper.opened_decision_id.length < 1 ||
            paper.opened_selection_id.length < 1 ||
            !["BOC", "DIR_CLOSE", "HTF_FLIP"].includes(
              paper.opened_canonical_model,
            ) ||
            !Number.isSafeInteger(paper.opened_evaluated_at_epoch))) ||
        (paper !== null && row.liquidity_cohort === "ONE_CANDLE") ||
        (shadow !== null &&
          (!candidateRowsByStorageId.has(shadow.candidate_id) ||
            shadow.liquidity_cohort !== row.liquidity_cohort ||
            shadow.one_candle_enabled !== row.one_candle_enabled))
      ) {
        throw new StorageUnavailableError();
      }
      return {
        decision_id: row.selection_id,
        setup_id: row.setup_id,
        attempt_kind: row.attempt_kind,
        symbol: row.symbol,
        direction: candidates[0]!.direction,
        selection: decisionSelectionView(selection, row),
        parity: {
          status: parity.parity_status,
          mismatch_reason: parity.mismatch_reason,
        },
        candidates: candidates.map((candidate) => {
          const evidence = evidenceByCandidate.get(candidate.candidate_id);
          if (evidence === undefined) throw new StorageUnavailableError();
          return decisionCandidateView(candidate, evidence);
        }),
        trade_plan: {
          tick_size: row.tick_size,
          entry_ticks: row.entry_ticks,
          stop_ticks: row.stop_ticks,
          target_ticks: row.target_ticks,
        },
        opened_economic_selection:
          paper === null
            ? null
            : {
                decision_id: paper.opened_decision_id,
                selection_id: paper.opened_selection_id,
                canonical_model: paper.opened_canonical_model,
                reason: paper.opened_reason,
                evaluated_at_epoch: paper.opened_evaluated_at_epoch,
              },
        paper_intent_id: paper?.intent_id ?? null,
        trade:
          paper === null
            ? null
            : {
                entry_price: paper.entry_price,
                stop_loss: paper.stop_loss,
                take_profit: paper.take_profit,
                state: paper.trade_state,
              },
        shadow_outcome:
          shadow === null
            ? null
            : {
                state: shadow.state,
                outcome_r_millis: shadow.outcome_r_millis,
                liquidity_cohort: shadow.liquidity_cohort,
                one_candle_enabled: shadow.one_candle_enabled === 1,
              },
      };
    });
    const report = {
      schema_version: "1.0",
      mode: "PAPER_ONLY",
      count: items.length,
      items,
    };
    if (
      new TextEncoder().encode(JSON.stringify(report)).byteLength >
      MAX_DECISION_RESPONSE_BYTES
    ) {
      throw new StorageUnavailableError();
    }
    return jsonResponse(report);
  } catch {
    return errorResponse(
      503,
      "ENTRY_DECISIONS_UNAVAILABLE",
      "Entry decision storage is unavailable",
    );
  }
}

async function listReceipts(request: Request, env: Env): Promise<Response> {
  if (!ingressConfigured(env)) {
    return errorResponse(
      503,
      "INGRESS_DISABLED",
      "TradingView observation ingress is disabled",
    );
  }
  const limit = parseLimit(new URL(request.url));
  if (limit === null) {
    return errorResponse(
      422,
      "INVALID_LIMIT",
      "Receipt limit must be an integer between 1 and 200",
    );
  }
  if (env.DB === undefined || env.DB === null) {
    return errorResponse(
      503,
      "INGRESS_UNAVAILABLE",
      "Observation receipt storage is unavailable",
    );
  }
  try {
    const result = await env.DB.prepare(LIST_RECEIPTS_SQL).bind(limit).all<StoredReceipt>();
    const items = result.results.map((record) => receipt(record, "RECEIVED"));
    return jsonResponse({
      mode: "OBSERVATION_ONLY",
      ingress_enabled: true,
      items,
      count: items.length,
    });
  } catch {
    return errorResponse(
      503,
      "INGRESS_UNAVAILABLE",
      "Observation receipt storage is unavailable",
    );
  }
}

function setupEvidence(record: StoredSetupEvidence): ObservationSetupEvidence {
  let rulePasses: unknown;
  try {
    rulePasses = JSON.parse(record.rule_passes_json);
  } catch {
    throw new StorageUnavailableError();
  }
  if (
    !Array.isArray(rulePasses) ||
    rulePasses.length !== 22 ||
    rulePasses.some((pass) => typeof pass !== "boolean")
  ) {
    throw new StorageUnavailableError();
  }
  const { rule_passes_json: _storedRulePasses, ...sanitized } = record;
  return { ...sanitized, rule_passes: rulePasses };
}

async function listSetupEvidence(request: Request, env: Env): Promise<Response> {
  if (!ingressConfigured(env)) {
    return errorResponse(
      503,
      "INGRESS_DISABLED",
      "TradingView observation ingress is disabled",
    );
  }
  const limit = parseLimit(new URL(request.url));
  if (limit === null) {
    return errorResponse(
      422,
      "INVALID_LIMIT",
      "Evidence limit must be an integer between 1 and 200",
    );
  }
  if (env.DB === undefined || env.DB === null) {
    return errorResponse(
      503,
      "INGRESS_UNAVAILABLE",
      "Observation evidence storage is unavailable",
    );
  }
  try {
    const result = await env.DB
      .prepare(LIST_SETUP_EVIDENCE_SQL)
      .bind(limit)
      .all<StoredSetupEvidence>();
    const items = result.results.map(setupEvidence);
    return jsonResponse({
      mode: "OBSERVATION_ONLY",
      execution: "DISABLED",
      items,
      count: items.length,
    });
  } catch {
    return errorResponse(
      503,
      "INGRESS_UNAVAILABLE",
      "Observation evidence storage is unavailable",
    );
  }
}

function paperAccountIdempotencyKey(accountId: string): string {
  return `paper-account:${accountId}`;
}

function paperLedgerIdempotencyKey(accountId: string, sequence: number): string {
  return `paper-ledger:${accountId}:${sequence}`;
}

function paperIntentIdempotencyKey(intentId: string): string {
  return `paper-intent:${intentId}`;
}

function paperSettlementIdempotencyKey(intentId: string): string {
  return `paper-settlement:${intentId}`;
}

function projectionIsSafe(value: PaperAccountProjection): boolean {
  return (
    value.mode === "PAPER_ONLY" &&
    Number.isSafeInteger(value.currency_scale) &&
    value.currency_scale >= 0 &&
    value.currency_scale <= 8 &&
    Number.isSafeInteger(value.opening_balance_minor) &&
    Number.isSafeInteger(value.ledger_delta_minor) &&
    Number.isSafeInteger(value.balance_minor) &&
    Number.isSafeInteger(value.last_sequence) &&
    value.last_sequence >= 0
  );
}

function entryIsSafe(value: StoredPaperLedgerEntry): boolean {
  return (
    value.entry_kind === "MANUAL_ADJUSTMENT" &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 1 &&
    Number.isSafeInteger(value.amount_minor) &&
    value.amount_minor !== 0
  );
}

function paperAccountResponse(
  projection: PaperAccountProjection,
  status: "CREATED" | "DUPLICATE",
): Record<string, unknown> {
  if (!projectionIsSafe(projection)) {
    throw new StorageUnavailableError();
  }
  return {
    schema_version: "1.0",
    status,
    account_id: projection.account_id,
    mode: projection.mode,
    label: projection.label,
    currency_code: projection.currency_code,
    currency_scale: projection.currency_scale,
    opening_balance_minor: projection.opening_balance_minor,
    ledger_delta_minor: projection.ledger_delta_minor,
    balance_minor: projection.balance_minor,
    last_sequence: projection.last_sequence,
    created_at: projection.created_at,
  };
}

function paperEntryResponse(
  entry: StoredPaperLedgerEntry,
  status: "RECORDED" | "DUPLICATE",
): Record<string, unknown> {
  if (!entryIsSafe(entry)) {
    throw new StorageUnavailableError();
  }
  return {
    schema_version: "1.0",
    status,
    entry_id: entry.entry_id,
    account_id: entry.account_id,
    sequence: entry.sequence,
    idempotency_key: entry.idempotency_key,
    payload_sha256: entry.payload_sha256,
    entry_kind: entry.entry_kind,
    amount_minor: entry.amount_minor,
    recorded_at: entry.recorded_at,
  };
}

async function selectPaperAccountProjection(
  env: Env,
  accountId: string,
): Promise<PaperAccountProjection | null> {
  if (env.DB === undefined || env.DB === null) {
    throw new StorageUnavailableError();
  }
  const projection = await env.DB
    .prepare(SELECT_PAPER_ACCOUNT_PROJECTION_SQL)
    .bind(accountId)
    .first<PaperAccountProjection>();
  if (projection !== null && !projectionIsSafe(projection)) {
    throw new StorageUnavailableError();
  }
  return projection;
}

async function parsePaperAccountCreate(
  request: Request,
): Promise<PaperAccountCreateCommand | Response> {
  try {
    return validatePaperAccountCreate(await readPaperBody(request));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse(
        413,
        "BODY_TOO_LARGE",
        "Paper account body exceeds the configured byte limit",
      );
    }
    return errorResponse(
      422,
      "INVALID_PAPER_ACCOUNT",
      "Paper account body failed validation",
    );
  }
}

async function parsePaperLedgerAppend(
  request: Request,
): Promise<PaperLedgerAppendCommand | Response> {
  try {
    return validatePaperLedgerAppend(await readPaperBody(request));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse(
        413,
        "BODY_TOO_LARGE",
        "Paper ledger body exceeds the configured byte limit",
      );
    }
    return errorResponse(
      422,
      "INVALID_LEDGER_ENTRY",
      "Paper ledger body failed validation",
    );
  }
}

async function createPaperAccount(request: Request, env: Env): Promise<Response> {
  const authorizationError = await requirePaperAuthorization(request, env);
  if (authorizationError !== null) {
    return authorizationError;
  }
  const parsed = await parsePaperAccountCreate(request);
  if (parsed instanceof Response) {
    return parsed;
  }
  const idempotencyKey = paperAccountIdempotencyKey(parsed.account_id);
  const payloadSha256 = await sha256Hex(
    canonicalStringify(accountCanonicalCommand(parsed)),
  );
  const createdAt = new Date().toISOString();
  try {
    const insertion = await env.DB
      .prepare(INSERT_PAPER_ACCOUNT_SQL)
      .bind(
        parsed.account_id,
        parsed.label,
        parsed.currency_code,
        parsed.currency_scale,
        parsed.opening_balance_minor,
        idempotencyKey,
        payloadSha256,
        createdAt,
      )
      .run();
    const stored = await env.DB
      .prepare(SELECT_PAPER_ACCOUNT_BY_IDEMPOTENCY_SQL)
      .bind(idempotencyKey)
      .first<StoredPaperAccount>();
    if (stored === null) {
      throw new StorageUnavailableError();
    }
    if (stored.payload_sha256 !== payloadSha256) {
      return errorResponse(
        409,
        "PAPER_ACCOUNT_CONFLICT",
        "Paper account identifier was already used for different content",
      );
    }
    const projection = await selectPaperAccountProjection(env, parsed.account_id);
    if (projection === null) {
      throw new StorageUnavailableError();
    }
    const inserted = Number(insertion.meta.changes ?? 0) === 1;
    return jsonResponse(
      paperAccountResponse(projection, inserted ? "CREATED" : "DUPLICATE"),
      inserted ? 201 : 200,
    );
  } catch (error) {
    if (error instanceof StorageUnavailableError) {
      return errorResponse(
        503,
        "PAPER_LEDGER_UNAVAILABLE",
        "Paper ledger storage is unavailable",
      );
    }
    return errorResponse(
      503,
      "PAPER_LEDGER_UNAVAILABLE",
      "Paper ledger storage is unavailable",
    );
  }
}

async function listPaperAccounts(request: Request, env: Env): Promise<Response> {
  const authorizationError = await requirePaperAuthorization(request, env);
  if (authorizationError !== null) {
    return authorizationError;
  }
  const limit = parseLimit(new URL(request.url));
  if (limit === null) {
    return errorResponse(
      422,
      "INVALID_LIMIT",
      "Paper account limit must be an integer between 1 and 200",
    );
  }
  try {
    const result = await env.DB
      .prepare(LIST_PAPER_ACCOUNT_PROJECTIONS_SQL)
      .bind(limit)
      .all<PaperAccountProjection>();
    if (result.results.some((item) => !projectionIsSafe(item))) {
      throw new StorageUnavailableError();
    }
    return jsonResponse({
      mode: "PAPER_ONLY",
      count: result.results.length,
      items: result.results.map((item) => ({
        schema_version: "1.0",
        account_id: item.account_id,
        mode: item.mode,
        label: item.label,
        currency_code: item.currency_code,
        currency_scale: item.currency_scale,
        opening_balance_minor: item.opening_balance_minor,
        ledger_delta_minor: item.ledger_delta_minor,
        balance_minor: item.balance_minor,
        last_sequence: item.last_sequence,
        created_at: item.created_at,
      })),
    });
  } catch {
    return errorResponse(
      503,
      "PAPER_LEDGER_UNAVAILABLE",
      "Paper ledger storage is unavailable",
    );
  }
}

function balanceRemainsSafe(balanceMinor: number, amountMinor: number): boolean {
  const next = BigInt(balanceMinor) + BigInt(amountMinor);
  const maximum = BigInt(MAX_SAFE_INTEGER);
  return next >= -maximum && next <= maximum;
}

function paperAmountRemainsSafe(
  projection: PaperAccountProjection,
  amountMinor: number,
): boolean {
  return (
    balanceRemainsSafe(projection.balance_minor, amountMinor) &&
    balanceRemainsSafe(projection.ledger_delta_minor, amountMinor)
  );
}

async function appendPaperLedgerEntry(
  request: Request,
  env: Env,
  rawAccountId: string,
): Promise<Response> {
  const authorizationError = await requirePaperAuthorization(request, env);
  if (authorizationError !== null) {
    return authorizationError;
  }
  let accountId: string;
  try {
    accountId = validatePaperAccountId(decodeURIComponent(rawAccountId));
  } catch (error) {
    if (error instanceof PaperContractError || error instanceof URIError) {
      return errorResponse(
        422,
        "INVALID_PAPER_ACCOUNT",
        "Paper account identifier failed validation",
      );
    }
    return errorResponse(
      422,
      "INVALID_PAPER_ACCOUNT",
      "Paper account identifier failed validation",
    );
  }
  const parsed = await parsePaperLedgerAppend(request);
  if (parsed instanceof Response) {
    return parsed;
  }
  const idempotencyKey = paperLedgerIdempotencyKey(accountId, parsed.sequence);
  const payloadSha256 = await sha256Hex(
    canonicalStringify(ledgerCanonicalCommand(accountId, parsed)),
  );

  try {
    const existing = await env.DB
      .prepare(SELECT_PAPER_LEDGER_ENTRY_BY_IDEMPOTENCY_SQL)
      .bind(idempotencyKey)
      .first<StoredPaperLedgerEntry>();
    if (existing !== null) {
      if (existing.payload_sha256 !== payloadSha256) {
        return errorResponse(
          409,
          "PAPER_LEDGER_CONFLICT",
          "Paper ledger sequence was already used for different content",
        );
      }
      return jsonResponse(paperEntryResponse(existing, "DUPLICATE"), 200);
    }

    const before = await selectPaperAccountProjection(env, accountId);
    if (before === null) {
      return errorResponse(
        404,
        "PAPER_ACCOUNT_NOT_FOUND",
        "Paper account was not found",
      );
    }
    if (parsed.sequence !== before.last_sequence + 1) {
      return errorResponse(
        409,
        "PAPER_LEDGER_SEQUENCE_CONFLICT",
        "Paper ledger sequence must be contiguous",
      );
    }
    if (!paperAmountRemainsSafe(before, parsed.amount_minor)) {
      return errorResponse(
        422,
        "PAPER_BALANCE_OUT_OF_RANGE",
        "Paper balance would leave the safe integer range",
      );
    }

    let insertionChanges = 0;
    try {
      const insertion = await env.DB
        .prepare(INSERT_PAPER_LEDGER_ENTRY_SQL)
        .bind(
          accountId,
          crypto.randomUUID(),
          parsed.sequence,
          idempotencyKey,
          payloadSha256,
          parsed.amount_minor,
          new Date().toISOString(),
          parsed.sequence,
          parsed.amount_minor,
          parsed.amount_minor,
          parsed.amount_minor,
          parsed.amount_minor,
        )
        .run();
      insertionChanges = Number(insertion.meta.changes ?? 0);
    } catch {
      // A concurrent identical/conflicting insert can trip a BEFORE trigger.
      // Classification is performed from durable state below.
    }

    const stored = await env.DB
      .prepare(SELECT_PAPER_LEDGER_ENTRY_BY_IDEMPOTENCY_SQL)
      .bind(idempotencyKey)
      .first<StoredPaperLedgerEntry>();
    if (stored !== null) {
      if (stored.payload_sha256 !== payloadSha256) {
        return errorResponse(
          409,
          "PAPER_LEDGER_CONFLICT",
          "Paper ledger sequence was already used for different content",
        );
      }
      return jsonResponse(
        paperEntryResponse(stored, insertionChanges === 1 ? "RECORDED" : "DUPLICATE"),
        insertionChanges === 1 ? 201 : 200,
      );
    }

    const after = await selectPaperAccountProjection(env, accountId);
    if (after === null) {
      return errorResponse(
        404,
        "PAPER_ACCOUNT_NOT_FOUND",
        "Paper account was not found",
      );
    }
    if (parsed.sequence !== after.last_sequence + 1) {
      return errorResponse(
        409,
        "PAPER_LEDGER_SEQUENCE_CONFLICT",
        "Paper ledger sequence must be contiguous",
      );
    }
    if (!paperAmountRemainsSafe(after, parsed.amount_minor)) {
      return errorResponse(
        422,
        "PAPER_BALANCE_OUT_OF_RANGE",
        "Paper balance would leave the safe integer range",
      );
    }
    throw new StorageUnavailableError();
  } catch (error) {
    if (error instanceof StorageUnavailableError || error instanceof Error) {
      return errorResponse(
        503,
        "PAPER_LEDGER_UNAVAILABLE",
        "Paper ledger storage is unavailable",
      );
    }
    return errorResponse(
      503,
      "PAPER_LEDGER_UNAVAILABLE",
      "Paper ledger storage is unavailable",
    );
  }
}

function parseBeforeSequence(url: URL): number | null | "INVALID" {
  const values = url.searchParams.getAll("before_sequence");
  if (values.length === 0) {
    return null;
  }
  if (values.length !== 1 || !/^[0-9]+$/.test(values[0] ?? "")) {
    return "INVALID";
  }
  const sequence = Number(values[0]);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    return "INVALID";
  }
  return sequence;
}

async function listPaperLedgerEntries(
  request: Request,
  env: Env,
  rawAccountId: string,
): Promise<Response> {
  const authorizationError = await requirePaperAuthorization(request, env);
  if (authorizationError !== null) {
    return authorizationError;
  }
  let accountId: string;
  try {
    accountId = validatePaperAccountId(decodeURIComponent(rawAccountId));
  } catch {
    return errorResponse(
      422,
      "INVALID_PAPER_ACCOUNT",
      "Paper account identifier failed validation",
    );
  }
  const url = new URL(request.url);
  const limit = parseLimit(url);
  const beforeSequence = parseBeforeSequence(url);
  if (limit === null || beforeSequence === "INVALID") {
    return errorResponse(
      422,
      "INVALID_LIMIT",
      "Paper ledger pagination failed validation",
    );
  }
  try {
    const [accountResult, entriesResult] = await env.DB.batch([
      env.DB
        .prepare(SELECT_PAPER_ACCOUNT_PROJECTION_SQL)
        .bind(accountId),
      env.DB
        .prepare(LIST_PAPER_LEDGER_ENTRIES_SQL)
        .bind(accountId, beforeSequence, beforeSequence, limit),
    ]);
    const account =
      (accountResult?.results[0] as PaperAccountProjection | undefined) ?? null;
    if (account === null) {
      return errorResponse(
        404,
        "PAPER_ACCOUNT_NOT_FOUND",
        "Paper account was not found",
      );
    }
    if (!projectionIsSafe(account) || entriesResult === undefined) {
      throw new StorageUnavailableError();
    }
    const entries = entriesResult.results as unknown as StoredPaperLedgerEntry[];
    if (
      entries.some(
        (entry) => entry.account_id !== accountId || !entryIsSafe(entry),
      )
    ) {
      throw new StorageUnavailableError();
    }
    return jsonResponse({
      mode: "PAPER_ONLY",
      account_id: accountId,
      currency_code: account.currency_code,
      currency_scale: account.currency_scale,
      balance_minor: account.balance_minor,
      last_sequence: account.last_sequence,
      count: entries.length,
      items: entries.map((entry) =>
        paperEntryResponse(entry, "RECORDED"),
      ),
    });
  } catch {
    return errorResponse(
      503,
      "PAPER_LEDGER_UNAVAILABLE",
      "Paper ledger storage is unavailable",
    );
  }
}

function storedPaperTradeIntentIsSafe(value: StoredPaperTradeIntent): boolean {
  return (
    value.idempotency_key === paperIntentIdempotencyKey(value.intent_id) &&
    SHA256.test(value.payload_sha256) &&
    (value.side === "BUY" || value.side === "SELL") &&
    Number.isSafeInteger(value.risk_bps) &&
    value.risk_bps >= 1 &&
    value.risk_bps <= 500 &&
    value.entry_price.length > 0 &&
    value.stop_loss.length > 0 &&
    value.take_profit.length > 0 &&
    (value.source === "MANUAL" || value.source === "TRADINGVIEW") &&
    (value.source === "MANUAL"
      ? value.source_receipt_id === null
      : typeof value.source_receipt_id === "string" &&
        value.source_receipt_id.length > 0)
  );
}

function storedPaperTradeAllocationIsSafe(
  value: StoredPaperTradeAllocation,
): boolean {
  return (
    Number.isSafeInteger(value.risk_amount_minor) &&
    value.risk_amount_minor > 0 &&
    Number.isSafeInteger(value.balance_before_minor)
  );
}

function storedPaperTradeSettlementIsSafe(
  value: StoredPaperTradeSettlement,
): boolean {
  return (
    value.idempotency_key === paperSettlementIdempotencyKey(value.intent_id) &&
    SHA256.test(value.payload_sha256) &&
    Number.isSafeInteger(value.outcome_r_millis) &&
    value.outcome_r_millis >= -1_000 &&
    value.outcome_r_millis <= 10_000 &&
    (value.exit_reason === "STOP" ||
      value.exit_reason === "TARGET" ||
      value.exit_reason === "MANUAL")
  );
}

function simulationPnlMinor(
  riskAmountMinor: number,
  outcomeRMillis: number,
): number {
  if (!pnlRemainsSafe(riskAmountMinor, outcomeRMillis)) {
    throw new StorageUnavailableError();
  }
  return Number(
    (BigInt(riskAmountMinor) * BigInt(outcomeRMillis)) / 1_000n,
  );
}

type PaperTradeBundle = {
  readonly intent: StoredPaperTradeIntent;
  readonly allocations: readonly StoredPaperTradeAllocation[];
  readonly settlement: StoredPaperTradeSettlement | null;
};

async function selectPaperTradeBundle(
  env: Env,
  intentId: string,
): Promise<PaperTradeBundle | null> {
  const [intentResult, allocationsResult, settlementResult] = await env.DB.batch([
    env.DB.prepare(SELECT_PAPER_TRADE_INTENT_SQL).bind(intentId),
    env.DB.prepare(LIST_PAPER_TRADE_ALLOCATIONS_SQL).bind(intentId),
    env.DB.prepare(SELECT_PAPER_TRADE_SETTLEMENT_SQL).bind(intentId),
  ]);
  const intent =
    (intentResult?.results[0] as StoredPaperTradeIntent | undefined) ?? null;
  if (intent === null) {
    return null;
  }
  const allocations =
    (allocationsResult?.results as unknown as StoredPaperTradeAllocation[] | undefined) ??
    [];
  const settlement =
    (settlementResult?.results[0] as StoredPaperTradeSettlement | undefined) ??
    null;
  if (
    !storedPaperTradeIntentIsSafe(intent) ||
    allocations.length === 0 ||
    allocations.some(
      (allocation) =>
        allocation.intent_id !== intentId ||
        !storedPaperTradeAllocationIsSafe(allocation),
    ) ||
    (settlement !== null &&
      (settlement.intent_id !== intentId ||
        !storedPaperTradeSettlementIsSafe(settlement)))
  ) {
    throw new StorageUnavailableError();
  }
  return { intent, allocations, settlement };
}

function paperTradeResponse(
  bundle: PaperTradeBundle,
  status: "CREATED" | "DUPLICATE" | "SETTLED",
): Record<string, unknown> {
  return {
    schema_version: "1.0",
    mode: "PAPER_SIMULATION_ONLY",
    status,
    intent_id: bundle.intent.intent_id,
    symbol: bundle.intent.symbol,
    side: bundle.intent.side,
    entry_price: bundle.intent.entry_price,
    stop_loss: bundle.intent.stop_loss,
    take_profit: bundle.intent.take_profit,
    risk_bps: bundle.intent.risk_bps,
    source: bundle.intent.source,
    source_receipt_id: bundle.intent.source_receipt_id,
    state: bundle.settlement === null ? "OPEN" : "SETTLED",
    created_at: bundle.intent.created_at,
    settlement:
      bundle.settlement === null
        ? null
        : {
            outcome_r_millis: bundle.settlement.outcome_r_millis,
            exit_reason: bundle.settlement.exit_reason,
            settled_at: bundle.settlement.settled_at,
          },
    allocations: bundle.allocations.map((allocation) => ({
      account_id: allocation.account_id,
      risk_amount_minor: allocation.risk_amount_minor,
      balance_before_minor: allocation.balance_before_minor,
      pnl_minor:
        bundle.settlement === null
          ? null
          : simulationPnlMinor(
              allocation.risk_amount_minor,
              bundle.settlement.outcome_r_millis,
            ),
    })),
  };
}

async function parsePaperTradeIntent(
  request: Request,
): Promise<PaperTradeIntentCommand | Response> {
  try {
    return validatePaperTradeIntent(await readPaperBody(request));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse(
        413,
        "BODY_TOO_LARGE",
        "Paper trade intent exceeds the configured byte limit",
      );
    }
    return errorResponse(
      422,
      "INVALID_PAPER_TRADE_INTENT",
      "Paper trade intent failed validation",
    );
  }
}

async function parsePaperTradeSettlement(
  request: Request,
): Promise<PaperTradeSettlementCommand | Response> {
  try {
    return validatePaperTradeSettlement(await readPaperBody(request));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse(
        413,
        "BODY_TOO_LARGE",
        "Paper trade settlement exceeds the configured byte limit",
      );
    }
    return errorResponse(
      422,
      "INVALID_PAPER_TRADE_SETTLEMENT",
      "Paper trade settlement failed validation",
    );
  }
}

async function createPaperTradeIntent(
  request: Request,
  env: Env,
): Promise<Response> {
  const authorizationError = await requirePaperAuthorization(request, env);
  if (authorizationError !== null) {
    return authorizationError;
  }
  const parsed = await parsePaperTradeIntent(request);
  if (parsed instanceof Response) {
    return parsed;
  }
  const payloadSha256 = await sha256Hex(
    canonicalStringify(tradeIntentCanonicalCommand(parsed)),
  );
  try {
    const existing = await selectPaperTradeBundle(env, parsed.intent_id);
    if (existing !== null) {
      if (existing.intent.payload_sha256 !== payloadSha256) {
        return errorResponse(
          409,
          "PAPER_TRADE_INTENT_CONFLICT",
          "Paper trade intent identifier was already used for different content",
        );
      }
      return jsonResponse(paperTradeResponse(existing, "DUPLICATE"), 200);
    }
    const terminalBlocked = await selectBlockedPaperIntent(
      env,
      parsed.intent_id,
    );
    if (terminalBlocked !== null) {
      if (terminalBlocked.payload_sha256 !== payloadSha256) {
        return errorResponse(
          409,
          "PAPER_TRADE_INTENT_CONFLICT",
          "Paper trade intent identifier conflicts with durable blocked content",
        );
      }
      return errorResponse(
        423,
        "PAPER_TRADE_INTENT_TERMINALLY_BLOCKED",
        "Paper trade intent identifier was terminally blocked",
      );
    }
    const killSwitch = await latestPaperKillSwitch(env);
    if (killSwitch.enabled === 1) {
      return errorResponse(
        423,
        "PAPER_KILL_SWITCH_ENABLED",
        "Paper kill switch blocks new trade intents",
      );
    }
    const accountResults = await env.DB.batch(
      parsed.account_ids.map((accountId) =>
        env.DB
          .prepare(SELECT_PAPER_ACCOUNT_READINESS_METRIC_SQL)
          .bind(accountId),
      ),
    );
    for (let index = 0; index < parsed.account_ids.length; index += 1) {
      const metric =
        (accountResults[index]?.results[0] as
          | PaperReadinessAccountInput
          | undefined) ?? null;
      if (metric === null) {
        return errorResponse(
          404,
          "PAPER_ACCOUNT_NOT_FOUND",
          "One or more paper accounts were not found",
        );
      }
      if (!paperReadinessAccountInputIsSafe(metric)) {
        throw new StorageUnavailableError();
      }
      const riskAmount =
        (BigInt(metric.balance_minor) * BigInt(parsed.risk_bps)) /
        10_000n;
      if (riskAmount <= 0n) {
        return errorResponse(
          422,
          "PAPER_RISK_TOO_SMALL",
          "Paper account balance is too small for the requested risk",
        );
      }
      if (
        riskAmount > BigInt(MAX_SAFE_INTEGER) ||
        !paperAccountAllowsNewOpen(metric, Number(riskAmount))
      ) {
        return errorResponse(
          423,
          "PAPER_RISK_LIMIT_REACHED",
          "Paper account risk limits block new trade intents",
        );
      }
    }

    const createdAt = new Date().toISOString();
    let insertionResults: D1Result[];
    try {
      insertionResults = await env.DB.batch([
        env.DB
          .prepare(INSERT_PAPER_TRADE_INTENT_SQL)
          .bind(
            parsed.intent_id,
            paperIntentIdempotencyKey(parsed.intent_id),
            payloadSha256,
            parsed.symbol,
            parsed.side,
            parsed.entry_price,
            parsed.stop_loss,
            parsed.take_profit,
            parsed.risk_bps,
            createdAt,
          ),
        ...parsed.account_ids.map((accountId) =>
          env.DB
            .prepare(INSERT_PAPER_TRADE_ALLOCATION_SQL)
            .bind(
              parsed.risk_bps,
              accountId,
              parsed.intent_id,
              payloadSha256,
              crypto.randomUUID(),
              accountId,
              createdAt,
            ),
        ),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("paper safety gate blocked allocation")
      ) {
        return errorResponse(
          423,
          "PAPER_SAFETY_GATE_CHANGED",
          "Paper safety state changed before the trade could be recorded",
        );
      }
      const raced = await selectPaperTradeBundle(env, parsed.intent_id);
      if (raced !== null) {
        if (raced.intent.payload_sha256 !== payloadSha256) {
          return errorResponse(
            409,
            "PAPER_TRADE_INTENT_CONFLICT",
            "Paper trade intent identifier was already used for different content",
          );
        }
        return jsonResponse(paperTradeResponse(raced, "DUPLICATE"), 200);
      }
      const racedBlocked = await selectBlockedPaperIntent(
        env,
        parsed.intent_id,
      );
      if (racedBlocked !== null) {
        if (racedBlocked.payload_sha256 !== payloadSha256) {
          return errorResponse(
            409,
            "PAPER_TRADE_INTENT_CONFLICT",
            "Paper trade intent identifier conflicts with durable blocked content",
          );
        }
        return errorResponse(
          423,
          "PAPER_TRADE_INTENT_TERMINALLY_BLOCKED",
          "Paper trade intent identifier was terminally blocked",
        );
      }
      throw new StorageUnavailableError();
    }

    const stored = await selectPaperTradeBundle(env, parsed.intent_id);
    if (
      stored === null ||
      stored.intent.payload_sha256 !== payloadSha256 ||
      stored.allocations.length !== parsed.account_ids.length
    ) {
      throw new StorageUnavailableError();
    }
    const inserted = Number(insertionResults[0]?.meta.changes ?? 0) === 1;
    return jsonResponse(
      paperTradeResponse(stored, inserted ? "CREATED" : "DUPLICATE"),
      inserted ? 201 : 200,
    );
  } catch {
    return errorResponse(
      503,
      "PAPER_SIMULATOR_UNAVAILABLE",
      "Paper simulator storage is unavailable",
    );
  }
}

async function settlePaperTradeIntent(
  request: Request,
  env: Env,
  rawIntentId: string,
): Promise<Response> {
  const authorizationError = await requirePaperAuthorization(request, env);
  if (authorizationError !== null) {
    return authorizationError;
  }
  let intentId: string;
  try {
    intentId = validatePaperIntentId(decodeURIComponent(rawIntentId));
  } catch (error) {
    if (
      error instanceof PaperSimulatorContractError ||
      error instanceof URIError
    ) {
      return errorResponse(
        422,
        "INVALID_PAPER_INTENT_ID",
        "Paper trade intent identifier failed validation",
      );
    }
    return errorResponse(
      422,
      "INVALID_PAPER_INTENT_ID",
      "Paper trade intent identifier failed validation",
    );
  }
  const parsed = await parsePaperTradeSettlement(request);
  if (parsed instanceof Response) {
    return parsed;
  }
  const payloadSha256 = await sha256Hex(
    canonicalStringify(tradeSettlementCanonicalCommand(intentId, parsed)),
  );
  try {
    const before = await selectPaperTradeBundle(env, intentId);
    if (before === null) {
      return errorResponse(
        404,
        "PAPER_TRADE_INTENT_NOT_FOUND",
        "Paper trade intent was not found",
      );
    }
    if (before.settlement !== null) {
      if (before.settlement.payload_sha256 !== payloadSha256) {
        return errorResponse(
          409,
          "PAPER_TRADE_SETTLEMENT_CONFLICT",
          "Paper trade intent was already settled with different content",
        );
      }
      return jsonResponse(paperTradeResponse(before, "DUPLICATE"), 200);
    }

    const projectionResults = await env.DB.batch(
      before.allocations.map((allocation) =>
        env.DB
          .prepare(SELECT_PAPER_ACCOUNT_PROJECTION_SQL)
          .bind(allocation.account_id),
      ),
    );
    for (let index = 0; index < before.allocations.length; index += 1) {
      const allocation = before.allocations[index];
      const projection =
        (projectionResults[index]?.results[0] as
          | PaperAccountProjection
          | undefined) ?? null;
      if (
        allocation === undefined ||
        projection === null ||
        !projectionIsSafe(projection)
      ) {
        throw new StorageUnavailableError();
      }
      const pnlMinor = simulationPnlMinor(
        allocation.risk_amount_minor,
        parsed.outcome_r_millis,
      );
      if (!balanceRemainsSafe(projection.balance_minor, pnlMinor)) {
        return errorResponse(
          422,
          "PAPER_SETTLEMENT_OUT_OF_RANGE",
          "Paper settlement would leave the safe balance range",
        );
      }
    }

    const settledAt = new Date().toISOString();
    try {
      await env.DB
        .prepare(INSERT_PAPER_TRADE_SETTLEMENT_SQL)
        .bind(
          crypto.randomUUID(),
          intentId,
          paperSettlementIdempotencyKey(intentId),
          payloadSha256,
          parsed.outcome_r_millis,
          parsed.exit_reason,
          settledAt,
        )
        .run();
    } catch {
      const raced = await selectPaperTradeBundle(env, intentId);
      if (raced?.settlement !== null && raced?.settlement !== undefined) {
        if (raced.settlement.payload_sha256 !== payloadSha256) {
          return errorResponse(
            409,
            "PAPER_TRADE_SETTLEMENT_CONFLICT",
            "Paper trade intent was already settled with different content",
          );
        }
        return jsonResponse(paperTradeResponse(raced, "DUPLICATE"), 200);
      }
      throw new StorageUnavailableError();
    }

    const stored = await selectPaperTradeBundle(env, intentId);
    if (stored?.settlement === null || stored?.settlement === undefined) {
      throw new StorageUnavailableError();
    }
    if (stored.settlement.payload_sha256 !== payloadSha256) {
      return errorResponse(
        409,
        "PAPER_TRADE_SETTLEMENT_CONFLICT",
        "Paper trade intent was already settled with different content",
      );
    }
    return jsonResponse(paperTradeResponse(stored, "SETTLED"), 201);
  } catch {
    return errorResponse(
      503,
      "PAPER_SIMULATOR_UNAVAILABLE",
      "Paper simulator storage is unavailable",
    );
  }
}

function paperReadinessAccountInputIsSafe(
  value: PaperReadinessAccountInput,
): boolean {
  return (
    typeof value.account_id === "string" &&
    value.account_id.length > 0 &&
    typeof value.label === "string" &&
    value.label.length > 0 &&
    Number.isSafeInteger(value.opening_balance_minor) &&
    value.opening_balance_minor > 0 &&
    Number.isSafeInteger(value.balance_minor) &&
    Number.isSafeInteger(value.daily_pnl_minor) &&
    Number.isSafeInteger(value.open_risk_minor) &&
    value.open_risk_minor >= 0 &&
    Number.isSafeInteger(value.open_positions) &&
    value.open_positions >= 0 &&
    Number.isSafeInteger(value.max_drawdown_minor) &&
    value.max_drawdown_minor >= 0
  );
}

function paperLatestReceiptIsSafe(
  value: PaperReadinessLatestReceipt,
): boolean {
  return (
    typeof value.receipt_id === "string" &&
    value.receipt_id.length > 0 &&
    Number.isFinite(Date.parse(value.received_at)) &&
    typeof value.producer_instance_id === "string" &&
    value.producer_instance_id.length > 0 &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    typeof value.symbol === "string" &&
    value.symbol.length > 0
  );
}

function paperOpenHealthIsSafe(
  value: PaperReadinessOpenHealth,
): boolean {
  return (
    Number.isSafeInteger(value.open_intents) &&
    value.open_intents >= 0 &&
    Number.isSafeInteger(value.stale_open_intents) &&
    value.stale_open_intents >= 0 &&
    value.stale_open_intents <= value.open_intents &&
    (value.oldest_open_intent_at === null ||
      Number.isFinite(Date.parse(value.oldest_open_intent_at)))
  );
}

async function paperReadinessReport(
  env: Env,
): Promise<ReturnType<typeof evaluatePaperReadiness>> {
  const now = new Date();
  const evaluatedAt = now.toISOString();
  const staleCutoff = new Date(
    now.getTime() -
      PAPER_READINESS_THRESHOLDS.stale_trade_seconds * 1_000,
  ).toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(LIST_PAPER_ACCOUNT_READINESS_METRICS_SQL),
    env.DB.prepare(SELECT_LATEST_PAPER_AUTOMATION_RECEIPT_SQL),
    env.DB.prepare(SELECT_PAPER_OPEN_INTENT_HEALTH_SQL).bind(staleCutoff),
    env.DB.prepare(SELECT_LATEST_PAPER_KILL_SWITCH_SQL),
  ]);
  const accounts =
    (results[0]?.results as unknown as
      | PaperReadinessAccountInput[]
      | undefined) ?? [];
  const latestReceipt =
    (results[1]?.results[0] as
      | PaperReadinessLatestReceipt
      | undefined) ?? null;
  const openHealth =
    (results[2]?.results[0] as
      | PaperReadinessOpenHealth
      | undefined) ?? null;
  const killSwitch =
    (results[3]?.results[0] as
      | StoredPaperKillSwitchEvent
      | undefined) ?? null;
  if (
    accounts.some((account) => !paperReadinessAccountInputIsSafe(account)) ||
    (latestReceipt !== null && !paperLatestReceiptIsSafe(latestReceipt)) ||
    openHealth === null ||
    !paperOpenHealthIsSafe(openHealth) ||
    killSwitch === null ||
    !killSwitchEventIsSafe(killSwitch)
  ) {
    throw new StorageUnavailableError();
  }
  return evaluatePaperReadiness({
    evaluated_at: evaluatedAt,
    kill_switch: {
      enabled: killSwitch.enabled === 1,
      reason: killSwitch.reason,
      changed_at: killSwitch.changed_at,
    },
    latest_receipt: latestReceipt,
    open_health: openHealth,
    accounts,
  });
}

async function getPaperReadiness(
  request: Request,
  env: Env,
): Promise<Response> {
  const authorizationError = await requirePaperAuthorization(request, env);
  if (authorizationError !== null) return authorizationError;
  try {
    return jsonResponse(await paperReadinessReport(env));
  } catch {
    return errorResponse(
      503,
      "PAPER_READINESS_UNAVAILABLE",
      "Paper readiness evidence is unavailable",
    );
  }
}

function killSwitchIdempotencyKey(request: Request): string | null {
  const value = request.headers.get("idempotency-key");
  return value !== null && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : null;
}

async function setPaperKillSwitch(
  request: Request,
  env: Env,
): Promise<Response> {
  const authorizationError = await requirePaperAuthorization(request, env);
  if (authorizationError !== null) return authorizationError;
  const idempotencyKey = killSwitchIdempotencyKey(request);
  if (idempotencyKey === null) {
    return errorResponse(
      422,
      "INVALID_IDEMPOTENCY_KEY",
      "A valid Idempotency-Key header is required",
    );
  }
  let parsed;
  try {
    parsed = validatePaperKillSwitchCommand(await readPaperBody(request));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse(
        413,
        "BODY_TOO_LARGE",
        "Paper kill-switch command exceeds the configured byte limit",
      );
    }
    if (
      error instanceof PaperReadinessContractError ||
      error instanceof Error
    ) {
      return errorResponse(
        422,
        "INVALID_PAPER_KILL_SWITCH",
        "Paper kill-switch command failed validation",
      );
    }
    return errorResponse(
      422,
      "INVALID_PAPER_KILL_SWITCH",
      "Paper kill-switch command failed validation",
    );
  }
  const payloadSha256 = await sha256Hex(
    canonicalStringify({
      schema_version: parsed.schema_version,
      enabled: parsed.enabled,
      reason: parsed.reason,
    }),
  );
  try {
    const existing = await env.DB
      .prepare(SELECT_PAPER_KILL_SWITCH_BY_IDEMPOTENCY_SQL)
      .bind(idempotencyKey)
      .first<StoredPaperKillSwitchEvent>();
    if (existing !== null) {
      if (!killSwitchEventIsSafe(existing)) throw new StorageUnavailableError();
      if (existing.payload_sha256 !== payloadSha256) {
        return errorResponse(
          409,
          "PAPER_KILL_SWITCH_CONFLICT",
          "Idempotency key was already used for different control content",
        );
      }
      return jsonResponse({
        schema_version: "1.0",
        status: "DUPLICATE",
        kill_switch: {
          enabled: existing.enabled === 1,
          reason: existing.reason,
          changed_at: existing.changed_at,
        },
      });
    }
    const changedAt = new Date().toISOString();
    const insertion = await env.DB
      .prepare(INSERT_PAPER_KILL_SWITCH_EVENT_SQL)
      .bind(
        crypto.randomUUID(),
        idempotencyKey,
        payloadSha256,
        parsed.enabled ? 1 : 0,
        parsed.reason,
        changedAt,
      )
      .run();
    const stored = await env.DB
      .prepare(SELECT_PAPER_KILL_SWITCH_BY_IDEMPOTENCY_SQL)
      .bind(idempotencyKey)
      .first<StoredPaperKillSwitchEvent>();
    if (stored === null || !killSwitchEventIsSafe(stored)) {
      throw new StorageUnavailableError();
    }
    if (stored.payload_sha256 !== payloadSha256) {
      return errorResponse(
        409,
        "PAPER_KILL_SWITCH_CONFLICT",
        "Idempotency key was already used for different control content",
      );
    }
    const inserted = Number(insertion.meta.changes ?? 0) === 1;
    return jsonResponse(
      {
        schema_version: "1.0",
        status: inserted ? "APPLIED" : "DUPLICATE",
        kill_switch: {
          enabled: stored.enabled === 1,
          reason: stored.reason,
          changed_at: stored.changed_at,
        },
      },
      inserted ? 201 : 200,
    );
  } catch {
    return errorResponse(
      503,
      "PAPER_READINESS_UNAVAILABLE",
      "Paper kill-switch storage is unavailable",
    );
  }
}

function simulationAccountStatIsSafe(
  value: PaperSimulationAccountStat,
): boolean {
  return (
    projectionIsSafe(value) &&
    Number.isSafeInteger(value.realized_pnl_minor) &&
    Number.isSafeInteger(value.open_risk_minor) &&
    value.open_risk_minor >= 0 &&
    Number.isSafeInteger(value.open_positions) &&
    value.open_positions >= 0 &&
    Number.isSafeInteger(value.settled_trades) &&
    value.settled_trades >= 0 &&
    Number.isSafeInteger(value.winning_trades) &&
    value.winning_trades >= 0 &&
    Number.isSafeInteger(value.losing_trades) &&
    value.losing_trades >= 0 &&
    Number.isSafeInteger(value.max_drawdown_minor) &&
    value.max_drawdown_minor >= 0
  );
}

function simulationRowIsSafe(value: PaperSimulationRow): boolean {
  const settled = value.settlement_id !== null;
  let parsedCoTriggeredModels: unknown;
  try {
    parsedCoTriggeredModels = JSON.parse(value.co_triggered_models_json ?? "[]");
  } catch {
    return false;
  }
  if (!Array.isArray(parsedCoTriggeredModels)) return false;
  const coTriggeredModels = parsedCoTriggeredModels;
  const setupId = value.setup_id ?? null;
  const selectedEntryModel = value.selected_entry_model ?? null;
  const v3Context =
    typeof setupId === "string" &&
    setupId.length > 0 &&
    (selectedEntryModel === "BOC" ||
      selectedEntryModel === "DIR_CLOSE" ||
      selectedEntryModel === "HTF_FLIP");
  const coTriggerSafe =
    coTriggeredModels.length <= 3 &&
    new Set(coTriggeredModels).size === coTriggeredModels.length &&
    coTriggeredModels.every(
      (model) =>
        model === "BOC" || model === "DIR_CLOSE" || model === "HTF_FLIP",
    );
  return (
    (value.side === "BUY" || value.side === "SELL") &&
    Number.isSafeInteger(value.risk_bps) &&
    value.risk_bps >= 1 &&
    value.risk_bps <= 500 &&
    Number.isSafeInteger(value.risk_amount_minor) &&
    value.risk_amount_minor > 0 &&
    Number.isSafeInteger(value.balance_before_minor) &&
    (value.source === "MANUAL" || value.source === "TRADINGVIEW") &&
    coTriggerSafe &&
    (value.source === "MANUAL"
      ? value.source_receipt_id === null &&
        setupId === null &&
        selectedEntryModel === null &&
        coTriggeredModels.length === 0
      : (typeof value.source_receipt_id === "string" &&
          value.source_receipt_id.length > 0 &&
          setupId === null &&
          selectedEntryModel === null &&
          coTriggeredModels.length === 0) ||
        (value.source_receipt_id === null && v3Context)) &&
    (settled
      ? value.outcome_r_millis !== null &&
        Number.isSafeInteger(value.outcome_r_millis) &&
        value.pnl_minor !== null &&
        Number.isSafeInteger(value.pnl_minor) &&
        value.exit_reason !== null &&
        value.settled_at !== null
      : value.outcome_r_millis === null &&
        value.pnl_minor === null &&
        value.exit_reason === null &&
        value.settled_at === null)
  );
}

async function listPaperSimulationSummary(
  request: Request,
  env: Env,
): Promise<Response> {
  const authorizationError = await requirePaperAuthorization(request, env);
  if (authorizationError !== null) {
    return authorizationError;
  }
  const limit = parseLimit(new URL(request.url));
  if (limit === null) {
    return errorResponse(
      422,
      "INVALID_LIMIT",
      "Paper simulation limit must be an integer between 1 and 200",
    );
  }
  try {
    const [accountResult, rowResult] = await env.DB.batch([
      env.DB.prepare(LIST_PAPER_SIMULATION_ACCOUNT_STATS_SQL),
      env.DB.prepare(LIST_PAPER_SIMULATION_ROWS_SQL).bind(limit),
    ]);
    const accounts =
      (accountResult?.results as unknown as PaperSimulationAccountStat[] | undefined) ??
      [];
    const rows =
      (rowResult?.results as unknown as PaperSimulationRow[] | undefined) ?? [];
    if (
      accounts.some((account) => !simulationAccountStatIsSafe(account)) ||
      rows.some((row) => !simulationRowIsSafe(row))
    ) {
      throw new StorageUnavailableError();
    }
    const intents = new Map<
      string,
      {
        intent_id: string;
        symbol: string;
        side: "BUY" | "SELL";
        entry_price: string;
        stop_loss: string;
        take_profit: string;
        risk_bps: number;
        source: "MANUAL" | "TRADINGVIEW";
        source_receipt_id: string | null;
        setup_id: string | null;
        selected_entry_model: "BOC" | "DIR_CLOSE" | "HTF_FLIP" | null;
        co_triggered_models: Array<"BOC" | "DIR_CLOSE" | "HTF_FLIP">;
        state: "OPEN" | "SETTLED";
        created_at: string;
        settlement: null | {
          outcome_r_millis: number;
          exit_reason: "STOP" | "TARGET" | "MANUAL";
          settled_at: string;
        };
        allocations: Array<{
          account_id: string;
          risk_amount_minor: number;
          balance_before_minor: number;
          pnl_minor: number | null;
        }>;
      }
    >();
    for (const row of rows) {
      let intent = intents.get(row.intent_id);
      if (intent === undefined) {
        intent = {
          intent_id: row.intent_id,
          symbol: row.symbol,
          side: row.side,
          entry_price: row.entry_price,
          stop_loss: row.stop_loss,
          take_profit: row.take_profit,
          risk_bps: row.risk_bps,
          source: row.source,
          source_receipt_id: row.source_receipt_id,
          setup_id: row.setup_id ?? null,
          selected_entry_model: row.selected_entry_model ?? null,
          co_triggered_models: JSON.parse(
            row.co_triggered_models_json ?? "[]",
          ) as Array<"BOC" | "DIR_CLOSE" | "HTF_FLIP">,
          state: row.settlement_id === null ? "OPEN" : "SETTLED",
          created_at: row.created_at,
          settlement:
            row.settlement_id === null
              ? null
              : {
                  outcome_r_millis: row.outcome_r_millis as number,
                  exit_reason: row.exit_reason as
                    | "STOP"
                    | "TARGET"
                    | "MANUAL",
                  settled_at: row.settled_at as string,
                },
          allocations: [],
        };
        intents.set(row.intent_id, intent);
      }
      intent.allocations.push({
        account_id: row.account_id,
        risk_amount_minor: row.risk_amount_minor,
        balance_before_minor: row.balance_before_minor,
        pnl_minor: row.pnl_minor,
      });
    }
    return jsonResponse({
      schema_version: "1.0",
      mode: "PAPER_SIMULATION_ONLY",
      account_count: accounts.length,
      intent_count: intents.size,
      accounts: accounts.map((account) => ({
        account_id: account.account_id,
        label: account.label,
        currency_code: account.currency_code,
        currency_scale: account.currency_scale,
        balance_minor: account.balance_minor,
        realized_pnl_minor: account.realized_pnl_minor,
        open_risk_minor: account.open_risk_minor,
        open_positions: account.open_positions,
        settled_trades: account.settled_trades,
        winning_trades: account.winning_trades,
        losing_trades: account.losing_trades,
        max_drawdown_minor: account.max_drawdown_minor,
      })),
      intents: [...intents.values()],
    });
  } catch {
    return errorResponse(
      503,
      "PAPER_SIMULATOR_UNAVAILABLE",
      "Paper simulator storage is unavailable",
    );
  }
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health/live") {
    if (request.method !== "GET") {
      return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    }
    return jsonResponse({
      status: "ALIVE",
      mode: "OBSERVATION_ONLY",
      paper_simulator: paperLedgerConfigured(env) ? "ENABLED" : "DISABLED",
      canonical_paper:
        RD_ENTRY_PROMOTION_BINDING !== null &&
        env.RD_ENTRY_CANONICAL_PAPER_ENABLED === "true" &&
        env.CF_VERSION_METADATA?.tag ===
          RD_ENTRY_PROMOTION_BINDING.build_metadata_digest
          ? "ARMED_IDENTITY_REQUIRED"
          : "DISABLED",
      deployment_version: {
        id: env.CF_VERSION_METADATA?.id ?? null,
        tag: env.CF_VERSION_METADATA?.tag ?? null,
      },
      execution: "DISABLED",
    });
  }
  if (url.pathname === "/api/v1/tradingview/observations") {
    if (request.method !== "POST") {
      return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    }
    return postObservation(request, env);
  }
  if (url.pathname === "/api/v1/observation-receipts") {
    if (request.method !== "GET") {
      return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    }
    return listReceipts(request, env);
  }
  if (url.pathname === "/api/v1/observation-setup-evidence") {
    if (request.method !== "GET") {
      return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    }
    return listSetupEvidence(request, env);
  }
  if (url.pathname === "/api/v1/paper-accounts") {
    if (request.method === "POST") {
      return createPaperAccount(request, env);
    }
    if (request.method === "GET") {
      return listPaperAccounts(request, env);
    }
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }
  if (url.pathname === "/api/v1/paper-simulations/intents") {
    if (request.method === "POST") {
      return createPaperTradeIntent(request, env);
    }
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }
  if (url.pathname === "/api/v1/paper-simulations/summary") {
    if (request.method === "GET") {
      return listPaperSimulationSummary(request, env);
    }
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }
  if (url.pathname === "/api/v1/rd-entry-decisions") {
    if (request.method !== "GET") {
      return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    }
    return listRdEntryDecisions(request, env);
  }
  if (url.pathname === "/api/v1/paper-readiness") {
    if (request.method === "GET") {
      return getPaperReadiness(request, env);
    }
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }
  if (url.pathname === "/api/v1/paper-readiness/kill-switch") {
    if (request.method === "POST") {
      return setPaperKillSwitch(request, env);
    }
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }
  const paperSettlementMatch =
    /^\/api\/v1\/paper-simulations\/intents\/([^/]+)\/settlement$/.exec(
      url.pathname,
    );
  if (paperSettlementMatch !== null) {
    const rawIntentId = paperSettlementMatch[1];
    if (rawIntentId === undefined) {
      return errorResponse(404, "NOT_FOUND", "Route not found");
    }
    if (request.method === "POST") {
      return settlePaperTradeIntent(request, env, rawIntentId);
    }
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }
  const paperLedgerMatch =
    /^\/api\/v1\/paper-accounts\/([^/]+)\/ledger-entries$/.exec(
      url.pathname,
    );
  if (paperLedgerMatch !== null) {
    const rawAccountId = paperLedgerMatch[1];
    if (rawAccountId === undefined) {
      return errorResponse(404, "NOT_FOUND", "Route not found");
    }
    if (request.method === "POST") {
      return appendPaperLedgerEntry(request, env, rawAccountId);
    }
    if (request.method === "GET") {
      return listPaperLedgerEntries(request, env, rawAccountId);
    }
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/health/")) {
    return errorResponse(404, "NOT_FOUND", "Route not found");
  }
  if (env.ASSETS !== undefined) {
    return env.ASSETS.fetch(request);
  }
  return errorResponse(404, "NOT_FOUND", "Route not found");
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
