import type {
  CanonicalObject,
  CanonicalValue,
  SetupEvidenceDecision,
  SetupEvidenceEntryModel,
  SetupEvidenceInsert,
  SetupEvidenceSide,
} from "./types";

const RULE_PASS_COUNT = 22;

export class SetupEvidenceExtractionError extends Error {
  constructor() {
    super("validated setup evidence invariant failed");
    this.name = "SetupEvidenceExtractionError";
  }
}

function invariant(): never {
  throw new SetupEvidenceExtractionError();
}

function isCanonicalArray(
  value: CanonicalValue | undefined,
): value is readonly CanonicalValue[] {
  return Array.isArray(value);
}

function object(value: CanonicalValue | undefined): CanonicalObject {
  if (
    value === null ||
    value === undefined ||
    isCanonicalArray(value) ||
    typeof value !== "object"
  ) {
    return invariant();
  }
  return value;
}

function array(value: CanonicalValue | undefined): readonly CanonicalValue[] {
  return isCanonicalArray(value) ? value : invariant();
}

function text(value: CanonicalValue | undefined): string {
  return typeof value === "string" ? value : invariant();
}

function integer(value: CanonicalValue | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : invariant();
}

function nullableInteger(value: CanonicalValue | undefined): number | null {
  return value === null ? null : integer(value);
}

function nullableText(value: CanonicalValue | undefined): string | null {
  return value === null ? null : text(value);
}

function side(value: CanonicalValue | undefined): SetupEvidenceSide {
  return value === "DEMAND" || value === "SUPPLY" ? value : invariant();
}

function decision(value: CanonicalValue | undefined): SetupEvidenceDecision {
  return value === "WAIT" || value === "SHADOW_ONLY" || value === "REJECT"
    ? value
    : invariant();
}

function entryModel(
  value: CanonicalValue | undefined,
): SetupEvidenceEntryModel | null {
  return value === null
    ? null
    : value === "DIR_CLOSE" || value === "HTF_FLIP"
      ? value
      : invariant();
}

function rulePassesJson(value: CanonicalValue | undefined): string {
  const passes = array(value);
  if (
    passes.length !== RULE_PASS_COUNT ||
    passes.some((pass) => typeof pass !== "boolean")
  ) {
    return invariant();
  }
  return JSON.stringify(passes);
}

function extractItem(
  itemValue: CanonicalValue,
  eventIndex: number,
  eventKind: "transition" | "active_setup",
  symbol: string,
): SetupEvidenceInsert {
  const item = object(itemValue);
  const natural = object(item.natural_key);
  const zone = object(item.zone);
  const liquidity = object(item.liquidity);
  const source = object(item.source_candle);
  const evidence = object(item.rule_evidence);
  const lifecycle = object(evidence.lifecycle);
  const transitionIndex =
    eventKind === "transition" ? integer(item.transition_index) : eventIndex;
  if (transitionIndex !== eventIndex) {
    return invariant();
  }

  return {
    eventIndex,
    eventKind,
    symbol,
    side: side(natural.side),
    zoneKey: text(natural.zone_key),
    liquidityKey: text(natural.liquidity_key),
    formationBarCloseEpoch: integer(natural.formation_bar_close_epoch),
    fromState:
      eventKind === "transition" ? nullableText(item.from_state) : null,
    toState:
      eventKind === "transition" ? text(item.to_state) : text(item.state),
    reasonCode: text(item.reason_code),
    decision: decision(evidence.decision),
    entryModel: entryModel(evidence.entry_model),
    rulePassesJson: rulePassesJson(evidence.rule_passes),
    liquidityFormedEpoch: nullableInteger(lifecycle.liquidity_formed_epoch),
    ownExtremeBrokenEpoch: nullableInteger(lifecycle.own_extreme_broken_epoch),
    liquiditySweptEpoch: nullableInteger(lifecycle.liquidity_swept_epoch),
    zoneEngagedEpoch: nullableInteger(lifecycle.zone_engaged_epoch),
    entryConfirmedEpoch: nullableInteger(lifecycle.entry_confirmed_epoch),
    zoneTop: text(zone.top),
    zoneBottom: text(zone.bottom),
    zoneOriginOpenEpoch: integer(zone.origin_bar_open_epoch),
    zoneOriginCloseEpoch: integer(zone.origin_bar_close_epoch),
    liquidityPrice: text(liquidity.price),
    liquidityOriginOpenEpoch: integer(liquidity.origin_bar_open_epoch),
    liquidityOriginCloseEpoch: integer(liquidity.origin_bar_close_epoch),
    sourceOpenEpoch: integer(source.open_epoch),
    sourceCloseEpoch: integer(source.close_epoch),
    sourceOpen: text(source.open),
    sourceHigh: text(source.high),
    sourceLow: text(source.low),
    sourceClose: text(source.close),
  };
}

export function extractSetupEvidence(
  payload: Readonly<Record<string, CanonicalValue>>,
): readonly SetupEvidenceInsert[] {
  if (payload.schema_version !== "1.2") {
    return [];
  }
  if (payload.execution_mode !== "OBSERVATION_ONLY") {
    return invariant();
  }
  const symbol = text(payload.symbol);
  if (payload.kind === "incremental") {
    return array(payload.transitions).map((item, index) =>
      extractItem(item, index, "transition", symbol),
    );
  }
  if (payload.kind === "snapshot") {
    return array(payload.active_setups).map((item, index) =>
      extractItem(item, index, "active_setup", symbol),
    );
  }
  return invariant();
}
