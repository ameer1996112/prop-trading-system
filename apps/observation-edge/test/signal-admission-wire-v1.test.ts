import { describe, expect, it } from "vitest";
import { parseAdmissionTransport } from "../src/signal-admission-wire-v1";
import admissionVectors from "../../../contracts/vectors/signal-admission-v1.json";
import evidenceVectors from "../../../contracts/vectors/signal-evidence-v1.json";

const encode = (value: string) => new TextEncoder().encode(value);
const request = (credential = "local-test-credential") => JSON.stringify({
  schema_version: "TradeOpsSignalAdmissionRequestV1", credential,
  registration_id: "registration-one", generation: 2,
  evidence: { schema_version: "TradeOpsSignalEvidenceInputV1", observation: {
    producer_instance_id: "pine-evidence-v1", producer_sequence: 7,
    strategy_id: "rd_liquidity_sd_5m_v1",
  }, formations: [] },
});

describe("signal admission transport v1", () => {
  it("parses a closed credential-free transport identity", async () => {
    const parsed = await parseAdmissionTransport(encode(request()));
    expect(parsed).toMatchObject({ registrationId: "registration-one", generation: 2,
      sequence: 7, producerInstanceId: "pine-evidence-v1", strategyId: "rd_liquidity_sd_5m_v1" });
    expect(parsed.credential).toBe("local-test-credential");
    expect(parsed.bodySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(new TextDecoder().decode(parsed.evidenceBytes)).toBe('{"formations":[],"observation":{"producer_instance_id":"pine-evidence-v1","producer_sequence":7,"strategy_id":"rd_liquidity_sd_5m_v1"},"schema_version":"TradeOpsSignalEvidenceInputV1"}');
  });

  it("does not accept a duplicate outer identity", async () => {
    await expect(parseAdmissionTransport(encode('{"registration_id":"one","registration_id":"two"}'))).rejects.toThrow();
  });

  it.each([
    ["unknown field", request().replace('"evidence":', '"extra":true,"evidence":')],
    ["fraction", request().replace('"generation":2', '"generation":2.0')],
    ["exponent", request().replace('"producer_sequence":7', '"producer_sequence":7e0')],
    ["negative zero", request().replace('"generation":2', '"generation":-0')],
    ["unsafe integer", request().replace('"generation":2', '"generation":9007199254740992')],
  ])("rejects %s", async (_name, raw) => {
    await expect(parseAdmissionTransport(encode(raw))).rejects.toThrow();
  });

  it("rejects malformed UTF-8 and the outer cap", async () => {
    await expect(parseAdmissionTransport(new Uint8Array([0xc3, 0x28]))).rejects.toThrow();
    await expect(parseAdmissionTransport(new Uint8Array(278_529))).rejects.toThrow();
  });

  it("makes credential rotation body-hash neutral and copies evidence", async () => {
    const firstBytes = encode(request("local-test-one"));
    const first = await parseAdmissionTransport(firstBytes);
    const second = await parseAdmissionTransport(encode(request("local-test-two")));
    firstBytes.fill(0);
    expect(first.bodySha256).toBe(second.bodySha256);
    expect(new TextDecoder().decode(first.evidenceBytes)).toContain("TradeOpsSignalEvidenceInputV1");
  });

  it("matches all nine admission vectors without changing source evidence", async () => {
    expect(admissionVectors.cases).toHaveLength(9);
    for (const vector of admissionVectors.cases) {
      const source = evidenceVectors.cases.find(item => item.case_id === vector.source_case_id)!;
      const raw = encode(JSON.stringify({ schema_version: "TradeOpsSignalAdmissionRequestV1",
        credential: admissionVectors.credential, registration_id: admissionVectors.registration_id,
        generation: admissionVectors.generation, evidence: source.input }));
      if (vector.accepted) expect((await parseAdmissionTransport(raw)).bodySha256).toBe(vector.body_sha256);
      else await expect(parseAdmissionTransport(raw)).rejects.toThrow();
    }
  });
});
