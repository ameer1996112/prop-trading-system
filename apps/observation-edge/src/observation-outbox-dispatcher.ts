import type { Env } from "./types";

const SHA256 = /^[a-f0-9]{64}$/u;
const LEASE_OWNER = /^[\x21-\x5b\x5d-\x7e]{1,160}$/u;
const LEASE_SECONDS = 30;
const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_SECONDS = 300;

export type DeliveryStatus =
  | "PENDING"
  | "RETRY"
  | "CLAIMED"
  | "ACKNOWLEDGED"
  | "EXPIRED"
  | "FAILED_TERMINAL";

export interface ObservationCandidateDeliveryClaim {
  readonly logical_candidate_id: string;
  readonly candidate_body_sha256: string;
  readonly payload_json: string;
  readonly status: "CLAIMED";
  readonly attempt_count: number;
  readonly lease_owner: string;
  readonly lease_expires_at_epoch: number;
  readonly claim_token: string;
  readonly expires_at_epoch: number;
}

export type DeliveryFinalization =
  | { readonly kind: "ACKNOWLEDGED"; readonly receiver_status: number }
  | { readonly kind: "TRANSIENT_FAILURE"; readonly detail: string }
  | {
      readonly kind: "FAILED_TERMINAL";
      readonly receiver_status: number;
      readonly detail: string;
    };

export type ObservationOutboxOutcome =
  | { readonly status: "DISABLED" }
  | { readonly status: "EMPTY" }
  | { readonly status: "RETRY" }
  | { readonly status: "ACKNOWLEDGED" }
  | { readonly status: "EXPIRED" }
  | { readonly status: "FAILED_TERMINAL" };

export type PrivateCandidateSender = (
  payloadJson: string,
  receiverManifestSha256: string,
) => Promise<Response>;

function dispatchEnabled(env: Env): boolean {
  return (
    env.RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED === "true" &&
    typeof env.RD_EXECUTION_RECEIVER_MANIFEST_SHA256 === "string" &&
    SHA256.test(env.RD_EXECUTION_RECEIVER_MANIFEST_SHA256) &&
    env.RD_EXECUTION_RECEIVER_MANIFEST_SHA256 !== "0".repeat(64)
  );
}

function validNow(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

async function claimToken(): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(crypto.randomUUID()),
  );
  return Array.from(new Uint8Array(digest), (item) =>
    item.toString(16).padStart(2, "0"),
  ).join("");
}

function freshCompletionEpoch(
  preSendEpoch: number,
  clock: () => number,
): number {
  try {
    const fresh = clock();
    return validNow(fresh) ? Math.max(preSendEpoch, fresh) : preSendEpoch;
  } catch {
    return preSendEpoch;
  }
}

async function expireStaleDeliveries(
  env: Env,
  nowEpoch: number,
): Promise<number> {
  const result = await env.DB
    .prepare(
      `UPDATE observation_execution_candidate_v1_deliveries
       SET status = 'EXPIRED',
           lease_owner = NULL,
           lease_expires_at_epoch = NULL,
           claim_token = NULL,
           acknowledged_at_epoch = NULL,
           receiver_status = NULL,
           last_error = 'candidate expired before private delivery',
           updated_at_epoch = ?
       WHERE status IN ('PENDING', 'RETRY', 'CLAIMED')
         AND expires_at_epoch <= ?`,
    )
    .bind(nowEpoch, nowEpoch)
    .run();
  return Number(result.meta.changes ?? 0);
}

export async function claimObservationCandidateDelivery(
  env: Env,
  leaseOwner: string,
  nowEpoch: number,
): Promise<ObservationCandidateDeliveryClaim | null> {
  if (
    !dispatchEnabled(env) ||
    !LEASE_OWNER.test(leaseOwner) ||
    !validNow(nowEpoch)
  ) {
    return null;
  }
  const leaseExpiresAtEpoch = nowEpoch + LEASE_SECONDS;
  const token = await claimToken();
  const results = await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE observation_execution_candidate_v1_deliveries
         SET status = 'EXPIRED',
             lease_owner = NULL,
             lease_expires_at_epoch = NULL,
             claim_token = NULL,
             acknowledged_at_epoch = NULL,
             receiver_status = NULL,
             last_error = 'candidate expired before private delivery',
             updated_at_epoch = ?
         WHERE status IN ('PENDING', 'RETRY', 'CLAIMED')
           AND expires_at_epoch <= ?`,
      )
      .bind(nowEpoch, nowEpoch),
    env.DB
      .prepare(
        `UPDATE observation_execution_candidate_v1_deliveries
         SET status = 'FAILED_TERMINAL',
             lease_owner = NULL,
             lease_expires_at_epoch = NULL,
             claim_token = NULL,
             acknowledged_at_epoch = NULL,
             receiver_status = NULL,
             last_error = 'final private delivery lease expired',
             updated_at_epoch = ?
         WHERE status = 'CLAIMED'
           AND lease_expires_at_epoch <= ?
           AND attempt_count >= ?
           AND expires_at_epoch > ?`,
      )
      .bind(nowEpoch, nowEpoch, MAX_ATTEMPTS, nowEpoch),
    env.DB
      .prepare(
        `UPDATE observation_execution_candidate_v1_deliveries
         SET status = 'RETRY',
             lease_owner = NULL,
             lease_expires_at_epoch = NULL,
             claim_token = NULL,
             acknowledged_at_epoch = NULL,
             receiver_status = NULL,
             last_error = 'private delivery lease expired',
             next_attempt_at_epoch = ?,
             updated_at_epoch = ?
         WHERE status = 'CLAIMED'
           AND lease_expires_at_epoch <= ?
           AND attempt_count < ?
           AND expires_at_epoch > ?`,
      )
      .bind(nowEpoch, nowEpoch, nowEpoch, MAX_ATTEMPTS, nowEpoch),
    env.DB
      .prepare(
        `UPDATE observation_execution_candidate_v1_deliveries
         SET status = 'CLAIMED',
             attempt_count = attempt_count + 1,
             lease_owner = ?,
             lease_expires_at_epoch = ?,
             claim_token = ?,
             acknowledged_at_epoch = NULL,
             receiver_status = NULL,
             last_error = NULL,
             updated_at_epoch = ?
         WHERE logical_candidate_id = (
             SELECT logical_candidate_id
             FROM observation_execution_candidate_v1_deliveries
             WHERE status IN ('PENDING', 'RETRY')
               AND attempt_count < ?
               AND next_attempt_at_epoch <= ?
               AND expires_at_epoch > ?
             ORDER BY next_attempt_at_epoch, created_at_epoch, logical_candidate_id
             LIMIT 1
         )
           AND status IN ('PENDING', 'RETRY')
           AND next_attempt_at_epoch <= ?
           AND expires_at_epoch > ?`,
      )
      .bind(
        leaseOwner,
        leaseExpiresAtEpoch,
        token,
        nowEpoch,
        MAX_ATTEMPTS,
        nowEpoch,
        nowEpoch,
        nowEpoch,
        nowEpoch,
      ),
    env.DB
      .prepare(
        `SELECT delivery.logical_candidate_id,
                payload.candidate_body_sha256,
                payload.payload_json,
                delivery.status,
                delivery.attempt_count,
                delivery.lease_owner,
                delivery.lease_expires_at_epoch,
                delivery.claim_token,
                delivery.expires_at_epoch
         FROM observation_execution_candidate_v1_deliveries AS delivery
         JOIN observation_execution_candidate_v1_payloads AS payload
           ON payload.logical_candidate_id = delivery.logical_candidate_id
         WHERE delivery.status = 'CLAIMED'
           AND delivery.claim_token = ?
         LIMIT 1`,
      )
      .bind(token),
  ]);
  const claim = results[4]?.results[0] as
    | ObservationCandidateDeliveryClaim
    | undefined;
  return claim ?? null;
}

export async function finalizeObservationCandidateDelivery(
  env: Env,
  claim: ObservationCandidateDeliveryClaim,
  finalization: DeliveryFinalization,
  nowEpoch: number,
): Promise<ObservationOutboxOutcome> {
  if (!validNow(nowEpoch)) return { status: "FAILED_TERMINAL" };
  if (nowEpoch >= claim.expires_at_epoch) {
    const result = await env.DB
      .prepare(
        `UPDATE observation_execution_candidate_v1_deliveries
         SET status = 'EXPIRED', lease_owner = NULL,
             lease_expires_at_epoch = NULL, acknowledged_at_epoch = NULL,
             claim_token = NULL,
             receiver_status = NULL,
             last_error = 'candidate expired during private delivery',
             updated_at_epoch = ?
         WHERE logical_candidate_id = ? AND status = 'CLAIMED'
           AND lease_owner = ? AND lease_expires_at_epoch = ?
           AND claim_token = ?`,
      )
      .bind(
        nowEpoch,
        claim.logical_candidate_id,
        claim.lease_owner,
        claim.lease_expires_at_epoch,
        claim.claim_token,
      )
      .run();
    return Number(result.meta.changes ?? 0) === 1
      ? { status: "EXPIRED" }
      : { status: "EMPTY" };
  }

  if (nowEpoch >= claim.lease_expires_at_epoch) {
    const terminal = claim.attempt_count >= MAX_ATTEMPTS;
    const result = await env.DB
      .prepare(
        `UPDATE observation_execution_candidate_v1_deliveries
         SET status = ?, lease_owner = NULL,
             lease_expires_at_epoch = NULL, claim_token = NULL,
             acknowledged_at_epoch = NULL, receiver_status = NULL,
             last_error = ?, next_attempt_at_epoch = ?, updated_at_epoch = ?
         WHERE logical_candidate_id = ? AND status = 'CLAIMED'
           AND lease_owner = ? AND lease_expires_at_epoch = ?
           AND claim_token = ?`,
      )
      .bind(
        terminal ? "FAILED_TERMINAL" : "RETRY",
        terminal
          ? "final private delivery lease expired"
          : "private delivery lease expired",
        nowEpoch,
        nowEpoch,
        claim.logical_candidate_id,
        claim.lease_owner,
        claim.lease_expires_at_epoch,
        claim.claim_token,
      )
      .run();
    if (Number(result.meta.changes ?? 0) !== 1) return { status: "EMPTY" };
    return terminal ? { status: "FAILED_TERMINAL" } : { status: "RETRY" };
  }

  if (finalization.kind === "ACKNOWLEDGED") {
    const result = await env.DB
      .prepare(
        `UPDATE observation_execution_candidate_v1_deliveries
         SET status = 'ACKNOWLEDGED', lease_owner = NULL,
             lease_expires_at_epoch = NULL, claim_token = NULL,
             acknowledged_at_epoch = ?,
             receiver_status = ?, last_error = NULL, updated_at_epoch = ?
         WHERE logical_candidate_id = ? AND status = 'CLAIMED'
           AND lease_owner = ? AND lease_expires_at_epoch = ?
           AND claim_token = ?`,
      )
      .bind(
        nowEpoch,
        finalization.receiver_status,
        nowEpoch,
        claim.logical_candidate_id,
        claim.lease_owner,
        claim.lease_expires_at_epoch,
        claim.claim_token,
      )
      .run();
    return Number(result.meta.changes ?? 0) === 1
      ? { status: "ACKNOWLEDGED" }
      : { status: "EMPTY" };
  }

  const terminal =
    finalization.kind === "FAILED_TERMINAL" ||
    claim.attempt_count >= MAX_ATTEMPTS;
  if (terminal) {
    const receiverStatus = finalization.kind === "FAILED_TERMINAL"
      ? finalization.receiver_status
      : null;
    const result = await env.DB
      .prepare(
        `UPDATE observation_execution_candidate_v1_deliveries
         SET status = 'FAILED_TERMINAL', lease_owner = NULL,
             lease_expires_at_epoch = NULL, claim_token = NULL,
             acknowledged_at_epoch = NULL,
             receiver_status = ?, last_error = ?, updated_at_epoch = ?
         WHERE logical_candidate_id = ? AND status = 'CLAIMED'
           AND lease_owner = ? AND lease_expires_at_epoch = ?
           AND claim_token = ?`,
      )
      .bind(
        receiverStatus,
        finalization.detail.slice(0, 512),
        nowEpoch,
        claim.logical_candidate_id,
        claim.lease_owner,
        claim.lease_expires_at_epoch,
        claim.claim_token,
      )
      .run();
    return Number(result.meta.changes ?? 0) === 1
      ? { status: "FAILED_TERMINAL" }
      : { status: "EMPTY" };
  }

  const backoffSeconds = Math.min(
    MAX_BACKOFF_SECONDS,
    2 ** claim.attempt_count,
  );
  const result = await env.DB
    .prepare(
      `UPDATE observation_execution_candidate_v1_deliveries
       SET status = 'RETRY', lease_owner = NULL,
           lease_expires_at_epoch = NULL, claim_token = NULL,
           acknowledged_at_epoch = NULL,
           receiver_status = NULL, last_error = ?,
           next_attempt_at_epoch = ?, updated_at_epoch = ?
       WHERE logical_candidate_id = ? AND status = 'CLAIMED'
         AND lease_owner = ? AND lease_expires_at_epoch = ?
         AND claim_token = ?`,
    )
    .bind(
      finalization.detail.slice(0, 512),
      nowEpoch + backoffSeconds,
      nowEpoch,
      claim.logical_candidate_id,
      claim.lease_owner,
      claim.lease_expires_at_epoch,
      claim.claim_token,
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1
    ? { status: "RETRY" }
    : { status: "EMPTY" };
}

export async function dispatchObservationOutboxOnce(
  env: Env,
  leaseOwner: string,
  nowEpoch: number,
  send: PrivateCandidateSender,
  completionClock: () => number = () => Math.floor(Date.now() / 1_000),
): Promise<ObservationOutboxOutcome> {
  if (!validNow(nowEpoch)) return { status: "DISABLED" };
  const expired = await expireStaleDeliveries(env, nowEpoch);
  if (expired > 0) return { status: "EXPIRED" };
  if (!dispatchEnabled(env)) return { status: "DISABLED" };
  const claim = await claimObservationCandidateDelivery(
    env,
    leaseOwner,
    nowEpoch,
  );
  if (claim === null) return { status: "EMPTY" };

  try {
    const manifest = env.RD_EXECUTION_RECEIVER_MANIFEST_SHA256;
    if (manifest === undefined) return { status: "DISABLED" };
    const response = await send(claim.payload_json, manifest);
    const completedAtEpoch = freshCompletionEpoch(nowEpoch, completionClock);
    if (response.status >= 200 && response.status < 300) {
      return finalizeObservationCandidateDelivery(
        env,
        claim,
        { kind: "ACKNOWLEDGED", receiver_status: response.status },
        completedAtEpoch,
      );
    }
    if (
      response.status === 408 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      return finalizeObservationCandidateDelivery(
        env,
        claim,
        { kind: "TRANSIENT_FAILURE", detail: `receiver status ${response.status}` },
        completedAtEpoch,
      );
    }
    return finalizeObservationCandidateDelivery(
      env,
      claim,
      {
        kind: "FAILED_TERMINAL",
        receiver_status: response.status,
        detail: `receiver status ${response.status}`,
      },
      completedAtEpoch,
    );
  } catch {
    const completedAtEpoch = freshCompletionEpoch(nowEpoch, completionClock);
    return finalizeObservationCandidateDelivery(
      env,
      claim,
      { kind: "TRANSIENT_FAILURE", detail: "private receiver request failed" },
      completedAtEpoch,
    );
  }
}
