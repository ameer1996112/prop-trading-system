import { isStrictJsonNumber, parseStrictJson, type StrictJsonValue } from "./strict-json";
import type { Freshness, Transport } from "./signal-admission-wire-v1";

export interface Registration {
  registrationId: string; generation: number; revision: number;
  scopeKey: string; producerInstanceId: string; credentialSha256: string;
  bindingBytes: Uint8Array; activeFrom: number; activeUntil: number;
  enabled: boolean; freshness: Freshness;
}

const REGISTRATION_MAX = 8_192;
const IDENTIFIER = /^[\x21-\x5b\x5d-\x7e]{1,160}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const DECIMAL = /^(?:0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(?:\.[0-9]+)?)$/u;
const REGISTRATION_KEYS = ["schema_version", "registration_id", "generation", "revision", "scope_key", "producer_instance_id", "credential_sha256", "reviewed_binding", "active_from", "active_until", "enabled", "freshness"];
const BINDING_KEYS = ["schema_version", "producer_namespace", "ticker_id", "feed", "symbol", "tick_size", "detector_code_hash", "settings_hash"];
const FRESHNESS_KEYS = ["max_event_age_seconds", "max_observation_age_seconds", "future_skew_seconds", "max_queue_age_seconds"];
const SCOPE_KEYS = ["producer_namespace", "strategy_id", "ticker_id"];

function record(value: StrictJsonValue): Record<string, StrictJsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || isStrictJsonNumber(value)) throw new Error();
  return value as Record<string, StrictJsonValue>;
}
function exact(value: Record<string, StrictJsonValue>, keys: readonly string[]): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) throw new Error();
}
function text(value: StrictJsonValue): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new Error();
  return value;
}
function integer(value: StrictJsonValue, allowZero = false): number {
  if (!isStrictJsonNumber(value) || !value.isIntegerToken || value.raw !== String(value.value) || !Number.isSafeInteger(value.value) || (allowZero ? value.value < 0 : value.value <= 0)) throw new Error();
  return value.value;
}
function canonical(value: StrictJsonValue): string {
  if (isStrictJsonNumber(value)) return value.raw;
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
}

export function readRegistration(bytes: Uint8Array): Registration | null {
  try {
    if (bytes.length === 0 || bytes.length > REGISTRATION_MAX) throw new Error();
    const value = record(parseStrictJson(new Uint8Array(bytes)));
    exact(value, REGISTRATION_KEYS);
    if (value.schema_version !== "TradeOpsSignalAdmissionRegistrationV1" || typeof value.enabled !== "boolean") throw new Error();
    const binding = record(value.reviewed_binding!); exact(binding, BINDING_KEYS);
    if (binding.schema_version !== "TradeOpsSignalEvidenceBindingV1") throw new Error();
    for (const key of ["producer_namespace", "ticker_id", "feed", "symbol", "tick_size"] as const) text(binding[key]!);
    if (typeof binding.tick_size !== "string" || !DECIMAL.test(binding.tick_size)
      || binding.tick_size.replace(/0+$/u, "").replace(/\.$/u, "") !== binding.tick_size) throw new Error();
    for (const key of ["detector_code_hash", "settings_hash"] as const) if (typeof binding[key] !== "string" || !DIGEST.test(binding[key]) || /^0{64}$/u.test(binding[key])) throw new Error();
    const scopeKey = typeof value.scope_key === "string" ? value.scope_key : (() => { throw new Error(); })();
    const scope = record(parseStrictJson(new TextEncoder().encode(scopeKey))); exact(scope, SCOPE_KEYS);
    const namespace = text(scope.producer_namespace!); const ticker = text(scope.ticker_id!); text(scope.strategy_id!);
    if (canonical(scope) !== scopeKey || namespace !== binding.producer_namespace || ticker !== binding.ticker_id) throw new Error();
    const freshnessValue = record(value.freshness!); exact(freshnessValue, FRESHNESS_KEYS);
    const freshness = Object.freeze({
      max_event_age_seconds: integer(freshnessValue.max_event_age_seconds!),
      max_observation_age_seconds: integer(freshnessValue.max_observation_age_seconds!),
      future_skew_seconds: integer(freshnessValue.future_skew_seconds!, true),
      max_queue_age_seconds: integer(freshnessValue.max_queue_age_seconds!),
    });
    const activeFrom = integer(value.active_from!, true); const activeUntil = integer(value.active_until!, true);
    if (activeUntil <= activeFrom) throw new Error();
    if (typeof value.credential_sha256 !== "string" || !DIGEST.test(value.credential_sha256)) throw new Error();
    return Object.freeze({ registrationId: text(value.registration_id!), generation: integer(value.generation!),
      revision: integer(value.revision!), scopeKey, producerInstanceId: text(value.producer_instance_id!),
      credentialSha256: value.credential_sha256, bindingBytes: new TextEncoder().encode(canonical(binding)),
      activeFrom, activeUntil, enabled: value.enabled, freshness });
  } catch { return null; }
}

function digestBytes(value: string): Uint8Array | null {
  if (!DIGEST.test(value)) return null;
  return Uint8Array.from(value.match(/../gu)!, pair => Number.parseInt(pair, 16));
}
function equalDigest(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== 32 || right.length !== 32) return false;
  let different = 0;
  for (let index = 0; index < 32; index += 1) different |= left[index]! ^ right[index]!;
  return different === 0;
}
async function credentialDigest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function authenticateRegistration(t: Transport, r: Registration | null, now: number): Promise<boolean> {
  if (r === null || !Number.isSafeInteger(now)) return false;
  const expected = digestBytes(r.credentialSha256);
  if (expected === null) return false;
  let scope: Record<string, StrictJsonValue>;
  try { scope = record(parseStrictJson(new TextEncoder().encode(r.scopeKey))); exact(scope, SCOPE_KEYS); } catch { return false; }
  const digest = await credentialDigest(typeof t.credential === "string" ? t.credential : "");
  const authenticated = r.enabled && r.registrationId === t.registrationId && r.generation === t.generation
    && r.producerInstanceId === t.producerInstanceId && scope.strategy_id === t.strategyId
    && now >= r.activeFrom && now < r.activeUntil;
  return authenticated && equalDigest(digest, expected);
}
