import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  deriveSignalEvidenceIdentityV1,
  validateSignalEvidenceFormationsV1,
} from "../src/signal-evidence-identity-v1";
import { parseStrictJson } from "../src/strict-json";

const bytes = (value: string) => new TextEncoder().encode(value);
const parse = (value: string) => parseStrictJson(bytes(value));
const setup = {
  setup_id: "chart-17",
  direction: "LONG" as const,
  zone_top_ticks: 105,
  zone_bottom_ticks: 90,
  zone_engaged_epoch: 1_800,
};
const descriptor = (overrides: Record<string, string | number> = {}) =>
  JSON.stringify({
    setup_id: "chart-17",
    origin_epoch: 900,
    confirmation_epoch: 1_200,
    direction: "LONG",
    variant: "STANDARD",
    origin_open_ticks: 100,
    origin_high_ticks: 105,
    origin_low_ticks: 90,
    origin_close_ticks: 95,
    formation_source_id: "full:diagnostic:formation:17",
    ...overrides,
  });

describe("signal evidence formation validation", () => {
  it("accepts literal strict JSON tokens and derives frozen STANDARD geometry", () => {
    const result = validateSignalEvidenceFormationsV1(
      parse(`[${descriptor()}]`),
      [setup],
    );
    expect(result).toEqual([{
      setup_id: "chart-17",
      origin_epoch: 900,
      confirmation_epoch: 1_200,
      direction: "LONG",
      variant: "STANDARD",
      origin_open_ticks: 100,
      origin_high_ticks: 105,
      origin_low_ticks: 90,
      origin_close_ticks: 95,
      zone_top_ticks: 105,
      zone_bottom_ticks: 90,
      formation_source_id: "full:diagnostic:formation:17",
    }]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
  });

  it("rejects unknown and missing descriptor keys", () => {
    expect(() => validateSignalEvidenceFormationsV1(
      parse(`[${descriptor({ account_id: "forbidden" })}]`), [setup],
    )).toThrow(TypeError);
    const missing = descriptor().replace(',"variant":"STANDARD"', "");
    expect(() => validateSignalEvidenceFormationsV1(parse(`[${missing}]`), [setup]))
      .toThrow(TypeError);
  });

  it.each(["900.0", "9e2", "9007199254740992", "0", "-300"])(
    "rejects non-strict, unsafe or non-positive epoch token %s",
    (token) => {
      const raw = descriptor().replace('"origin_epoch":900', `"origin_epoch":${token}`);
      expect(() => validateSignalEvidenceFormationsV1(parse(`[${raw}]`), [setup]))
        .toThrow();
    },
  );

  it.each([
    "confirmation_epoch", "origin_open_ticks", "origin_high_ticks",
    "origin_low_ticks", "origin_close_ticks",
  ])("rejects non-integer strict-number spelling for %s", (field) => {
    const raw = descriptor().replace(
      new RegExp(`"${field}":(?:1200|100|105|90|95)`),
      `"${field}":1e3`,
    );
    expect(() => validateSignalEvidenceFormationsV1(parse(`[${raw}]`), [setup]))
      .toThrow(TypeError);
  });

  it.each([
    { origin_low_ticks: 100 },
    { origin_high_ticks: 100 },
    { origin_open_ticks: 89 },
    { origin_close_ticks: 106 },
    { origin_close_ticks: 100 },
  ])("rejects invalid LONG OHLC or origin direction: %o", (change) => {
    expect(() => validateSignalEvidenceFormationsV1(
      parse(`[${descriptor(change)}]`), [setup],
    )).toThrow(TypeError);
  });

  it("validates SHORT direction and ACCURACY geometry exactly", () => {
    const shortSetup = { ...setup, direction: "SHORT" as const, zone_top_ticks: 105, zone_bottom_ticks: 100 };
    const valid = descriptor({ direction: "SHORT", variant: "ACCURACY", origin_close_ticks: 102 });
    expect(validateSignalEvidenceFormationsV1(parse(`[${valid}]`), [shortSetup])[0])
      .toMatchObject({ zone_top_ticks: 105, zone_bottom_ticks: 100 });
    expect(() => validateSignalEvidenceFormationsV1(
      parse(`[${descriptor({ direction: "SHORT", variant: "ACCURACY", origin_close_ticks: 102 })}]`),
      [{ ...shortSetup, zone_bottom_ticks: 99 }],
    )).toThrow(TypeError);
  });

  it("validates LONG ACCURACY geometry and rejects incorrect STANDARD bounds", () => {
    const accuracySetup = { ...setup, zone_top_ticks: 100 };
    expect(validateSignalEvidenceFormationsV1(
      parse(`[${descriptor({ variant: "ACCURACY" })}]`), [accuracySetup],
    )[0]).toMatchObject({ zone_top_ticks: 100, zone_bottom_ticks: 90 });
    expect(() => validateSignalEvidenceFormationsV1(
      parse(`[${descriptor()}]`), [{ ...setup, zone_top_ticks: 104 }],
    )).toThrow(TypeError);
  });

  it.each([
    { origin_epoch: 901 },
    { confirmation_epoch: 1_201 },
    { confirmation_epoch: 900 },
    { confirmation_epoch: 2_100 },
  ])("rejects misalignment or invalid chronology: %o", (change) => {
    expect(() => validateSignalEvidenceFormationsV1(
      parse(`[${descriptor(change)}]`), [setup],
    )).toThrow(TypeError);
  });

  it("requires exact one-to-one descriptor coverage by setup ID", () => {
    expect(() => validateSignalEvidenceFormationsV1(
      parse(`[${descriptor()},${descriptor()}]`), [setup],
    )).toThrow(TypeError);
    expect(() => validateSignalEvidenceFormationsV1(
      parse(`[${descriptor({ setup_id: "unmatched" })}]`), [setup],
    )).toThrow(TypeError);
    expect(() => validateSignalEvidenceFormationsV1(parse("[]"), [setup]))
      .toThrow(TypeError);
  });

  it("returns formations in explicit setup_id code-unit order", () => {
    const firstSetup = { ...setup, setup_id: "A-setup" };
    const lastSetup = { ...setup, setup_id: "z-setup" };
    const result = validateSignalEvidenceFormationsV1(
      parse(`[${descriptor({ setup_id: "z-setup" })},${descriptor({ setup_id: "A-setup" })}]`),
      [lastSetup, firstSetup],
    );
    expect(result.map((item) => item.setup_id)).toEqual(["A-setup", "z-setup"]);
  });
});

describe("signal evidence stable identity", () => {
  const vector = JSON.parse(readFileSync(fileURLToPath(new URL(
    "../../../contracts/vectors/signal-evidence-identity-v1.json",
    import.meta.url,
  )), "utf8")) as {
    attempt_preimage: string;
    attempt_key: string;
    formation_preimage: string;
    formation_body_sha256: string;
    evidence_preimage: string;
    evidence_id: string;
  };
  const base = {
    strategy_id: "rd_liquidity_sd_5m_v1",
    ticker_id: "OANDA:XAUUSD",
    feed: "OANDA",
    producer_namespace: "tradeops.reviewed.signal-evidence",
    producer_instance_id: "pine-instance-a",
    event_id: "event-42",
    producer_sequence: 7,
    tick_size: "0.01",
    formation: {
      setup_id: "chart-17", origin_epoch: 900, confirmation_epoch: 1200,
      direction: "LONG" as const, variant: "STANDARD" as const,
      origin_open_ticks: 100, origin_high_ticks: 105, origin_low_ticks: 90,
      origin_close_ticks: 95, zone_top_ticks: 105, zone_bottom_ticks: 90,
      formation_source_id: "full:diagnostic:formation:17",
    },
  };

  it("matches independently fixed literal canonical SHA-256 vectors", async () => {
    for (const [preimage, digest] of [
      [vector.attempt_preimage, vector.attempt_key],
      [vector.formation_preimage, vector.formation_body_sha256],
      [vector.evidence_preimage, vector.evidence_id],
    ] as const) {
      expect(createHash("sha256").update(preimage).digest("hex")).toBe(digest);
    }
    expect(await deriveSignalEvidenceIdentityV1(base)).toEqual({
      attempt_key: vector.attempt_key,
      formation_body_sha256: vector.formation_body_sha256,
      evidence_id: vector.evidence_id,
    });
  });

  it("keeps attempt identity independent of chart, diagnostics, producer, model and settings", async () => {
    const original = await deriveSignalEvidenceIdentityV1(base);
    for (const change of [
      { formation: { ...base.formation, setup_id: "chart-99" } },
      { formation: { ...base.formation, formation_source_id: "different" } },
      { producer_instance_id: "reloaded" },
      { selected_model: "HTF_FLIP" },
      { settings_hash: "f".repeat(64) },
    ]) {
      expect((await deriveSignalEvidenceIdentityV1({ ...base, ...change })).attempt_key)
        .toBe(original.attempt_key);
    }
  });

  it("separates evidence transport identity and immutable formation conflicts", async () => {
    const original = await deriveSignalEvidenceIdentityV1(base);
    for (const change of [
      { producer_namespace: "other.namespace" },
      { producer_instance_id: "other-instance" },
      { event_id: "other-event" },
      { producer_sequence: 8 },
    ]) expect((await deriveSignalEvidenceIdentityV1({ ...base, ...change })).evidence_id)
      .not.toBe(original.evidence_id);

    for (const formationChange of [
      { origin_open_ticks: 99 }, { zone_top_ticks: 106 },
    ]) {
      const changed = await deriveSignalEvidenceIdentityV1({
        ...base, formation: { ...base.formation, ...formationChange },
      });
      expect(changed.attempt_key).toBe(original.attempt_key);
      expect(changed.formation_body_sha256).not.toBe(original.formation_body_sha256);
    }
    const setupOnly = await deriveSignalEvidenceIdentityV1({
      ...base, formation: { ...base.formation, setup_id: "other" },
    });
    expect(setupOnly.formation_body_sha256).toBe(original.formation_body_sha256);
  });

  it.each([
    { direction: "SHORT" as const },
    { variant: "ACCURACY" as const },
    { origin_epoch: 300 },
    { confirmation_epoch: 1_500 },
  ])("changes attempt identity for economic formation field %o", async (change) => {
    const original = await deriveSignalEvidenceIdentityV1(base);
    const changed = await deriveSignalEvidenceIdentityV1({
      ...base, formation: { ...base.formation, ...change },
    });
    expect(changed.attempt_key).not.toBe(original.attempt_key);
  });
});
