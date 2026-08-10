import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateBrokerSymbolCapabilityV1 } from "../src/broker-symbol-capability-v1";
import { validateExecutionCandidateV2 } from "../src/execution-candidate-v2";
import {
  brokerCapabilityFixture,
  validateJsonSchemaPayload,
  v2LongCandidateFixture,
} from "./support/broker-reconstruction-fixture";

const root = new URL("../../../", import.meta.url);

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(path, root), "utf8")) as Record<string, unknown>;
}

const schemas = [
  ["broker-bar-evidence-v1.schema.json", "BrokerBarEvidenceV1"],
  ["account-profile-v1.schema.json", "AccountProfileV1"],
  ["signed-account-profile-v1.schema.json", "SignedAccountProfileV1"],
  ["prop-rule-pack-v1.schema.json", "PropRulePackV1"],
  ["news-calendar-pack-v1.schema.json", "NewsCalendarPackV1"],
  ["agent-sync-request-v1.schema.json", "AgentSyncRequestV1"],
  ["agent-sync-response-v1.schema.json", "AgentSyncResponseV1"],
  ["trade-command-v1.schema.json", "TradeCommandV1"],
  ["agent-event-v1.schema.json", "AgentEventV1"],
  ["execution-decision-v1.schema.json", "ExecutionDecisionV1"],
  ["routing-manifest-v1.schema.json", "RoutingManifestV1"],
  ["rd-entry-execution-proposal-v2.schema.json", "rd-entry-execution-proposal-v2"],
  ["execution-candidate-v2.schema.json", "ExecutionCandidateV2"],
  ["broker-symbol-capability-v1.schema.json", "BrokerSymbolCapabilityV1"],
  ["broker-geometry-reconstruction-v1.schema.json", "BrokerGeometryReconstructionV1"],
] as const;

describe("execution-edge configuration and schema boundaries", () => {
  it("uses an independent inert database and SQLite Durable Objects", () => {
    const config = json("apps/execution-edge/wrangler.jsonc");
    expect(config).toMatchObject({
      name: "prop-trading-execution-edge",
      main: "src/index.ts",
      workers_dev: false,
      preview_urls: false,
      vars: {
        CANDIDATE_INBOX_ENABLED: "false",
        AGENT_SYNC_ENABLED: "false",
        EXECUTION_AUTHORITY_ENABLED: "false",
        EXECUTION_MODE_CEILING: "DRY_RUN",
        ROUTING_MANIFEST_SHA256: "INERT_NOT_CONFIGURED",
      },
    });
    const d1 = config.d1_databases as Record<string, unknown>[];
    expect(d1).toEqual([expect.objectContaining({
      binding: "EXECUTION_DB",
      database_name: "prop-trading-execution-edge-inert",
      database_id: "00000000-0000-0000-0000-000000000000",
    })]);
    const durable = config.durable_objects as { bindings: Record<string, unknown>[] };
    expect(durable.bindings.map((item) => item.class_name).sort()).toEqual([
      "AccountCoordinator",
      "CandidateInbox",
    ]);
  });

  it.each(schemas)("freezes strict %s", (file, title) => {
    const schema = json(`contracts/schema/${file}`);
    expect(schema.title).toBe(title);
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.any(Array));
    expect((schema.required as unknown[]).length).toBeGreaterThan(0);
  });

  it("rejects extra fields through the broker reconstruction payload validators", async () => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    await expect(validateExecutionCandidateV2({ ...candidate, unexpected: true })).rejects.toThrow(
      "EXECUTION_CANDIDATE_V2_INVALID",
    );
    await expect(validateBrokerSymbolCapabilityV1({ ...capability, unexpected: true })).rejects.toThrow(
      "BROKER_SYMBOL_CAPABILITY_INVALID",
    );
  });

  it("rejects an extra payload field through all four broker reconstruction JSON schemas", async () => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    const {
      candidate_body_sha256: _candidateDigest,
      logical_candidate_id: _candidateId,
      proposal_schema_version: _proposalVersion,
      schema_version: _candidateSchemaVersion,
      ...proposalBody
    } = candidate;
    const proposal = {
      ...proposalBody,
      schema_version: "rd-entry-execution-proposal-v2",
    };
    const reconstruction = {
      schema_version: "BrokerGeometryReconstructionV1",
      reconstruction_body_sha256: "f".repeat(64),
      logical_candidate_id: candidate.logical_candidate_id,
      candidate_body_sha256: candidate.candidate_body_sha256,
      evidence_id: "broker-evidence-schema-fixture",
      capability_sha256: capability.capability_sha256,
      source_symbol: "EURUSD",
      broker_symbol: "EURUSD",
      candidate_source_bar_close_epoch: 1_786_392_000,
      outcome: "MATCH",
      reason_code: "NONE",
      matched_engagement_open_epoch: 1_786_391_400,
      matched_source_bar_close_epoch: 1_786_392_000,
      broker_entry_ticks: 1100,
      broker_wick_ticks: 1000,
      broker_stop_ticks: 998,
      broker_risk_distance_ticks: 102,
      broker_target_ticks: 1508,
      maximum_divergence_price_units: 0,
      authority: "PAPER_ONLY",
      real_execution_allowed: false,
      command: null,
    };
    for (const [file, payload] of [
      ["rd-entry-execution-proposal-v2.schema.json", proposal],
      ["execution-candidate-v2.schema.json", candidate],
      ["broker-symbol-capability-v1.schema.json", capability],
      ["broker-geometry-reconstruction-v1.schema.json", reconstruction],
    ] as const) {
      const schema = json(`contracts/schema/${file}`);
      expect(validateJsonSchemaPayload(schema, payload)).toEqual([]);
      expect(validateJsonSchemaPayload(schema, { ...payload, unexpected: true })).toContain(
        "$.unexpected: additional property is not allowed",
      );
    }
  });

  it("rejects invalid reconstruction outcome, reason, and numeric mappings through its parsed schema", async () => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    const schema = json("contracts/schema/broker-geometry-reconstruction-v1.schema.json");
    const match = {
      schema_version: "BrokerGeometryReconstructionV1",
      reconstruction_body_sha256: "f".repeat(64),
      logical_candidate_id: candidate.logical_candidate_id,
      candidate_body_sha256: candidate.candidate_body_sha256,
      evidence_id: "broker-evidence-schema-fixture",
      capability_sha256: capability.capability_sha256,
      source_symbol: "EURUSD",
      broker_symbol: "EURUSD",
      candidate_source_bar_close_epoch: 1_786_392_000,
      outcome: "MATCH",
      reason_code: "NONE",
      matched_engagement_open_epoch: 1_786_391_400,
      matched_source_bar_close_epoch: 1_786_392_000,
      broker_entry_ticks: 1100,
      broker_wick_ticks: 1000,
      broker_stop_ticks: 998,
      broker_risk_distance_ticks: 102,
      broker_target_ticks: 1508,
      maximum_divergence_price_units: 0,
      authority: "PAPER_ONLY",
      real_execution_allowed: false,
      command: null,
    };
    const emptyGeometry = {
      matched_engagement_open_epoch: null,
      matched_source_bar_close_epoch: null,
      broker_entry_ticks: null,
      broker_wick_ticks: null,
      broker_stop_ticks: null,
      broker_risk_distance_ticks: null,
      broker_target_ticks: null,
      maximum_divergence_price_units: null,
    };

    expect(validateJsonSchemaPayload(schema, match)).toEqual([]);
    for (const [caseName, value] of [
      ["MATCH reason", { ...match, reason_code: "GEOMETRY_MISMATCH" }],
      ["MATCH zero geometry", { ...match, broker_entry_ticks: 0 }],
      ["MATCH negative geometry", { ...match, broker_wick_ticks: -1 }],
      ["MATCH negative divergence", { ...match, maximum_divergence_price_units: -1 }],
      ["DATA_GAP reason", { ...match, ...emptyGeometry, outcome: "DATA_GAP", reason_code: "NONE" }],
      ["BLOCKED reason", { ...match, ...emptyGeometry, outcome: "BLOCKED", reason_code: "BROKER_EVIDENCE_GAP" }],
      ["DATA_GAP geometry", { ...match, outcome: "DATA_GAP", reason_code: "BROKER_EVIDENCE_MISSING" }],
      ["BLOCKED geometry", { ...match, outcome: "BLOCKED", reason_code: "GEOMETRY_MISMATCH" }],
    ] as const) {
      expect(validateJsonSchemaPayload(schema, value), caseName).not.toEqual([]);
    }
  });

  it("contains no live command authority or credential-shaped contract fields", () => {
    const command = readFileSync(
      new URL("contracts/schema/trade-command-v1.schema.json", root),
      "utf8",
    );
    const profile = readFileSync(
      new URL("contracts/schema/account-profile-v1.schema.json", root),
      "utf8",
    );
    expect(command).toContain('"const": "DRY_RUN"');
    expect(command).not.toMatch(/"LIVE"|"EVALUATION"|generic_instruction|order_payload/u);
    expect(profile).not.toMatch(/current_mode|password|credential|secret|token/u);
  });

  it("preserves the account-free observation boundary", () => {
    const observationTypes = readFileSync(
      new URL("apps/observation-edge/src/types.ts", root),
      "utf8",
    );
    expect(observationTypes).not.toMatch(
      /BrokerBarEvidenceV1|AccountProfileV1|TradeCommandV1|AgentSyncRequestV1|broker_password|account_password/u,
    );
  });
});
