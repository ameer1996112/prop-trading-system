import { canonicalStringify, sha256Hex } from "./canonical";
import {
  type BrokerSymbolCapabilityV1,
  validateBrokerSymbolCapabilityV1,
} from "./broker-symbol-capability-v1";
import { validateBrokerBarEvidenceV1 } from "./contracts-v1";
import {
  type ExecutionCandidateV2,
  validateExecutionCandidateV2,
} from "./execution-candidate-v2";
import { parseTickSizeToPriceUnits, safeBrokerTicks } from "./exact-price-v1";

export interface BrokerGeometryReconstructionV1 {
  readonly schema_version: "BrokerGeometryReconstructionV1";
  readonly reconstruction_body_sha256: string;
  readonly logical_candidate_id: string;
  readonly candidate_body_sha256: string;
  readonly evidence_id: string;
  readonly capability_sha256: string;
  readonly source_symbol: string;
  readonly broker_symbol: string;
  readonly candidate_source_bar_close_epoch: number;
  readonly outcome: "MATCH" | "BLOCKED" | "DATA_GAP";
  readonly reason_code: "NONE" | "BROKER_EVIDENCE_MISSING" | "BROKER_EVIDENCE_GAP" | "BROKER_CAPABILITY_MISMATCH" | "GEOMETRY_MISMATCH";
  readonly matched_engagement_open_epoch: number | null;
  readonly matched_source_bar_close_epoch: number | null;
  readonly broker_entry_ticks: number | null;
  readonly broker_wick_ticks: number | null;
  readonly broker_stop_ticks: number | null;
  readonly broker_risk_distance_ticks: number | null;
  readonly broker_target_ticks: number | null;
  readonly maximum_divergence_price_units: number | null;
  readonly authority: "PAPER_ONLY";
  readonly real_execution_allowed: false;
  readonly command: null;
}

type MatchGeometry = Readonly<{
  readonly matched_engagement_open_epoch: number;
  readonly matched_source_bar_close_epoch: number;
  readonly broker_entry_ticks: number;
  readonly broker_wick_ticks: number;
  readonly broker_stop_ticks: number;
  readonly broker_risk_distance_ticks: number;
  readonly broker_target_ticks: number;
  readonly maximum_divergence_price_units: number;
}>;

function invalidInput(): never {
  throw new Error("BROKER_RECONSTRUCTION_INPUT_INVALID");
}

function safeNonnegativeWireUnits(value: bigint): number {
  if (value < 0n) throw new Error("EXACT_PRICE_INVALID");
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("EXACT_PRICE_OUT_OF_RANGE");
  return Number(value);
}

function exactConversionFailure(error: unknown): boolean {
  return error instanceof Error && (
    error.message === "EXACT_PRICE_INVALID" || error.message === "EXACT_PRICE_OUT_OF_RANGE"
  );
}

function priceUnits(ticks: number, tickSizeUnits: bigint): bigint {
  if (!Number.isSafeInteger(ticks) || tickSizeUnits <= 0n) invalidInput();
  return BigInt(ticks) * tickSizeUnits;
}

function absoluteDifference(left: bigint, right: bigint): bigint {
  return left >= right ? left - right : right - left;
}

async function result(
  candidate: ExecutionCandidateV2,
  evidenceId: string,
  capability: BrokerSymbolCapabilityV1,
  outcome: BrokerGeometryReconstructionV1["outcome"],
  reasonCode: BrokerGeometryReconstructionV1["reason_code"],
  geometry: MatchGeometry | null,
): Promise<BrokerGeometryReconstructionV1> {
  const body = {
    schema_version: "BrokerGeometryReconstructionV1" as const,
    logical_candidate_id: candidate.logical_candidate_id,
    candidate_body_sha256: candidate.candidate_body_sha256,
    evidence_id: evidenceId,
    capability_sha256: capability.capability_sha256,
    source_symbol: candidate.source_symbol,
    broker_symbol: capability.broker_symbol,
    candidate_source_bar_close_epoch: candidate.source_bar.close_epoch,
    outcome,
    reason_code: reasonCode,
    matched_engagement_open_epoch: geometry?.matched_engagement_open_epoch ?? null,
    matched_source_bar_close_epoch: geometry?.matched_source_bar_close_epoch ?? null,
    broker_entry_ticks: geometry?.broker_entry_ticks ?? null,
    broker_wick_ticks: geometry?.broker_wick_ticks ?? null,
    broker_stop_ticks: geometry?.broker_stop_ticks ?? null,
    broker_risk_distance_ticks: geometry?.broker_risk_distance_ticks ?? null,
    broker_target_ticks: geometry?.broker_target_ticks ?? null,
    maximum_divergence_price_units: geometry?.maximum_divergence_price_units ?? null,
    authority: "PAPER_ONLY" as const,
    real_execution_allowed: false as const,
    command: null,
  };
  return Object.freeze({
    ...body,
    reconstruction_body_sha256: await sha256Hex(canonicalStringify(body)),
  });
}

export async function reconstructBrokerGeometryV1(
  candidateValue: unknown,
  evidenceValue: unknown,
  capabilityValue: unknown,
): Promise<BrokerGeometryReconstructionV1> {
  let candidate: ExecutionCandidateV2;
  let capability: BrokerSymbolCapabilityV1;
  try {
    candidate = await validateExecutionCandidateV2(candidateValue);
    capability = await validateBrokerSymbolCapabilityV1(capabilityValue);
  } catch {
    return invalidInput();
  }

  let evidence;
  try {
    evidence = validateBrokerBarEvidenceV1(evidenceValue, capability.capability_sha256);
  } catch {
    return invalidInput();
  }

  if (
    candidate.source_symbol !== capability.source_symbol ||
    candidate.source_tick_size !== capability.source_tick_size ||
    evidence.source_symbol !== candidate.source_symbol ||
    evidence.broker_symbol !== capability.broker_symbol ||
    evidence.account_profile_sha256 !== capability.account_profile_sha256 ||
    evidence.timeframe !== "M5"
  ) {
    return result(candidate, evidence.evidence_id, capability, "BLOCKED", "BROKER_CAPABILITY_MISMATCH", null);
  }

  const sourceTickUnits = parseTickSizeToPriceUnits(candidate.source_tick_size);
  const brokerTickUnits = parseTickSizeToPriceUnits(capability.broker_tick_size);
  const zoneTop = priceUnits(candidate.zone_top_ticks, sourceTickUnits);
  const zoneBottom = priceUnits(candidate.zone_bottom_ticks, sourceTickUnits);
  const bars = evidence.bars.filter((bar) => (
    bar.open_epoch >= candidate.zone_active_from_epoch &&
    bar.close_epoch <= candidate.source_bar.close_epoch
  ));
  const engagement = bars.find((bar) => (
    priceUnits(bar.low_ticks, brokerTickUnits) <= zoneTop &&
    priceUnits(bar.high_ticks, brokerTickUnits) >= zoneBottom
  ));
  const sourceBar = bars.find((bar) => bar.close_epoch === candidate.source_bar.close_epoch);

  if (
    engagement === undefined || sourceBar === undefined ||
    engagement.open_epoch !== candidate.engagement_candle.open_epoch
  ) {
    return result(candidate, evidence.evidence_id, capability, "BLOCKED", "GEOMETRY_MISMATCH", null);
  }

  const sourceBarClose = priceUnits(sourceBar.close_ticks, brokerTickUnits);
  const sourceBarOpen = priceUnits(sourceBar.open_ticks, brokerTickUnits);
  const directionalCloseIsValid = candidate.direction === "LONG"
    ? sourceBarClose > sourceBarOpen && sourceBarClose > zoneTop
    : sourceBarClose < sourceBarOpen && sourceBarClose < zoneBottom;
  if (!directionalCloseIsValid) {
    return result(candidate, evidence.evidence_id, capability, "BLOCKED", "GEOMETRY_MISMATCH", null);
  }

  const entry = BigInt(sourceBar.close_ticks);
  const wick = BigInt(candidate.direction === "LONG" ? engagement.low_ticks : engagement.high_ticks);
  const buffer = BigInt(capability.broker_buffer_ticks);
  const stop = candidate.direction === "LONG" ? wick - buffer : wick + buffer;
  const risk = candidate.direction === "LONG" ? entry - stop : stop - entry;
  const target = candidate.direction === "LONG" ? entry + 4n * risk : entry - 4n * risk;
  const stopIsOnCorrectSide = candidate.direction === "LONG" ? stop < wick : stop > wick;
  if (risk <= 0n || !stopIsOnCorrectSide) {
    return result(candidate, evidence.evidence_id, capability, "BLOCKED", "GEOMETRY_MISMATCH", null);
  }

  const sourceValues = [
    candidate.engagement_candle.open_ticks,
    candidate.engagement_candle.high_ticks,
    candidate.engagement_candle.low_ticks,
    candidate.engagement_candle.close_ticks,
    candidate.source_bar.open_ticks,
    candidate.source_bar.high_ticks,
    candidate.source_bar.low_ticks,
    candidate.source_bar.close_ticks,
  ];
  const brokerValues = [
    engagement.open_ticks,
    engagement.high_ticks,
    engagement.low_ticks,
    engagement.close_ticks,
    sourceBar.open_ticks,
    sourceBar.high_ticks,
    sourceBar.low_ticks,
    sourceBar.close_ticks,
  ];
  const maximumDivergence = sourceValues.reduce((maximum, sourceValue, index) => {
    const brokerValue = brokerValues[index];
    if (brokerValue === undefined) invalidInput();
    const difference = absoluteDifference(
      priceUnits(sourceValue, sourceTickUnits),
      priceUnits(brokerValue, brokerTickUnits),
    );
    return difference > maximum ? difference : maximum;
  }, 0n);

  try {
    return result(candidate, evidence.evidence_id, capability, "MATCH", "NONE", {
      matched_engagement_open_epoch: engagement.open_epoch,
      matched_source_bar_close_epoch: sourceBar.close_epoch,
      broker_entry_ticks: safeBrokerTicks(entry),
      broker_wick_ticks: safeBrokerTicks(wick),
      broker_stop_ticks: safeBrokerTicks(stop),
      broker_risk_distance_ticks: safeBrokerTicks(risk),
      broker_target_ticks: safeBrokerTicks(target),
      maximum_divergence_price_units: safeNonnegativeWireUnits(maximumDivergence),
    });
  } catch (error) {
    if (exactConversionFailure(error)) {
      return result(candidate, evidence.evidence_id, capability, "BLOCKED", "GEOMETRY_MISMATCH", null);
    }
    throw error;
  }
}
