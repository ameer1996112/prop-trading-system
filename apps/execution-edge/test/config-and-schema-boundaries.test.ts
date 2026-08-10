import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

  it("keeps all broker reconstruction schemas closed to unknown fields", () => {
    for (const file of [
      "rd-entry-execution-proposal-v2.schema.json",
      "execution-candidate-v2.schema.json",
      "broker-symbol-capability-v1.schema.json",
      "broker-geometry-reconstruction-v1.schema.json",
    ]) {
      const schema = json(`contracts/schema/${file}`);
      const properties = schema.properties as Record<string, unknown>;
      expect(schema.additionalProperties).toBe(false);
      expect(properties).not.toHaveProperty("unexpected");
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
