import { describe, expect, it } from "vitest";
import { authenticateRegistration, readRegistration } from "../src/signal-admission-registration-v1";
import type { Transport } from "../src/signal-admission-wire-v1";

const encoder = new TextEncoder();
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), b => b.toString(16).padStart(2, "0")).join("");
const binding = { schema_version: "TradeOpsSignalEvidenceBindingV1", producer_namespace: "tradeops.signal-evidence", ticker_id: "OANDA:EURUSD", feed: "OANDA", symbol: "EURUSD", tick_size: "0.00001", detector_code_hash: "a".repeat(64), settings_hash: "b".repeat(64) };
const scopeKey = '{"producer_namespace":"tradeops.signal-evidence","strategy_id":"rd_liquidity_sd_5m_v1","ticker_id":"OANDA:EURUSD"}';
async function registry(overrides: Record<string, unknown> = {}) {
  return encoder.encode(JSON.stringify({ schema_version: "TradeOpsSignalAdmissionRegistrationV1", registration_id: "registration-one", generation: 2, revision: 1, scope_key: scopeKey, producer_instance_id: "pine-evidence-v1", credential_sha256: await sha256("local-test-credential"), reviewed_binding: binding, active_from: 100, active_until: 200, enabled: true, freshness: { max_event_age_seconds: 60, max_observation_age_seconds: 30, future_skew_seconds: 0, max_queue_age_seconds: 20 }, ...overrides }));
}
const transport = (): Transport => ({ registrationId: "registration-one", generation: 2, credential: "local-test-credential", evidenceBytes: new Uint8Array(), sequence: 1, producerInstanceId: "pine-evidence-v1", strategyId: "rd_liquidity_sd_5m_v1", bodySha256: "c".repeat(64) });

describe("signal admission registration v1", () => {
  it("reads a closed registration and canonical binding bytes", async () => {
    const value = readRegistration(await registry());
    expect(value).toMatchObject({ registrationId: "registration-one", scopeKey, generation: 2, revision: 1, enabled: true });
    expect(new TextDecoder().decode(value!.bindingBytes)).toBe('{"detector_code_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","feed":"OANDA","producer_namespace":"tradeops.signal-evidence","schema_version":"TradeOpsSignalEvidenceBindingV1","settings_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","symbol":"EURUSD","tick_size":"0.00001","ticker_id":"OANDA:EURUSD"}');
  });

  it("fails authentication without a registered producer", async () => {
    expect(await authenticateRegistration({} as Transport, null, 100)).toBe(false);
  });

  it.each([
    ["bad digest", { credential_sha256: "A".repeat(64) }], ["unknown field", { unknown: true }],
    ["zero freshness", { freshness: { max_event_age_seconds: 0, max_observation_age_seconds: 30, future_skew_seconds: 0, max_queue_age_seconds: 20 } }],
    ["wrong namespace scope", { scope_key: scopeKey.replace("tradeops.signal-evidence", "other") }],
    ["fractional revision", { revision: 1.5 }],
    ["invalid binding digest", { reviewed_binding: { ...binding, detector_code_hash: "0".repeat(64) } }],
    ["invalid binding tick size", { reviewed_binding: { ...binding, tick_size: "0.000010" } }],
  ])("rejects %s", async (_name, change) => expect(readRegistration(await registry(change))).toBeNull());

  it("rejects duplicate keys and invalid UTF-8", () => {
    expect(readRegistration(encoder.encode('{"schema_version":"x","schema_version":"y"}'))).toBeNull();
    expect(readRegistration(new Uint8Array([0xc3, 0x28]))).toBeNull();
  });

  it("authenticates only exact active registration identity", async () => {
    const value = readRegistration(await registry())!;
    expect(await authenticateRegistration(transport(), value, 100)).toBe(true);
    expect(await authenticateRegistration(transport(), value, 200)).toBe(false);
    expect(await authenticateRegistration({ ...transport(), credential: "wrong" }, value, 150)).toBe(false);
    expect(await authenticateRegistration({ ...transport(), generation: 3 }, value, 150)).toBe(false);
    expect(await authenticateRegistration({ ...transport(), producerInstanceId: "wrong" }, value, 150)).toBe(false);
    expect(await authenticateRegistration({ ...transport(), strategyId: "wrong" }, value, 150)).toBe(false);
    expect(await authenticateRegistration(transport(), { ...value, enabled: false }, 150)).toBe(false);
  });
});
