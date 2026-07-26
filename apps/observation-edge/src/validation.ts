import {
  isStrictJsonNumber,
  type StrictJsonNumber,
  type StrictJsonValue,
} from "./strict-json";
import type {
  CanonicalValue,
  PaperAutomationCommand,
  ReceiptMetadata,
  ValidatedObservation,
} from "./types";
import {
  tradeIntentCanonicalCommand,
  validatePaperIntentId,
  validatePaperTradeIntent,
  validatePaperTradeSettlement,
} from "./paper-simulator-contract";
import { validateEntryV2Payload } from "./rd-entry-wire";

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const MAX_OBSERVATIONS_PER_MESSAGE = 1_024;
const WIRE_IDENTIFIER = /^[\x21-\x5b\x5d-\x7e]+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RD_RULE_CONTRACT_VERSION = "1.0.0";

const COMMON_KEYS = [
  "schema_version",
  "strategy_id",
  "strategy_version",
  "producer_instance_id",
  "sequence",
  "idempotency_key",
  "symbol",
  "ticker_id",
  "feed",
  "timeframe",
  "timezone",
  "bar_open_epoch",
  "bar_close_epoch",
  "detector_code_hash",
  "settings_hash",
] as const;

const CONTRACT_COMMON_KEYS = [
  ...COMMON_KEYS,
  "rule_contract_version",
  "rule_catalog",
  "execution_mode",
] as const;

const OPEN_REQUIREMENT_FIDELITY = new Map<string, string>([
  ["ZONE_ORIGIN_OPPOSITE_CANDLE", "EXACT"],
  ["ZONE_ACCURACY_BOUNDS", "UNRESOLVED"],
  ["ZONE_FRESH_UNTAPPED", "EXACT"],
  ["ZONE_FIRST_ENGAGEMENT", "EXACT"],
  ["ZONE_PRE_ENTRY_CLOSE_OUTSIDE", "EXACT"],
  ["LIQ_NORMAL_TWO_OPPOSITE_CANDLES", "EXACT"],
  ["LIQ_ONE_CANDLE_EXCEPTION", "DISCRETIONARY"],
  ["LIQ_OWN_EXTREME_SAME_LEG", "EXACT"],
  ["LIQ_STRICT_OWN_EXTREME_BREAK", "EXACT"],
  ["LIQ_ACTUAL_EXTREME_SWEPT", "EXACT"],
  ["LIQ_EVENT_ORDER", "EXACT"],
  ["LIQ_INTERNAL_REBREAK", "CALIBRATED"],
  ["LIQ_DISTANCE_INFLUENCES_ZONE", "DISCRETIONARY"],
  ["LIQ_REPLACEMENT_AFTER_STALE_MOVE", "DISCRETIONARY"],
  ["LIQ_MULTIPLE_CANDIDATE_ARBITRATION", "UNRESOLVED"],
  ["ENTRY_DIR_CLOSE", "EXACT"],
  ["ENTRY_HTF_FLIP", "EXACT"],
  ["ENTRY_HTF_BOUNDARY_CAUTION", "DISCRETIONARY"],
  ["MANAGEMENT_STOP_TRIGGER_CANDLE", "UNRESOLVED"],
  ["MANAGEMENT_TP_BE_TABLE", "UNRESOLVED"],
  ["RISK_SESSION_PROFILE", "CALIBRATED"],
  ["TIMEFRAME_FIVE_MINUTE_ONLY", "EXACT"],
]);

export class ObservationValidationError extends Error {
  constructor(message = "invalid observation") {
    super(message);
    this.name = "ObservationValidationError";
  }
}

type StrictObject = { [key: string]: StrictJsonValue };
type CanonicalObject = Record<string, CanonicalValue>;

interface DecimalValue {
  readonly canonical: string;
}

interface CommonResult {
  readonly canonical: CanonicalObject;
  readonly metadata: Omit<ReceiptMetadata, "kind">;
  readonly barCloseEpoch: number;
  readonly paperAutomationEnabled: boolean;
}

interface ItemResult {
  readonly canonical: CanonicalObject;
  readonly sourceCloseEpoch: number;
}

interface RuleEvidenceResult {
  readonly canonical: CanonicalObject;
  readonly latestLifecycleEpoch: number | null;
  readonly decision: "WAIT" | "SHADOW_ONLY" | "REJECT";
}

function fail(): never {
  throw new ObservationValidationError();
}

function asObject(value: StrictJsonValue): StrictObject {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isStrictJsonNumber(value)
  ) {
    return fail();
  }
  return value;
}

function field(object: StrictObject, key: string): StrictJsonValue {
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    return fail();
  }
  const value = object[key];
  if (value === undefined) {
    return fail();
  }
  return value;
}

function exactKeys(object: StrictObject, keys: readonly string[]): void {
  const actual = Object.keys(object);
  if (actual.length !== keys.length) {
    fail();
  }
  const allowed = new Set(keys);
  if (actual.some((key) => !allowed.has(key))) {
    fail();
  }
  for (const key of keys) {
    field(object, key);
  }
}

function asString(value: StrictJsonValue, minLength = 1, maxLength = 256): string {
  if (
    typeof value !== "string" ||
    value.length < minLength ||
    value.length > maxLength
  ) {
    return fail();
  }
  return value;
}

function asBoolean(value: StrictJsonValue): boolean {
  if (typeof value !== "boolean") {
    return fail();
  }
  return value;
}

function literal(value: StrictJsonValue, expected: string): string {
  if (value !== expected) {
    return fail();
  }
  return expected;
}

function wireIdentifier(value: StrictJsonValue): string {
  const text = asString(value);
  if (!WIRE_IDENTIFIER.test(text)) {
    fail();
  }
  return text;
}

function sha256(value: StrictJsonValue): string {
  const text = asString(value, 64, 64);
  if (!SHA256.test(text)) {
    fail();
  }
  return text;
}

function integer(
  value: StrictJsonValue,
  minimum = 0,
  maximum = MAX_SAFE_INTEGER,
): number {
  if (
    !isStrictJsonNumber(value) ||
    !value.isIntegerToken ||
    !Number.isSafeInteger(value.value) ||
    value.value < minimum ||
    value.value > maximum
  ) {
    return fail();
  }
  return value.value;
}

function asArray(
  value: StrictJsonValue,
  minimum: number,
  maximum: number,
): StrictJsonValue[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    return fail();
  }
  return value;
}

function decimalParts(raw: string): {
  readonly negative: boolean;
  readonly digits: string;
  readonly decimalPosition: number;
  readonly floatingToken: boolean;
} {
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const exponentIndex = Math.max(unsigned.indexOf("e"), unsigned.indexOf("E"));
  const coefficient =
    exponentIndex === -1 ? unsigned : unsigned.slice(0, exponentIndex);
  const exponent =
    exponentIndex === -1 ? 0 : Number.parseInt(unsigned.slice(exponentIndex + 1), 10);
  const dot = coefficient.indexOf(".");
  const integerLength = dot === -1 ? coefficient.length : dot;
  const digits = coefficient.replace(".", "");
  return {
    negative,
    digits,
    decimalPosition: integerLength + exponent,
    floatingToken: dot !== -1 || exponentIndex !== -1,
  };
}

function normalizeMarketNumber(number: StrictJsonNumber): DecimalValue {
  if (!Number.isFinite(number.value)) {
    return fail();
  }
  const { negative, digits, decimalPosition, floatingToken } = decimalParts(number.raw);
  let whole: string;
  let fraction: string;
  if (decimalPosition <= 0) {
    whole = "0";
    fraction = `${"0".repeat(-decimalPosition)}${digits}`;
  } else if (decimalPosition >= digits.length) {
    whole = `${digits}${"0".repeat(decimalPosition - digits.length)}`;
    fraction = "";
  } else {
    whole = digits.slice(0, decimalPosition);
    fraction = digits.slice(decimalPosition);
  }

  whole = whole.replace(/^0+(?=[0-9])/, "");
  fraction = fraction.replace(/0+$/, "");
  const significantWhole = whole.replace(/^0+/, "");
  const significantFraction = fraction;
  const digitCount = significantWhole.length + significantFraction.length;
  if (digitCount > 38 || fraction.length > 18) {
    return fail();
  }

  const isZero = significantWhole.length === 0 && significantFraction.length === 0;
  let canonical = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  if (floatingToken && fraction.length === 0) {
    canonical = `${whole}.0`;
  }
  if (negative) {
    canonical = `-${canonical}`;
  }
  if (isZero && !floatingToken) {
    canonical = negative ? "-0" : "0";
  }
  return { canonical };
}

function marketNumber(value: StrictJsonValue): DecimalValue {
  if (!isStrictJsonNumber(value)) {
    return fail();
  }
  return normalizeMarketNumber(value);
}

function decimalComparison(left: string, right: string): number {
  const parse = (value: string) => {
    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [wholeRaw = "0", fractionRaw = ""] = unsigned.split(".");
    const whole = wholeRaw.replace(/^0+/, "") || "0";
    const fraction = fractionRaw.replace(/0+$/, "");
    const zero = whole === "0" && fraction.length === 0;
    return { negative: negative && !zero, whole, fraction };
  };
  const a = parse(left);
  const b = parse(right);
  if (a.negative !== b.negative) {
    return a.negative ? -1 : 1;
  }
  let magnitude: number;
  if (a.whole.length !== b.whole.length) {
    magnitude = a.whole.length < b.whole.length ? -1 : 1;
  } else if (a.whole !== b.whole) {
    magnitude = a.whole < b.whole ? -1 : 1;
  } else {
    const width = Math.max(a.fraction.length, b.fraction.length);
    const leftFraction = a.fraction.padEnd(width, "0");
    const rightFraction = b.fraction.padEnd(width, "0");
    magnitude =
      leftFraction === rightFraction ? 0 : leftFraction < rightFraction ? -1 : 1;
  }
  return a.negative ? -magnitude : magnitude;
}

function validateNaturalKey(value: StrictJsonValue): {
  readonly canonical: CanonicalObject;
  readonly formationEpoch: number;
} {
  const object = asObject(value);
  exactKeys(object, [
    "side",
    "zone_key",
    "liquidity_key",
    "formation_bar_close_epoch",
  ]);
  const sideValue = field(object, "side");
  if (sideValue !== "DEMAND" && sideValue !== "SUPPLY") {
    fail();
  }
  const formationEpoch = integer(field(object, "formation_bar_close_epoch"));
  return {
    canonical: {
      side: sideValue,
      zone_key: wireIdentifier(field(object, "zone_key")),
      liquidity_key: wireIdentifier(field(object, "liquidity_key")),
      formation_bar_close_epoch: formationEpoch,
    },
    formationEpoch,
  };
}

function validateZone(value: StrictJsonValue): {
  readonly canonical: CanonicalObject;
  readonly originCloseEpoch: number;
} {
  const object = asObject(value);
  exactKeys(object, [
    "top",
    "bottom",
    "origin_bar_open_epoch",
    "origin_bar_close_epoch",
  ]);
  const top = marketNumber(field(object, "top"));
  const bottom = marketNumber(field(object, "bottom"));
  const originOpenEpoch = integer(field(object, "origin_bar_open_epoch"));
  const originCloseEpoch = integer(field(object, "origin_bar_close_epoch"));
  if (
    decimalComparison(top.canonical, bottom.canonical) <= 0 ||
    originCloseEpoch <= originOpenEpoch
  ) {
    fail();
  }
  return {
    canonical: {
      top: top.canonical,
      bottom: bottom.canonical,
      origin_bar_open_epoch: originOpenEpoch,
      origin_bar_close_epoch: originCloseEpoch,
    },
    originCloseEpoch,
  };
}

function validateLiquidity(value: StrictJsonValue): {
  readonly canonical: CanonicalObject;
  readonly originCloseEpoch: number;
} {
  const object = asObject(value);
  exactKeys(object, [
    "price",
    "origin_bar_open_epoch",
    "origin_bar_close_epoch",
  ]);
  const price = marketNumber(field(object, "price"));
  const originOpenEpoch = integer(field(object, "origin_bar_open_epoch"));
  const originCloseEpoch = integer(field(object, "origin_bar_close_epoch"));
  if (originCloseEpoch <= originOpenEpoch) {
    fail();
  }
  return {
    canonical: {
      price: price.canonical,
      origin_bar_open_epoch: originOpenEpoch,
      origin_bar_close_epoch: originCloseEpoch,
    },
    originCloseEpoch,
  };
}

function validateSourceCandle(value: StrictJsonValue): ItemResult {
  const object = asObject(value);
  exactKeys(object, [
    "open_epoch",
    "close_epoch",
    "open",
    "high",
    "low",
    "close",
  ]);
  const openEpoch = integer(field(object, "open_epoch"));
  const closeEpoch = integer(field(object, "close_epoch"));
  const open = marketNumber(field(object, "open"));
  const high = marketNumber(field(object, "high"));
  const low = marketNumber(field(object, "low"));
  const close = marketNumber(field(object, "close"));
  if (
    closeEpoch <= openEpoch ||
    decimalComparison(high.canonical, open.canonical) < 0 ||
    decimalComparison(high.canonical, close.canonical) < 0 ||
    decimalComparison(high.canonical, low.canonical) < 0 ||
    decimalComparison(low.canonical, open.canonical) > 0 ||
    decimalComparison(low.canonical, close.canonical) > 0 ||
    decimalComparison(low.canonical, high.canonical) > 0
  ) {
    fail();
  }
  return {
    canonical: {
      open_epoch: openEpoch,
      close_epoch: closeEpoch,
      open: open.canonical,
      high: high.canonical,
      low: low.canonical,
      close: close.canonical,
    },
    sourceCloseEpoch: closeEpoch,
  };
}

function nullableEpoch(value: StrictJsonValue): number | null {
  return value === null ? null : integer(value);
}

function validateRuleCatalog(value: StrictJsonValue): readonly CanonicalObject[] {
  const expectedRules = [...OPEN_REQUIREMENT_FIDELITY.entries()];
  const ruleValues = asArray(
    value,
    expectedRules.length,
    expectedRules.length,
  );
  return ruleValues.map((ruleValue, index) => {
    const expectedRule = expectedRules[index];
    if (expectedRule === undefined) {
      return fail();
    }
    const [expectedRuleId, expectedFidelity] = expectedRule;
    const rule = asObject(ruleValue);
    exactKeys(rule, ["rule_id", "fidelity"]);
    return {
      rule_id: literal(field(rule, "rule_id"), expectedRuleId),
      fidelity: literal(field(rule, "fidelity"), expectedFidelity),
    };
  });
}

function validateRuleEvidence(value: StrictJsonValue): RuleEvidenceResult {
  const object = asObject(value);
  exactKeys(object, ["decision", "entry_model", "rule_passes", "lifecycle"]);

  const decisionValue = field(object, "decision");
  if (
    decisionValue !== "WAIT" &&
    decisionValue !== "SHADOW_ONLY" &&
    decisionValue !== "REJECT"
  ) {
    fail();
  }
  const entryModelValue = field(object, "entry_model");
  if (
    entryModelValue !== null &&
    entryModelValue !== "DIR_CLOSE" &&
    entryModelValue !== "HTF_FLIP"
  ) {
    fail();
  }

  const rulePassValues = asArray(
    field(object, "rule_passes"),
    OPEN_REQUIREMENT_FIDELITY.size,
    OPEN_REQUIREMENT_FIDELITY.size,
  );
  const rulePasses = rulePassValues.map(asBoolean);

  const lifecycle = asObject(field(object, "lifecycle"));
  const lifecycleKeys = [
    "liquidity_formed_epoch",
    "own_extreme_broken_epoch",
    "liquidity_swept_epoch",
    "zone_engaged_epoch",
    "entry_confirmed_epoch",
  ] as const;
  exactKeys(lifecycle, lifecycleKeys);
  const lifecycleEpochs = lifecycleKeys.map((key) =>
    nullableEpoch(field(lifecycle, key)),
  );
  const [
    liquidityFormedEpoch,
    ownExtremeBrokenEpoch,
    liquiditySweptEpoch,
    zoneEngagedEpoch,
    entryConfirmedEpoch,
  ] = lifecycleEpochs;
  if (
    liquidityFormedEpoch === undefined ||
    ownExtremeBrokenEpoch === undefined ||
    liquiditySweptEpoch === undefined ||
    zoneEngagedEpoch === undefined ||
    entryConfirmedEpoch === undefined
  ) {
    fail();
  }
  let previousEpoch: number | null = null;
  for (const epoch of lifecycleEpochs) {
    if (epoch === null) {
      continue;
    }
    if (previousEpoch !== null && epoch < previousEpoch) {
      fail();
    }
    previousEpoch = epoch;
  }

  const eventOrderIndex = [...OPEN_REQUIREMENT_FIDELITY.keys()].indexOf(
    "LIQ_EVENT_ORDER",
  );
  const eventOrderPassed = rulePasses[eventOrderIndex];
  if (eventOrderPassed === undefined) {
    fail();
  }
  const orderedLifecycle = lifecycleEpochs.slice(0, 4);
  const strictEventOrder =
    orderedLifecycle.every((epoch) => epoch !== null) &&
    orderedLifecycle.every(
      (epoch, index) =>
        index === 0 ||
        (epoch as number) > (orderedLifecycle[index - 1] as number),
    );
  if (eventOrderPassed !== strictEventOrder) {
    fail();
  }

  return {
    canonical: {
      decision: decisionValue,
      entry_model: entryModelValue,
      rule_passes: rulePasses,
      lifecycle: {
        liquidity_formed_epoch: liquidityFormedEpoch,
        own_extreme_broken_epoch: ownExtremeBrokenEpoch,
        liquidity_swept_epoch: liquiditySweptEpoch,
        zone_engaged_epoch: zoneEngagedEpoch,
        entry_confirmed_epoch: entryConfirmedEpoch,
      },
    },
    latestLifecycleEpoch: previousEpoch,
    decision: decisionValue,
  };
}

function validateTransition(
  value: StrictJsonValue,
  expectedIndex: number,
  ruleEvidenceRequired: boolean,
): ItemResult {
  const object = asObject(value);
  exactKeys(object, [
    "transition_index",
    "natural_key",
    "from_state",
    "to_state",
    "reason_code",
    "zone",
    "liquidity",
    "source_candle",
    ...(ruleEvidenceRequired ? ["rule_evidence"] : []),
  ]);
  const transitionIndex = integer(
    field(object, "transition_index"),
    0,
    MAX_OBSERVATIONS_PER_MESSAGE - 1,
  );
  if (transitionIndex !== expectedIndex) {
    fail();
  }
  const natural = validateNaturalKey(field(object, "natural_key"));
  const zone = validateZone(field(object, "zone"));
  const liquidity = validateLiquidity(field(object, "liquidity"));
  const source = validateSourceCandle(field(object, "source_candle"));
  const ruleEvidence = ruleEvidenceRequired
    ? validateRuleEvidence(field(object, "rule_evidence"))
    : null;
  if (
    natural.formationEpoch > source.sourceCloseEpoch ||
    zone.originCloseEpoch > source.sourceCloseEpoch ||
    liquidity.originCloseEpoch > source.sourceCloseEpoch ||
    (ruleEvidence?.latestLifecycleEpoch ?? 0) > source.sourceCloseEpoch
  ) {
    fail();
  }
  const fromStateValue = field(object, "from_state");
  const fromState =
    fromStateValue === null ? null : wireIdentifier(fromStateValue);
  const toState = wireIdentifier(field(object, "to_state"));
  if (ruleEvidence !== null) {
    const expectedDecision =
      toState === "SHADOW_ONLY"
        ? "SHADOW_ONLY"
        : toState === "REJECTED"
          ? "REJECT"
          : toState === "WAITING_FOR_ELIGIBILITY" || toState === "ARMED"
            ? "WAIT"
            : fail();
    if (ruleEvidence.decision !== expectedDecision) {
      fail();
    }
  }
  return {
    canonical: {
      transition_index: transitionIndex,
      natural_key: natural.canonical,
      from_state: fromState,
      to_state: toState,
      reason_code: wireIdentifier(field(object, "reason_code")),
      zone: zone.canonical,
      liquidity: liquidity.canonical,
      source_candle: source.canonical,
      ...(ruleEvidence === null ? {} : { rule_evidence: ruleEvidence.canonical }),
    },
    sourceCloseEpoch: source.sourceCloseEpoch,
  };
}

function validateActiveSetup(
  value: StrictJsonValue,
  ruleEvidenceRequired: boolean,
): ItemResult {
  const object = asObject(value);
  exactKeys(object, [
    "natural_key",
    "state",
    "reason_code",
    "zone",
    "liquidity",
    "source_candle",
    ...(ruleEvidenceRequired ? ["rule_evidence"] : []),
  ]);
  const natural = validateNaturalKey(field(object, "natural_key"));
  const zone = validateZone(field(object, "zone"));
  const liquidity = validateLiquidity(field(object, "liquidity"));
  const source = validateSourceCandle(field(object, "source_candle"));
  const ruleEvidence = ruleEvidenceRequired
    ? validateRuleEvidence(field(object, "rule_evidence"))
    : null;
  const state = wireIdentifier(field(object, "state"));
  if (
    ruleEvidence !== null &&
    (state !== "WAITING_FOR_ELIGIBILITY" && state !== "ARMED")
  ) {
    fail();
  }
  if (ruleEvidence !== null && ruleEvidence.decision !== "WAIT") {
    fail();
  }
  if (
    natural.formationEpoch > source.sourceCloseEpoch ||
    zone.originCloseEpoch > source.sourceCloseEpoch ||
    liquidity.originCloseEpoch > source.sourceCloseEpoch ||
    (ruleEvidence?.latestLifecycleEpoch ?? 0) > source.sourceCloseEpoch
  ) {
    fail();
  }
  return {
    canonical: {
      natural_key: natural.canonical,
      state,
      reason_code: wireIdentifier(field(object, "reason_code")),
      zone: zone.canonical,
      liquidity: liquidity.canonical,
      source_candle: source.canonical,
      ...(ruleEvidence === null ? {} : { rule_evidence: ruleEvidence.canonical }),
    },
    sourceCloseEpoch: source.sourceCloseEpoch,
  };
}

function validateCommon(object: StrictObject): CommonResult {
  const rawSchemaVersion = field(object, "schema_version");
  if (
    rawSchemaVersion !== "1.0" &&
    rawSchemaVersion !== "1.1" &&
    rawSchemaVersion !== "1.2"
  ) {
    fail();
  }
  const schemaVersion: "1.0" | "1.1" | "1.2" = rawSchemaVersion;
  literal(field(object, "strategy_id"), "rd_liquidity_sd_5m_v1");
  const rawStrategyVersion = field(object, "strategy_version");
  if (
    (schemaVersion === "1.0" && rawStrategyVersion !== "1.0.0-phase1") ||
    (schemaVersion === "1.1" && rawStrategyVersion !== "1.1.0-paper1") ||
    (schemaVersion === "1.2" && rawStrategyVersion !== "1.2.0-contract1")
  ) {
    fail();
  }
  const strategyVersion:
    | "1.0.0-phase1"
    | "1.1.0-paper1"
    | "1.2.0-contract1" =
    schemaVersion === "1.0"
      ? "1.0.0-phase1"
      : schemaVersion === "1.1"
        ? "1.1.0-paper1"
        : "1.2.0-contract1";
  const producerInstanceId = wireIdentifier(field(object, "producer_instance_id"));
  const sequence = integer(field(object, "sequence"));
  const idempotencyKey = wireIdentifier(field(object, "idempotency_key"));
  if (idempotencyKey !== `${producerInstanceId}:${sequence}`) {
    fail();
  }
  const symbol = wireIdentifier(field(object, "symbol"));
  const tickerId = wireIdentifier(field(object, "ticker_id"));
  const feed = wireIdentifier(field(object, "feed"));
  literal(field(object, "timeframe"), "5");
  const timezone = wireIdentifier(field(object, "timezone"));
  const barOpenEpoch = integer(field(object, "bar_open_epoch"));
  const barCloseEpoch = integer(field(object, "bar_close_epoch"));
  if (barCloseEpoch <= barOpenEpoch) {
    fail();
  }
  const detectorCodeHash = sha256(field(object, "detector_code_hash"));
  const settingsHash = sha256(field(object, "settings_hash"));
  const ruleContractVersion =
    schemaVersion === "1.2"
      ? literal(
          field(object, "rule_contract_version"),
          RD_RULE_CONTRACT_VERSION,
        )
      : null;
  const ruleCatalog =
    schemaVersion === "1.2"
      ? validateRuleCatalog(field(object, "rule_catalog"))
      : null;
  return {
    canonical: {
      schema_version: schemaVersion,
      strategy_id: "rd_liquidity_sd_5m_v1",
      strategy_version: strategyVersion,
      producer_instance_id: producerInstanceId,
      sequence,
      idempotency_key: idempotencyKey,
      symbol,
      ticker_id: tickerId,
      feed,
      timeframe: "5",
      timezone,
      bar_open_epoch: barOpenEpoch,
      bar_close_epoch: barCloseEpoch,
      detector_code_hash: detectorCodeHash,
      settings_hash: settingsHash,
      ...(schemaVersion === "1.2"
        ? {
            rule_contract_version: ruleContractVersion,
            rule_catalog: ruleCatalog,
            execution_mode: literal(
              field(object, "execution_mode"),
              "OBSERVATION_ONLY",
            ),
          }
        : {}),
    },
    metadata: {
      idempotencyKey,
      schemaVersion,
      strategyId: "rd_liquidity_sd_5m_v1",
      strategyVersion,
      producerInstanceId,
      sequence,
      symbol,
      tickerId,
      feed,
      timeframe: "5",
    },
    barCloseEpoch,
    paperAutomationEnabled: schemaVersion === "1.1",
  };
}

function validatePaperAutomationCommand(value: StrictJsonValue): {
  readonly command: PaperAutomationCommand;
  readonly canonical: CanonicalObject;
} {
  const object = asObject(value);
  const action = field(object, "action");
  if (action === "OPEN") {
    exactKeys(object, ["command_version", "action", "intent"]);
    literal(field(object, "command_version"), "1.0");
    const intent = validatePaperTradeIntent(field(object, "intent"));
    return {
      command: { command_version: "1.0", action: "OPEN", intent },
      canonical: {
        command_version: "1.0",
        action: "OPEN",
        intent: tradeIntentCanonicalCommand(intent),
      },
    };
  }
  if (action === "SETTLE") {
    exactKeys(object, [
      "command_version",
      "action",
      "intent_id",
      "settlement",
    ]);
    literal(field(object, "command_version"), "1.0");
    const rawIntentId = field(object, "intent_id");
    if (typeof rawIntentId !== "string") {
      fail();
    }
    const intentId = validatePaperIntentId(rawIntentId);
    const settlement = validatePaperTradeSettlement(field(object, "settlement"));
    return {
      command: {
        command_version: "1.0",
        action: "SETTLE",
        intent_id: intentId,
        settlement,
      },
      canonical: {
        command_version: "1.0",
        action: "SETTLE",
        intent_id: intentId,
        settlement: { ...settlement },
      },
    };
  }
  return fail();
}

function validatePaperCommands(
  object: StrictObject,
  enabled: boolean,
): {
  readonly commands: readonly PaperAutomationCommand[];
  readonly canonical: readonly CanonicalObject[];
} {
  if (!enabled) {
    return { commands: [], canonical: [] };
  }
  const values = asArray(field(object, "paper_commands"), 0, 128);
  const parsed = values.map(validatePaperAutomationCommand);
  const openIds = new Set<string>();
  const settlementIds = new Set<string>();
  for (const item of parsed) {
    const intentId =
      item.command.action === "OPEN"
        ? item.command.intent.intent_id
        : item.command.intent_id;
    const seen =
      item.command.action === "OPEN" ? openIds : settlementIds;
    if (seen.has(intentId)) {
      fail();
    }
    seen.add(intentId);
  }
  if ([...openIds].some((intentId) => settlementIds.has(intentId))) {
    fail();
  }
  return {
    commands: parsed.map((item) => item.command),
    canonical: parsed.map((item) => item.canonical),
  };
}

function validatePayload(value: StrictJsonValue): {
  readonly canonical: CanonicalObject;
  readonly metadata: ReceiptMetadata;
  readonly paperCommands: readonly PaperAutomationCommand[];
} {
  const object = asObject(value);
  const kind = field(object, "kind");
  if (kind === "incremental") {
    const schemaVersion = field(object, "schema_version");
    const paperAutomationEnabled = schemaVersion === "1.1";
    const ruleEvidenceRequired = schemaVersion === "1.2";
    exactKeys(object, [
      ...(ruleEvidenceRequired ? CONTRACT_COMMON_KEYS : COMMON_KEYS),
      "kind",
      "chunk_index",
      "chunk_count",
      "transitions",
      ...(paperAutomationEnabled ? ["paper_commands"] : []),
    ]);
    const common = validateCommon(object);
    if (
      common.metadata.sequence < 1 ||
      integer(field(object, "chunk_index"), 0, 0) !== 0 ||
      integer(field(object, "chunk_count"), 1, 1) !== 1
    ) {
      fail();
    }
    const transitionValues = asArray(
      field(object, "transitions"),
      schemaVersion === "1.0" ? 1 : 0,
      MAX_OBSERVATIONS_PER_MESSAGE,
    );
    const transitions = transitionValues.map((transition, index) =>
      validateTransition(transition, index, ruleEvidenceRequired),
    );
    const paperCommands = validatePaperCommands(
      object,
      common.paperAutomationEnabled,
    );
    if (
      transitions.some(
        (transition) => transition.sourceCloseEpoch > common.barCloseEpoch,
      )
    ) {
      fail();
    }
    return {
      canonical: {
        ...common.canonical,
        kind: "incremental",
        chunk_index: 0,
        chunk_count: 1,
        transitions: transitions.map((transition) => transition.canonical),
        ...(common.paperAutomationEnabled
          ? { paper_commands: paperCommands.canonical }
          : {}),
      },
      metadata: { ...common.metadata, kind: "incremental" },
      paperCommands: paperCommands.commands,
    };
  }
  if (kind === "snapshot") {
    const schemaVersion = field(object, "schema_version");
    const paperAutomationEnabled = schemaVersion === "1.1";
    const ruleEvidenceRequired = schemaVersion === "1.2";
    exactKeys(object, [
      ...(ruleEvidenceRequired ? CONTRACT_COMMON_KEYS : COMMON_KEYS),
      "kind",
      "last_confirmed_bar_close_epoch",
      "active_setups",
      ...(paperAutomationEnabled ? ["paper_commands"] : []),
    ]);
    const common = validateCommon(object);
    if (common.metadata.sequence !== 0) {
      fail();
    }
    const lastConfirmedBarCloseEpoch = integer(
      field(object, "last_confirmed_bar_close_epoch"),
    );
    if (lastConfirmedBarCloseEpoch > common.barCloseEpoch) {
      fail();
    }
    const setupValues = asArray(
      field(object, "active_setups"),
      0,
      MAX_OBSERVATIONS_PER_MESSAGE,
    );
    const setups = setupValues.map((setup) =>
      validateActiveSetup(setup, ruleEvidenceRequired),
    );
    const paperCommands = validatePaperCommands(
      object,
      common.paperAutomationEnabled,
    );
    if (paperCommands.commands.length !== 0) {
      fail();
    }
    if (
      setups.some(
        (setup) => setup.sourceCloseEpoch > lastConfirmedBarCloseEpoch,
      )
    ) {
      fail();
    }
    return {
      canonical: {
        ...common.canonical,
        kind: "snapshot",
        last_confirmed_bar_close_epoch: lastConfirmedBarCloseEpoch,
        active_setups: setups.map((setup) => setup.canonical),
        ...(common.paperAutomationEnabled ? { paper_commands: [] } : {}),
      },
      metadata: { ...common.metadata, kind: "snapshot" },
      paperCommands: [],
    };
  }
  return fail();
}

export async function validateObservationEnvelope(
  value: StrictJsonValue,
): Promise<ValidatedObservation> {
  const envelope = asObject(value);
  exactKeys(envelope, ["credential", "payload"]);
  const credential = asString(field(envelope, "credential"), 1, 1_024);
  const payloadValue = field(envelope, "payload");
  const payloadObject = asObject(payloadValue);
  if (field(payloadObject, "schema_version") === "2.0") {
    const payload = await validateEntryV2Payload(payloadValue);
    return {
      version: "entry-v2",
      credential,
      ...payload,
      paperCommands: [],
    };
  }
  const payload = validatePayload(payloadValue);
  return {
    version: "legacy",
    credential,
    canonicalPayload: payload.canonical,
    metadata: payload.metadata,
    paperCommands: payload.paperCommands,
  };
}

export function canonicalStringify(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const object = value as Readonly<Record<string, CanonicalValue>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(object[key] ?? null)}`)
    .join(",")}}`;
}
