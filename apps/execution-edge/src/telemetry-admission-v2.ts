import { canonicalStringify } from "./canonical";
import { readCounterV2, readDigestV2, readIdentifierV2 } from "./telemetry-values-v2";

/**
 * Pure admission only: not a wire parser, authenticator, or repository. The caller authenticates,
 * strictly validates the complete bounded wire body and recomputes its digest, looks up the exact
 * account/tracking/request-receipt key, validates stored canonical response schema/digest before
 * sending it, and atomically commits state/events/receipt before a NEW result becomes an ACK.
 * These results do not prove a commit; failures at those future boundaries must not be faked here.
 */
export type SyncIdentityV2 = Readonly<{
  account_id: string;
  installation_id: string;
  tracking_id: string;
  safety_epoch: number;
  account_profile_sha256: string;
  account_fingerprint_sha256: string;
  tracking_boundary_sha256: string;
}>;

export type RequestMetaV2 = Readonly<{
  identity: SyncIdentityV2;
  request_sequence: number;
  body_sha256: string;
  event_sequences: readonly number[];
  fresh: boolean;
}>;

export type AcceptedStateV2 = Readonly<{
  identity: SyncIdentityV2;
  last_request_sequence: number;
  last_event_sequence: number;
}>;

export type ReceiptMetaV2 = Readonly<{
  identity: SyncIdentityV2;
  request_sequence: number;
  request_body_sha256: string;
  response_bytes: string;
}>;

export type AdmissionV2 = Readonly<
  | { kind: "NEW"; event_sequence_if_committed: number }
  | { kind: "REPLAY"; response_bytes: string }
  | {
      kind: "REJECT";
      code:
        | "IDENTITY_MISMATCH"
        | "RECEIPT_INVALID"
        | "REPLAY_CONFLICT"
        | "RECEIPT_MISSING"
        | "SEQUENCE_INVALID"
        | "STALE_ENVELOPE"
        | "EVENT_SEQUENCE_INVALID";
    }
>;

const REQUEST_META_INVALID = "TELEMETRY_REQUEST_META_INVALID";
const RECEIPT_RESPONSE_MAX_LENGTH = 128 * 1024;

function requestMetaInvalid(): never {
  throw new Error(REQUEST_META_INVALID);
}

function identityKey(identity: SyncIdentityV2): string {
  return canonicalStringify({
    account_id: readIdentifierV2(identity.account_id),
    installation_id: readIdentifierV2(identity.installation_id),
    tracking_id: readIdentifierV2(identity.tracking_id),
    safety_epoch: readCounterV2(identity.safety_epoch),
    account_profile_sha256: readDigestV2(identity.account_profile_sha256),
    account_fingerprint_sha256: readDigestV2(identity.account_fingerprint_sha256),
    tracking_boundary_sha256: readDigestV2(identity.tracking_boundary_sha256),
  });
}

function validateRequest(request: RequestMetaV2): Readonly<{
  identityKey: string;
  requestSequence: number;
  bodyDigest: string;
  eventSequences: readonly number[];
  fresh: boolean;
}> {
  if (request === null || typeof request !== "object") requestMetaInvalid();
  const requestIdentityKey = identityKey(request.identity);
  const requestSequence = readCounterV2(request.request_sequence, 1);
  const bodyDigest = readDigestV2(request.body_sha256);
  if (typeof request.fresh !== "boolean" || !Array.isArray(request.event_sequences) || request.event_sequences.length > 32) {
    requestMetaInvalid();
  }
  const eventSequences = request.event_sequences;
  for (let index = 0; index < eventSequences.length; index += 1) {
    readCounterV2(Object.prototype.hasOwnProperty.call(eventSequences, index) ? eventSequences[index] : undefined, 1);
  }
  return { identityKey: requestIdentityKey, requestSequence, bodyDigest, eventSequences, fresh: request.fresh };
}

export function decideAdmissionV2(
  state: AcceptedStateV2 | null,
  receipt: ReceiptMetaV2 | null,
  request: RequestMetaV2,
): AdmissionV2 {
  const validatedRequest = validateRequest(request);
  const lastRequest = state === null ? 0 : readCounterV2(state.last_request_sequence, 1);
  const lastEvent = state === null ? 0 : readCounterV2(state.last_event_sequence);

  if (state !== null && identityKey(state.identity) !== validatedRequest.identityKey) {
    return { kind: "REJECT", code: "IDENTITY_MISMATCH" };
  }

  if (receipt !== null) {
    if (state === null) return { kind: "REJECT", code: "RECEIPT_INVALID" };
    if (identityKey(receipt.identity) !== validatedRequest.identityKey) {
      return { kind: "REJECT", code: "RECEIPT_INVALID" };
    }
    const receiptSequence = readCounterV2(receipt.request_sequence, 1);
    if (receiptSequence !== validatedRequest.requestSequence || receiptSequence > lastRequest) {
      return { kind: "REJECT", code: "RECEIPT_INVALID" };
    }
    if (typeof receipt.response_bytes !== "string" || receipt.response_bytes.length === 0 || receipt.response_bytes.length > RECEIPT_RESPONSE_MAX_LENGTH) {
      return { kind: "REJECT", code: "RECEIPT_INVALID" };
    }
    if (readDigestV2(receipt.request_body_sha256) !== validatedRequest.bodyDigest) {
      return { kind: "REJECT", code: "REPLAY_CONFLICT" };
    }
    return { kind: "REPLAY", response_bytes: receipt.response_bytes };
  }

  if (validatedRequest.requestSequence <= lastRequest) return { kind: "REJECT", code: "RECEIPT_MISSING" };
  if (lastRequest === Number.MAX_SAFE_INTEGER || validatedRequest.requestSequence !== lastRequest + 1) {
    return { kind: "REJECT", code: "SEQUENCE_INVALID" };
  }
  if (!validatedRequest.fresh) return { kind: "REJECT", code: "STALE_ENVELOPE" };

  let proposedEvent = lastEvent;
  for (const eventSequence of validatedRequest.eventSequences) {
    if (proposedEvent === Number.MAX_SAFE_INTEGER || eventSequence !== proposedEvent + 1) {
      return { kind: "REJECT", code: "EVENT_SEQUENCE_INVALID" };
    }
    proposedEvent = eventSequence;
  }
  return { kind: "NEW", event_sequence_if_committed: proposedEvent };
}
