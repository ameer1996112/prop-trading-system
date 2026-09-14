import { canonicalStringify } from "./canonical";
import {
  readCounterV2,
  readDigestV2,
  readIdentifierV2,
  readTicketV2,
} from "./telemetry-values-v2";

export type TrackingBoundaryV2 = Readonly<{
  tracking_id: string;
  account_fingerprint_sha256: string;
  started_at_broker_msc: number;
  initialized_at_utc_seconds: number;
  excluded_boundary_deal_ids: readonly string[];
}>;

const BOUNDARY_INVALID = "TELEMETRY_BOUNDARY_INVALID";

function invalidBoundary(): never {
  throw new Error(BOUNDARY_INVALID);
}

export function makeBoundaryV2(input: TrackingBoundaryV2): TrackingBoundaryV2 {
  const startedAt = readCounterV2(input.started_at_broker_msc, 1);
  if (startedAt % 1000 !== 0 || startedAt > Number.MAX_SAFE_INTEGER - 1000) invalidBoundary();
  const initializedAt = readCounterV2(input.initialized_at_utc_seconds, 1);
  const trackingId = readIdentifierV2(input.tracking_id);
  const fingerprint = readDigestV2(input.account_fingerprint_sha256);

  const exclusions = input.excluded_boundary_deal_ids;
  if (!Array.isArray(exclusions) || exclusions.length > 1024) invalidBoundary();
  const copied: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < exclusions.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(exclusions, index)) invalidBoundary();
    const ticket = readTicketV2(exclusions[index]);
    if (seen.has(ticket)) invalidBoundary();
    seen.add(ticket);
    copied.push(ticket);
  }
  copied.sort();
  Object.freeze(copied);
  return Object.freeze({
    tracking_id: trackingId,
    account_fingerprint_sha256: fingerprint,
    started_at_broker_msc: startedAt,
    initialized_at_utc_seconds: initializedAt,
    excluded_boundary_deal_ids: copied,
  });
}

// The boundary must have been previously validated by makeBoundaryV2.
export function includesDealV2(
  boundary: TrackingBoundaryV2,
  brokerTimeMsc: number,
  dealId: string,
): boolean {
  const time = readCounterV2(brokerTimeMsc);
  const ticket = readTicketV2(dealId);
  if (time < boundary.started_at_broker_msc) return false;
  if (time < boundary.started_at_broker_msc + 1000) {
    return !boundary.excluded_boundary_deal_ids.includes(ticket);
  }
  return true;
}

export function sameBoundaryV2(left: TrackingBoundaryV2, right: TrackingBoundaryV2): boolean {
  return canonicalStringify(makeBoundaryV2(left)) === canonicalStringify(makeBoundaryV2(right));
}
