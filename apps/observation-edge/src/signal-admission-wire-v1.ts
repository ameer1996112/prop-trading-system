import { isStrictJsonNumber, parseStrictJson, type StrictJsonValue } from "./strict-json";

export type Safety = { authority: "EVIDENCE_ONLY"; execution_allowed: false };
export type StreamState = "ACTIVE" | "QUARANTINED" | "RETIRED";
export type ReceiptOutcome = "ACCEPTED" | "NO_CANDIDATE" | "AUDIT_ONLY" | "REJECTED";
export type AdmissionCode = "SEQUENCE_GAP" | "UNKNOWN_OLD_SEQUENCE" | "BODY_CONFLICT"
  | "INVALID_EVIDENCE" | "STALE" | "FUTURE" | "CLOCK_REGRESSION"
  | "ATTEMPT_CONFLICT" | "STREAM_BLOCKED";
export interface Freshness {
  max_event_age_seconds: number;
  max_observation_age_seconds: number;
  future_skew_seconds: number;
  max_queue_age_seconds: number;
}

export interface Transport {
  registrationId: string;
  generation: number;
  credential: string;
  evidenceBytes: Uint8Array;
  sequence: number;
  producerInstanceId: string;
  strategyId: string;
  bodySha256: string;
}

const OUTER_MAX = 278_528;
const INNER_MAX = 262_144;
const OUTER_KEYS = ["schema_version", "credential", "registration_id", "generation", "evidence"] as const;
const IDENTIFIER = /^[\x21-\x5b\x5d-\x7e]{1,160}$/u;
const CREDENTIAL = /^[\x20-\x7e]{1,1024}$/u;

function record(value: StrictJsonValue): Record<string, StrictJsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || isStrictJsonNumber(value)) throw new Error("invalid admission request");
  return value as Record<string, StrictJsonValue>;
}

function exactKeys(value: Record<string, StrictJsonValue>, keys: readonly string[]): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) throw new Error("invalid admission request");
}

function identifier(value: StrictJsonValue): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new Error("invalid admission request");
  return value;
}

function canonicalInteger(value: StrictJsonValue, positive: boolean): number {
  if (!isStrictJsonNumber(value) || !value.isIntegerToken || value.raw !== String(value.value) || !Number.isSafeInteger(value.value) || (positive && value.value <= 0)) throw new Error("invalid admission request");
  return value.value;
}

function assertCanonicalIntegerTokens(value: StrictJsonValue): void {
  if (isStrictJsonNumber(value)) {
    canonicalInteger(value, false);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertCanonicalIntegerTokens);
    return;
  }
  if (value !== null && typeof value === "object") Object.values(value).forEach(assertCanonicalIntegerTokens);
}

function canonical(value: StrictJsonValue): string {
  if (isStrictJsonNumber(value)) return value.raw;
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", value));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function parseAdmissionTransport(bytes: Uint8Array): Promise<Transport> {
  if (bytes.length === 0 || bytes.length > OUTER_MAX) throw new Error("invalid admission request");
  const input = new Uint8Array(bytes);
  const outer = record(parseStrictJson(input));
  exactKeys(outer, OUTER_KEYS);
  if (outer.schema_version !== "TradeOpsSignalAdmissionRequestV1") throw new Error("invalid admission request");
  const registrationId = identifier(outer.registration_id!);
  const generation = canonicalInteger(outer.generation!, true);
  if (typeof outer.credential !== "string" || !CREDENTIAL.test(outer.credential)) throw new Error("invalid admission request");
  const evidence = record(outer.evidence!);
  assertCanonicalIntegerTokens(evidence);
  const observation = record(evidence.observation!);
  const sequence = canonicalInteger(observation.producer_sequence!, true);
  const producerInstanceId = identifier(observation.producer_instance_id!);
  const strategyId = identifier(observation.strategy_id!);
  const evidenceBytes = new TextEncoder().encode(canonical(evidence));
  if (evidenceBytes.length === 0 || evidenceBytes.length > INNER_MAX) throw new Error("invalid admission request");
  const identityBytes = new TextEncoder().encode(canonical({
    registration_id: registrationId,
    generation: outer.generation!,
    evidence,
  }));
  return Object.freeze({ registrationId, generation, credential: outer.credential,
    evidenceBytes: new Uint8Array(evidenceBytes), sequence, producerInstanceId,
    strategyId, bodySha256: await sha256(identityBytes) });
}
