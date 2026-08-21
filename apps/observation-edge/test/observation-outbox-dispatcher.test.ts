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
