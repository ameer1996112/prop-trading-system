const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[\x21-\x5b\x5d-\x7e]{1,160}$/u;
const SOURCE_SYMBOLS = Object.freeze({ EURUSD: true, GBPJPY: true, USDJPY: true, XAUUSD: true, NAS100: true });
const EVIDENCE_KEYS = [
  "schema_version", "evidence_id", "installation_id", "account_id", "account_profile_sha256",
  "source_symbol", "broker_symbol", "symbol_capability_sha256", "timeframe",
  "reconciliation_cursor", "reconciliation_sha256", "bars", "observed_at_epoch",
] as const;
const BAR_KEYS = [
  "open_epoch", "close_epoch", "open_ticks", "high_ticks", "low_ticks", "close_ticks", "closed",
] as const;

export interface BrokerBarV1 {
  readonly open_epoch: number;
  readonly close_epoch: number;
  readonly open_ticks: number;
  readonly high_ticks: number;
  readonly low_ticks: number;
  readonly close_ticks: number;
  readonly closed: true;
}

export interface BrokerBarEvidenceV1 {
  readonly schema_version: "BrokerBarEvidenceV1";
  readonly evidence_id: string;
  readonly installation_id: string;
  readonly account_id: string;
  readonly account_profile_sha256: string;
  readonly source_symbol: "EURUSD" | "GBPJPY" | "USDJPY" | "XAUUSD" | "NAS100";
  readonly broker_symbol: string;
  readonly symbol_capability_sha256: string;
  readonly timeframe: "M5" | "M1";
  readonly reconciliation_cursor: string;
  readonly reconciliation_sha256: string;
  readonly bars: readonly BrokerBarV1[];
  readonly observed_at_epoch: number;
}

function invalid(): never {
  throw new Error("BROKER_BAR_EVIDENCE_INVALID");
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) invalid();
}

function safeInteger(value: unknown, minimum = Number.MIN_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) invalid();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value) || value === "0".repeat(64)) invalid();
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) invalid();
  return value;
}

function bar(value: unknown, duration: number): BrokerBarV1 {
  const input = objectValue(value);
  exactKeys(input, BAR_KEYS);
  const result: BrokerBarV1 = Object.freeze({
    open_epoch: safeInteger(input.open_epoch, 0),
    close_epoch: safeInteger(input.close_epoch, 0),
    open_ticks: safeInteger(input.open_ticks),
    high_ticks: safeInteger(input.high_ticks),
    low_ticks: safeInteger(input.low_ticks),
    close_ticks: safeInteger(input.close_ticks),
    closed: input.closed === true ? true : invalid(),
  });
  if (
    result.open_epoch % duration !== 0 || result.close_epoch - result.open_epoch !== duration ||
    result.low_ticks > result.high_ticks || result.open_ticks < result.low_ticks ||
    result.open_ticks > result.high_ticks || result.close_ticks < result.low_ticks ||
    result.close_ticks > result.high_ticks
  ) invalid();
  return result;
}

export function validateBrokerBarEvidenceV1(
  value: unknown,
  expectedCapabilitySha256: string,
): BrokerBarEvidenceV1 {
  try {
    const input = objectValue(value);
    exactKeys(input, EVIDENCE_KEYS);
    if (input.schema_version !== "BrokerBarEvidenceV1") invalid();
    const sourceSymbol = input.source_symbol;
    if (typeof sourceSymbol !== "string" || !Object.hasOwn(SOURCE_SYMBOLS, sourceSymbol)) invalid();
    const timeframe = input.timeframe;
    if (timeframe !== "M5" && timeframe !== "M1") invalid();
    const duration = timeframe === "M5" ? 300 : 60;
    const capabilitySha256 = digest(input.symbol_capability_sha256);
    if (capabilitySha256 !== digest(expectedCapabilitySha256)) invalid();
    if (!Array.isArray(input.bars) || input.bars.length < 1 || input.bars.length > 512) invalid();
    const bars = input.bars.map((value) => bar(value, duration));
    const lastBar = bars.at(-1);
    if (lastBar === undefined) invalid();
    for (let index = 1; index < bars.length; index += 1) {
      if (bars[index]!.open_epoch !== bars[index - 1]!.close_epoch) invalid();
    }
    const observedAt = safeInteger(input.observed_at_epoch, 0);
    if (observedAt < lastBar.close_epoch || observedAt - lastBar.close_epoch > 30) invalid();
    return Object.freeze({
      schema_version: "BrokerBarEvidenceV1",
      evidence_id: identifier(input.evidence_id),
      installation_id: identifier(input.installation_id),
      account_id: identifier(input.account_id),
      account_profile_sha256: digest(input.account_profile_sha256),
      source_symbol: sourceSymbol as BrokerBarEvidenceV1["source_symbol"],
      broker_symbol: identifier(input.broker_symbol),
      symbol_capability_sha256: capabilitySha256,
      timeframe,
      reconciliation_cursor: identifier(input.reconciliation_cursor),
      reconciliation_sha256: digest(input.reconciliation_sha256),
      bars: Object.freeze(bars),
      observed_at_epoch: observedAt,
    });
  } catch {
    return invalid();
  }
}
