import { validateBrokerBarEvidenceV1 } from "./contracts-v1";
import { canonicalStringify, sha256Hex } from "./canonical";

const MAX_BODY_BYTES = 256 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[\x21-\x5b\x5d-\x7e]{1,160}$/u;
const ROOT_KEYS = [
  "schema_version", "installation_id", "account_id", "account_profile_sha256", "safety_epoch",
  "request_sequence", "last_acknowledged_server_sequence", "nonce", "sent_at_epoch", "body_sha256",
  "account_snapshot", "events", "broker_bar_evidence",
] as const;
const SNAPSHOT_KEYS = [
  "terminal_build", "ea_sha256", "manifest_sha256", "account_fingerprint_sha256", "broker_time_epoch",
  "windows_time_epoch", "terminal_connection_state", "account_trade_permission", "terminal_trade_permission",
  "algo_trading_permission", "balance_minor_units", "equity_minor_units", "margin_minor_units",
  "free_margin_minor_units", "margin_level_bps", "symbols", "open_orders", "positions",
  "reconciliation_watermark", "observed_at_epoch",
] as const;
const EVENT_KEYS = [
  "schema_version", "event_id", "installation_id", "account_id", "account_profile_sha256", "safety_epoch",
  "sequence", "observed_at_epoch", "kind", "body_sha256", "fact",
] as const;
const EVENT_KINDS = new Set([
  "HEARTBEAT", "TERMINAL_STATE", "SUBMIT_STATE", "ORDER_STATE", "DEAL_STATE", "POSITION_STATE",
  "PROTECTION_STATE", "CLOSE_ATTEMPT_STATE", "UNATTRIBUTED_EXPOSURE_STATE", "RECONCILIATION_STATE",
]);
const SYMBOL_KEYS = [
  "source_symbol", "broker_symbol", "synchronization_state", "selection_state", "capability_state",
  "symbol_capability_sha256", "trade_mode", "bid_ticks", "ask_ticks", "observed_at_epoch",
] as const;
const WATERMARK_KEYS = [
  "watermark", "state", "reconciliation_sha256", "history_through_epoch", "consecutive_stable_sweeps",
] as const;
const OPEN_ORDER_KEYS = [
  "order_ticket", "attribution_state", "command_id", "broker_request_id", "state", "direction", "broker_symbol",
  "requested_volume_steps", "filled_volume_steps", "residual_volume_steps", "entry_price_ticks", "stop_ticks",
  "target_ticks", "protection_state",
] as const;
const POSITION_KEYS = [
  "position_ticket", "attribution_state", "command_id", "broker_request_id", "state", "direction", "broker_symbol",
  "volume_steps", "weighted_fill_price_ticks", "stop_ticks", "target_ticks", "protection_state", "deal_ids",
] as const;
const EVENT_FACT_KEYS: Readonly<Record<string, readonly string[]>> = {
  HEARTBEAT: ["terminal_connection_state", "account_trade_permission", "terminal_trade_permission", "algo_trading_permission", "broker_time_epoch", "windows_time_epoch"],
  TERMINAL_STATE: ["terminal_build", "ea_sha256", "manifest_sha256", "account_fingerprint_sha256", "terminal_connection_state", "account_trade_permission", "terminal_trade_permission", "algo_trading_permission"],
  SUBMIT_STATE: ["command_id", "lease_id", "reservation_id", "broker_request_id", "state", "requested_volume_steps", "filled_volume_steps", "residual_volume_steps", "broker_order_tickets", "acknowledgement_code"],
  ORDER_STATE: ["order_ticket", "attribution_state", "command_id", "broker_request_id", "state", "direction", "broker_symbol", "requested_volume_steps", "filled_volume_steps", "residual_volume_steps", "entry_price_ticks", "stop_ticks", "target_ticks"],
  DEAL_STATE: ["deal_id", "order_ticket", "position_ticket", "attribution_state", "command_id", "broker_request_id", "role", "direction", "volume_steps", "price_ticks", "commission_minor_units"],
  POSITION_STATE: ["position_ticket", "attribution_state", "command_id", "broker_request_id", "state", "direction", "volume_steps", "weighted_fill_price_ticks", "deal_ids"],
  PROTECTION_STATE: ["position_ticket", "attribution_state", "command_id", "broker_request_id", "state", "protected_volume_steps", "stop_ticks", "target_ticks"],
  CLOSE_ATTEMPT_STATE: ["close_attempt_id", "position_ticket", "attribution_state", "command_id", "broker_request_id", "state", "requested_volume_steps", "filled_volume_steps", "residual_volume_steps", "deal_ids"],
  UNATTRIBUTED_EXPOSURE_STATE: ["exposure_id", "exposure_kind", "broker_ticket", "broker_symbol", "direction", "volume_steps", "price_ticks", "pricing_state", "modeled_loss_minor_units", "protection_state", "state"],
  RECONCILIATION_STATE: ["watermark", "previous_watermark", "state", "reconciliation_sha256", "history_from_epoch", "history_to_epoch", "sweep_number", "consecutive_stable_sweeps", "order_tickets", "deal_ids", "position_tickets", "unattributed_exposure_ids"],
};

export interface AgentSyncRequestV1 {
  readonly schema_version: "AgentSyncRequestV1";
  readonly installation_id: string;
  readonly account_id: string;
  readonly account_profile_sha256: string;
  readonly safety_epoch: number;
  readonly request_sequence: number;
  readonly last_acknowledged_server_sequence: number;
  readonly nonce: string;
  readonly sent_at_epoch: number;
  readonly body_sha256: string;
  readonly account_snapshot: Readonly<Record<string, unknown>>;
  readonly events: readonly Readonly<Record<string, unknown>>[];
  readonly broker_bar_evidence: readonly Readonly<Record<string, unknown>>[];
}

export interface AgentSyncResponseV1 {
  readonly schema_version: "AgentSyncResponseV1";
  readonly response_body_sha256: string;
  readonly server_sequence: number;
  readonly server_time_epoch: number;
  readonly mode: "DRY_RUN";
  readonly freeze_reasons: readonly [];
  readonly acknowledged_event_sequence: number;
  readonly evidence_requests: readonly [];
  readonly command: null;
}

export type AgentSyncParseContext = Readonly<{ nowEpoch: number }>;

function invalid(): never {
  throw new Error("AGENT_SYNC_INVALID");
}

function strictObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid();
  return input;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) invalid();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value) || value === "0".repeat(64)) invalid();
  return value;
}

function safeInteger(value: unknown, minimum = Number.MIN_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) invalid();
  return value;
}

function nullableNonnegativeInteger(value: unknown): number | null {
  return value === null ? null : safeInteger(value, 0);
}

function permission(value: unknown): "ALLOWED" | "DENIED" | "UNKNOWN" {
  if (value !== "ALLOWED" && value !== "DENIED" && value !== "UNKNOWN") invalid();
  return value;
}

function connection(value: unknown): "CONNECTED" | "DISCONNECTED" | "UNKNOWN" {
  if (value !== "CONNECTED" && value !== "DISCONNECTED" && value !== "UNKNOWN") invalid();
  return value;
}

function enumeration<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) invalid();
  return value as T;
}

function nullableIdentifier(value: unknown): string | null {
  return value === null ? null : identifier(value);
}

function nullableSafeInteger(value: unknown): number | null {
  return value === null ? null : safeInteger(value);
}

function boundedArray(value: unknown, maximum: number, validate: (entry: unknown) => void): void {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  value.forEach(validate);
}

function direction(value: unknown): "LONG" | "SHORT" {
  return enumeration(value, ["LONG", "SHORT"]);
}

function attribution(input: Record<string, unknown>): void {
  const state = enumeration(input.attribution_state, ["ATTRIBUTED", "UNATTRIBUTED", "UNKNOWN"]);
  if (state === "ATTRIBUTED") {
    identifier(input.command_id);
    identifier(input.broker_request_id);
    return;
  }
  if (input.command_id !== null || input.broker_request_id !== null) invalid();
}

function protectionState(value: unknown): string {
  return enumeration(value, ["REQUIRED", "VERIFIED", "MISSING_DEFINITE", "UNKNOWN", "BREACHED"]);
}

function validateOpenOrder(value: unknown): void {
  const input = strictObject(value, OPEN_ORDER_KEYS);
  safeInteger(input.order_ticket, 1);
  attribution(input);
  enumeration(input.state, ["DISCOVERED", "PENDING", "PARTIALLY_FILLED", "UNKNOWN"]);
  direction(input.direction);
  identifier(input.broker_symbol);
  safeInteger(input.requested_volume_steps, 1);
  safeInteger(input.filled_volume_steps, 0);
  safeInteger(input.residual_volume_steps, 1);
  nullableSafeInteger(input.entry_price_ticks);
  nullableSafeInteger(input.stop_ticks);
  nullableSafeInteger(input.target_ticks);
  protectionState(input.protection_state);
}

function validatePosition(value: unknown): void {
  const input = strictObject(value, POSITION_KEYS);
  safeInteger(input.position_ticket, 1);
  attribution(input);
  enumeration(input.state, ["OPEN", "PARTIAL"]);
  direction(input.direction);
  identifier(input.broker_symbol);
  safeInteger(input.volume_steps, 1);
  safeInteger(input.weighted_fill_price_ticks);
  nullableSafeInteger(input.stop_ticks);
  nullableSafeInteger(input.target_ticks);
  protectionState(input.protection_state);
  boundedArray(input.deal_ids, 64, identifier);
}

function strictJson(value: unknown): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) invalid();
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) strictJson(item);
    return;
  }
  if (typeof value !== "object") invalid();
  for (const entry of Object.values(value as Record<string, unknown>)) strictJson(entry);
}

function validateSymbol(value: unknown): void {
  const input = strictObject(value, SYMBOL_KEYS);
  if (!["EURUSD", "GBPJPY", "USDJPY", "XAUUSD", "NAS100"].includes(input.source_symbol as string)) invalid();
  identifier(input.broker_symbol);
  if (!["SYNCHRONIZED", "UNSYNCHRONIZED", "UNKNOWN"].includes(input.synchronization_state as string)) invalid();
  if (!["SELECTED", "NOT_SELECTED", "UNKNOWN"].includes(input.selection_state as string)) invalid();
  if (!["CURRENT", "CHANGED", "UNKNOWN"].includes(input.capability_state as string)) invalid();
  digest(input.symbol_capability_sha256);
  if (!["FULL", "LONG_ONLY", "SHORT_ONLY", "CLOSE_ONLY", "DISABLED", "UNKNOWN"].includes(input.trade_mode as string)) invalid();
  if (input.bid_ticks !== null) safeInteger(input.bid_ticks);
  if (input.ask_ticks !== null) safeInteger(input.ask_ticks);
  safeInteger(input.observed_at_epoch, 0);
}

function validateSnapshot(value: unknown): Readonly<Record<string, unknown>> {
  const input = strictObject(value, SNAPSHOT_KEYS);
  safeInteger(input.terminal_build, 1);
  digest(input.ea_sha256);
  digest(input.manifest_sha256);
  digest(input.account_fingerprint_sha256);
  nullableNonnegativeInteger(input.broker_time_epoch);
  nullableNonnegativeInteger(input.windows_time_epoch);
  connection(input.terminal_connection_state);
  permission(input.account_trade_permission);
  permission(input.terminal_trade_permission);
  permission(input.algo_trading_permission);
  safeInteger(input.balance_minor_units);
  safeInteger(input.equity_minor_units);
  safeInteger(input.margin_minor_units);
  safeInteger(input.free_margin_minor_units);
  nullableNonnegativeInteger(input.margin_level_bps);
  if (!Array.isArray(input.symbols) || input.symbols.length < 1 || input.symbols.length > 5) invalid();
  input.symbols.forEach(validateSymbol);
  if (!Array.isArray(input.open_orders) || input.open_orders.length > 128) invalid();
  if (!Array.isArray(input.positions) || input.positions.length > 128) invalid();
  input.open_orders.forEach(validateOpenOrder);
  input.positions.forEach(validatePosition);
  const watermark = strictObject(input.reconciliation_watermark, WATERMARK_KEYS);
  identifier(watermark.watermark);
  if (!["STABLE", "UNSTABLE", "GAP", "UNKNOWN"].includes(watermark.state as string)) invalid();
  digest(watermark.reconciliation_sha256);
  safeInteger(watermark.history_through_epoch, 0);
  safeInteger(watermark.consecutive_stable_sweeps, 0);
  safeInteger(input.observed_at_epoch, 0);
  return Object.freeze(input);
}

function validateHeartbeatFact(input: Record<string, unknown>): void {
  connection(input.terminal_connection_state);
  permission(input.account_trade_permission);
  permission(input.terminal_trade_permission);
  permission(input.algo_trading_permission);
  nullableNonnegativeInteger(input.broker_time_epoch);
  nullableNonnegativeInteger(input.windows_time_epoch);
}

function validateTerminalStateFact(input: Record<string, unknown>): void {
  safeInteger(input.terminal_build, 1);
  digest(input.ea_sha256);
  digest(input.manifest_sha256);
  digest(input.account_fingerprint_sha256);
  connection(input.terminal_connection_state);
  permission(input.account_trade_permission);
  permission(input.terminal_trade_permission);
  permission(input.algo_trading_permission);
}

function validateOrderStateFact(input: Record<string, unknown>): void {
  safeInteger(input.order_ticket, 1);
  attribution(input);
  enumeration(input.state, ["DISCOVERED", "PENDING", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED", "EXPIRED", "UNKNOWN"]);
  direction(input.direction);
  identifier(input.broker_symbol);
  safeInteger(input.requested_volume_steps, 1);
  safeInteger(input.filled_volume_steps, 0);
  safeInteger(input.residual_volume_steps, 0);
  nullableSafeInteger(input.entry_price_ticks);
  nullableSafeInteger(input.stop_ticks);
  nullableSafeInteger(input.target_ticks);
}

function validatePositionStateFact(input: Record<string, unknown>): void {
  const ticket = nullablePositive(input.position_ticket);
  attribution(input);
  const state = enumeration(input.state, ["ABSENT", "OPEN", "PARTIAL", "CLOSED"]);
  const positionDirection = input.direction === null ? null : direction(input.direction);
  const volume = safeInteger(input.volume_steps, 0);
  const fillPrice = nullableSafeInteger(input.weighted_fill_price_ticks);
  boundedArray(input.deal_ids, 64, identifier);
  if (state === "ABSENT") {
    if (ticket !== null || input.attribution_state === "ATTRIBUTED" || positionDirection !== null || volume !== 0 || fillPrice !== null) invalid();
    return;
  }
  if (ticket === null || positionDirection === null || fillPrice === null) invalid();
  if ((state === "OPEN" || state === "PARTIAL") && volume < 1) invalid();
  if (state === "CLOSED" && volume !== 0) invalid();
}

function validateEventFact(kind: string, value: unknown): void {
  const keys = EVENT_FACT_KEYS[kind];
  if (keys === undefined) invalid();
  const input = strictObject(value, keys);
  switch (kind) {
    case "HEARTBEAT":
      return validateHeartbeatFact(input);
    case "TERMINAL_STATE":
      return validateTerminalStateFact(input);
    case "SUBMIT_STATE":
      identifier(input.command_id); identifier(input.lease_id); identifier(input.reservation_id); identifier(input.broker_request_id);
      enumeration(input.state, ["JOURNALED", "SENT", "ACK_REJECTED", "ACK_ACCEPTED", "ACK_UNKNOWN"]);
      safeInteger(input.requested_volume_steps, 1); safeInteger(input.filled_volume_steps, 0); safeInteger(input.residual_volume_steps, 0);
      boundedArray(input.broker_order_tickets, 32, (entry) => { safeInteger(entry, 1); }); nullableIdentifier(input.acknowledgement_code);
      return;
    case "ORDER_STATE":
      return validateOrderStateFact(input);
    case "DEAL_STATE":
      identifier(input.deal_id); nullablePositive(input.order_ticket); nullablePositive(input.position_ticket); attribution(input);
      enumeration(input.role, ["ENTRY", "EXIT"]); direction(input.direction); safeInteger(input.volume_steps, 1);
      safeInteger(input.price_ticks); safeInteger(input.commission_minor_units);
      return;
    case "POSITION_STATE":
      validatePositionStateFact(input);
      return;
    case "PROTECTION_STATE":
      safeInteger(input.position_ticket, 1); attribution(input); const protection = protectionState(input.state);
      safeInteger(input.protected_volume_steps, 0); nullableSafeInteger(input.stop_ticks); nullableSafeInteger(input.target_ticks);
      if (protection === "VERIFIED" && (input.stop_ticks === null || input.target_ticks === null)) invalid();
      return;
    case "CLOSE_ATTEMPT_STATE":
      identifier(input.close_attempt_id); safeInteger(input.position_ticket, 1); attribution(input);
      enumeration(input.state, ["JOURNALED", "SENT", "ACK_UNKNOWN", "RECONCILED"]);
      safeInteger(input.requested_volume_steps, 1); safeInteger(input.filled_volume_steps, 0); safeInteger(input.residual_volume_steps, 0);
      boundedArray(input.deal_ids, 64, identifier);
      return;
    case "UNATTRIBUTED_EXPOSURE_STATE":
      identifier(input.exposure_id); enumeration(input.exposure_kind, ["ORDER", "POSITION"]); safeInteger(input.broker_ticket, 1);
      identifier(input.broker_symbol); direction(input.direction); safeInteger(input.volume_steps, 1); nullableSafeInteger(input.price_ticks);
      enumeration(input.pricing_state, ["PRICED", "UNPRICED"]); nullableNonnegativeInteger(input.modeled_loss_minor_units);
      protectionState(input.protection_state); enumeration(input.state, ["DISCOVERED", "ATTRIBUTED", "CLOSED", "UNKNOWN"]);
      return;
    case "RECONCILIATION_STATE":
      identifier(input.watermark); nullableIdentifier(input.previous_watermark); enumeration(input.state, ["STABLE", "UNSTABLE", "GAP", "UNKNOWN"]);
      digest(input.reconciliation_sha256); safeInteger(input.history_from_epoch, 0); safeInteger(input.history_to_epoch, 0);
      safeInteger(input.sweep_number, 1); safeInteger(input.consecutive_stable_sweeps, 0);
      boundedArray(input.order_tickets, 512, (entry) => { safeInteger(entry, 1); }); boundedArray(input.deal_ids, 512, identifier);
      boundedArray(input.position_tickets, 512, (entry) => { safeInteger(entry, 1); }); boundedArray(input.unattributed_exposure_ids, 512, identifier);
      return;
    default:
      return invalid();
  }
}

function nullablePositive(value: unknown): number | null {
  return value === null ? null : safeInteger(value, 1);
}

async function validateEvent(
  value: unknown,
  request: Pick<AgentSyncRequestV1, "installation_id" | "account_id" | "account_profile_sha256" | "safety_epoch">,
): Promise<Readonly<Record<string, unknown>>> {
  const input = strictObject(value, EVENT_KEYS);
  if (input.schema_version !== "AgentEventV1") invalid();
  identifier(input.event_id);
  if (identifier(input.installation_id) !== request.installation_id || identifier(input.account_id) !== request.account_id) invalid();
  if (digest(input.account_profile_sha256) !== request.account_profile_sha256 || safeInteger(input.safety_epoch, 0) !== request.safety_epoch) invalid();
  safeInteger(input.sequence, 1);
  safeInteger(input.observed_at_epoch, 0);
  if (typeof input.kind !== "string" || !EVENT_KINDS.has(input.kind)) invalid();
  digest(input.body_sha256);
  validateEventFact(input.kind, input.fact);
  const { body_sha256: _digest, ...canonicalBody } = input;
  if (await sha256Hex(canonicalStringify(canonicalBody)) !== input.body_sha256) {
    throw new Error("AGENT_SYNC_EVENT_BODY_DIGEST_MISMATCH");
  }
  return Object.freeze(input);
}

class StrictJsonParser {
  private position = 0;

  constructor(private readonly text: string) {}

  parse(): unknown {
    const result = this.value();
    this.whitespace();
    if (this.position !== this.text.length) invalid();
    return result;
  }

  private whitespace(): void {
    while ([" ", "\n", "\r", "\t"].includes(this.text[this.position] ?? "")) this.position += 1;
  }

  private value(): unknown {
    this.whitespace();
    const character = this.text[this.position];
    if (character === "{") return this.object();
    if (character === "[") return this.array();
    if (character === '"') return this.string();
    if (character === "t" && this.take("true")) return true;
    if (character === "f" && this.take("false")) return false;
    if (character === "n" && this.take("null")) return null;
    if (character === "-" || (character !== undefined && /[0-9]/u.test(character))) return this.number();
    return invalid();
  }

  private object(): Record<string, unknown> {
    this.position += 1;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    this.whitespace();
    if (this.text[this.position] === "}") {
      this.position += 1;
      return result;
    }
    while (true) {
      this.whitespace();
      if (this.text[this.position] !== '"') invalid();
      const key = this.string();
      if (Object.hasOwn(result, key)) invalid();
      this.whitespace();
      if (this.text[this.position] !== ":") invalid();
      this.position += 1;
      Object.defineProperty(result, key, {
        value: this.value(),
        enumerable: true,
      });
      this.whitespace();
      if (this.text[this.position] === "}") {
        this.position += 1;
        return result;
      }
      if (this.text[this.position] !== ",") invalid();
      this.position += 1;
    }
  }

  private array(): unknown[] {
    this.position += 1;
    const result: unknown[] = [];
    this.whitespace();
    if (this.text[this.position] === "]") {
      this.position += 1;
      return result;
    }
    while (true) {
      result.push(this.value());
      this.whitespace();
      if (this.text[this.position] === "]") {
        this.position += 1;
        return result;
      }
      if (this.text[this.position] !== ",") invalid();
      this.position += 1;
    }
  }

  private string(): string {
    const start = this.position;
    this.position += 1;
    let escaped = false;
    while (this.position < this.text.length) {
      const character = this.text[this.position] ?? invalid();
      this.position += 1;
      if (!escaped && character === '"') {
        try {
          return JSON.parse(this.text.slice(start, this.position)) as string;
        } catch {
          return invalid();
        }
      }
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
    }
    return invalid();
  }

  private number(): number {
    const match = this.text.slice(this.position).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u);
    if (match === null || match[0] === undefined) return invalid();
    this.position += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) invalid();
    return value;
  }

  private take(expected: string): boolean {
    if (!this.text.startsWith(expected, this.position)) return false;
    this.position += expected.length;
    return true;
  }
}

function parseBoundedJson(body: string | Uint8Array): unknown {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
  if (bytes.byteLength > MAX_BODY_BYTES) invalid();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return invalid();
  }
  return new StrictJsonParser(text).parse();
}

export async function parseAgentSyncRequest(
  body: string | Uint8Array,
  context: AgentSyncParseContext,
): Promise<AgentSyncRequestV1> {
  const input = strictObject(parseBoundedJson(body), ROOT_KEYS);
  if (input.schema_version !== "AgentSyncRequestV1") invalid();
  const installationId = identifier(input.installation_id);
  const accountId = identifier(input.account_id);
  const profileSha = digest(input.account_profile_sha256);
  const safetyEpoch = safeInteger(input.safety_epoch, 0);
  const requestSequence = safeInteger(input.request_sequence, 1);
  const acknowledgedSequence = safeInteger(input.last_acknowledged_server_sequence, 0);
  const nonce = identifier(input.nonce);
  const sentAt = safeInteger(input.sent_at_epoch, 0);
  const bodySha = digest(input.body_sha256);
  if (!Number.isSafeInteger(context.nowEpoch) || context.nowEpoch < 0) invalid();
  if (Math.abs(sentAt - context.nowEpoch) > 30) throw new Error("AGENT_SYNC_TIMESTAMP_INVALID");
  const accountSnapshot = validateSnapshot(input.account_snapshot);
  if (!Array.isArray(input.events) || input.events.length > 256) invalid();
  const eventRequest = { installation_id: installationId, account_id: accountId, account_profile_sha256: profileSha, safety_epoch: safetyEpoch };
  const events = await Promise.all(input.events.map((event) => validateEvent(event, eventRequest)));
  if (!Array.isArray(input.broker_bar_evidence) || input.broker_bar_evidence.length > 8) invalid();
  const evidence = input.broker_bar_evidence.map((entry) => {
    const raw = entry === null || typeof entry !== "object" || Array.isArray(entry) ? invalid() : entry as Record<string, unknown>;
    const validated = validateBrokerBarEvidenceV1(raw, digest(raw.symbol_capability_sha256));
    if (validated.installation_id !== installationId || validated.account_id !== accountId || validated.account_profile_sha256 !== profileSha) invalid();
    return Object.freeze(raw);
  });
  const { body_sha256: _digest, ...canonicalBody } = input;
  if (await sha256Hex(canonicalStringify(canonicalBody)) !== bodySha) throw new Error("AGENT_SYNC_BODY_DIGEST_MISMATCH");
  return Object.freeze({
    schema_version: "AgentSyncRequestV1",
    installation_id: installationId,
    account_id: accountId,
    account_profile_sha256: profileSha,
    safety_epoch: safetyEpoch,
    request_sequence: requestSequence,
    last_acknowledged_server_sequence: acknowledgedSequence,
    nonce,
    sent_at_epoch: sentAt,
    body_sha256: bodySha,
    account_snapshot: accountSnapshot,
    events: Object.freeze(events),
    broker_bar_evidence: Object.freeze(evidence),
  });
}

function configuredDigest(value: unknown): string | null {
  return typeof value === "string" && SHA256.test(value) && value !== "0".repeat(64) ? value : null;
}

function constantTimeEqualHex(left: string, right: string): boolean {
  const leftBytes = new Uint8Array(left.length / 2);
  const rightBytes = new Uint8Array(right.length / 2);
  for (let index = 0; index < leftBytes.length; index += 1) {
    leftBytes.set([Number.parseInt(left.slice(index * 2, index * 2 + 2), 16)], index);
  }
  for (let index = 0; index < rightBytes.length; index += 1) {
    rightBytes.set([Number.parseInt(right.slice(index * 2, index * 2 + 2), 16)], index);
  }
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index]! ^ rightBytes[index]!;
  return difference === 0;
}

export async function authenticateAgentSyncBearer(
  authorization: string | null | undefined,
  configuredSecretSha256: unknown,
): Promise<boolean> {
  const expected = configuredDigest(configuredSecretSha256);
  if (expected === null || typeof authorization !== "string") return false;
  const match = /^Bearer ([^\s]+)$/u.exec(authorization);
  if (match?.[1] === undefined) return false;
  return constantTimeEqualHex(await sha256Hex(match[1]), expected);
}

export async function createDryRunResponse(
  request: Pick<AgentSyncRequestV1, "events">,
  nextServerSequence: number,
  nowEpoch: number,
): Promise<AgentSyncResponseV1> {
  const serverSequence = safeInteger(nextServerSequence, 1);
  const serverTime = safeInteger(nowEpoch, 0);
  let acknowledgedEventSequence = 0;
  for (const event of request.events) {
    const sequence = event.sequence;
    if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) invalid();
    acknowledgedEventSequence = Math.max(acknowledgedEventSequence, sequence);
  }
  const body = {
    schema_version: "AgentSyncResponseV1" as const,
    server_sequence: serverSequence,
    server_time_epoch: serverTime,
    mode: "DRY_RUN" as const,
    freeze_reasons: [] as const,
    acknowledged_event_sequence: acknowledgedEventSequence,
    evidence_requests: [] as const,
    command: null,
  };
  return Object.freeze({ response_body_sha256: await sha256Hex(canonicalStringify(body)), ...body });
}
