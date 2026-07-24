import { CanonicalizationError, parseCanonicalJson } from "./canonical";
import { getConsoleConfig } from "./config";

export type ApiHealthSnapshot = {
  state: "ONLINE" | "OFFLINE";
  paperSimulator: "ENABLED" | "DISABLED" | "UNKNOWN";
  execution: "DISABLED" | "UNKNOWN";
  message: string;
};

export type ObservationReceiptStatus = "RECEIVED" | "DUPLICATE" | "REJECTED";

export type ObservationReceipt = {
  symbol: string;
  feed: string;
  kind: string;
  sequence: number;
  status: ObservationReceiptStatus;
  receivedAt: string;
};

export type ObservationReceiptsSnapshot = {
  state: "LOADING" | "ERROR" | "EMPTY" | "BLOCKED" | "RECEIVED";
  ingressEnabled: boolean | null;
  count: number;
  items: ObservationReceipt[];
  message: string;
};

export type PaperSimulationAccount = {
  accountId: string;
  label: string;
  currencyCode: string;
  currencyScale: number;
  balanceMinor: number;
  realizedPnlMinor: number;
  openRiskMinor: number;
  openPositions: number;
  settledTrades: number;
  winningTrades: number;
  losingTrades: number;
  maxDrawdownMinor: number;
};

export type PaperSimulationAllocation = {
  accountId: string;
  riskAmountMinor: number;
  balanceBeforeMinor: number;
  pnlMinor: number | null;
};

export type PaperSimulationIntent = {
  intentId: string;
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
  riskBps: number;
  source: "MANUAL" | "TRADINGVIEW";
  sourceReceiptId: string | null;
  state: "OPEN" | "SETTLED";
  createdAt: string;
  outcomeRMillis: number | null;
  exitReason: "STOP" | "TARGET" | "MANUAL" | null;
  settledAt: string | null;
  allocations: PaperSimulationAllocation[];
};

export type PaperSimulationSnapshot = {
  accounts: PaperSimulationAccount[];
  intents: PaperSimulationIntent[];
};

export type PaperReadinessState = "READY" | "DEGRADED" | "STOPPED";

export type PaperReadinessReasonCode =
  | "KILL_SWITCH_ENABLED"
  | "NO_PAPER_ACCOUNTS"
  | "NO_AUTOMATION_RECEIPT"
  | "NON_POSITIVE_BALANCE"
  | "RECEIPT_CLOCK_SKEW"
  | "RECEIPT_STALE"
  | "STALE_OPEN_INTENT"
  | "DAILY_LOSS_LIMIT"
  | "TOTAL_DRAWDOWN_LIMIT"
  | "OPEN_RISK_LIMIT"
  | "OPEN_POSITION_LIMIT";

export type PaperReadinessReason = {
  code: PaperReadinessReasonCode;
  accountId: string | null;
  message: string;
};

export type PaperReadinessKillSwitch = {
  enabled: boolean;
  reason: string | null;
  changedAt: string | null;
};

export type PaperReadinessThresholds = {
  receiptMaxAgeSeconds: number;
  staleTradeSeconds: number;
  maxDailyLossBps: number;
  maxTotalDrawdownBps: number;
  maxOpenRiskBps: number;
  maxOpenPositions: number;
};

export type PaperReadinessLatestReceipt = {
  receiptId: string;
  receivedAt: string;
  producerInstanceId: string;
  sequence: number;
  symbol: string;
  ageSeconds: number | null;
};

export type PaperReadinessOpenHealth = {
  openIntents: number;
  staleOpenIntents: number;
  oldestOpenIntentAt: string | null;
};

export type PaperReadinessAccount = {
  accountId: string;
  label: string;
  state: "READY" | "STOPPED";
  dailyPnlMinor: number;
  dailyLossBps: number;
  totalDrawdownBps: number;
  openRiskBps: number;
  openPositions: number;
  reasons: PaperReadinessReason[];
};

export type PaperReadinessSnapshot = {
  state: PaperReadinessState;
  evaluatedAt: string;
  thresholds: PaperReadinessThresholds;
  killSwitch: PaperReadinessKillSwitch;
  latestReceipt: PaperReadinessLatestReceipt | null;
  openHealth: PaperReadinessOpenHealth;
  accounts: PaperReadinessAccount[];
  reasons: PaperReadinessReason[];
  execution: "DISABLED";
};

export type PaperReadinessKillSwitchResult = {
  status: "APPLIED" | "DUPLICATE";
  killSwitch: {
    enabled: boolean;
    reason: string;
    changedAt: string;
  };
};

class InvalidApiPayload extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRealUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u.exec(
    value,
  );
  if (match === null) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day &&
    parsed.getUTCHours() === hour &&
    parsed.getUTCMinutes() === minute &&
    parsed.getUTCSeconds() === second
  );
}

async function parseStrictResponse(response: Response): Promise<unknown> {
  try {
    return parseCanonicalJson(await response.text());
  } catch (error) {
    if (error instanceof CanonicalizationError) {
      throw new InvalidApiPayload(`response is not strict canonical-profile JSON: ${error.message}`);
    }
    throw error;
  }
}

function endpoint(path: string): string {
  return `${getConsoleConfig().apiBaseUrl}${path}`;
}

async function fetchBounded(
  path: string,
  externalSignal?: AbortSignal,
  additionalHeaders: Record<string, string> = {},
): Promise<Response> {
  const { fetchTimeoutMs } = getConsoleConfig();
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, fetchTimeoutMs);
  try {
    return await fetch(endpoint(path), {
      cache: "no-store",
      headers: { Accept: "application/json", ...additionalHeaders },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abort);
  }
}

async function mutateBounded(
  path: string,
  body: string,
  externalSignal?: AbortSignal,
  additionalHeaders: Record<string, string> = {},
): Promise<Response> {
  const { fetchTimeoutMs } = getConsoleConfig();
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, fetchTimeoutMs);
  try {
    return await fetch(endpoint(path), {
      body,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...additionalHeaders,
      },
      method: "POST",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abort);
  }
}

export async function loadApiHealth(signal?: AbortSignal): Promise<ApiHealthSnapshot> {
  try {
    const response = await fetchBounded("/health/live", signal);
    if (response.status !== 200) throw new Error("unexpected health response status");
    const body = await parseStrictResponse(response);
    if (
      !isRecord(body) ||
      body.status !== "ALIVE" ||
      body.mode !== "OBSERVATION_ONLY" ||
      (body.paper_simulator !== "ENABLED" &&
        body.paper_simulator !== "DISABLED") ||
      body.execution !== "DISABLED"
    ) {
      throw new InvalidApiPayload("health document is malformed or not observation-only");
    }
    return {
      state: "ONLINE",
      paperSimulator: body.paper_simulator,
      execution: "DISABLED",
      message:
        body.paper_simulator === "ENABLED"
          ? "Observation API is online. Protected paper simulation is enabled; broker execution is disabled."
          : "Observation API is online. Paper simulation and broker execution are disabled.",
    };
  } catch {
    return {
      state: "OFFLINE",
      paperSimulator: "UNKNOWN",
      execution: "UNKNOWN",
      message: "API health could not be verified. The console remains fail-closed.",
    };
  }
}

function parseReceipt(value: unknown): ObservationReceipt {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.receipt_id) ||
    !isNonEmptyString(value.idempotency_key) ||
    !isNonEmptyString(value.producer_instance_id) ||
    !isNonEmptyString(value.symbol) ||
    !isNonEmptyString(value.feed) ||
    !isNonEmptyString(value.kind) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    (value.status !== "RECEIVED" &&
      value.status !== "DUPLICATE" &&
      value.status !== "REJECTED") ||
    typeof value.payload_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.payload_sha256) ||
    !isRealUtcTimestamp(value.received_at)
  ) {
    throw new InvalidApiPayload("observation receipt is malformed");
  }

  // Identifiers and fingerprints are contract-validated, then intentionally discarded.
  return {
    symbol: value.symbol,
    feed: value.feed,
    kind: value.kind,
    sequence: value.sequence as number,
    status: value.status,
    receivedAt: value.received_at,
  };
}

function parseObservationReceipts(value: unknown): {
  ingressEnabled: boolean;
  count: number;
  items: ObservationReceipt[];
} {
  if (
    !isRecord(value) ||
    value.mode !== "OBSERVATION_ONLY" ||
    typeof value.ingress_enabled !== "boolean" ||
    !Number.isSafeInteger(value.count) ||
    (value.count as number) < 0 ||
    !Array.isArray(value.items)
  ) {
    throw new InvalidApiPayload("observation receipt report is malformed");
  }
  const items = value.items.map(parseReceipt);
  if (value.count !== items.length) {
    throw new InvalidApiPayload("observation receipt count does not match returned items");
  }
  return {
    ingressEnabled: value.ingress_enabled,
    count: value.count as number,
    items,
  };
}

function receiptFallback(
  state: "ERROR" | "BLOCKED",
  message: string,
): ObservationReceiptsSnapshot {
  return {
    state,
    ingressEnabled: state === "BLOCKED" ? false : null,
    count: 0,
    items: [],
    message,
  };
}

export async function loadObservationReceipts(
  signal?: AbortSignal,
): Promise<ObservationReceiptsSnapshot> {
  try {
    const response = await fetchBounded("/api/v1/observation-receipts?limit=50", signal);
    if (response.status === 503) {
      return receiptFallback(
        "BLOCKED",
        "Observation ingress is blocked. No alert receipt is treated as executable.",
      );
    }
    if (response.status !== 200) throw new Error("unexpected receipt response status");

    const report = parseObservationReceipts(await parseStrictResponse(response));
    if (!report.ingressEnabled) {
      return {
        state: "BLOCKED",
        ingressEnabled: false,
        count: report.count,
        items: report.items,
        message: "Ingress is disabled. Historical observations remain inspection-only.",
      };
    }
    if (report.items.length === 0) {
      return {
        state: "EMPTY",
        ingressEnabled: true,
        count: 0,
        items: [],
        message: "Ingress is open, but no observation receipts have been recorded.",
      };
    }
    return {
      state: "RECEIVED",
      ingressEnabled: true,
      count: report.count,
      items: report.items,
      message: "Metadata-only observations returned by the paper LAB API.",
    };
  } catch {
    return receiptFallback(
      "ERROR",
      "Receipt state is unavailable or malformed. Ingress is treated as blocked.",
    );
  }
}

function safeInteger(
  value: unknown,
  minimum = Number.MIN_SAFE_INTEGER,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function parsePaperSimulationAccount(value: unknown): PaperSimulationAccount {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.account_id) ||
    !isNonEmptyString(value.label) ||
    typeof value.currency_code !== "string" ||
    !/^[A-Z]{3}$/u.test(value.currency_code) ||
    !safeInteger(value.currency_scale, 0, 8) ||
    !safeInteger(value.balance_minor) ||
    !safeInteger(value.realized_pnl_minor) ||
    !safeInteger(value.open_risk_minor, 0) ||
    !safeInteger(value.open_positions, 0) ||
    !safeInteger(value.settled_trades, 0) ||
    !safeInteger(value.winning_trades, 0) ||
    !safeInteger(value.losing_trades, 0) ||
    !safeInteger(value.max_drawdown_minor, 0)
  ) {
    throw new InvalidApiPayload("paper simulation account is malformed");
  }
  return {
    accountId: value.account_id,
    label: value.label,
    currencyCode: value.currency_code,
    currencyScale: value.currency_scale,
    balanceMinor: value.balance_minor,
    realizedPnlMinor: value.realized_pnl_minor,
    openRiskMinor: value.open_risk_minor,
    openPositions: value.open_positions,
    settledTrades: value.settled_trades,
    winningTrades: value.winning_trades,
    losingTrades: value.losing_trades,
    maxDrawdownMinor: value.max_drawdown_minor,
  };
}

function parsePaperSimulationAllocation(
  value: unknown,
  settled: boolean,
): PaperSimulationAllocation {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.account_id) ||
    !safeInteger(value.risk_amount_minor, 1) ||
    !safeInteger(value.balance_before_minor) ||
    (settled ? !safeInteger(value.pnl_minor) : value.pnl_minor !== null)
  ) {
    throw new InvalidApiPayload("paper simulation allocation is malformed");
  }
  return {
    accountId: value.account_id,
    riskAmountMinor: value.risk_amount_minor,
    balanceBeforeMinor: value.balance_before_minor,
    pnlMinor: value.pnl_minor as number | null,
  };
}

function parsePaperSimulationIntent(value: unknown): PaperSimulationIntent {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.intent_id) ||
    !isNonEmptyString(value.symbol) ||
    (value.side !== "BUY" && value.side !== "SELL") ||
    !isNonEmptyString(value.entry_price) ||
    !isNonEmptyString(value.stop_loss) ||
    !isNonEmptyString(value.take_profit) ||
    !safeInteger(value.risk_bps, 1, 500) ||
    (value.source !== "MANUAL" && value.source !== "TRADINGVIEW") ||
    (value.source === "MANUAL"
      ? value.source_receipt_id !== null
      : !isNonEmptyString(value.source_receipt_id)) ||
    (value.state !== "OPEN" && value.state !== "SETTLED") ||
    !isRealUtcTimestamp(value.created_at) ||
    !Array.isArray(value.allocations) ||
    value.allocations.length === 0
  ) {
    throw new InvalidApiPayload("paper simulation intent is malformed");
  }
  const settled = value.state === "SETTLED";
  let outcomeRMillis: number | null = null;
  let exitReason: "STOP" | "TARGET" | "MANUAL" | null = null;
  let settledAt: string | null = null;
  if (settled) {
    if (
      !isRecord(value.settlement) ||
      !safeInteger(value.settlement.outcome_r_millis, -1_000, 10_000) ||
      (value.settlement.exit_reason !== "STOP" &&
        value.settlement.exit_reason !== "TARGET" &&
        value.settlement.exit_reason !== "MANUAL") ||
      !isRealUtcTimestamp(value.settlement.settled_at)
    ) {
      throw new InvalidApiPayload("paper simulation settlement is malformed");
    }
    outcomeRMillis = value.settlement.outcome_r_millis;
    exitReason = value.settlement.exit_reason;
    settledAt = value.settlement.settled_at;
  } else if (value.settlement !== null) {
    throw new InvalidApiPayload("open paper simulation has a settlement");
  }
  const sourceReceiptId =
    value.source === "TRADINGVIEW" ? (value.source_receipt_id as string) : null;
  return {
    intentId: value.intent_id,
    symbol: value.symbol,
    side: value.side,
    entryPrice: value.entry_price,
    stopLoss: value.stop_loss,
    takeProfit: value.take_profit,
    riskBps: value.risk_bps,
    source: value.source,
    sourceReceiptId,
    state: value.state,
    createdAt: value.created_at,
    outcomeRMillis,
    exitReason,
    settledAt,
    allocations: value.allocations.map((allocation) =>
      parsePaperSimulationAllocation(allocation, settled),
    ),
  };
}

function parsePaperSimulationSummary(value: unknown): PaperSimulationSnapshot {
  if (
    !isRecord(value) ||
    value.schema_version !== "1.0" ||
    value.mode !== "PAPER_SIMULATION_ONLY" ||
    !safeInteger(value.account_count, 0) ||
    !safeInteger(value.intent_count, 0) ||
    !Array.isArray(value.accounts) ||
    !Array.isArray(value.intents)
  ) {
    throw new InvalidApiPayload("paper simulation report is malformed");
  }
  const accounts = value.accounts.map(parsePaperSimulationAccount);
  const intents = value.intents.map(parsePaperSimulationIntent);
  if (
    accounts.length !== value.account_count ||
    intents.length !== value.intent_count
  ) {
    throw new InvalidApiPayload("paper simulation report counts do not match");
  }
  return { accounts, intents };
}

export async function loadPaperSimulationSummary(
  credential: string,
  signal?: AbortSignal,
): Promise<PaperSimulationSnapshot> {
  if (credential.length < 1 || credential.length > 1_024) {
    throw new Error("Paper operator credential is invalid.");
  }
  const response = await fetchBounded(
    "/api/v1/paper-simulations/summary?limit=50",
    signal,
    { Authorization: `Bearer ${credential}` },
  );
  if (response.status === 401) {
    throw new Error("Paper operator credential was rejected.");
  }
  if (response.status !== 200) {
    throw new Error("Paper simulator is unavailable.");
  }
  return parsePaperSimulationSummary(await parseStrictResponse(response));
}

const paperReadinessReasonCodes = new Set<PaperReadinessReasonCode>([
  "KILL_SWITCH_ENABLED",
  "NO_PAPER_ACCOUNTS",
  "NO_AUTOMATION_RECEIPT",
  "NON_POSITIVE_BALANCE",
  "RECEIPT_CLOCK_SKEW",
  "RECEIPT_STALE",
  "STALE_OPEN_INTENT",
  "DAILY_LOSS_LIMIT",
  "TOTAL_DRAWDOWN_LIMIT",
  "OPEN_RISK_LIMIT",
  "OPEN_POSITION_LIMIT",
]);

function isPaperReadinessReasonCode(
  value: unknown,
): value is PaperReadinessReasonCode {
  return (
    typeof value === "string" &&
    paperReadinessReasonCodes.has(value as PaperReadinessReasonCode)
  );
}

function parsePaperReadinessReason(value: unknown): PaperReadinessReason {
  if (
    !isRecord(value) ||
    !isPaperReadinessReasonCode(value.code) ||
    (value.account_id !== null && !isNonEmptyString(value.account_id)) ||
    !isNonEmptyString(value.message)
  ) {
    throw new InvalidApiPayload("paper readiness reason is malformed");
  }
  return {
    code: value.code,
    accountId: value.account_id,
    message: value.message,
  };
}

function parsePaperReadinessKillSwitch(
  value: unknown,
): PaperReadinessKillSwitch {
  if (
    !isRecord(value) ||
    typeof value.enabled !== "boolean" ||
    (value.reason !== null && !isNonEmptyString(value.reason)) ||
    (value.changed_at !== null && !isRealUtcTimestamp(value.changed_at))
  ) {
    throw new InvalidApiPayload("paper readiness kill switch is malformed");
  }
  return {
    enabled: value.enabled,
    reason: value.reason,
    changedAt: value.changed_at,
  };
}

function parsePaperReadinessLatestReceipt(
  value: unknown,
): PaperReadinessLatestReceipt | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.receipt_id) ||
    !isRealUtcTimestamp(value.received_at) ||
    !isNonEmptyString(value.producer_instance_id) ||
    !safeInteger(value.sequence, 0) ||
    !isNonEmptyString(value.symbol) ||
    (value.age_seconds !== null && !safeInteger(value.age_seconds, 0))
  ) {
    throw new InvalidApiPayload("paper readiness receipt is malformed");
  }
  return {
    receiptId: value.receipt_id,
    receivedAt: value.received_at,
    producerInstanceId: value.producer_instance_id,
    sequence: value.sequence,
    symbol: value.symbol,
    ageSeconds: value.age_seconds,
  };
}

function parsePaperReadinessOpenHealth(
  value: unknown,
): PaperReadinessOpenHealth {
  if (
    !isRecord(value) ||
    !safeInteger(value.open_intents, 0) ||
    !safeInteger(value.stale_open_intents, 0) ||
    value.stale_open_intents > value.open_intents ||
    (value.oldest_open_intent_at !== null &&
      !isRealUtcTimestamp(value.oldest_open_intent_at))
  ) {
    throw new InvalidApiPayload("paper readiness open health is malformed");
  }
  if (
    (value.open_intents === 0 && value.oldest_open_intent_at !== null) ||
    (value.open_intents > 0 && value.oldest_open_intent_at === null)
  ) {
    throw new InvalidApiPayload("paper readiness open health is inconsistent");
  }
  return {
    openIntents: value.open_intents,
    staleOpenIntents: value.stale_open_intents,
    oldestOpenIntentAt: value.oldest_open_intent_at,
  };
}

function parsePaperReadinessAccount(value: unknown): PaperReadinessAccount {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.account_id) ||
    !isNonEmptyString(value.label) ||
    (value.state !== "READY" && value.state !== "STOPPED") ||
    !safeInteger(value.daily_pnl_minor) ||
    !safeInteger(value.daily_loss_bps, 0) ||
    !safeInteger(value.total_drawdown_bps, 0) ||
    !safeInteger(value.open_risk_bps, 0) ||
    !safeInteger(value.open_positions, 0) ||
    !Array.isArray(value.reasons)
  ) {
    throw new InvalidApiPayload("paper readiness account is malformed");
  }
  const reasons = value.reasons.map(parsePaperReadinessReason);
  if (
    reasons.some(
      (reason) =>
        reason.accountId !== null && reason.accountId !== value.account_id,
    )
  ) {
    throw new InvalidApiPayload("paper readiness account reason does not match");
  }
  return {
    accountId: value.account_id,
    label: value.label,
    state: value.state,
    dailyPnlMinor: value.daily_pnl_minor,
    dailyLossBps: value.daily_loss_bps,
    totalDrawdownBps: value.total_drawdown_bps,
    openRiskBps: value.open_risk_bps,
    openPositions: value.open_positions,
    reasons,
  };
}

function parsePaperReadiness(value: unknown): PaperReadinessSnapshot {
  if (
    !isRecord(value) ||
    value.schema_version !== "1.0" ||
    value.mode !== "PAPER_ONLY" ||
    (value.state !== "READY" &&
      value.state !== "DEGRADED" &&
      value.state !== "STOPPED") ||
    !isRealUtcTimestamp(value.evaluated_at) ||
    !isRecord(value.thresholds) ||
    !safeInteger(value.thresholds.receipt_max_age_seconds, 1) ||
    !safeInteger(value.thresholds.stale_trade_seconds, 1) ||
    !safeInteger(value.thresholds.max_daily_loss_bps, 1) ||
    !safeInteger(value.thresholds.max_total_drawdown_bps, 1) ||
    !safeInteger(value.thresholds.max_open_risk_bps, 1) ||
    !safeInteger(value.thresholds.max_open_positions, 1) ||
    !Array.isArray(value.accounts) ||
    !Array.isArray(value.reasons) ||
    value.execution !== "DISABLED"
  ) {
    throw new InvalidApiPayload("paper readiness report is malformed");
  }
  const accounts = value.accounts.map(parsePaperReadinessAccount);
  if (new Set(accounts.map((account) => account.accountId)).size !== accounts.length) {
    throw new InvalidApiPayload("paper readiness account identifiers are duplicated");
  }
  return {
    state: value.state,
    evaluatedAt: value.evaluated_at,
    thresholds: {
      receiptMaxAgeSeconds: value.thresholds.receipt_max_age_seconds,
      staleTradeSeconds: value.thresholds.stale_trade_seconds,
      maxDailyLossBps: value.thresholds.max_daily_loss_bps,
      maxTotalDrawdownBps: value.thresholds.max_total_drawdown_bps,
      maxOpenRiskBps: value.thresholds.max_open_risk_bps,
      maxOpenPositions: value.thresholds.max_open_positions,
    },
    killSwitch: parsePaperReadinessKillSwitch(value.kill_switch),
    latestReceipt: parsePaperReadinessLatestReceipt(value.latest_receipt),
    openHealth: parsePaperReadinessOpenHealth(value.open_health),
    accounts,
    reasons: value.reasons.map(parsePaperReadinessReason),
    execution: "DISABLED",
  };
}

function parsePaperReadinessKillSwitchResult(
  value: unknown,
): PaperReadinessKillSwitchResult {
  if (
    !isRecord(value) ||
    value.schema_version !== "1.0" ||
    (value.status !== "APPLIED" && value.status !== "DUPLICATE")
  ) {
    throw new InvalidApiPayload("paper readiness control response is malformed");
  }
  const killSwitch = parsePaperReadinessKillSwitch(value.kill_switch);
  if (killSwitch.reason === null || killSwitch.changedAt === null) {
    throw new InvalidApiPayload("paper readiness control response is incomplete");
  }
  return {
    status: value.status,
    killSwitch: {
      enabled: killSwitch.enabled,
      reason: killSwitch.reason,
      changedAt: killSwitch.changedAt,
    },
  };
}

function validatePaperCredential(credential: string): void {
  if (credential.length < 1 || credential.length > 1_024) {
    throw new Error("Paper operator credential is invalid.");
  }
}

let paperReadinessIdempotencySequence = 0;

function nextPaperReadinessIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `paper-readiness:${globalThis.crypto.randomUUID()}`;
  }
  paperReadinessIdempotencySequence += 1;
  return [
    "paper-readiness",
    Date.now().toString(36),
    paperReadinessIdempotencySequence.toString(36),
    Math.random().toString(36).slice(2),
  ].join(":");
}

export async function loadPaperReadiness(
  credential: string,
  signal?: AbortSignal,
): Promise<PaperReadinessSnapshot> {
  validatePaperCredential(credential);
  const response = await fetchBounded("/api/v1/paper-readiness", signal, {
    Authorization: `Bearer ${credential}`,
  });
  if (response.status === 401) {
    throw new Error("Paper operator credential was rejected.");
  }
  if (response.status !== 200) {
    throw new Error("Paper readiness is unavailable.");
  }
  return parsePaperReadiness(await parseStrictResponse(response));
}

export async function setPaperReadinessKillSwitch(
  credential: string,
  enabled: boolean,
  reason: string,
  signal?: AbortSignal,
): Promise<PaperReadinessKillSwitchResult> {
  validatePaperCredential(credential);
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 3 || normalizedReason.length > 240) {
    throw new Error("An operator reason of 3 to 240 characters is required.");
  }
  const response = await mutateBounded(
    "/api/v1/paper-readiness/kill-switch",
    JSON.stringify({
      schema_version: "1.0",
      enabled,
      reason: normalizedReason,
    }),
    signal,
    {
      Authorization: `Bearer ${credential}`,
      "Idempotency-Key": nextPaperReadinessIdempotencyKey(),
    },
  );
  if (response.status === 401) {
    throw new Error("Paper operator credential was rejected.");
  }
  if (response.status === 409) {
    throw new Error("Paper readiness control conflicted. Refresh and try again.");
  }
  if (response.status !== 200 && response.status !== 201) {
    throw new Error("Paper readiness control is unavailable.");
  }
  const result = parsePaperReadinessKillSwitchResult(
    await parseStrictResponse(response),
  );
  if (
    result.killSwitch.enabled !== enabled ||
    result.killSwitch.reason !== normalizedReason
  ) {
    throw new InvalidApiPayload(
      "paper readiness control response does not match the request",
    );
  }
  return result;
}
