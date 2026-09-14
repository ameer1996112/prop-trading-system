import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateSignalEvidenceV1 } from "../src/signal-evidence-v1";

// Literal wire examples + real bytes validation, supplemented by source guards.
// This suite does not execute Pine and cannot establish native compilation.
type Formation = { setup_id: string; origin_epoch: number; confirmation_epoch: number; direction: string; variant: string; origin_open_ticks: number; origin_high_ticks: number; origin_low_ticks: number; origin_close_ticks: number; formation_source_id: string };
type Vector = { case_id: string; input: { schema_version: string; observation: { producer_instance_id: string; producer_sequence: number; event_id: string; tick_size: string; [key: string]: unknown }; formations: Formation[] }; reviewed_binding: unknown; expected: { attempt_key: string; formation_body_sha256: string; evidence_id: string; evidence_body_sha256: string } };
const vectors = JSON.parse(readFileSync(new URL("../../../contracts/vectors/signal-evidence-v1.json", import.meta.url), "utf8")) as { cases: Vector[] };
const source = readFileSync(new URL("../../../scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine", import.meta.url), "utf8");
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("Pine signal evidence source/fixture parity (not native execution)", () => {
  it("declares a default-off stream and a credential-free three-key envelope", () => {
    expect(source).toContain('emitSignalEvidenceV1 = input.bool(false,');
    const envelope = source.match(/^signalEvidenceV1Envelope\([^\n]+\) =>\n([\s\S]*?)(?=\n\S)/m)?.[1];
    expect(envelope).toBeDefined();
    expect([...envelope!.matchAll(/\\"([a-z_]+)\\":/g)].map(m => m[1])).toEqual(["schema_version", "observation", "formations"]);
    expect(envelope).not.toMatch(/credential/i);
  });

  it.each(vectors.cases)("validates the complete literal $case_id envelope and hashes", async v => {
    const result = await validateSignalEvidenceV1(encode(v.input), encode(v.reviewed_binding));
    expect(result.status).toBe("VALIDATED");
    if (result.status !== "VALIDATED") throw new Error(result.code);
    expect(result.entries[0]).toMatchObject(v.expected);
    expect(result.entries[0]!.formation).toMatchObject(v.input.formations[0]!);
    expect(result.execution_allowed).toBe(false);
  });

  it.each([
    ["strict_long_boc_only", "BOC"],
    ["close_fallback_after_blocked_aggressive_models", "DIR_CLOSE"],
    ["flip_before_boc", "HTF_FLIP"],
    ["strict_short_boc_only", "BOC"],
    ["close_fallback_after_blocked_aggressive_models_short", "DIR_CLOSE"],
    ["flip_before_boc_short", "HTF_FLIP"],
  ])("accepts %s with the independent Pine delivery identity", async (id, model) => {
    const v = vectors.cases.find(item => item.case_id === id)!;
    const input = structuredClone(v.input);
    input.observation.producer_instance_id = "signal-evidence-v1:isolated-test:1789380000000";
    input.observation.producer_sequence = 1;
    input.observation.event_id = "signal-evidence-v1:isolated-test:1789380000000:1";
    const result = await validateSignalEvidenceV1(encode(input), encode(v.reviewed_binding));
    expect(result.status).toBe("VALIDATED");
    if (result.status !== "VALIDATED") throw new Error(result.code);
    expect(result.entries[0]!.selected?.candidate.model).toBe(model);
    expect(result.entries[0]!.attempt_key).toBe(v.expected.attempt_key);
    expect(result.entries[0]!.formation_body_sha256).toBe(v.expected.formation_body_sha256);
    expect(result.entries[0]!.evidence_id).not.toBe(v.expected.evidence_id);
    expect(result.authority).toBe("EVIDENCE_ONLY");
  });

  it.each([
    { id: "strict_long_boc_only", originMs: 300000, confirmationMs: 600000, prices: ["0.00103", "0.00103", "0.00097", "0.00097"], ticks: [103, 103, 97, 97] },
    { id: "strict_short_boc_only", originMs: 300000, confirmationMs: 600000, prices: ["0.00097", "0.00103", "0.00097", "0.00103"], ticks: [97, 103, 97, 103] },
    { id: "flip_before_boc_short", originMs: 300000, confirmationMs: 600000, prices: ["0.00897", "0.00903", "0.00897", "0.00903"], ticks: [897, 903, 897, 903] },
  ])("documents exact frozen RawZone units for $id", async example => {
    const v = vectors.cases.find(item => item.case_id === example.id)!;
    const formation = v.input.formations[0]!;
    // Independent decimal integer arithmetic for literal five-place prices.
    // No floating-point rounding or detector/arbitration model is replicated.
    expect(v.input.observation.tick_size).toBe("0.00001");
    expect(example.prices.map(price => Number(BigInt(price.replace(".", ""))))).toEqual(example.ticks);
    expect([formation.origin_open_ticks, formation.origin_high_ticks, formation.origin_low_ticks, formation.origin_close_ticks]).toEqual(example.ticks);
    expect(example.originMs % 1000).toBe(0);
    expect(example.confirmationMs % 1000).toBe(0);
    expect(formation.origin_epoch).toBe(example.originMs / 1000);
    expect(formation.confirmation_epoch).toBe(example.confirmationMs / 1000);
    expect((await validateSignalEvidenceV1(encode(v.input), encode(v.reviewed_binding))).status).toBe("VALIDATED");
  });

  it("rejects fractional seconds and tick facts at the actual strict bytes boundary", async () => {
    const v = vectors.cases[0]!;
    for (const patch of [{ origin_epoch: 300.001 }, { origin_open_ticks: 103.5 }, { confirmation_epoch: 601 }]) {
      const input = structuredClone(v.input);
      Object.assign(input.formations[0]!, patch);
      expect(await validateSignalEvidenceV1(encode(input), encode(v.reviewed_binding))).toEqual({ status: "REJECTED", code: "INVALID_FORMATION" });
    }
  });
});
