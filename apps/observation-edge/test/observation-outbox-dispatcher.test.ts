import { describe, expect, it, vi } from "vitest";

import {
  claimObservationCandidateDelivery,
  dispatchObservationOutboxOnce,
  finalizeObservationCandidateDelivery,
} from "../src/observation-outbox-dispatcher";
import { ingestExecutionProposalV1 } from "../src/execution-proposal-ingestion";
import {
  ProposalTestD1,
  proposal,
  proposalEnv,
} from "./support/execution-proposal-fixture";

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function deliveryStatus(database: ProposalTestD1): string {
  return (
    database.database
      .prepare(
        "SELECT status FROM observation_execution_candidate_v1_deliveries",
      )
      .get() as { status: string }
  ).status;
}

async function seededDatabase() {
  const database = new ProposalTestD1();
  const env = proposalEnv(database, {
    RD_EXECUTION_CANDIDATE_EMISSION_ENABLED: "true",
    RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED: "true",
    RD_EXECUTION_RECEIVER_MANIFEST_SHA256: "a".repeat(64),
  });
  const response = await ingestExecutionProposalV1(
    env,
    bytes(proposal(1)),
    1_800_000_302,
  );
  expect(response.status).toBe(202);
  return { database, env };
}

describe("private observation candidate outbox", () => {
  it("does not claim or call the network while dispatch is disabled or inert", async () => {
    const database = new ProposalTestD1();
    const env = proposalEnv(database, {
      RD_EXECUTION_CANDIDATE_EMISSION_ENABLED: "true",
    });
    await ingestExecutionProposalV1(env, bytes(proposal(1)), 1_800_000_302);
    const send = vi.fn(async () => new Response(null, { status: 204 }));

    expect(await claimObservationCandidateDelivery(env, "lease-a", 1_800_000_303)).toBeNull();
    expect(await dispatchObservationOutboxOnce(env, "lease-a", 1_800_000_303, send)).toEqual({
      status: "DISABLED",
    });
    expect(send).not.toHaveBeenCalled();
    expect(deliveryStatus(database)).toBe("PENDING");
  });

  it("expires rather than dispatches a stale candidate", async () => {
    const { database, env } = await seededDatabase();
    const send = vi.fn(async () => new Response(null, { status: 204 }));
    const outcome = await dispatchObservationOutboxOnce(
      env,
      "lease-expiry",
      1_800_000_602,
      send,
    );

    expect(outcome).toEqual({ status: "EXPIRED" });
    expect(send).not.toHaveBeenCalled();
    expect(deliveryStatus(database)).toBe("EXPIRED");
  });

  it("leases once, retries transient failures, and acknowledges a later success", async () => {
    const { database, env } = await seededDatabase();
    const first = await claimObservationCandidateDelivery(
      env,
      "lease-retry",
      1_800_000_303,
    );
    expect(first).toMatchObject({ status: "CLAIMED", lease_owner: "lease-retry" });
    expect(first!.claim_token).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      await claimObservationCandidateDelivery(env, "lease-other", 1_800_000_303),
    ).toBeNull();

    expect(
      await finalizeObservationCandidateDelivery(
        env,
        first!,
        { kind: "TRANSIENT_FAILURE", detail: "receiver unavailable" },
        1_800_000_304,
      ),
    ).toEqual({ status: "RETRY" });
    expect(deliveryStatus(database)).toBe("RETRY");
    expect(
      await claimObservationCandidateDelivery(env, "lease-early", 1_800_000_304),
    ).toBeNull();

    const retry = await claimObservationCandidateDelivery(
      env,
      "lease-success",
      1_800_000_306,
    );
    expect(retry).toMatchObject({ status: "CLAIMED", attempt_count: 2 });
    expect(
      await finalizeObservationCandidateDelivery(
        env,
        retry!,
        { kind: "ACKNOWLEDGED", receiver_status: 204 },
        1_800_000_307,
      ),
    ).toEqual({ status: "ACKNOWLEDGED" });
    expect(deliveryStatus(database)).toBe("ACKNOWLEDGED");
  });

  it("returns distinct exact claims for a reused owner in the same second", async () => {
    const database = new ProposalTestD1();
    const env = proposalEnv(database, {
      RD_EXECUTION_CANDIDATE_EMISSION_ENABLED: "true",
      RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED: "true",
      RD_EXECUTION_RECEIVER_MANIFEST_SHA256: "a".repeat(64),
    });
    await ingestExecutionProposalV1(env, bytes(proposal(1)), 1_800_000_302);
    await ingestExecutionProposalV1(
      env,
      bytes(
        proposal(2, {
          setup_id: "setup-long-2",
          selection_id: "selection-long-2",
        }),
      ),
      1_800_000_302,
    );

    const first = await claimObservationCandidateDelivery(env, "same-owner", 1_800_000_303);
    const second = await claimObservationCandidateDelivery(env, "same-owner", 1_800_000_303);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.logical_candidate_id).not.toBe(second!.logical_candidate_id);
    expect(first!.claim_token).not.toBe(second!.claim_token);
    expect(
      await finalizeObservationCandidateDelivery(
        env,
        first!,
        { kind: "ACKNOWLEDGED", receiver_status: 204 },
        1_800_000_304,
      ),
    ).toEqual({ status: "ACKNOWLEDGED" });
    expect(
      await finalizeObservationCandidateDelivery(
        env,
        second!,
        { kind: "ACKNOWLEDGED", receiver_status: 204 },
        1_800_000_304,
      ),
    ).toEqual({ status: "ACKNOWLEDGED" });
    expect(
      database.database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM observation_execution_candidate_v1_deliveries
           WHERE status = 'ACKNOWLEDGED'`,
        )
        .get(),
    ).toMatchObject({ count: 2 });
  });

  it("terminally fails recovery after a crashed fifth claim", async () => {
    const { database, env } = await seededDatabase();
    let now = 1_800_000_303;
    let claim = await claimObservationCandidateDelivery(env, "crash-owner", now);
    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect(claim?.attempt_count).toBe(attempt);
      const outcome = await finalizeObservationCandidateDelivery(
        env,
        claim!,
        { kind: "TRANSIENT_FAILURE", detail: "retry before crash" },
        now,
      );
      expect(outcome).toEqual({ status: "RETRY" });
      now += 2 ** attempt;
      claim = await claimObservationCandidateDelivery(env, "crash-owner", now);
    }
    expect(claim?.attempt_count).toBe(5);
    const recovered = await claimObservationCandidateDelivery(
      env,
      "recovery-owner",
      claim!.lease_expires_at_epoch,
    );

    expect(recovered).toBeNull();
    expect(deliveryStatus(database)).toBe("FAILED_TERMINAL");
  });

  it("uses a fresh completion time and never acknowledges across expiry", async () => {
    const candidateExpiry = await seededDatabase();
    const send = vi.fn(async () => new Response(null, { status: 204 }));
    expect(
      await dispatchObservationOutboxOnce(
        candidateExpiry.env,
        "slow-candidate",
        1_800_000_303,
        send,
        () => 1_800_000_601,
      ),
    ).toEqual({ status: "EXPIRED" });
    expect(deliveryStatus(candidateExpiry.database)).toBe("EXPIRED");

    const leaseExpiry = await seededDatabase();
    expect(
      await dispatchObservationOutboxOnce(
        leaseExpiry.env,
        "slow-lease",
        1_800_000_303,
        send,
        () => 1_800_000_334,
      ),
    ).toEqual({ status: "RETRY" });
    expect(deliveryStatus(leaseExpiry.database)).toBe("RETRY");
  });

  it("terminally fails a non-retryable private receiver response", async () => {
    const { database, env } = await seededDatabase();
    const send = vi.fn(async () => new Response(null, { status: 400 }));

    expect(
      await dispatchObservationOutboxOnce(
        env,
        "lease-terminal",
        1_800_000_303,
        send,
      ),
    ).toEqual({ status: "FAILED_TERMINAL" });
    expect(send).toHaveBeenCalledOnce();
    expect(deliveryStatus(database)).toBe("FAILED_TERMINAL");
  });
});
