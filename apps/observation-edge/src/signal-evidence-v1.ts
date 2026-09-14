import type { CanonicalObject, CanonicalValue } from "./types";
import { canonicalSha256 } from "./rd-entry-policy";
import type { EntryCandidateEvidenceV3, EntryCandidateV3, EntryEvaluationV3 } from "./rd-entry-domain-v3";
import { validateEntryV3Payload, type ValidatedEntryV3Bundle } from "./rd-entry-wire-v3";
import { isStrictJsonNumber, parseStrictJson, type StrictJsonValue } from "./strict-json";
import {
  deriveSignalEvidenceIdentityV1,
  validateSignalEvidenceFormationsV1,
  type SignalEvidenceFormationV1,
} from "./signal-evidence-identity-v1";

export type SignalEvidenceRejectCodeV1 =
  | "INPUT_SIZE" | "BINDING_SIZE" | "INVALID_JSON" | "INVALID_BINDING"
  | "INVALID_ENVELOPE" | "UNSUPPORTED_OBSERVATION" | "INVALID_OBSERVATION"
  | "BINDING_MISMATCH" | "INVALID_FORMATION" | "INELIGIBLE_SOURCE"
  | "INELIGIBLE_EVIDENCE";

export type ReviewedBindingV1 = Readonly<{
  schema_version: "TradeOpsSignalEvidenceBindingV1";
  producer_namespace: string;
  ticker_id: string;
  feed: string;
  symbol: string;
  tick_size: string;
  detector_code_hash: string;
  settings_hash: string;
}>;

export type SignalEvidenceEntryV1 = Readonly<{
  schema_version: "TradeOpsSignalEvidenceV1";
  authority: "EVIDENCE_ONLY";
  execution_allowed: false;
  status: "SELECTED" | "NO_CANDIDATE";
  attempt_key: string;
  formation_body_sha256: string;
  evidence_id: string;
  evidence_body_sha256: string;
  formation: SignalEvidenceFormationV1;
  reviewed_binding: ReviewedBindingV1;
  source_observation: CanonicalObject;
  edge_evaluation: EntryEvaluationV3;
  selected: Readonly<{ candidate: EntryCandidateV3; evidence: EntryCandidateEvidenceV3 }> | null;
}>;

export type SignalEvidenceResultV1 =
  | Readonly<{ status: "REJECTED"; code: SignalEvidenceRejectCodeV1 }>
  | Readonly<{ status: "VALIDATED"; authority: "EVIDENCE_ONLY"; execution_allowed: false; entries: readonly SignalEvidenceEntryV1[] }>;

const INPUT_MAX = 262_144;
const BINDING_MAX = 4_096;
const BINDING_KEYS = ["schema_version", "producer_namespace", "ticker_id", "feed", "symbol", "tick_size", "detector_code_hash", "settings_hash"] as const;
const DIGEST = /^(?!0{64}$)[a-f0-9]{64}$/u;
const IDENTIFIER = /^[!-~]+$/u;
const DECIMAL = /^(?:0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(?:\.[0-9]+)?)$/u;

function rejected(code: SignalEvidenceRejectCodeV1): SignalEvidenceResultV1 {
  return Object.freeze({ status: "REJECTED", code });
}

function object(value: StrictJsonValue): Record<string, StrictJsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
  return value as Record<string, StrictJsonValue>;
}

function text(value: StrictJsonValue, max = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || !IDENTIFIER.test(value)) throw new Error();
  return value;
}

function field(value: Record<string, StrictJsonValue>, key: string): StrictJsonValue {
  const result = value[key];
  if (result === undefined) throw new Error();
  return result;
}

function binding(value: StrictJsonValue): ReviewedBindingV1 {
  const item = object(value);
  const keys = Object.keys(item).sort();
  if (keys.join("\0") !== [...BINDING_KEYS].sort().join("\0")) throw new Error();
  if (item.schema_version !== "TradeOpsSignalEvidenceBindingV1") throw new Error();
  const tickSize = text(field(item, "tick_size"), 64);
  if (!DECIMAL.test(tickSize) || canonicalTick(tickSize) !== tickSize) throw new Error();
  const detector = text(field(item, "detector_code_hash"), 64);
  const settings = text(field(item, "settings_hash"), 64);
  if (!DIGEST.test(detector) || !DIGEST.test(settings)) throw new Error();
  return Object.freeze({
    schema_version: "TradeOpsSignalEvidenceBindingV1",
    producer_namespace: text(field(item, "producer_namespace")),
    ticker_id: text(field(item, "ticker_id")), feed: text(field(item, "feed")), symbol: text(field(item, "symbol")),
    tick_size: tickSize, detector_code_hash: detector, settings_hash: settings,
  });
}

function canonicalTick(value: string): string {
  return value.includes(".") ? value.replace(/0+$/u, "").replace(/\.$/u, "") : value;
}

function plain(value: StrictJsonValue): unknown {
  if (isStrictJsonNumber(value)) return value.value;
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}

function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

// Every numeric field in the closed V3.1 observation is an integer. Check
// spelling while strict-parser branding still exists, before wire decoding.
function integerTokens(value: StrictJsonValue): boolean {
  if (isStrictJsonNumber(value)) return value.isIntegerToken && Number.isSafeInteger(value.value);
  if (Array.isArray(value)) return value.every(integerTokens);
  if (value !== null && typeof value === "object") return Object.values(value).every(integerTokens);
  return true;
}

// These two proposal lists are sets in the bridge contract, while the existing
// wire reader requires canonical list order. Preserve strict numeric tokens and
// every other field; duplicate identities remain present for wire rejection.
function normalizeProposalLists(value: StrictJsonValue): StrictJsonValue {
  const header = object(value);
  if (!Array.isArray(header.setups)) return value;
  return { ...header, setups: header.setups.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item) || isStrictJsonNumber(item)) return item;
    const proposal = item.selection_proposal;
    if (proposal === null || typeof proposal !== "object" || Array.isArray(proposal) || isStrictJsonNumber(proposal)) return item;
    const normalized = { ...proposal };
    for (const key of ["candidate_ids_considered", "co_triggered_models"]) {
      const list = normalized[key];
      if (Array.isArray(list) && list.every((entry) => typeof entry === "string")) normalized[key] = [...list].sort((a, b) => compare(a as string, b as string));
    }
    return { ...item, selection_proposal: normalized };
  }) };
}

function normalize(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) {
    const result = value.map((item) => normalize(item));
    const sortKey = key === "formations" ? "setup_id"
      : key === "candidates" ? "candidate_id" : key === "evidence" ? "evidence_id" : null;
    if (key === "setups") result.sort((a, b) => compare((a as { setup: { setup_id: string } }).setup.setup_id, (b as { setup: { setup_id: string } }).setup.setup_id));
    if (sortKey !== null) result.sort((a, b) => compare(String((a as Record<string, unknown>)[sortKey]), String((b as Record<string, unknown>)[sortKey])));
    if (key === "candidate_ids_considered" || key === "co_triggered_models") result.sort((a, b) => compare(String(a), String(b)));
    return result;
  }
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalize(v, k)]));
  return value;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function eligibleProof(candidate: EntryCandidateV3, evidence: EntryCandidateEvidenceV3): boolean {
  if (candidate.state !== "MATCHED" || evidence.candidate_id !== candidate.candidate_id || evidence.fidelity !== "EXACT" || evidence.failed_rule_ids.length !== 0) return false;
  if (candidate.model === "BOC") return candidate.boc_tier === "HTF_TIMED" && evidence.boc_tier === "HTF_TIMED" && evidence.proof_plane === "REALTIME_TICK" && evidence.replayability === "LIVE_EXACT_NON_REPLAYABLE" && evidence.reference_candle_open_epoch !== null && evidence.observed_trigger_ticks !== null;
  if (candidate.model === "DIR_CLOSE") return evidence.proof_plane === "CONFIRMED_5M" && evidence.replayability === "REPLAYABLE" && evidence.observed_trigger_epoch !== null;
  return candidate.model === "HTF_FLIP" && evidence.proof_plane === "REALTIME_TICK" && evidence.replayability === "LIVE_EXACT_NON_REPLAYABLE" && evidence.contact_candle !== null && evidence.recross_candle !== null && evidence.coverage_gap_detected === false && evidence.full_lifecycle_ordered === true && evidence.destination_seen_before_contact === false && evidence.contact_candle.close_epoch <= evidence.recross_candle.open_epoch;
}

function selected(bundle: ValidatedEntryV3Bundle): { candidate: EntryCandidateV3; evidence: EntryCandidateEvidenceV3 } | null {
  const selection = bundle.evaluation.selection;
  if (selection.canonical_candidate_id === null || selection.canonical_evidence_id === null || selection.canonical_model === null) return null;
  const candidate = bundle.evaluation.candidates.find((item) => item.candidate_id === selection.canonical_candidate_id && item.model === selection.canonical_model);
  const evidence = bundle.evaluation.evidence.find((item) => item.evidence_id === selection.canonical_evidence_id && item.candidate_id === selection.canonical_candidate_id);
  if (candidate === undefined || evidence === undefined || selection.action !== "PAPER_ELIGIBLE" || selection.fidelity !== "EXACT" || !eligibleProof(candidate, evidence)) throw new Error();
  return { candidate, evidence };
}

export async function validateSignalEvidenceV1(inputBytes: Uint8Array, reviewedBindingBytes: Uint8Array): Promise<SignalEvidenceResultV1> {
  if (inputBytes.length === 0 || inputBytes.length > INPUT_MAX) return rejected("INPUT_SIZE");
  if (reviewedBindingBytes.length === 0 || reviewedBindingBytes.length > BINDING_MAX) return rejected("BINDING_SIZE");
  const input = new Uint8Array(inputBytes);
  const bindingInput = new Uint8Array(reviewedBindingBytes);
  let raw: StrictJsonValue; let rawBinding: StrictJsonValue;
  try { raw = parseStrictJson(input); rawBinding = parseStrictJson(bindingInput); } catch { return rejected("INVALID_JSON"); }
  let reviewed: ReviewedBindingV1;
  try { reviewed = binding(rawBinding); } catch { return rejected("INVALID_BINDING"); }
  let observation: StrictJsonValue; let formationsValue: StrictJsonValue;
  try {
    const envelope = object(raw);
    if (Object.keys(envelope).sort().join("\0") !== "formations\0observation\0schema_version" || envelope.schema_version !== "TradeOpsSignalEvidenceInputV1") throw new Error();
    observation = envelope.observation!; formationsValue = envelope.formations!;
  } catch { return rejected("INVALID_ENVELOPE"); }
  const header = (() => { try { return object(observation); } catch { return null; } })();
  if (header === null || header.schema_version !== "3.1" || header.strategy_version !== "3.1.0-contract3" || header.rule_contract_version !== "3.1.0") return rejected("UNSUPPORTED_OBSERVATION");
  if (!integerTokens(observation)) return rejected("INVALID_OBSERVATION");
  let validated;
  try { validated = await validateEntryV3Payload(normalizeProposalLists(observation)); } catch { return rejected("INVALID_OBSERVATION"); }
  const source = validated.canonicalPayload as Record<string, CanonicalValue>;
  if (validated.metadata.tickerId !== reviewed.ticker_id || validated.metadata.feed !== reviewed.feed || validated.metadata.symbol !== reviewed.symbol || canonicalTick(validated.tickSize) !== reviewed.tick_size || validated.detectorCodeHash !== reviewed.detector_code_hash || validated.settingsHash !== reviewed.settings_hash) return rejected("BINDING_MISMATCH");
  let formations: readonly SignalEvidenceFormationV1[];
  try { formations = validateSignalEvidenceFormationsV1(formationsValue, validated.entryBundles.map((item) => item.setup)); } catch { return rejected("INVALID_FORMATION"); }
  if (validated.eventRole !== "ENTRY_DECISION" || !validated.isRealtime || validated.exitEvents.length !== 0 || validated.entryBundles.some((item) => item.setup.common_fidelity !== "EXACT" || item.setup.liquidity_cohort !== "TWO_PLUS_CANDLES" || item.setup.invalidated_before_entry || item.setup.zone_engaged_epoch === null || item.commonRuleResults.some((rule) => !rule.passed))) return rejected("INELIGIBLE_SOURCE");
  const normalizedSource = normalize(plain(source as unknown as StrictJsonValue)) as CanonicalObject;
  const entries: SignalEvidenceEntryV1[] = [];
  const evidenceIds = new Set<string>();
  for (const formation of formations) {
    const bundle = validated.entryBundles.find((item) => item.setup.setup_id === formation.setup_id)!;
    let chosen;
    try { chosen = selected(bundle); } catch { return rejected("INELIGIBLE_EVIDENCE"); }
    const identity = await deriveSignalEvidenceIdentityV1({ strategy_id: validated.metadata.strategyId, ticker_id: reviewed.ticker_id, feed: reviewed.feed, producer_namespace: reviewed.producer_namespace, producer_instance_id: validated.metadata.producerInstanceId, event_id: validated.eventId, producer_sequence: validated.producerSequence, tick_size: reviewed.tick_size, formation });
    // Chart-local setup IDs cannot distinguish duplicate economic formations.
    // Reject the entire envelope before exposing two bodies under one identity.
    if (evidenceIds.has(identity.evidence_id)) return rejected("INVALID_FORMATION");
    evidenceIds.add(identity.evidence_id);
    const body = {
      schema_version: "TradeOpsSignalEvidenceV1" as const, authority: "EVIDENCE_ONLY" as const,
      execution_allowed: false as const, status: chosen === null ? "NO_CANDIDATE" as const : "SELECTED" as const,
      ...identity, formation, reviewed_binding: reviewed, source_observation: normalizedSource,
      edge_evaluation: normalize(bundle.evaluation) as unknown as EntryEvaluationV3,
      selected: chosen === null ? null : normalize(chosen) as { candidate: EntryCandidateV3; evidence: EntryCandidateEvidenceV3 },
    };
    entries.push({ ...body, evidence_body_sha256: await canonicalSha256(body as never) });
  }
  entries.sort((a, b) => compare(a.formation.setup_id, b.formation.setup_id));
  return freeze({ status: "VALIDATED", authority: "EVIDENCE_ONLY", execution_allowed: false, entries });
}
