import { validatePaperAccountId } from "./paper-ledger-contract";
import {
  PaperSimulatorContractError,
  validatePaperTradeIntent,
} from "./paper-simulator-contract";
import {
  SELECT_LATEST_PAPER_KILL_SWITCH_SQL,
  SELECT_PAPER_ACCOUNT_READINESS_METRIC_SQL,
} from "./paper-readiness-queries";
import { paperAccountAllowsNewOpen } from "./paper-readiness";
import {
  INSERT_ENTRY_V3_PAPER_TRADE_INTENT_SQL,
  INSERT_PAPER_TRADE_ALLOCATION_SQL,
  INSERT_PAPER_TRADE_SETTLEMENT_SQL,
  SELECT_PAPER_TRADE_SETTLEMENT_SQL,
} from "./paper-simulator-queries";
import {
  INSERT_ENTRY_V3_CANDIDATES_SQL,
  INSERT_ENTRY_V3_EVENT_SQL,
  INSERT_ENTRY_V3_EVENT_DISPOSITION_SQL,
  INSERT_ENTRY_V3_EVIDENCE_SQL,
  INSERT_ENTRY_V3_EXIT_APPLICATION_SQL,
  INSERT_ENTRY_V3_PAPER_LINK_SQL,
  INSERT_ENTRY_V3_PARITY_SQL,
  INSERT_ENTRY_V3_SELECTION_MEMBERS_SQL,
  INSERT_ENTRY_V3_SELECTIONS_SQL,
  INSERT_ENTRY_V3_SHADOW_POSITION_SQL,
  LIST_ENTRY_V3_PAPER_INTENT_IDS_SQL,
  LIST_ENTRY_V3_STORED_DECISIONS_SQL,
  SELECT_ENTRY_V3_EVENT_BY_ID_SQL,
  SELECT_ENTRY_V3_EVENT_BY_PRODUCER_SEQUENCE_SQL,
  SELECT_ENTRY_V3_EVENT_DISPOSITION_SQL,
  SELECT_ENTRY_V3_EXIT_APPLICATION_SQL,
  SELECT_ENTRY_V3_PAPER_LINK_SQL,
  SELECT_ENTRY_V3_SHADOW_POSITION_SQL,
  TERMINATE_ENTRY_V3_SHADOW_POSITION_SQL,
} from "./rd-entry-queries-v3";
import { canonicalSha256 } from "./rd-entry-policy";
import { isStrictJsonNumber, parseStrictJson } from "./strict-json";
import type {
  EntryCandidateEvidenceV3,
  EntryEvaluationV3,
  EntrySelectionV3,
  SelectionActionV3,
} from "./rd-entry-domain-v3";
import type {
  EntryV3ExitEvent,
  ValidatedEntryV3Bundle,
} from "./rd-entry-wire-v3";
import {
  INSERT_RECEIPT_SQL,
  SELECT_RECEIPT_SQL,
} from "./queries";
import type {
  Env,
  PaperReadinessAccountInput,
  PaperTradeIntentCommand,
  StoredPaperTradeSettlement,
  StoredPaperKillSwitchEvent,
  StoredReceipt,
  ValidatedObservation,
} from "./types";

const SHA256 = /^[a-f0-9]{64}$/u;
const NONZERO_SHA256 = /^(?!0{64}$)[a-f0-9]{64}$/u;
const RISK_BPS = /^(?:[1-9][0-9]{0,2})$/u;
const REVIEWED_TICKER_ID =
  /^[A-Z0-9][A-Z0-9._-]{0,31}:[A-Z0-9][A-Z0-9._-]{0,63}$/u;
const MAX_REVIEWED_TICKERS = 64;
const MAX_REVIEWED_SETTINGS_JSON_BYTES = 16_384;
const MAX_SAFE_INTEGER = 9_007_199_254_740_991n;
const ATTEMPT_KIND = "INITIAL" as const;

type EntryV3Observation = Extract<
  ValidatedObservation,
  { readonly version: "entry-v3" }
>;

type EffectiveActionReason =
  | "PROMOTION_IDENTITY_MISMATCH"
  | "PAPER_CONFIGURATION_UNAVAILABLE"
  | "NOT_SELECTED_ALREADY_OPEN"
  | null;

type ParityMismatchReason =
  | "CANDIDATE_IDENTITIES"
  | "EVIDENCE_IDENTITIES"
  | "SELECTED_CANDIDATE"
  | "REASON"
  | "ACTION"
  | "MULTIPLE"
  | null;

interface StoredPaperLinkV3 {
  readonly setup_id: string;
  readonly attempt_kind: "INITIAL" | "RE_ENTRY";
  readonly selection_id: string;
  readonly intent_id: string;
  readonly direction: "LONG" | "SHORT";
  readonly trigger_epoch: number;
  readonly trigger_sequence: number;
  readonly evaluated_at_epoch: number;
  readonly entry_ticks: number;
  readonly stop_ticks: number;
  readonly target_ticks: number;
  readonly created_at: string;
}

interface StoredShadowPositionV3 {
  readonly candidate_id: string;
  readonly setup_id: string;
  readonly attempt_kind: "INITIAL" | "RE_ENTRY";
  readonly direction: "LONG" | "SHORT";
  readonly trigger_epoch: number;
  readonly trigger_sequence: number;
  readonly evaluated_at_epoch: number;
  readonly entry_ticks: number;
  readonly stop_ticks: number;
  readonly target_ticks: number;
  readonly state: "OPEN" | "STOPPED" | "TARGET_HIT" | "AMBIGUOUS";
  readonly exit_event_id: string | null;
  readonly outcome_r_millis: number | null;
}

interface StoredExitApplicationV3 {
  readonly application_id: string;
  readonly event_id: string;
  readonly exit_event_id: string;
  readonly setup_id: string;
  readonly attempt_kind: "INITIAL" | "RE_ENTRY";
  readonly target_kind: "PAPER" | "SHADOW";
  readonly intent_id: string | null;
  readonly candidate_id: string | null;
  readonly terminal_code:
    | "STOP"
    | "TARGET"
    | "STOPPED"
    | "TARGET_HIT"
    | "AMBIGUOUS";
  readonly outcome_r_millis: number | null;
  readonly applied_at: string;
}

interface StoredEventDispositionV3 {
  readonly event_id: string;
  readonly receipt_id: string;
  readonly disposition: "ACCEPTED" | "CONFLICT";
  readonly conflict_code: "EXIT_CONFLICT" | null;
  readonly recorded_at: string;
}

interface PaperConfiguration {
  readonly accountIds: readonly string[];
  readonly riskBps: number;
}

export interface EntryV3StoredEvaluation {
  readonly evaluation: EntryEvaluationV3;
  readonly effectiveAction: SelectionActionV3;
  readonly effectiveActionReason: EffectiveActionReason;
  readonly parityStatus: "MATCH" | "MISMATCH" | "NOT_PROVIDED";
  readonly parityMismatchReason: ParityMismatchReason;
}

export interface AppendEntryV3Result {
  readonly record: StoredReceipt;
  readonly inserted: boolean;
  readonly eventId: string;
  readonly evaluations: readonly EntryV3StoredEvaluation[];
  readonly paperIntentIds: readonly string[];
}

export class EntryV3StoreConflict extends Error {
  constructor(
    readonly code:
      | "IDEMPOTENCY_CONFLICT"
      | "EVENT_ID_CONFLICT"
      | "PRODUCER_SEQUENCE_CONFLICT"
      | "EXIT_CONFLICT",
  ) {
    super(code);
    this.name = "EntryV3StoreConflict";
  }
}

function parsePaperConfiguration(env: Env): PaperConfiguration | null {
  const rawAccounts = env.RD_ENTRY_PAPER_ACCOUNT_IDS;
  const rawRisk = env.RD_ENTRY_PAPER_RISK_BPS;
  if (
    rawAccounts === undefined ||
    rawRisk === undefined ||
    !RISK_BPS.test(rawRisk)
  ) {
    return null;
  }
  const riskBps = Number(rawRisk);
  if (riskBps < 1 || riskBps > 500) return null;
  try {
    const accountIds = rawAccounts.split(",").map((item) => {
      if (item.length === 0 || item.trim() !== item) throw new TypeError();
      return validatePaperAccountId(item);
    });
    const sorted = [...new Set(accountIds)].sort((left, right) =>
      left.localeCompare(right),
    );
    if (sorted.length === 0 || sorted.length !== accountIds.length) return null;
    return { accountIds: sorted, riskBps };
  } catch {
    return null;
  }
}

function reviewedIdentityMatches(
  env: Env,
  observation: EntryV3Observation,
): boolean {
  const settingsHash = reviewedSettingsHashForTicker(
    env,
    observation.metadata.tickerId,
  );
  return (
    typeof env.RD_ENTRY_V3_DETECTOR_CODE_HASH === "string" &&
    NONZERO_SHA256.test(env.RD_ENTRY_V3_DETECTOR_CODE_HASH) &&
    settingsHash !== null &&
    observation.detectorCodeHash === env.RD_ENTRY_V3_DETECTOR_CODE_HASH &&
    observation.settingsHash === settingsHash
  );
}

function reviewedSettingsHashForTicker(
  env: Env,
  tickerId: string,
): string | null {
  const rawByTicker = env.RD_ENTRY_V3_SETTINGS_HASHES_JSON;
  if (rawByTicker === undefined) {
    const legacyHash = env.RD_ENTRY_V3_SETTINGS_HASH;
    return typeof legacyHash === "string" && NONZERO_SHA256.test(legacyHash)
      ? legacyHash
      : null;
  }
  if (
    rawByTicker.length === 0 ||
    new TextEncoder().encode(rawByTicker).byteLength >
      MAX_REVIEWED_SETTINGS_JSON_BYTES
  ) {
    return null;
  }
  let value;
  try {
    value = parseStrictJson(new TextEncoder().encode(rawByTicker));
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    isStrictJsonNumber(value)
  ) {
    return null;
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > MAX_REVIEWED_TICKERS) {
    return null;
  }
  for (const [configuredTickerId, configuredHash] of entries) {
    if (
      !REVIEWED_TICKER_ID.test(configuredTickerId) ||
      typeof configuredHash !== "string" ||
      !NONZERO_SHA256.test(configuredHash)
    ) {
      return null;
    }
  }
  const reviewedHash = value[tickerId];
  return typeof reviewedHash === "string" ? reviewedHash : null;
}

async function paperConfigurationIsUsable(
  env: Env,
  configuration: PaperConfiguration,
  candidatePositions: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(candidatePositions) || candidatePositions < 1) {
    return false;
  }
  const killSwitch = await env.DB
    .prepare(SELECT_LATEST_PAPER_KILL_SWITCH_SQL)
    .first<StoredPaperKillSwitchEvent>();
  if (killSwitch === null || killSwitch.enabled !== 0) return false;
  const results = await env.DB.batch(
    configuration.accountIds.map((accountId) =>
      env.DB.prepare(SELECT_PAPER_ACCOUNT_READINESS_METRIC_SQL).bind(accountId),
    ),
  );
  return results.every((result) => {
    const account = result.results[0] as PaperReadinessAccountInput | undefined;
    if (
      account === undefined ||
      !Number.isSafeInteger(account.balance_minor) ||
      account.balance_minor <= 0
    ) {
      return false;
    }
    const riskPerPosition =
      (BigInt(account.balance_minor) * BigInt(configuration.riskBps)) / 10_000n;
    const risk = riskPerPosition * BigInt(candidatePositions);
    return (
      risk > 0n &&
      risk <= MAX_SAFE_INTEGER &&
      paperAccountAllowsNewOpen(account, Number(risk), candidatePositions)
    );
  });
}

function ticksToDecimal(ticks: number, tickSize: string): string {
  if (!Number.isSafeInteger(ticks) || ticks <= 0) throw new TypeError();
  const [whole = "", fractional = ""] = tickSize.split(".");
  const scale = fractional.length;
  const units = BigInt(`${whole}${fractional}`) * BigInt(ticks);
  const digits = units.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const integer = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/u, "");
  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
}

function validatedPaperIntent(
  observation: EntryV3Observation,
  bundle: ValidatedEntryV3Bundle,
  evidence: EntryCandidateEvidenceV3,
  configuration: PaperConfiguration,
): PaperTradeIntentCommand | null {
  try {
    const command = {
      schema_version: "1.0",
      intent_id: `rd-entry-v3:${bundle.evaluation.selection.selection_id}`,
      symbol: observation.metadata.symbol,
      side: bundle.setup.direction === "LONG" ? "BUY" : "SELL",
      entry_price: ticksToDecimal(
        evidence.observed_trigger_ticks!,
        observation.tickSize,
      ),
      stop_loss: ticksToDecimal(
        bundle.tradePlan.stop_ticks,
        observation.tickSize,
      ),
      take_profit: ticksToDecimal(
        bundle.tradePlan.target_ticks,
        observation.tickSize,
      ),
      risk_bps: configuration.riskBps,
      account_ids: [...configuration.accountIds],
    };
    return validatePaperTradeIntent(
      parseStrictJson(
        new TextEncoder().encode(JSON.stringify(command)),
      ),
    );
  } catch (error) {
    if (
      error instanceof PaperSimulatorContractError ||
      error instanceof TypeError
    ) {
      return null;
    }
    throw error;
  }
}

function selectedEvidence(
  bundle: ValidatedEntryV3Bundle,
): EntryCandidateEvidenceV3 | null {
  const id = bundle.evaluation.selection.canonical_evidence_id;
  return id === null
    ? null
    : (bundle.evaluation.evidence.find((item) => item.evidence_id === id) ??
        null);
}

function discretionaryBocPair(bundle: ValidatedEntryV3Bundle): {
  readonly candidateIndex: number;
  readonly evidence: EntryCandidateEvidenceV3;
} | null {
  const candidateIndex = bundle.evaluation.candidates.findIndex(
    (candidate) =>
      candidate.model === "BOC" &&
      candidate.state === "MATCHED" &&
      candidate.boc_tier === "DISCRETIONARY_5M",
  );
  if (candidateIndex < 0) return null;
  const candidate = bundle.evaluation.candidates[candidateIndex];
  const evidence = bundle.evaluation.evidence.find(
    (item) => item.candidate_id === candidate?.candidate_id,
  );
  return evidence === undefined || evidence.observed_trigger_epoch === null
    ? null
    : { candidateIndex, evidence };
}

function selectedShadowPair(bundle: ValidatedEntryV3Bundle): {
  readonly candidateIndex: number;
  readonly evidence: EntryCandidateEvidenceV3;
} | null {
  const candidateId =
    bundle.evaluation.selection.canonical_candidate_id;
  const evidence = selectedEvidence(bundle);
  if (
    candidateId === null ||
    evidence === null ||
    evidence.observed_trigger_epoch === null ||
    evidence.observed_trigger_ticks === null
  ) {
    return null;
  }
  const candidateIndex = bundle.evaluation.candidates.findIndex(
    (candidate) =>
      candidate.candidate_id === candidateId &&
      candidate.state === "MATCHED",
  );
  return candidateIndex < 0 ? null : { candidateIndex, evidence };
}

function parityFor(bundle: ValidatedEntryV3Bundle): {
  readonly status: "MATCH" | "MISMATCH" | "NOT_PROVIDED";
  readonly reason: ParityMismatchReason;
} {
  const proposal = bundle.selectionProposal;
  if (proposal === null) return { status: "NOT_PROVIDED", reason: null };
  const edge = bundle.evaluation.selection;
  const differences: ParityMismatchReason[] = [];
  if (
    proposal.candidate_ids_considered.join("\u0000") !==
    edge.candidate_ids_considered.join("\u0000")
  ) {
    differences.push("CANDIDATE_IDENTITIES");
  }
  const proposalEvidence = proposal.canonical_evidence_id;
  if (proposalEvidence !== edge.canonical_evidence_id) {
    differences.push("EVIDENCE_IDENTITIES");
  }
  if (
    proposal.canonical_candidate_id !== edge.canonical_candidate_id ||
    proposal.canonical_model !== edge.canonical_model
  ) {
    differences.push("SELECTED_CANDIDATE");
  }
  if (proposal.reason !== edge.reason) differences.push("REASON");
  if (proposal.action !== edge.action) differences.push("ACTION");
  return differences.length === 0
    ? { status: "MATCH", reason: null }
    : {
        status: "MISMATCH",
        reason: differences.length === 1 ? differences[0]! : "MULTIPLE",
      };
}

function eventTupleAfter(
  epoch: number,
  sequence: number,
  anchorEpoch: number,
  anchorSequence: number,
): boolean {
  return (
    epoch > anchorEpoch ||
    (epoch === anchorEpoch && sequence > anchorSequence)
  );
}

function exitIsCausallyEconomic(
  observation: EntryV3Observation,
  exit: EntryV3ExitEvent,
  boundary: {
    readonly trigger_epoch: number;
    readonly trigger_sequence: number;
    readonly evaluated_at_epoch: number;
  },
): boolean {
  if (
    !eventTupleAfter(
      exit.epoch,
      exit.sequence,
      boundary.trigger_epoch,
      boundary.trigger_sequence,
    ) ||
    exit.epoch < boundary.evaluated_at_epoch
  ) {
    return false;
  }
  const bar = observation.marketEvent.confirmed_bar;
  return (
    observation.isRealtime ||
    (bar !== null &&
      bar.open_epoch >=
        Math.max(boundary.trigger_epoch, boundary.evaluated_at_epoch))
  );
}

function exitHitsStoredPlan(
  observation: EntryV3Observation,
  exit: EntryV3ExitEvent,
  position: {
    readonly direction: "LONG" | "SHORT";
    readonly stop_ticks: number;
    readonly target_ticks: number;
  },
): boolean {
  const bar = observation.marketEvent.confirmed_bar;
  if (!observation.isRealtime && bar !== null) {
    const stopHit =
      position.direction === "LONG"
        ? bar.low_ticks <= position.stop_ticks
        : bar.high_ticks >= position.stop_ticks;
    const targetHit =
      position.direction === "LONG"
        ? bar.high_ticks >= position.target_ticks
        : bar.low_ticks <= position.target_ticks;
    return exit.exit_reason === "AMBIGUOUS_SAME_BAR_EXIT"
      ? stopHit && targetHit
      : exit.exit_reason === "STOP_LOSS"
        ? stopHit && !targetHit
        : targetHit && !stopHit;
  }
  if (exit.exit_reason === "AMBIGUOUS_SAME_BAR_EXIT") return false;
  return position.direction === "LONG"
    ? exit.exit_reason === "STOP_LOSS"
      ? exit.price_ticks <= position.stop_ticks
      : exit.price_ticks >= position.target_ticks
    : exit.exit_reason === "STOP_LOSS"
      ? exit.price_ticks >= position.stop_ticks
      : exit.price_ticks <= position.target_ticks;
}

function targetRMillis(position: {
  readonly entry_ticks: number;
  readonly stop_ticks: number;
  readonly target_ticks: number;
}): number | null {
  const risk = Math.abs(position.entry_ticks - position.stop_ticks);
  const reward = Math.abs(position.target_ticks - position.entry_ticks);
  if (risk <= 0) return null;
  const result = Math.trunc((reward * 1_000) / risk);
  return result >= 0 && result <= 10_000 ? result : null;
}

async function qualifiedId(eventId: string, kind: string, id: string): Promise<string> {
  return canonicalSha256({ event_id: eventId, kind, logical_id: id });
}

function receiptInsert(
  env: Env,
  receiptId: string,
  recordedAt: string,
  observation: EntryV3Observation,
  payloadSha256: string,
): D1PreparedStatement {
  const metadata = observation.metadata;
  return env.DB.prepare(INSERT_RECEIPT_SQL).bind(
    receiptId,
    recordedAt,
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

async function storedReceipt(
  env: Env,
  idempotencyKey: string,
): Promise<StoredReceipt | null> {
  return env.DB
    .prepare(SELECT_RECEIPT_SQL)
    .bind(idempotencyKey)
    .first<StoredReceipt>();
}

async function paperIntentIdsForEvent(
  env: Env,
  eventId: string,
): Promise<readonly string[]> {
  const result = await env.DB
    .prepare(LIST_ENTRY_V3_PAPER_INTENT_IDS_SQL)
    .bind(eventId)
    .all<{ intent_id: string }>();
  return result.results.map((item) => item.intent_id);
}

async function storedEvaluationsForEvent(
  env: Env,
  eventId: string,
  bundles: readonly ValidatedEntryV3Bundle[],
): Promise<readonly EntryV3StoredEvaluation[]> {
  const result = await env.DB
    .prepare(LIST_ENTRY_V3_STORED_DECISIONS_SQL)
    .bind(eventId)
    .all<{
      setup_id: string;
      action: SelectionActionV3;
      effective_action_reason: EffectiveActionReason;
      parity_status: "MATCH" | "MISMATCH" | "NOT_PROVIDED";
      mismatch_reason: ParityMismatchReason;
    }>();
  const bySetup = new Map(result.results.map((item) => [item.setup_id, item]));
  return bundles.map((bundle) => {
    const stored = bySetup.get(bundle.setup.setup_id);
    if (stored === undefined) throw new TypeError("stored v3 decision unavailable");
    return {
      evaluation: bundle.evaluation,
      effectiveAction: stored.action,
      effectiveActionReason: stored.effective_action_reason,
      parityStatus: stored.parity_status,
      parityMismatchReason: stored.mismatch_reason,
    };
  });
}

function paperIntentIdempotencyKey(intentId: string): string {
  return `paper-intent:${intentId}`;
}

function paperSettlementIdempotencyKey(intentId: string): string {
  return `paper-settlement:${intentId}`;
}

function databaseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isReadinessConstraint(error: unknown): boolean {
  const message = databaseErrorMessage(error);
  return (
    message.includes("paper safety gate blocked allocation") ||
    /NOT NULL constraint failed: paper_trade_allocations\.(?:intent_id|risk_amount_minor|balance_before_minor)/u.test(
      message,
    )
  );
}

function isExitApplicationRace(error: unknown): boolean {
  const message = databaseErrorMessage(error);
  return (
    message.includes(
      "UNIQUE constraint failed: observation_entry_v3_exit_applications",
    ) ||
    /UNIQUE constraint failed: paper_trade_settlements\.(?:settlement_id|intent_id|idempotency_key)/u.test(
      message,
    )
  );
}

function isPaperLinkRace(error: unknown): boolean {
  const message = databaseErrorMessage(error);
  return (
    message.includes(
      "UNIQUE constraint failed: observation_entry_v3_paper_links.setup_id, observation_entry_v3_paper_links.attempt_kind",
    ) ||
    message.includes(
      "UNIQUE constraint failed: paper_trade_intents.intent_id",
    ) ||
    message.includes(
      "UNIQUE constraint failed: paper_trade_intents.idempotency_key",
    )
  );
}

async function storedEventDisposition(
  env: Env,
  eventId: string,
): Promise<StoredEventDispositionV3> {
  const disposition = await env.DB
    .prepare(SELECT_ENTRY_V3_EVENT_DISPOSITION_SQL)
    .bind(eventId)
    .first<StoredEventDispositionV3>();
  if (disposition === null) throw new TypeError("v3 disposition unavailable");
  return disposition;
}

async function throwStoredEventConflict(
  env: Env,
  eventId: string,
  receiptId: string,
): Promise<void> {
  const disposition = await storedEventDisposition(env, eventId);
  if (disposition.receipt_id !== receiptId) {
    throw new EntryV3StoreConflict("EVENT_ID_CONFLICT");
  }
  if (
    disposition.disposition === "CONFLICT" &&
    disposition.conflict_code === "EXIT_CONFLICT"
  ) {
    throw new EntryV3StoreConflict("EXIT_CONFLICT");
  }
}

async function appendEntryV3ObservationAttempt(
  env: Env,
  observation: EntryV3Observation,
  payloadSha256: string,
  allowDecisionRaceRetry: boolean,
  forceConfigurationUnavailable = false,
): Promise<AppendEntryV3Result> {
  if (!SHA256.test(payloadSha256)) throw new TypeError("payload digest");
  const existingReceipt = await storedReceipt(
    env,
    observation.metadata.idempotencyKey,
  );
  if (existingReceipt !== null) {
    if (existingReceipt.payload_sha256 !== payloadSha256) {
      throw new EntryV3StoreConflict("IDEMPOTENCY_CONFLICT");
    }
    const storedEvent = await env.DB
      .prepare(SELECT_ENTRY_V3_EVENT_BY_ID_SQL)
      .bind(observation.eventId)
      .first<{
        event_id: string;
        receipt_id: string;
        payload_sha256: string;
      }>();
    if (
      storedEvent === null ||
      storedEvent.receipt_id !== existingReceipt.receipt_id ||
      storedEvent.payload_sha256 !== payloadSha256
    ) {
      throw new EntryV3StoreConflict("EVENT_ID_CONFLICT");
    }
    await throwStoredEventConflict(
      env,
      observation.eventId,
      existingReceipt.receipt_id,
    );
    return {
      record: existingReceipt,
      inserted: false,
      eventId: observation.eventId,
      evaluations: await storedEvaluationsForEvent(
        env,
        observation.eventId,
        observation.entryBundles,
      ),
      paperIntentIds: await paperIntentIdsForEvent(env, observation.eventId),
    };
  }
  const eventCollision = await env.DB
    .prepare(SELECT_ENTRY_V3_EVENT_BY_ID_SQL)
    .bind(observation.eventId)
    .first<{ event_id: string; payload_sha256: string }>();
  if (eventCollision !== null) throw new EntryV3StoreConflict("EVENT_ID_CONFLICT");
  const producerSequenceCollision = await env.DB
    .prepare(SELECT_ENTRY_V3_EVENT_BY_PRODUCER_SEQUENCE_SQL)
    .bind(
      observation.metadata.producerInstanceId,
      observation.producerSequence,
    )
    .first<{ event_id: string; payload_sha256: string }>();
  if (producerSequenceCollision !== null) {
    throw new EntryV3StoreConflict("PRODUCER_SEQUENCE_CONFLICT");
  }

  const identityMatches = reviewedIdentityMatches(env, observation);
  const paperConfiguration = parsePaperConfiguration(env);
  const links = await Promise.all(
    observation.entryBundles.map(async (bundle) => {
      const link = await env.DB
        .prepare(SELECT_ENTRY_V3_PAPER_LINK_SQL)
        .bind(bundle.setup.setup_id, ATTEMPT_KIND)
        .first<StoredPaperLinkV3>();
      return [bundle.setup.setup_id, link] as const;
    }),
  );
  const existingLinks = new Map(links);
  const preparedPaperIntents = new Map<
    string,
    {
      readonly intent: PaperTradeIntentCommand;
      readonly evidence: EntryCandidateEvidenceV3;
    }
  >();
  if (
    identityMatches &&
    observation.eventRole === "ENTRY_DECISION" &&
    paperConfiguration !== null &&
    !forceConfigurationUnavailable
  ) {
    for (const bundle of observation.entryBundles) {
      const evidence = selectedEvidence(bundle);
      if (
        bundle.evaluation.selection.action !== "PAPER_ELIGIBLE" ||
        existingLinks.get(bundle.setup.setup_id) !== null ||
        evidence === null ||
        evidence.observed_trigger_epoch === null ||
        evidence.observed_trigger_ticks === null
      ) {
        continue;
      }
      const intent = validatedPaperIntent(
        observation,
        bundle,
        evidence,
        paperConfiguration,
      );
      if (intent !== null) {
        preparedPaperIntents.set(bundle.setup.setup_id, { intent, evidence });
      }
    }
  }
  const potentialPaperPositions = preparedPaperIntents.size;
  const configurationUsable =
    !forceConfigurationUnavailable &&
    paperConfiguration !== null &&
    potentialPaperPositions > 0 &&
    (await paperConfigurationIsUsable(
      env,
      paperConfiguration,
      potentialPaperPositions,
    ));
  const recordedAt = new Date().toISOString();
  const receiptId = crypto.randomUUID();
  const candidateRows: Array<Record<string, unknown>> = [];
  const evidenceRows: Array<Record<string, unknown>> = [];
  const selectionRows: Array<Record<string, unknown>> = [];
  const memberRows: Array<Record<string, unknown>> = [];
  const parityRows: Array<Record<string, unknown>> = [];
  const entryAuthorizationStatements: D1PreparedStatement[] = [];
  const exitMutationStatements: D1PreparedStatement[] = [];
  const evaluations: EntryV3StoredEvaluation[] = [];
  let exitConflict = false;

  for (const bundle of observation.entryBundles) {
    const selection = bundle.evaluation.selection;
    const selectionRowId = await qualifiedId(
      observation.eventId,
      "selection",
      selection.selection_id,
    );
    const candidateRowIds = new Map<string, string>();
    for (const candidate of bundle.evaluation.candidates) {
      const rowId = await qualifiedId(
        observation.eventId,
        "candidate",
        candidate.candidate_id,
      );
      candidateRowIds.set(candidate.candidate_id, rowId);
      candidateRows.push({
        candidate_id: rowId,
        logical_candidate_id: candidate.candidate_id,
        event_id: observation.eventId,
        setup_id: candidate.setup_id,
        model: candidate.model,
        state: candidate.state,
        direction: candidate.direction,
        event_anchor_epoch: candidate.event_anchor_epoch,
        trigger_ordinal: candidate.trigger_ordinal,
        boc_tier: candidate.boc_tier,
        reference_candle_open_epoch: candidate.reference_candle_open_epoch,
        source_claim_ids_json: JSON.stringify(candidate.source_claim_ids),
        candidate_json: JSON.stringify(candidate),
        observed_at_epoch: candidate.observed_at_epoch,
      });
      memberRows.push({
        selection_id: selectionRowId,
        object_kind: "CANDIDATE",
        object_id: rowId,
      });
    }
    const evidenceRowIds = new Map<string, string>();
    for (const evidence of bundle.evaluation.evidence) {
      const rowId = await qualifiedId(
        observation.eventId,
        "evidence",
        evidence.evidence_id,
      );
      const candidateRowId = candidateRowIds.get(evidence.candidate_id);
      if (candidateRowId === undefined) throw new TypeError("orphan evidence");
      evidenceRowIds.set(evidence.evidence_id, rowId);
      evidenceRows.push({
        evidence_id: rowId,
        logical_evidence_id: evidence.evidence_id,
        event_id: observation.eventId,
        candidate_id: candidateRowId,
        logical_candidate_id: evidence.candidate_id,
        observed_trigger_epoch: evidence.observed_trigger_epoch,
        trigger_sequence: evidence.trigger_sequence,
        observed_trigger_ticks: evidence.observed_trigger_ticks,
        fidelity: evidence.fidelity,
        proof_plane: evidence.proof_plane,
        replayability: evidence.replayability,
        evidence_json: JSON.stringify(evidence),
        observed_at_epoch: evidence.observed_at_epoch,
      });
      memberRows.push({
        selection_id: selectionRowId,
        object_kind: "EVIDENCE",
        object_id: rowId,
      });
    }

    const existingLink = existingLinks.get(bundle.setup.setup_id) ?? null;
    let effectiveAction = selection.action;
    let effectiveActionReason: EffectiveActionReason = null;
    const evidence = selectedEvidence(bundle);
    if (selection.action === "PAPER_ELIGIBLE") {
      if (!identityMatches) {
        effectiveAction = "SHADOW_ONLY";
        effectiveActionReason = "PROMOTION_IDENTITY_MISMATCH";
      } else if (
        observation.eventRole !== "ENTRY_DECISION" ||
        existingLink !== null
      ) {
        effectiveAction = "SHADOW_ONLY";
        effectiveActionReason = "NOT_SELECTED_ALREADY_OPEN";
      } else if (
        !configurationUsable ||
        paperConfiguration === null ||
        !preparedPaperIntents.has(bundle.setup.setup_id)
      ) {
        effectiveAction = "SHADOW_ONLY";
        effectiveActionReason = "PAPER_CONFIGURATION_UNAVAILABLE";
      }
    }

    const parity = parityFor(bundle);
    const selectedTriggerEpoch = evidence?.observed_trigger_epoch ?? null;
    const selectedTriggerSequence = evidence?.trigger_sequence ?? null;
    selectionRows.push({
      selection_id: selectionRowId,
      logical_selection_id: selection.selection_id,
      event_id: observation.eventId,
      setup_id: selection.setup_id,
      attempt_kind: ATTEMPT_KIND,
      revision: selection.revision,
      canonical_candidate_id:
        selection.canonical_candidate_id === null
          ? null
          : candidateRowIds.get(selection.canonical_candidate_id),
      canonical_evidence_id:
        selection.canonical_evidence_id === null
          ? null
          : evidenceRowIds.get(selection.canonical_evidence_id),
      canonical_model: selection.canonical_model,
      reason: selection.reason,
      fidelity: selection.fidelity,
      policy_action: selection.action,
      action: effectiveAction,
      effective_action_reason: effectiveActionReason,
      co_triggered_models_json: JSON.stringify(selection.co_triggered_models),
      evaluated_at_epoch: selection.evaluated_at_epoch,
      selected_trigger_epoch: selectedTriggerEpoch,
      selected_trigger_sequence: selectedTriggerSequence,
      entry_ticks: bundle.tradePlan.entry_ticks,
      stop_ticks: bundle.tradePlan.stop_ticks,
      target_ticks: bundle.tradePlan.target_ticks,
      selection_json: JSON.stringify(selection),
    });
    parityRows.push({
      parity_id: await qualifiedId(observation.eventId, "parity", selection.selection_id),
      event_id: observation.eventId,
      selection_id: selectionRowId,
      parity_status: parity.status,
      mismatch_reason: parity.reason,
      compared_at: recordedAt,
    });
    evaluations.push({
      evaluation: bundle.evaluation,
      effectiveAction,
      effectiveActionReason,
      parityStatus: parity.status,
      parityMismatchReason: parity.reason,
    });

    const preparedPaper = preparedPaperIntents.get(bundle.setup.setup_id);
    if (
      effectiveAction === "PAPER_ELIGIBLE" &&
      preparedPaper !== undefined &&
      preparedPaper.evidence.observed_trigger_epoch !== null
    ) {
      const { intent, evidence: intentEvidence } = preparedPaper;
      const intentPayloadSha256 = await canonicalSha256({
        ...intent,
        account_ids: [...intent.account_ids],
      });
      entryAuthorizationStatements.push(
        env.DB
          .prepare(INSERT_ENTRY_V3_PAPER_TRADE_INTENT_SQL)
          .bind(
            intent.intent_id,
            paperIntentIdempotencyKey(intent.intent_id),
            intentPayloadSha256,
            intent.symbol,
            intent.side,
            intent.entry_price,
            intent.stop_loss,
            intent.take_profit,
            intent.risk_bps,
            recordedAt,
          ),
        ...intent.account_ids.map((accountId) =>
          env.DB
            .prepare(INSERT_PAPER_TRADE_ALLOCATION_SQL)
            .bind(
              intent.risk_bps,
              accountId,
              intent.intent_id,
              intentPayloadSha256,
              crypto.randomUUID(),
              accountId,
              recordedAt,
            ),
        ),
        env.DB.prepare(INSERT_ENTRY_V3_PAPER_LINK_SQL).bind(
          bundle.setup.setup_id,
          ATTEMPT_KIND,
          selectionRowId,
          intent.intent_id,
          bundle.setup.direction,
          intentEvidence.observed_trigger_epoch,
          intentEvidence.trigger_sequence,
          selection.evaluated_at_epoch,
          bundle.tradePlan.entry_ticks,
          bundle.tradePlan.stop_ticks,
          bundle.tradePlan.target_ticks,
          recordedAt,
        ),
      );
    }

    const shadowPair =
      discretionaryBocPair(bundle) ??
      (identityMatches &&
      effectiveActionReason === "PAPER_CONFIGURATION_UNAVAILABLE"
        ? selectedShadowPair(bundle)
        : null);
    if (
      observation.eventRole === "ENTRY_DECISION" &&
      shadowPair !== null &&
      (await env.DB
        .prepare(SELECT_ENTRY_V3_SHADOW_POSITION_SQL)
        .bind(bundle.setup.setup_id, ATTEMPT_KIND)
        .first<StoredShadowPositionV3>()) === null
    ) {
      const candidate = bundle.evaluation.candidates[shadowPair.candidateIndex]!;
      entryAuthorizationStatements.push(
        env.DB.prepare(INSERT_ENTRY_V3_SHADOW_POSITION_SQL).bind(
          candidateRowIds.get(candidate.candidate_id),
          bundle.setup.setup_id,
          ATTEMPT_KIND,
          bundle.setup.direction,
          shadowPair.evidence.observed_trigger_epoch,
          shadowPair.evidence.trigger_sequence,
          selection.evaluated_at_epoch,
          shadowPair.evidence.observed_trigger_ticks,
          bundle.tradePlan.stop_ticks,
          bundle.tradePlan.target_ticks,
          recordedAt,
        ),
      );
    }

    if (observation.eventRole === "EXIT_FOLLOWUP" && identityMatches) {
      const exits = observation.exitEvents.filter(
        (item) => item.setup_id === bundle.setup.setup_id,
      );
      const link = existingLink;
      const shadow = await env.DB
        .prepare(SELECT_ENTRY_V3_SHADOW_POSITION_SQL)
        .bind(bundle.setup.setup_id, ATTEMPT_KIND)
        .first<StoredShadowPositionV3>();
      for (const exit of exits) {
        if (link !== null) {
          const settled = await env.DB
            .prepare(SELECT_PAPER_TRADE_SETTLEMENT_SQL)
            .bind(link.intent_id)
            .first<StoredPaperTradeSettlement>();
          const application = await env.DB
            .prepare(SELECT_ENTRY_V3_EXIT_APPLICATION_SQL)
            .bind("PAPER", bundle.setup.setup_id, ATTEMPT_KIND)
            .first<StoredExitApplicationV3>();
          const outcome =
            exit.exit_reason === "STOP_LOSS"
              ? -1_000
              : exit.exit_reason === "TARGET"
                ? targetRMillis(link)
                : null;
          const terminal =
            exit.exit_reason === "STOP_LOSS"
              ? "STOP"
              : exit.exit_reason === "TARGET"
                ? "TARGET"
                : null;
          if (settled !== null || application !== null) {
            const terminalMatches =
              terminal !== null &&
              outcome !== null &&
              settled !== null &&
              application !== null &&
              settled.exit_reason === terminal &&
              settled.outcome_r_millis === outcome &&
              application.exit_event_id === exit.event_id &&
              application.terminal_code === terminal &&
              application.outcome_r_millis === outcome &&
              application.intent_id === link.intent_id;
            if (!terminalMatches) exitConflict = true;
          } else if (
            terminal !== null &&
            outcome !== null &&
            exitIsCausallyEconomic(observation, exit, link) &&
            exitHitsStoredPlan(observation, exit, link)
          ) {
            const settlementPayloadSha256 = await canonicalSha256({
              intent_id: link.intent_id,
              schema_version: "1.0",
              outcome_r_millis: outcome,
              exit_reason: terminal,
            });
            exitMutationStatements.push(
              env.DB.prepare(INSERT_PAPER_TRADE_SETTLEMENT_SQL).bind(
                await qualifiedId(exit.event_id, "settlement", link.intent_id),
                link.intent_id,
                paperSettlementIdempotencyKey(link.intent_id),
                settlementPayloadSha256,
                outcome,
                terminal,
                recordedAt,
              ),
              env.DB.prepare(INSERT_ENTRY_V3_EXIT_APPLICATION_SQL).bind(
                await qualifiedId(
                  exit.event_id,
                  "exit-application",
                  `PAPER:${bundle.setup.setup_id}:${ATTEMPT_KIND}`,
                ),
                observation.eventId,
                exit.event_id,
                bundle.setup.setup_id,
                ATTEMPT_KIND,
                "PAPER",
                link.intent_id,
                null,
                terminal,
                outcome,
                recordedAt,
              ),
            );
          }
        }
        if (shadow !== null) {
          const outcome =
            exit.exit_reason === "STOP_LOSS"
              ? -1_000
              : exit.exit_reason === "TARGET"
                ? targetRMillis(shadow)
                : null;
          const state =
            exit.exit_reason === "STOP_LOSS"
              ? "STOPPED"
              : exit.exit_reason === "TARGET"
                ? "TARGET_HIT"
                : "AMBIGUOUS";
          const canApply =
            exitHitsStoredPlan(observation, exit, shadow) &&
            exitIsCausallyEconomic(observation, exit, shadow) &&
            (exit.exit_reason === "AMBIGUOUS_SAME_BAR_EXIT" ||
              outcome !== null);
          const application = await env.DB
            .prepare(SELECT_ENTRY_V3_EXIT_APPLICATION_SQL)
            .bind("SHADOW", bundle.setup.setup_id, ATTEMPT_KIND)
            .first<StoredExitApplicationV3>();
          if (shadow.state !== "OPEN") {
            if (
              application === null ||
              shadow.state !== state ||
              shadow.exit_event_id !== exit.event_id ||
              shadow.outcome_r_millis !== outcome ||
              application.exit_event_id !== exit.event_id ||
              application.terminal_code !== state ||
              application.outcome_r_millis !== outcome ||
              application.candidate_id !== shadow.candidate_id
            ) {
              exitConflict = true;
            }
          } else if (canApply && application !== null) {
            exitConflict = true;
          } else if (canApply) {
            exitMutationStatements.push(
              env.DB.prepare(TERMINATE_ENTRY_V3_SHADOW_POSITION_SQL).bind(
                state,
                exit.event_id,
                outcome,
                recordedAt,
                shadow.candidate_id,
              ),
              env.DB.prepare(INSERT_ENTRY_V3_EXIT_APPLICATION_SQL).bind(
                await qualifiedId(
                  exit.event_id,
                  "exit-application",
                  `SHADOW:${bundle.setup.setup_id}:${ATTEMPT_KIND}`,
                ),
                observation.eventId,
                exit.event_id,
                bundle.setup.setup_id,
                ATTEMPT_KIND,
                "SHADOW",
                null,
                shadow.candidate_id,
                state,
                outcome,
                recordedAt,
              ),
            );
          }
        }
      }
    }
  }

  const statements = [
    receiptInsert(env, receiptId, recordedAt, observation, payloadSha256),
    env.DB.prepare(INSERT_ENTRY_V3_EVENT_SQL).bind(
      observation.eventId,
      receiptId,
      observation.metadata.producerInstanceId,
      observation.producerSequence,
      observation.eventRole,
      observation.isRealtime ? 1 : 0,
      observation.metadata.symbol,
      observation.tickSize,
      observation.detectorCodeHash,
      observation.settingsHash,
      JSON.stringify(observation.canonicalPayload),
      payloadSha256,
      observation.observedAtEpoch,
      recordedAt,
    ),
    env.DB.prepare(INSERT_ENTRY_V3_EVENT_DISPOSITION_SQL).bind(
      observation.eventId,
      receiptId,
      exitConflict ? "CONFLICT" : "ACCEPTED",
      exitConflict ? "EXIT_CONFLICT" : null,
      recordedAt,
    ),
    env.DB
      .prepare(INSERT_ENTRY_V3_CANDIDATES_SQL)
      .bind(JSON.stringify(candidateRows)),
    env.DB
      .prepare(INSERT_ENTRY_V3_EVIDENCE_SQL)
      .bind(JSON.stringify(evidenceRows)),
    env.DB
      .prepare(INSERT_ENTRY_V3_SELECTIONS_SQL)
      .bind(JSON.stringify(selectionRows)),
    env.DB
      .prepare(INSERT_ENTRY_V3_SELECTION_MEMBERS_SQL)
      .bind(JSON.stringify(memberRows)),
    env.DB.prepare(INSERT_ENTRY_V3_PARITY_SQL).bind(JSON.stringify(parityRows)),
    ...entryAuthorizationStatements,
    ...(exitConflict ? [] : exitMutationStatements),
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const raced = await storedReceipt(env, observation.metadata.idempotencyKey);
    if (raced !== null) {
      if (raced.payload_sha256 !== payloadSha256) {
        throw new EntryV3StoreConflict("IDEMPOTENCY_CONFLICT");
      }
      const racedEvent = await env.DB
        .prepare(SELECT_ENTRY_V3_EVENT_BY_ID_SQL)
        .bind(observation.eventId)
        .first<{ receipt_id: string; payload_sha256: string }>();
      if (
        racedEvent === null ||
        racedEvent.receipt_id !== raced.receipt_id ||
        racedEvent.payload_sha256 !== payloadSha256
      ) {
        throw new EntryV3StoreConflict("EVENT_ID_CONFLICT");
      }
      await throwStoredEventConflict(
        env,
        observation.eventId,
        raced.receipt_id,
      );
      return {
        record: raced,
        inserted: false,
        eventId: observation.eventId,
        evaluations: await storedEvaluationsForEvent(
          env,
          observation.eventId,
          observation.entryBundles,
        ),
        paperIntentIds: await paperIntentIdsForEvent(env, observation.eventId),
      };
    }
    if (
      allowDecisionRaceRetry &&
      !forceConfigurationUnavailable &&
      isReadinessConstraint(error)
    ) {
      return appendEntryV3ObservationAttempt(
        env,
        observation,
        payloadSha256,
        false,
        true,
      );
    }
    if (
      allowDecisionRaceRetry &&
      observation.eventRole === "EXIT_FOLLOWUP" &&
      isExitApplicationRace(error)
    ) {
      return appendEntryV3ObservationAttempt(
        env,
        observation,
        payloadSha256,
        false,
        forceConfigurationUnavailable,
      );
    }
    if (
      allowDecisionRaceRetry &&
      isPaperLinkRace(error)
    ) {
      const raceEligibleBundles = observation.entryBundles.filter(
        (bundle) =>
          bundle.evaluation.selection.action === "PAPER_ELIGIBLE" &&
          (existingLinks.get(bundle.setup.setup_id) ?? null) === null,
      );
      const racedLinks = await Promise.all(
        raceEligibleBundles.map((bundle) =>
          env.DB
            .prepare(SELECT_ENTRY_V3_PAPER_LINK_SQL)
            .bind(bundle.setup.setup_id, ATTEMPT_KIND)
            .first<StoredPaperLinkV3>(),
        ),
      );
      if (
        raceEligibleBundles.length > 0 &&
        racedLinks.some((link) => link !== null)
      ) {
        return appendEntryV3ObservationAttempt(
          env,
          observation,
          payloadSha256,
          false,
          forceConfigurationUnavailable,
        );
      }
    }
    const racedEvent = await env.DB
      .prepare(SELECT_ENTRY_V3_EVENT_BY_ID_SQL)
      .bind(observation.eventId)
      .first<{ payload_sha256: string }>();
    if (racedEvent !== null) {
      throw new EntryV3StoreConflict("EVENT_ID_CONFLICT");
    }
    const racedSequence = await env.DB
      .prepare(SELECT_ENTRY_V3_EVENT_BY_PRODUCER_SEQUENCE_SQL)
      .bind(
        observation.metadata.producerInstanceId,
        observation.producerSequence,
      )
      .first<{ event_id: string; payload_sha256: string }>();
    if (racedSequence !== null) {
      throw new EntryV3StoreConflict("PRODUCER_SEQUENCE_CONFLICT");
    }
    throw error;
  }
  const record = await storedReceipt(env, observation.metadata.idempotencyKey);
  if (record === null || record.payload_sha256 !== payloadSha256) {
    throw new TypeError("v3 receipt unavailable");
  }
  if (exitConflict) {
    throw new EntryV3StoreConflict("EXIT_CONFLICT");
  }
  return {
    record,
    inserted: true,
    eventId: observation.eventId,
    evaluations,
    paperIntentIds: await paperIntentIdsForEvent(env, observation.eventId),
  };
}

export async function appendEntryV3Observation(
  env: Env,
  observation: EntryV3Observation,
  payloadSha256: string,
): Promise<AppendEntryV3Result> {
  return appendEntryV3ObservationAttempt(env, observation, payloadSha256, true);
}
