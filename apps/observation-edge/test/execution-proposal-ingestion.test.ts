import { describe, expect, it } from "vitest";

import {
  ingestExecutionProposalV1,
  type ExecutionProposalIngestionResponse,
} from "../src/execution-proposal-ingestion";
import { handleRequest } from "../src/index";
import {
  ProposalTestD1,
  proposal,
  proposalEnv,
} from "./support/execution-proposal-fixture";

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function count(database: ProposalTestD1, table: string): number {
  return (
    database.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}

async function body(response: Response): Promise<ExecutionProposalIngestionResponse> {
  return (await response.json()) as ExecutionProposalIngestionResponse;
}

describe("execution proposal v1 ingestion", () => {
  it("accepts proposal v1 on the existing authenticated observation route", async () => {
    const database = new ProposalTestD1();
    const credential = "proposal-route-secret";
    const credentialDigest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential)),
      ),
      (item) => item.toString(16).padStart(2, "0"),
    ).join("");
    const response = await handleRequest(
      new Request("https://edge.example/api/v1/tradingview/observations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential, payload: proposal(1) }),
      }),
      proposalEnv(database, {
        TRADINGVIEW_OBSERVATION_INGRESS_ENABLED: "true",
        TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256: credentialDigest,
      }),
    );

    expect(response.status).toBe(202);
    expect(await body(response)).toMatchObject({
      schema_version: "rd-entry-execution-proposal-ingestion-v1",
      status: "RECORDED",
      execution_mode: "PAPER_ONLY",
      candidate_emission: "DISABLED",
      candidate_dispatch: "DISABLED",
    });
    expect(count(database, "observation_execution_proposal_v1_events")).toBe(1);
    expect(count(database, "observation_execution_proposal_v1_paper_results")).toBe(1);
    expect(count(database, "observation_execution_producer_checkpoints")).toBe(1);
  });

  it("replays an identical producer sequence idempotently", async () => {
    const database = new ProposalTestD1();
    const env = proposalEnv(database);
    const first = await ingestExecutionProposalV1(env, bytes(proposal(1)), 1_800_000_302);
    const firstText = await first.text();
    const replay = await ingestExecutionProposalV1(env, bytes(proposal(1)), 1_800_000_399);

    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(await replay.text()).toBe(firstText);
    expect(count(database, "observation_execution_proposal_v1_events")).toBe(1);
    expect(count(database, "observation_execution_producer_checkpoints")).toBe(1);
    expect(count(database, "observation_execution_producer_incidents")).toBe(0);
  });

  it("digests canonical proposal semantics across direct and routed transport variants", async () => {
    const database = new ProposalTestD1();
    const credential = "canonical-replay-secret";
    const credentialDigest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential)),
      ),
      (item) => item.toString(16).padStart(2, "0"),
    ).join("");
    const env = proposalEnv(database, {
      TRADINGVIEW_OBSERVATION_INGRESS_ENABLED: "true",
      TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256: credentialDigest,
    });
    const value = proposal(1);
    const first = await ingestExecutionProposalV1(env, bytes(value), 1_800_000_302);
    const firstText = await first.text();
    const reversed = Object.fromEntries(Object.entries(value).reverse());
    const transportVariant = JSON.stringify(reversed, null, 2).replace(
      "pine-proposal-v1-fixture",
      "\\u0070ine-proposal-v1-fixture",
    );
    const routed = await handleRequest(
      new Request("https://edge.example/api/v1/tradingview/observations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: `{\n  \"credential\": ${JSON.stringify(credential)},\n  \"payload\": ${transportVariant}\n}`,
      }),
      env,
    );

    expect(routed.status).toBe(202);
    expect(await routed.text()).toBe(firstText);
    expect(count(database, "observation_execution_proposal_v1_events")).toBe(1);
  });

  it("quarantines sequence gaps, out-of-order events, and body conflicts", async () => {
    const database = new ProposalTestD1();
    const env = proposalEnv(database);
    await ingestExecutionProposalV1(env, bytes(proposal(1)), 1_800_000_302);

    const gap = await ingestExecutionProposalV1(env, bytes(proposal(3)), 1_800_000_303);
    expect(gap.status).toBe(409);
    expect(await gap.json()).toMatchObject({
      error: { code: "EXECUTION_PROPOSAL_SEQUENCE_GAP" },
    });

    const conflict = await ingestExecutionProposalV1(
      env,
      bytes(proposal(1, { observed_at_epoch: 1_800_000_302 })),
      1_800_000_304,
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: { code: "EXECUTION_PROPOSAL_BODY_CONFLICT" },
    });

    database.database.prepare(
      `INSERT INTO observation_execution_producer_checkpoints
       (checkpoint_id, producer_instance_id, producer_sequence,
        proposal_sha256, recorded_at_epoch)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("f".repeat(64), "out-of-order-producer", 2, "e".repeat(64), 1_800_000_300);
    const outOfOrder = await ingestExecutionProposalV1(
      env,
      bytes(proposal(1, { producer_instance_id: "out-of-order-producer" })),
      1_800_000_305,
    );
    expect(outOfOrder.status).toBe(409);
    expect(await outOfOrder.json()).toMatchObject({
      error: { code: "EXECUTION_PROPOSAL_OUT_OF_ORDER" },
    });

    const incidentKinds = database.database
      .prepare(
        `SELECT incident_kind FROM observation_execution_producer_incidents
         ORDER BY recorded_at_epoch, incident_kind`,
      )
      .all()
      .map((row) => (row as { incident_kind: string }).incident_kind);
    expect(incidentKinds).toEqual([
      "SEQUENCE_GAP",
      "BODY_CONFLICT",
      "OUT_OF_ORDER",
    ]);
    const bodyIncident = database.database
      .prepare(
        `SELECT expected_sequence, proposal_sha256, existing_sha256, incident_json
         FROM observation_execution_producer_incidents
         WHERE incident_kind = 'BODY_CONFLICT'`,
      )
      .get() as {
        expected_sequence: number;
        proposal_sha256: string;
        existing_sha256: string;
        incident_json: string;
      };
    expect(bodyIncident.expected_sequence).toBe(2);
    expect(bodyIncident.proposal_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(bodyIncident.existing_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(bodyIncident.incident_json)).toMatchObject({
      incident_kind: "BODY_CONFLICT",
      expected_sequence: 2,
      producer_sequence: 1,
      proposal_sha256: bodyIncident.proposal_sha256,
      existing_sha256: bodyIncident.existing_sha256,
      execution_mode: "PAPER_ONLY",
    });
    expect(count(database, "observation_execution_proposal_v1_events")).toBe(1);
  });

  it("enforces logical candidate conflicts from immutable events across flag toggles", async () => {
    const database = new ProposalTestD1();
    const disabled = proposalEnv(database);
    const first = await ingestExecutionProposalV1(
      disabled,
      bytes(proposal(1)),
      1_800_000_302,
    );
    const conflictWhileDisabled = await ingestExecutionProposalV1(
      disabled,
      bytes(proposal(1, { producer_instance_id: "disabled-second-producer" })),
      1_800_000_303,
    );
    const replayAfterToggle = await ingestExecutionProposalV1(
      proposalEnv(database, { RD_EXECUTION_CANDIDATE_EMISSION_ENABLED: "true" }),
      bytes(proposal(1)),
      1_800_000_303,
    );
    const conflictingProducer = await ingestExecutionProposalV1(
      proposalEnv(database, { RD_EXECUTION_CANDIDATE_EMISSION_ENABLED: "true" }),
      bytes(proposal(1, { producer_instance_id: "second-producer" })),
      1_800_000_304,
    );

    expect(first.status).toBe(202);
    expect(conflictWhileDisabled.status).toBe(409);
    expect(await conflictWhileDisabled.json()).toMatchObject({
      error: { code: "EXECUTION_CANDIDATE_BODY_CONFLICT" },
    });
    expect(replayAfterToggle.status).toBe(202);
    expect(await replayAfterToggle.json()).toMatchObject({
      candidate_emission: "DISABLED",
    });
    expect(conflictingProducer.status).toBe(409);
    expect(await conflictingProducer.json()).toMatchObject({
      error: { code: "EXECUTION_CANDIDATE_BODY_CONFLICT" },
    });
    expect(count(database, "observation_execution_proposal_v1_events")).toBe(1);
    expect(count(database, "observation_execution_candidate_v1_payloads")).toBe(0);
    expect(count(database, "observation_execution_producer_incidents")).toBe(2);
  });

  it("classifies a concurrent natural-key race as candidate conflict", async () => {
    const database = new ProposalTestD1();
    const env = proposalEnv(database);
    const [first, second] = await Promise.all([
      ingestExecutionProposalV1(env, bytes(proposal(1)), 1_800_000_302),
      ingestExecutionProposalV1(
        env,
        bytes(proposal(1, { producer_instance_id: "racing-producer" })),
        1_800_000_302,
      ),
    ]);
    const responses = [first, second];

    expect(responses.filter((item) => item.status === 202)).toHaveLength(1);
    expect(responses.filter((item) => item.status === 409)).toHaveLength(1);
    const quarantined = responses.find((item) => item.status === 409)!;
    expect(await quarantined.json()).toMatchObject({
      error: { code: "EXECUTION_CANDIDATE_BODY_CONFLICT" },
    });
    expect(count(database, "observation_execution_proposal_v1_events")).toBe(1);
    expect(count(database, "observation_execution_producer_incidents")).toBe(1);
  });

  it("rolls back event, result, checkpoint, payload, and delivery atomically", async () => {
    const database = new ProposalTestD1();
    database.failBatchAtSqlFragment =
      "INSERT INTO observation_execution_candidate_v1_deliveries";
    const response = await ingestExecutionProposalV1(
      proposalEnv(database, {
        RD_EXECUTION_CANDIDATE_EMISSION_ENABLED: "true",
      }),
      bytes(proposal(1)),
      1_800_000_302,
    );

    expect(response.status).toBe(503);
    for (const table of [
      "observation_execution_proposal_v1_events",
      "observation_execution_proposal_v1_paper_results",
      "observation_execution_producer_checkpoints",
      "observation_execution_candidate_v1_payloads",
      "observation_execution_candidate_v1_deliveries",
    ]) {
      expect(count(database, table), table).toBe(0);
    }
  });

  it("keeps candidate emission and dispatch independently disabled", async () => {
    const withoutEmission = new ProposalTestD1();
    const noEmission = await ingestExecutionProposalV1(
      proposalEnv(withoutEmission, {
        RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED: "true",
        RD_EXECUTION_RECEIVER_MANIFEST_SHA256: "a".repeat(64),
      }),
      bytes(proposal(1)),
      1_800_000_302,
    );
    expect((await body(noEmission)).candidate_emission).toBe("DISABLED");
    expect(count(withoutEmission, "observation_execution_candidate_v1_payloads")).toBe(0);
    expect(count(withoutEmission, "observation_execution_candidate_v1_deliveries")).toBe(0);

    const withoutDispatch = new ProposalTestD1();
    const noDispatch = await ingestExecutionProposalV1(
      proposalEnv(withoutDispatch, {
        RD_EXECUTION_CANDIDATE_EMISSION_ENABLED: "true",
      }),
      bytes(proposal(1)),
      1_800_000_302,
    );
    const identicalReplay = await ingestExecutionProposalV1(
      proposalEnv(withoutDispatch, {
        RD_EXECUTION_CANDIDATE_EMISSION_ENABLED: "true",
      }),
      bytes(proposal(1)),
      1_800_000_303,
    );
    expect(await body(noDispatch)).toMatchObject({
      candidate_emission: "STORED",
      candidate_dispatch: "DISABLED",
    });
    expect(count(withoutDispatch, "observation_execution_candidate_v1_payloads")).toBe(1);
    expect(count(withoutDispatch, "observation_execution_candidate_v1_deliveries")).toBe(1);
    expect(identicalReplay.status).toBe(202);
  });

  it("uses the exact market expiry and expires stale candidates at ingestion", async () => {
    const pendingDatabase = new ProposalTestD1();
    await ingestExecutionProposalV1(
      proposalEnv(pendingDatabase, {
        RD_EXECUTION_CANDIDATE_EMISSION_ENABLED: "true",
      }),
      bytes(proposal(1)),
      1_800_000_600,
    );
    expect(
      pendingDatabase.database
        .prepare(
          `SELECT status, expires_at_epoch
           FROM observation_execution_candidate_v1_deliveries`,
        )
        .get(),
    ).toMatchObject({ status: "PENDING", expires_at_epoch: 1_800_000_601 });

    const staleDatabase = new ProposalTestD1();
    await ingestExecutionProposalV1(
      proposalEnv(staleDatabase, {
        RD_EXECUTION_CANDIDATE_EMISSION_ENABLED: "true",
      }),
      bytes(proposal(1)),
      1_800_000_601,
    );
    expect(
      staleDatabase.database
        .prepare(
          `SELECT status, expires_at_epoch, last_error
           FROM observation_execution_candidate_v1_deliveries`,
        )
        .get(),
    ).toMatchObject({
      status: "EXPIRED",
      expires_at_epoch: 1_800_000_601,
      last_error: "candidate expired before private delivery",
    });
    expect(count(staleDatabase, "observation_execution_candidate_v1_payloads")).toBe(1);
  });
});
