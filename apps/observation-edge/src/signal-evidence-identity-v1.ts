import { canonicalSha256 } from "./rd-entry-policy";
import {
  isStrictJsonNumber,
  type StrictJsonValue,
} from "./strict-json";

export type SignalEvidenceDirectionV1 = "LONG" | "SHORT";
export type SignalEvidenceFormationVariantV1 = "STANDARD" | "ACCURACY";

export type SignalEvidenceFormationV1 = Readonly<{
  setup_id: string;
  origin_epoch: number;
  confirmation_epoch: number;
  direction: SignalEvidenceDirectionV1;
  variant: SignalEvidenceFormationVariantV1;
  origin_open_ticks: number;
  origin_high_ticks: number;
  origin_low_ticks: number;
  origin_close_ticks: number;
  zone_top_ticks: number;
  zone_bottom_ticks: number;
  formation_source_id: string;
}>;

export type SignalEvidenceFormationSetupV1 = Readonly<{
  setup_id: string;
  direction: SignalEvidenceDirectionV1;
  zone_top_ticks: number;
  zone_bottom_ticks: number;
  zone_engaged_epoch: number | null;
}>;

export type SignalEvidenceIdentityV1 = Readonly<{
  attempt_key: string;
  formation_body_sha256: string;
  evidence_id: string;
}>;

export type SignalEvidenceIdentityInputV1 = Readonly<{
  strategy_id: string;
  ticker_id: string;
  feed: string;
  producer_namespace: string;
  producer_instance_id: string;
  event_id: string;
  producer_sequence: number;
  tick_size: string;
  formation: SignalEvidenceFormationV1;
}>;

const FORMATION_KEYS = [
  "setup_id", "origin_epoch", "confirmation_epoch", "direction", "variant",
  "origin_open_ticks", "origin_high_ticks", "origin_low_ticks",
  "origin_close_ticks", "formation_source_id",
] as const;

function invalid(): never {
  throw new TypeError("invalid signal evidence formation");
}

function record(value: StrictJsonValue): Record<string, StrictJsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, StrictJsonValue>;
}

function text(value: StrictJsonValue, maximum: number): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > maximum ||
    !/^[!-~]+$/u.test(value)
  ) invalid();
  return value;
}

function positiveInteger(value: StrictJsonValue): number {
  if (
    !isStrictJsonNumber(value) || !value.isIntegerToken ||
    !Number.isSafeInteger(value.value) || value.value <= 0
  ) invalid();
  return value.value;
}

function sameKeys(value: Record<string, StrictJsonValue>): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...FORMATION_KEYS].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function field(
  value: Record<string, StrictJsonValue>,
  key: (typeof FORMATION_KEYS)[number],
): StrictJsonValue {
  const result = value[key];
  if (result === undefined) invalid();
  return result;
}

/** Bridge-internal parser: accepts only values branded by parseStrictJson. */
export function validateSignalEvidenceFormationsV1(
  value: StrictJsonValue,
  setups: readonly SignalEvidenceFormationSetupV1[],
): readonly SignalEvidenceFormationV1[] {
  if (!Array.isArray(value) || value.length !== setups.length) invalid();
  const setupById = new Map(setups.map((item) => [item.setup_id, item]));
  if (setupById.size !== setups.length) invalid();
  const seen = new Set<string>();
  const formations = value.map((item) => {
    const input = record(item);
    if (!sameKeys(input)) invalid();
    const setupId = text(field(input, "setup_id"), 256);
    const formationSourceId = text(field(input, "formation_source_id"), 1024);
    const setup = setupById.get(setupId);
    if (setup === undefined || seen.has(setupId)) invalid();
    seen.add(setupId);
    const originEpoch = positiveInteger(field(input, "origin_epoch"));
    const confirmationEpoch = positiveInteger(field(input, "confirmation_epoch"));
    const open = positiveInteger(field(input, "origin_open_ticks"));
    const high = positiveInteger(field(input, "origin_high_ticks"));
    const low = positiveInteger(field(input, "origin_low_ticks"));
    const close = positiveInteger(field(input, "origin_close_ticks"));
    const direction = field(input, "direction");
    const variant = field(input, "variant");
    if (
      (direction !== "LONG" && direction !== "SHORT") ||
      (variant !== "STANDARD" && variant !== "ACCURACY") ||
      direction !== setup.direction ||
      originEpoch % 300 !== 0 || confirmationEpoch % 300 !== 0 ||
      originEpoch >= confirmationEpoch || setup.zone_engaged_epoch === null ||
      confirmationEpoch > setup.zone_engaged_epoch ||
      low >= high || open < low || open > high || close < low || close > high ||
      (direction === "LONG" ? close >= open : close <= open)
    ) invalid();
    const expectedTop = variant === "STANDARD" || direction === "SHORT"
      ? high
      : (open > close ? open : close);
    const expectedBottom = variant === "STANDARD" || direction === "LONG"
      ? low
      : (open < close ? open : close);
    if (
      setup.zone_top_ticks !== expectedTop ||
      setup.zone_bottom_ticks !== expectedBottom ||
      setup.zone_bottom_ticks >= setup.zone_top_ticks
    ) invalid();
    return Object.freeze({
      setup_id: setupId,
      origin_epoch: originEpoch,
      confirmation_epoch: confirmationEpoch,
      direction,
      variant,
      origin_open_ticks: open,
      origin_high_ticks: high,
      origin_low_ticks: low,
      origin_close_ticks: close,
      zone_top_ticks: setup.zone_top_ticks,
      zone_bottom_ticks: setup.zone_bottom_ticks,
      formation_source_id: formationSourceId,
    });
  });
  if (seen.size !== setupById.size) invalid();
  formations.sort((left, right) =>
    left.setup_id < right.setup_id
      ? -1
      : left.setup_id > right.setup_id
      ? 1
      : 0
  );
  return Object.freeze(formations);
}

/** Derives identifiers from values already validated by the bridge. */
export async function deriveSignalEvidenceIdentityV1(
  input: SignalEvidenceIdentityInputV1,
): Promise<SignalEvidenceIdentityV1> {
  const formation = input.formation;
  const attemptKey = await canonicalSha256({
    domain: "tradeops-demo-attempt-v1",
    strategy_id: input.strategy_id,
    ticker_id: input.ticker_id,
    feed: input.feed,
    timeframe: "5",
    origin_epoch: formation.origin_epoch,
    confirmation_epoch: formation.confirmation_epoch,
    direction: formation.direction,
    variant: formation.variant,
    attempt_kind: "INITIAL",
  });
  const formationBodySha256 = await canonicalSha256({
    domain: "tradeops-demo-formation-v1",
    origin_epoch: formation.origin_epoch,
    confirmation_epoch: formation.confirmation_epoch,
    direction: formation.direction,
    variant: formation.variant,
    origin_open_ticks: formation.origin_open_ticks,
    origin_high_ticks: formation.origin_high_ticks,
    origin_low_ticks: formation.origin_low_ticks,
    origin_close_ticks: formation.origin_close_ticks,
    tick_size: input.tick_size,
    zone_top_ticks: formation.zone_top_ticks,
    zone_bottom_ticks: formation.zone_bottom_ticks,
  });
  const evidenceId = await canonicalSha256({
    domain: "tradeops-signal-evidence-id-v1",
    producer_namespace: input.producer_namespace,
    producer_instance_id: input.producer_instance_id,
    event_id: input.event_id,
    producer_sequence: input.producer_sequence,
    attempt_key: attemptKey,
  });
  return Object.freeze({
    attempt_key: attemptKey,
    formation_body_sha256: formationBodySha256,
    evidence_id: evidenceId,
  });
}
