import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import { AccountCoordinatorV1, coordinateAgentSyncV1, getAccountCoordinatorStatusV1 } from "../src/account-coordinator-v1";

const D = (digit: string): string => digit.repeat(64);

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(entries: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) this.values.set(key, value);
  }
}

function request(): any {
  return {
    installation_id: "installation-1",
    account_id: "account-1",
    account_profile_sha256: D("a"),
    safety_epoch: 7,
    request_sequence: 1,
    body_sha256: D("b"),
    account_snapshot: {
      account_fingerprint_sha256: D("c"),
      observed_at_epoch: 1_787_472_010,
      terminal_connection_state: "CONNECTED",
      account_trade_permission: "DENIED",
      terminal_trade_permission: "DENIED",
      algo_trading_permission: "DENIED",
    },
    events: [],
  };
}

describe("account coordinator v1", () => {
  it("accepts the first account sync at sequence one with a dry-run null-command response", async () => {
    const result = await coordinateAgentSyncV1(new MemoryStorage(), request(), 1_787_472_010);

    expect(result).toMatchObject({
      code: "OK",
      response: { server_sequence: 1, mode: "DRY_RUN", command: null },
    });
  });

  it("returns the stored canonical bytes for an exact retry", async () => {
    const storage = new MemoryStorage();
    const first = await coordinateAgentSyncV1(storage, request(), 1_787_472_010);
    const retry = await coordinateAgentSyncV1(storage, request(), 1_787_472_099);

    if (first.code !== "OK" || retry.code !== "OK") throw new Error("expected successful coordination");
    expect(retry).toMatchObject({ code: "OK", response: first.response });
    expect(retry.responseBytes).toBe(first.responseBytes);
  });

  it("rejects a same-sequence request whose canonical digest changes", async () => {
    const storage = new MemoryStorage();
    await coordinateAgentSyncV1(storage, request(), 1_787_472_010);

    await expect(coordinateAgentSyncV1(storage, {
      ...request(), body_sha256: D("d"),
    }, 1_787_472_011)).resolves.toEqual({ code: "REPLAY_CONFLICT" });
  });

  it("rejects request sequence gaps and out-of-order requests", async () => {
    const storage = new MemoryStorage();
    await coordinateAgentSyncV1(storage, request(), 1_787_472_010);

    await expect(coordinateAgentSyncV1(storage, {
      ...request(), request_sequence: 3, body_sha256: D("d"),
    }, 1_787_472_011)).resolves.toEqual({ code: "SEQUENCE_INVALID" });
    await expect(coordinateAgentSyncV1(storage, {
      ...request(), request_sequence: 0, body_sha256: D("e"),
    }, 1_787_472_011)).resolves.toEqual({ code: "SEQUENCE_INVALID" });
  });

  it("rejects changed installation, profile, fingerprint, and safety epoch without re-enrolling", async () => {
    const storage = new MemoryStorage();
    await coordinateAgentSyncV1(storage, request(), 1_787_472_010);
    const next = { ...request(), request_sequence: 2, body_sha256: D("d") };

    for (const changed of [
      { installation_id: "installation-2" },
      { account_profile_sha256: D("e") },
      { account_snapshot: { ...next.account_snapshot, account_fingerprint_sha256: D("f") } },
      { safety_epoch: 8 },
    ]) {
      await expect(coordinateAgentSyncV1(storage, { ...next, ...changed }, 1_787_472_011))
        .resolves.toEqual({ code: "IDENTITY_MISMATCH" });
    }
  });

  it("keeps only replay metadata and a redacted heartbeat summary", async () => {
    const storage = new MemoryStorage();
    await coordinateAgentSyncV1(storage, request(), 1_787_472_010);

    expect([...storage.values.keys()].sort()).toEqual([
      "account_fingerprint_sha256",
      "account_profile_sha256",
      "heartbeat_summary",
      "installation_id",
      "last_accepted_request_digest",
      "last_accepted_request_sequence",
      "last_acknowledged_event_sequence",
      "last_canonical_response_bytes",
      "last_canonical_response_digest",
      "safety_epoch",
    ]);
    expect(await getAccountCoordinatorStatusV1(storage)).toEqual({ mode: "DRY_RUN", last_request_sequence: 1 });
    expect(storage.values.get("heartbeat_summary")).toEqual({
      observed_at_epoch: 1_787_472_010,
      terminal_connection_state: "CONNECTED",
      account_trade_permission: "DENIED",
      terminal_trade_permission: "DENIED",
      algo_trading_permission: "DENIED",
    });
  });

  it("defines an append-only redacted agent sync audit migration", async () => {
    const migration = await readFile(new URL("../migrations/0001_agent_sync.sql", import.meta.url), "utf8");

    expect(migration).toMatch(/CREATE TABLE agent_sync_audit_v1/u);
    for (const column of [
      "audit_id", "account_id", "installation_id", "request_sequence", "request_body_sha256",
      "result_code", "server_sequence", "received_at_epoch",
    ]) expect(migration).toMatch(new RegExp(`\\b${column}\\b`, "u"));
    expect(migration).not.toMatch(/bearer|credential|password|login|price|order|payload/iu);
    expect(migration).toMatch(/CREATE TRIGGER agent_sync_audit_v1_no_update[\s\S]*BEFORE UPDATE ON agent_sync_audit_v1[\s\S]*RAISE\(ABORT/u);
    expect(migration).toMatch(/CREATE TRIGGER agent_sync_audit_v1_no_delete[\s\S]*BEFORE DELETE ON agent_sync_audit_v1[\s\S]*RAISE\(ABORT/u);
  });

  it("envelopes internal coordinator sync outcomes and errors as dry-run null-command bodies", async () => {
    const coordinator = new AccountCoordinatorV1({ storage: new MemoryStorage() } as unknown as DurableObjectState);
    const invalid = await coordinator.fetch(new Request("https://account-coordinator.internal/not-a-route"));
    const accepted = await coordinator.fetch(new Request("https://account-coordinator.internal/sync", {
      method: "POST",
      body: JSON.stringify({ request: request(), now_epoch: 1_787_472_010 }),
    }));

    expect(await invalid.json()).toMatchObject({ code: "COORDINATOR_INVALID", mode: "DRY_RUN", command: null });
    expect(await accepted.json()).toMatchObject({ code: "OK", mode: "DRY_RUN", command: null });
  });
});
