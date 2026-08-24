import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { canonicalStringify, sha256Hex } from "../src/canonical";

const repositoryRoot = join(import.meta.dirname, "../../..");
const agentRoot = join(repositoryRoot, "mt5/TradeOpsAgent");

function source(relativePath: string): string {
  const path = join(agentRoot, relativePath);
  expect(existsSync(path), `${relativePath} must exist`).toBe(true);
  return readFileSync(path, "utf8");
}

function withoutDigest(value: Record<string, unknown>, digestKey: string): Record<string, unknown> {
  const copy = { ...value };
  delete copy[digestKey];
  return copy;
}

describe("MT5 dry-run heartbeat agent source", () => {
  it("ships a TypeScript-verifiable, redacted canonical request/response fixture pair", async () => {
    const fixture = JSON.parse(source("fixtures/agent-sync-v1.json")) as {
      request: Record<string, unknown>;
      response: Record<string, unknown>;
    };

    expect(fixture.request.schema_version).toBe("AgentSyncRequestV1");
    expect(fixture.request.events).toEqual([]);
    expect(fixture.request.broker_bar_evidence).toEqual([]);
    expect(fixture.request.body_sha256).toBe(await sha256Hex(canonicalStringify(withoutDigest(fixture.request, "body_sha256"))));

    expect(fixture.response.schema_version).toBe("AgentSyncResponseV1");
    expect(fixture.response.mode).toBe("DRY_RUN");
    expect(fixture.response.command).toBeNull();
    expect(fixture.response.response_body_sha256).toBe(await sha256Hex(canonicalStringify(withoutDigest(fixture.response, "response_body_sha256"))));
  });

  it("has a timer-only, reentrancy-guarded dry-run lifecycle", () => {
    const ea = source("TradeOpsAgent.mq5");
    expect(ea).toContain('input string InpProfile = "DRY_RUN";');
    expect(ea).toContain("EventSetTimer(5)");
    expect(ea).toContain("EventKillTimer()");
    expect(ea).toContain("if(g_timer_busy)");
    expect(ea).toContain("TradeOpsPostHeartbeat");
    expect(ea.match(/TradeOpsPostHeartbeat/g)).toHaveLength(1);
    expect(ea).not.toContain("OnTradeTransaction");
    expect(ea).not.toContain("OnTick");
  });

  it("keeps local configuration uncompiled and rejects unsafe server responses", () => {
    const config = source("Include/TradeOpsConfig.mqh");
    const sync = source("Include/TradeOpsSync.mqh");
    const canonical = source("Include/TradeOpsCanonicalJson.mqh");
    const readme = source("README.md");

    expect(config).toContain("TradeOpsAgent\\\\local\\\\config.ini");
    expect(config).not.toContain("TradeOpsAgent.local.mqh");
    expect(sync).toContain("WebRequest");
    expect(sync.match(/\bWebRequest\b/g)).toHaveLength(1);
    expect(sync).toContain("1500");
    expect(sync).toContain("SYNC_REJECTED");
    expect(canonical).toContain("TradeOpsSha256Hex");
    expect(canonical).toContain('mode\\\":\\\"DRY_RUN');
    expect(canonical).toContain('command\\\":null');
    expect(readme).toContain("Do not attach");
    expect(readme).toContain("Algo Trading disabled");
    expect(readme).toContain("DLL imports disabled");
  });

  it("includes a pure MQL self-test source", () => {
    const selfTest = source("Scripts/TradeOpsAgentSelfTest.mq5");
    expect(selfTest).toContain("TradeOpsCanonicalObject2");
    expect(selfTest).toContain("TradeOpsResponseIsSafe");
    expect(selfTest).not.toContain("WebRequest");
  });
});
