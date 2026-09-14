import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateSignalEvidenceV1, type ReviewedBindingV1, type SignalEvidenceRejectCodeV1 } from "../src/signal-evidence-v1";
import type { EntryCandidateV3, EntryCandidateEvidenceV3, EntrySelectionV3, SetupEntryFactsV3 } from "../src/rd-entry-domain-v3";
import type { EntryV3CommonRuleResult, EntryV3MarketEvent, EntryV3TradePlan, EntryV3ExitEvent } from "../src/rd-entry-wire-v3";

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
type Bundle = { setup: Mutable<SetupEntryFactsV3> & { common_rule_results: Mutable<EntryV3CommonRuleResult>[] }; candidates: Mutable<EntryCandidateV3>[]; evidence: Mutable<EntryCandidateEvidenceV3>[]; selection_proposal: Mutable<EntrySelectionV3>; trade_plan: Mutable<EntryV3TradePlan> };
type Input = { schema_version: string; observation: { schema_version: string; strategy_version: string; rule_contract_version: string; producer_sequence: number; event_id: string; is_realtime: boolean; tick_size: string; detector_code_hash: string; settings_hash: string; market_event: Mutable<EntryV3MarketEvent>; observed_at_epoch: number; setups: Bundle[]; exit_events: EntryV3ExitEvent[]; [key: string]: unknown }; formations: Array<{ setup_id: string; origin_epoch: number; confirmation_epoch: number; direction: string; variant: string; origin_open_ticks: number; origin_high_ticks: number; origin_low_ticks: number; origin_close_ticks: number; formation_source_id: string }> };
type Vector = { case_id: string; input: Input; reviewed_binding: ReviewedBindingV1; canonical_preimages: { attempt: string; formation: string; evidence_id: string; evidence_body: string }; expected: { attempt_key: string; formation_body_sha256: string; evidence_id: string; evidence_body_sha256: string } };
const vectors = JSON.parse(readFileSync(new URL("../../../contracts/vectors/signal-evidence-v1.json", import.meta.url), "utf8")) as { cases: Vector[] };
const bytes = (value: string) => new TextEncoder().encode(value);
const encode = (value: unknown) => bytes(JSON.stringify(value));
const fixture = (id = "strict_long_boc_only") => structuredClone(vectors.cases.find(v => v.case_id === id)!.input);
const reviewed = vectors.cases[0]!.reviewed_binding;
const run = (input: Input, binding: unknown = reviewed) => validateSignalEvidenceV1(encode(input), encode(binding));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(k => `${JSON.stringify(k)}:${canonical(object[k])}`).join(",")}}`;
}
function edgeDerived(input: Input): Input {
  for (const b of input.observation.setups) {
    const byId = new Map(b.candidates.map(c => [c.candidate_id, c.model]));
    for (const e of b.evidence) {
      e.candidate_id = `EDGE_DERIVED:${byId.get(e.candidate_id)}`;
      e.evidence_id = e.candidate_id;
      e.payload_sha256 = "EDGE_DERIVED";
    }
    for (const c of b.candidates) c.candidate_id = `EDGE_DERIVED:${c.model}`;
    const s = b.selection_proposal;
    s.selection_id = "EDGE_DERIVED";
    s.candidate_ids_considered = b.candidates.map(c => c.candidate_id).sort();
    s.canonical_candidate_id = s.canonical_model === null ? null : `EDGE_DERIVED:${s.canonical_model}`;
    s.canonical_evidence_id = s.canonical_candidate_id;
  }
  return input;
}
function unselected(): Input {
  const input = edgeDerived(fixture());
  const b = input.observation.setups[0]!;
  b.candidates = [];
  b.evidence = [];
  Object.assign(b.selection_proposal, { candidate_ids_considered: [], canonical_candidate_id: null, canonical_evidence_id: null, canonical_model: null, fidelity: null, reason: "NO_CANDIDATE", action: "NONE", co_triggered_models: [] });
  return input;
}
function twoSetups(): Input {
  const input = edgeDerived(fixture("boc_flip_same_event"));
  const second = structuredClone(input.observation.setups[0]!);
  second.setup.setup_id = "!second-setup";
  second.setup.zone_engaged_epoch = 1200;
  second.candidates.forEach(c => { c.setup_id = second.setup.setup_id; });
  second.selection_proposal.setup_id = second.setup.setup_id;
  input.observation.setups.push(second);
  input.formations.push({ ...input.formations[0]!, setup_id: second.setup.setup_id, confirmation_epoch: 900, formation_source_id: "second-formation" });
  return input;
}

// Keep every inner field valid while reaching the existing wire limit. Setup
// IDs occur twice in the observation, so event_id fills the final odd byte.
function observationLength(target: number): Input {
  const input = unselected();
  input.observation.observed_at_epoch = 100000;
  input.observation.market_event.epoch = 100000;
  input.observation.setups[0]!.selection_proposal.evaluated_at_epoch = 100000;
  input.observation.setups[0]!.setup.zone_engaged_epoch = 100000;
  const template = structuredClone(input.observation.setups[0]!);
  while (true) {
    const next = structuredClone(template);
    next.setup.setup_id = `setup-${input.observation.setups.length}`;
    next.selection_proposal.setup_id = next.setup.setup_id;
    input.observation.setups.push(next);
    if (JSON.stringify(input.observation).length > target) { input.observation.setups.pop(); break; }
  }
  for (const b of input.observation.setups) {
    const remaining = target - JSON.stringify(input.observation).length;
    const count = Math.min(256 - b.setup.setup_id.length, Math.floor(remaining / 2));
    b.setup.setup_id += "x".repeat(count);
    b.selection_proposal.setup_id = b.setup.setup_id;
  }
  input.observation.event_id += "x".repeat(target - JSON.stringify(input.observation).length);
  input.formations = input.observation.setups.map((b, index) => ({ ...input.formations[0]!, setup_id: b.setup.setup_id, confirmation_epoch: 600 + index * 300 }));
  return input;
}
async function rejected(input: Input, code: SignalEvidenceRejectCodeV1, binding: unknown = reviewed) {
  const result = await run(input, binding);
  expect(result).toEqual({ status: "REJECTED", code });
  expect(Object.isFrozen(result)).toBe(true);
}
function assertFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertFrozen);
}

describe("signal evidence literal vectors", () => {
  it.each(vectors.cases)("validates $case_id against independent literal preimages", async v => {
    const result = await run(v.input, v.reviewed_binding);
    expect(result.status).toBe("VALIDATED");
    if (result.status !== "VALIDATED") throw new Error(result.code);
    const entry = result.entries[0]!;
    expect(result.entries).toHaveLength(1);
    expect(result.authority).toBe("EVIDENCE_ONLY");
    expect(result.execution_allowed).toBe(false);
    expect(entry.status).toBe(v.case_id === "same_event_price_conflict" ? "NO_CANDIDATE" : "SELECTED");
    expect(entry.attempt_key).toBe(v.expected.attempt_key);
    expect(entry.formation_body_sha256).toBe(v.expected.formation_body_sha256);
    expect(entry.evidence_id).toBe(v.expected.evidence_id);
    expect(entry.evidence_body_sha256).toBe(v.expected.evidence_body_sha256);
    expect(hash(v.canonical_preimages.attempt)).toBe(v.expected.attempt_key);
    expect(hash(v.canonical_preimages.formation)).toBe(v.expected.formation_body_sha256);
    expect(hash(v.canonical_preimages.evidence_id)).toBe(v.expected.evidence_id);
    expect(hash(v.canonical_preimages.evidence_body)).toBe(v.expected.evidence_body_sha256);
    const { evidence_body_sha256: _, ...body } = entry;
    expect(canonical(body)).toBe(v.canonical_preimages.evidence_body);
    assertFrozen(result);
  });

  it("copies both byte arrays before await and completely detaches/freezes the result", async () => {
    const input = encode(fixture());
    const config = encode(reviewed);
    const pending = validateSignalEvidenceV1(input, config);
    input.fill(0); config.fill(0);
    const result = await pending;
    expect(result).toEqual(await run(fixture()));
    assertFrozen(result);
  });

  it("has identical retry bytes", async () => {
    const input = fixture("boc_flip_same_event");
    expect(canonical(await run(input))).toBe(canonical(await run(input)));
  });

  it("normalizes all documented unordered arrays, including nested source setup bundles", async () => {
    const first = twoSetups();
    const reordered = structuredClone(first);
    reordered.formations.reverse();
    reordered.observation.setups.reverse();
    for (const b of reordered.observation.setups) {
      b.candidates.reverse(); b.evidence.reverse();
      b.selection_proposal.candidate_ids_considered.reverse();
      b.selection_proposal.co_triggered_models.reverse();
    }
    const baseline = await run(first);
    expect(baseline.status).toBe("VALIDATED");
    expect(await run(reordered)).toEqual(baseline);
    if (baseline.status !== "VALIDATED") throw new Error(baseline.code);
    expect(baseline.entries.map(e => e.formation.setup_id)).toEqual(["!second-setup", first.formations[0]!.setup_id]);
    expect((baseline.entries[0]!.source_observation.setups as unknown as Bundle[]).map(b => b.setup.setup_id)).toEqual(baseline.entries.map(e => e.formation.setup_id));
  });

  it("diagnostic changes alter the body digest without changing economic identity", async () => {
    const original = fixture();
    const modified = fixture();
    modified.formations[0]!.formation_source_id = "diagnostic:new-full-id";
    const a = await run(original), b = await run(modified);
    if (a.status !== "VALIDATED" || b.status !== "VALIDATED") throw new Error("fixture rejected");
    expect(b.entries[0]!.attempt_key).toBe(a.entries[0]!.attempt_key);
    expect(b.entries[0]!.formation_body_sha256).toBe(a.entries[0]!.formation_body_sha256);
    expect(b.entries[0]!.evidence_id).toBe(a.entries[0]!.evidence_id);
    expect(b.entries[0]!.evidence_body_sha256).not.toBe(a.entries[0]!.evidence_body_sha256);
    expect(b.entries[0]!.formation.formation_source_id).toBe("diagnostic:new-full-id");
  });

  it("preserves semantic rule-list ordering instead of silently sorting it", async () => {
    const input = fixture();
    input.observation.setups[0]!.setup.common_rule_results.reverse();
    await rejected(input, "INVALID_OBSERVATION");
  });

  it("preserves source claim order and complete candle lifecycle facts", async () => {
    const result = await run(fixture("flip_before_boc"));
    if (result.status !== "VALIDATED") throw new Error(result.code);
    const b = fixture("flip_before_boc").observation.setups[0]!;
    expect(result.entries[0]!.edge_evaluation.evidence).toEqual([...b.evidence].sort((a,b) => a.evidence_id < b.evidence_id ? -1 : 1));
  });
});

describe("signal evidence parser and binding boundary", () => {
  it.each(["0e0", "0.0", "1e0", "1.0"])("rejects non-integer observation token spelling %s", async token => {
    const input = JSON.stringify(fixture()).replace(/"producer_sequence":\d+/, `"producer_sequence":${token}`);
    expect(await validateSignalEvidenceV1(bytes(input), encode(reviewed))).toEqual({ status: "REJECTED", code: "INVALID_OBSERVATION" });
  });

  it.each(["300e0", "300.0"])("rejects non-integer formation token spelling %s", async token => {
    const input = JSON.stringify(fixture()).replace('"origin_epoch":300', `"origin_epoch":${token}`);
    expect(await validateSignalEvidenceV1(bytes(input), encode(reviewed))).toEqual({ status: "REJECTED", code: "INVALID_FORMATION" });
  });

  it.each([
    ["malformed", "{"],
    ["duplicate keys", '{"credential":"private","credential":"private"}'],
    ["escaped duplicate keys", '{"a":1,"\\u0061":2}'],
    ["unsafe integer", '{"n":9007199254740993}'],
    ["depth", "[".repeat(65) + "0" + "]".repeat(65)],
    ["nodes", "[" + "0,".repeat(20000) + "0]"],
  ])("returns only INVALID_JSON for %s under the byte limit", async (_label, json) => {
    expect(bytes(json!).length).toBeLessThan(262144);
    const result = await validateSignalEvidenceV1(bytes(json!), encode(reviewed));
    expect(result).toEqual({ status: "REJECTED", code: "INVALID_JSON" });
    assertFrozen(result);
  });

  it("rejects malformed UTF-8 in either byte input", async () => {
    const invalid = new Uint8Array([0xc3, 0x28]);
    expect(await validateSignalEvidenceV1(invalid, encode(reviewed))).toEqual({ status: "REJECTED", code: "INVALID_JSON" });
    expect(await validateSignalEvidenceV1(encode(fixture()), invalid)).toEqual({ status: "REJECTED", code: "INVALID_JSON" });
  });

  it("enforces byte limits with exact maximum accepted and maximum-plus-one rejected", async () => {
    const input = JSON.stringify(fixture()), config = JSON.stringify(reviewed);
    expect((await validateSignalEvidenceV1(bytes(input.padEnd(262144)), bytes(config.padEnd(4096)))).status).toBe("VALIDATED");
    expect(await validateSignalEvidenceV1(bytes(input.padEnd(262145)), encode(reviewed))).toEqual({ status: "REJECTED", code: "INPUT_SIZE" });
    expect(await validateSignalEvidenceV1(encode(fixture()), bytes(config.padEnd(4097)))).toEqual({ status: "REJECTED", code: "BINDING_SIZE" });
    expect(await validateSignalEvidenceV1(new Uint8Array(), encode(reviewed))).toEqual({ status: "REJECTED", code: "INPUT_SIZE" });
    expect(await validateSignalEvidenceV1(encode(fixture()), new Uint8Array())).toEqual({ status: "REJECTED", code: "BINDING_SIZE" });
  });

  it("preserves the nested observation limit at 34999 versus 35000 characters", async () => {
    for (const size of [34999, 35000]) {
      const input = observationLength(size);
      expect(JSON.stringify(input.observation).length).toBe(size);
      expect(encode(input).length).toBeLessThan(262144);
      if (size === 34999) expect((await run(input)).status).toBe("VALIDATED");
      else await rejected(input, "INVALID_OBSERVATION");
    }
  });

  it("rejects unsafe nested integer tokens and duplicate binding keys", async () => {
    const input = JSON.stringify(fixture()).replace('"origin_epoch":300', '"origin_epoch":9007199254740993');
    expect(await validateSignalEvidenceV1(bytes(input), encode(reviewed))).toEqual({ status: "REJECTED", code: "INVALID_JSON" });
    const config = JSON.stringify(reviewed).replace('"feed":"OANDA"', '"feed":"OANDA","feed":"private"');
    expect(await validateSignalEvidenceV1(encode(fixture()), bytes(config))).toEqual({ status: "REJECTED", code: "INVALID_JSON" });
  });

  it("rejects malformed envelope shape and missing or producer-embedded bindings", async () => {
    for (const input of [null, [], {}, { ...fixture(), reviewed_binding: reviewed }, { ...fixture(), formations: undefined }]) {
      expect(await validateSignalEvidenceV1(encode(input), encode(reviewed))).toEqual({ status: "REJECTED", code: "INVALID_ENVELOPE" });
    }
    const input = fixture(); input.schema_version = "TradeOpsSignalEvidenceV1";
    await rejected(input, "INVALID_ENVELOPE");
  });

  it("rejects producer UNREVIEWED, zero and mismatched digest values", async () => {
    const unreviewed = unselected();
    unreviewed.observation.detector_code_hash = "UNREVIEWED";
    unreviewed.observation.settings_hash = "UNREVIEWED";
    unreviewed.observation.setups[0]!.setup.common_fidelity = "UNRESOLVED";
    await rejected(unreviewed, "BINDING_MISMATCH");
    for (const key of ["detector_code_hash", "settings_hash"] as const) {
      const zero = fixture(); zero.observation[key] = "0".repeat(64);
      await rejected(zero, "INVALID_OBSERVATION");
      const mismatch = fixture(); mismatch.observation[key] = "c".repeat(64);
      await rejected(mismatch, "BINDING_MISMATCH");
    }
  });

  it.each(["schema_version", "strategy_version", "rule_contract_version"])("rejects unsupported tuple component %s", async key => {
    const input = fixture(); input.observation[key] = "3.0";
    await rejected(input, "UNSUPPORTED_OBSERVATION");
  });

  it.each(["ticker_id", "feed", "symbol", "tick_size", "detector_code_hash", "settings_hash"])("requires exact reviewed binding for %s", async key => {
    const other = key.endsWith("hash") ? "c".repeat(64) : key === "tick_size" ? "0.01" : "OTHER";
    await rejected(fixture(), "BINDING_MISMATCH", { ...reviewed, [key]: other });
  });

  it.each(["detector_code_hash", "settings_hash"])("rejects unreviewed, zero, uppercase and malformed binding %s", async key => {
    for (const value of ["UNREVIEWED", "0".repeat(64), "A".repeat(64), "a".repeat(63)]) await rejected(fixture(), "INVALID_BINDING", { ...reviewed, [key]: value });
  });

  it.each(["", "with space", "with\ncontrol", "é", "x".repeat(257)])("rejects invalid binding namespace %s", async value => {
    await rejected(fixture(), "INVALID_BINDING", { ...reviewed, producer_namespace: value });
  });

  it("requires separately supplied closed binding and canonical decimal tick", async () => {
    await rejected(fixture(), "INVALID_BINDING", {});
    await rejected(fixture(), "INVALID_BINDING", { ...reviewed, account: "secret" });
    await rejected(fixture(), "INVALID_BINDING", { ...reviewed, tick_size: "0.000010" });
    const equivalent = fixture(); equivalent.observation.tick_size = "0.000010";
    const a = await run(fixture()), b = await run(equivalent);
    if (a.status !== "VALIDATED" || b.status !== "VALIDATED") throw new Error("fixture rejected");
    expect(b.entries[0]!.formation_body_sha256).toBe(a.entries[0]!.formation_body_sha256);
    expect(b.entries[0]!.source_observation.tick_size).toBe("0.000010");
    expect(b.entries[0]!.evidence_body_sha256).not.toBe(a.entries[0]!.evidence_body_sha256);
  });

  it.each(["credential", "account", "order"])("rejects unknown %s at closed boundaries without echoing it", async key => {
    const input = fixture(); Object.assign(input, { [key]: "private-value" });
    await rejected(input, "INVALID_ENVELOPE");
    const observation = fixture(); observation.observation[key] = "private-value";
    await rejected(observation, "INVALID_OBSERVATION");
    const formation = fixture(); Object.assign(formation.formations[0]!, { [key]: "private-value" });
    await rejected(formation, "INVALID_FORMATION");
    const candidate = fixture(); Object.assign(candidate.observation.setups[0]!.candidates[0]!, { [key]: "private-value" });
    await rejected(candidate, "INVALID_OBSERVATION");
  });
});

describe("signal evidence strict policy and atomic batch behavior", () => {
  it("returns typed NO_CANDIDATE for a valid unselected setup without executable fields", async () => {
    const result = await run(unselected());
    if (result.status !== "VALIDATED") throw new Error(result.code);
    const entry = result.entries[0]!;
    expect(entry.status).toBe("NO_CANDIDATE"); expect(entry.selected).toBeNull();
    expect(entry.execution_allowed).toBe(false); expect(entry.authority).toBe("EVIDENCE_ONLY");
    for (const field of ["trade_plan", "account", "order", "volume", "entry_ticks", "stop_ticks", "target_ticks"]) expect(entry).not.toHaveProperty(field);
  });

  it("one_candle_enabled cannot change cohort admission", async () => {
    const allowed = fixture(); allowed.observation.setups[0]!.setup.one_candle_enabled = true;
    expect((await run(allowed)).status).toBe("VALIDATED");
    for (const enabled of [false, true]) {
      const input = edgeDerived(fixture());
      const b = input.observation.setups[0]!;
      b.setup.liquidity_cohort = "ONE_CANDLE"; b.setup.one_candle_enabled = enabled;
      b.setup.common_fidelity = "DISCRETIONARY";
      Object.assign(b.selection_proposal, { canonical_candidate_id: null, canonical_evidence_id: null, canonical_model: null, fidelity: null, reason: "ONE_CANDLE_EXPERIMENT_NOT_PROMOTED", action: "SHADOW_ONLY", co_triggered_models: [] });
      await rejected(input, enabled ? "INELIGIBLE_SOURCE" : "INVALID_OBSERVATION");
    }
  });

  it("rejects historical confirmed close, invalidation, absent engagement and inexact common facts", async () => {
    const historical = fixture("close_fallback_after_blocked_aggressive_models_short"); historical.observation.is_realtime = false;
    await rejected(historical, "INELIGIBLE_SOURCE");
    const invalidated = unselected(); invalidated.observation.setups[0]!.setup.invalidated_before_entry = true;
    await rejected(invalidated, "INELIGIBLE_SOURCE");
    const noEngagement = unselected(); noEngagement.observation.setups[0]!.setup.zone_engaged_epoch = null;
    await rejected(noEngagement, "INVALID_FORMATION");
    const inexact = unselected(); inexact.observation.setups[0]!.setup.common_fidelity = "CALIBRATED";
    await rejected(inexact, "INELIGIBLE_SOURCE");
    const rule = fixture(); rule.observation.setups[0]!.setup.common_rule_results[0]!.passed = false;
    await rejected(rule, "INVALID_OBSERVATION");
  });

  it("rejects exit followup even when the existing wire contract validates it", async () => {
    const input = fixture(); const b = input.observation.setups[0]!;
    input.observation.market_event = { epoch: 2400, sequence: 8, tick_price_ticks: b.trade_plan.stop_ticks, barstate_isconfirmed: false, confirmed_bar: null };
    input.observation.exit_events = [{ event_id: "exit:1", setup_id: b.setup.setup_id, exit_reason: "STOP_LOSS", epoch: 2400, sequence: 8, price_ticks: b.trade_plan.stop_ticks }];
    await rejected(input, "INELIGIBLE_SOURCE");
  });

  it.each(["strict_long_boc_only", "flip_before_boc", "close_fallback_after_blocked_aggressive_models_short"])("rejects selected replay proof for %s without relabeling it", async id => {
    const input = edgeDerived(fixture(id));
    const b = input.observation.setups[0]!;
    const selected = b.evidence.find(e => e.candidate_id === b.selection_proposal.canonical_candidate_id)!;
    selected.proof_plane = "LOWER_TIMEFRAME_REPLAY"; selected.replayability = "REPLAYABLE";
    await rejected(input, "INELIGIBLE_EVIDENCE");
  });

  it("does not fall back from the selected invalid flip proof to an eligible BOC", async () => {
    const input = edgeDerived(fixture("flip_before_boc"));
    const b = input.observation.setups[0]!;
    const flip = b.evidence.find(e => e.candidate_id === "EDGE_DERIVED:HTF_FLIP")!;
    flip.proof_plane = "EXTERNAL_ARCHIVED_TICK"; flip.replayability = "REPLAYABLE";
    expect(b.evidence.find(e => e.candidate_id === "EDGE_DERIVED:BOC")!.fidelity).toBe("EXACT");
    await rejected(input, "INELIGIBLE_EVIDENCE");
  });

  it("rejects crossing, confirmation and lifecycle tampering", async () => {
    const wrongCross = edgeDerived(fixture());
    wrongCross.observation.setups[0]!.evidence[0]!.reference_candle_high_ticks = 111;
    await rejected(wrongCross, "INVALID_OBSERVATION");
    const close = fixture("close_fallback_after_blocked_aggressive_models_short");
    close.observation.market_event.barstate_isconfirmed = false; close.observation.market_event.confirmed_bar = null;
    await rejected(close, "INVALID_OBSERVATION");
    const incomplete = edgeDerived(fixture("flip_before_boc_short")); incomplete.observation.setups[0]!.evidence[0]!.contact_candle = null;
    await rejected(incomplete, "INVALID_OBSERVATION");
    const reversed = edgeDerived(fixture("flip_before_boc_short")); const e = reversed.observation.setups[0]!.evidence[0]!;
    [e.contact_candle, e.recross_candle] = [e.recross_candle, e.contact_candle];
    await rejected(reversed, "INVALID_OBSERVATION");
    for (const field of ["coverage_gap_detected", "full_lifecycle_ordered", "destination_seen_before_contact"] as const) {
      const invalid = edgeDerived(fixture("flip_before_boc_short"));
      invalid.observation.setups[0]!.evidence[0]![field] = field !== "full_lifecycle_ordered";
      await rejected(invalid, "INVALID_OBSERVATION");
    }
  });

  it("keeps discretionary BOC unselected and rejects a forged exact discretionary proof", async () => {
    const input = edgeDerived(fixture()); const b = input.observation.setups[0]!;
    b.candidates[0]!.boc_tier = "DISCRETIONARY_5M";
    b.candidates[0]!.source_claim_ids = ["discretionary-break-2025-11"];
    const e = b.evidence[0]!;
    e.boc_tier = "DISCRETIONARY_5M"; e.fidelity = "DISCRETIONARY";
    e.source_claim_ids = ["discretionary-break-2025-11"]; e.htf_context_minutes = [];
    e.passed_rule_ids = []; e.failed_rule_ids = ["BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED"];
    const result = await run(input);
    if (result.status !== "VALIDATED") throw new Error(result.code);
    expect(result.entries[0]!.status).toBe("NO_CANDIDATE"); expect(result.entries[0]!.selected).toBeNull();
    expect(result.entries[0]!.edge_evaluation.evidence[0]!.boc_tier).toBe("DISCRETIONARY_5M");
    e.fidelity = "EXACT"; e.failed_rule_ids = []; e.passed_rule_ids = ["ENTRY_BOC_HTF_TIMED"];
    await rejected(input, "INVALID_OBSERVATION");
  });

  it("checks complete formation coverage, frozen geometry and full diagnostic ID boundaries", async () => {
    const missing = fixture(); missing.formations = [];
    await rejected(missing, "INVALID_FORMATION");
    const extra = fixture(); extra.formations.push({ ...extra.formations[0]!, setup_id: "unmatched" });
    await rejected(extra, "INVALID_FORMATION");
    const mismatch = fixture(); mismatch.formations[0]!.setup_id = "unmatched";
    await rejected(mismatch, "INVALID_FORMATION");
    for (const patch of [
      { direction: "SHORT" }, { variant: "OTHER" }, { origin_epoch: 301 }, { confirmation_epoch: 300 },
      { confirmation_epoch: 900 }, { origin_low_ticks: 0 }, { origin_open_ticks: 999 },
      { origin_high_ticks: 104 }, { origin_close_ticks: 103 }, { formation_source_id: "x".repeat(1025) },
    ]) {
      const invalid = fixture(); Object.assign(invalid.formations[0]!, patch);
      await rejected(invalid, "INVALID_FORMATION");
    }
    const full = fixture(); full.formations[0]!.formation_source_id = "x".repeat(1024);
    const result = await run(full);
    if (result.status !== "VALIDATED") throw new Error(result.code);
    expect(result.entries[0]!.formation.formation_source_id).toHaveLength(1024);
  });

  it("proposal tampering cannot change the recomputed winner", async () => {
    const input = edgeDerived(fixture("flip_before_boc"));
    const baseline = await run(input);
    const s = input.observation.setups[0]!.selection_proposal;
    s.canonical_model = "BOC"; s.canonical_candidate_id = "EDGE_DERIVED:BOC"; s.canonical_evidence_id = "EDGE_DERIVED:BOC";
    expect(await run(input)).toEqual(baseline);
    expect(baseline.status).toBe("VALIDATED");
    const hashed = fixture("flip_before_boc"); hashed.observation.setups[0]!.selection_proposal.canonical_model = "BOC";
    await rejected(hashed, "INVALID_OBSERVATION");
  });

  it("rejects the entire batch for one malformed or policy-ineligible setup", async () => {
    const valid = twoSetups(); expect((await run(valid)).status).toBe("VALIDATED");
    const malformed = structuredClone(valid); malformed.formations[1]!.origin_epoch = 0;
    await rejected(malformed, "INVALID_FORMATION");
    const invalid = structuredClone(valid); invalid.observation.setups[1]!.setup.invalidated_before_entry = true;
    await rejected(invalid, "INELIGIBLE_SOURCE");
    const proof = structuredClone(valid); const b = proof.observation.setups[1]!;
    b.evidence.forEach(e => { e.proof_plane = "LOWER_TIMEFRAME_REPLAY"; e.replayability = "REPLAYABLE"; });
    await rejected(proof, "INELIGIBLE_EVIDENCE");
  });

  it("rejects duplicate setup, formation, candidate, evidence and selection identities", async () => {
    const setup = fixture(); setup.observation.setups.push(structuredClone(setup.observation.setups[0]!));
    await rejected(setup, "INVALID_OBSERVATION");
    const formation = twoSetups(); formation.formations[1] = structuredClone(formation.formations[0]!);
    await rejected(formation, "INVALID_FORMATION");
    for (const key of ["candidates", "evidence"] as const) {
      const input = fixture(); const items = input.observation.setups[0]![key];
      (items as unknown[]).push(structuredClone(items[0]!));
      await rejected(input, "INVALID_OBSERVATION");
    }
    const selection = fixture(); selection.observation.setups[0]!.selection_proposal.candidate_ids_considered.push(selection.observation.setups[0]!.candidates[0]!.candidate_id);
    await rejected(selection, "INVALID_OBSERVATION");
  });

  it("rejects duplicate economic evidence identities hidden behind distinct chart setup IDs", async () => {
    const input = twoSetups();
    input.formations[1]!.confirmation_epoch = input.formations[0]!.confirmation_epoch;
    expect(input.formations[0]!.setup_id).not.toBe(input.formations[1]!.setup_id);
    await rejected(input, "INVALID_FORMATION");
  });
});
