import { dispatchSignalAdmission } from "./signal-admission-outbox-v1";
import { authenticateRegistration, readRegistration } from "./signal-admission-registration-v1";
import { admitSignal, AdmissionUnavailableError, type AdmissionResult } from "./signal-admission-store-v1";
import { parseAdmissionTransport } from "./signal-admission-wire-v1";
import { isStrictJsonNumber, parseStrictJson, type StrictJsonValue } from "./strict-json";

export interface SignalAdmissionEnv {
  readonly DB: D1Database;
  readonly SIGNAL_ADMISSION_ENABLED?: string;
  readonly SIGNAL_ADMISSION_DISPATCH_ENABLED?: string;
  readonly SIGNAL_ADMISSION_STATUS_ENABLED?: string;
  readonly SIGNAL_EVIDENCE_INBOX_ENABLED?: string;
  readonly SIGNAL_EVIDENCE_RECEIVER?: Fetcher;
  readonly SIGNAL_DELIVERY_SECRET?: string;
  readonly SIGNAL_ADMISSION_OPERATOR_SECRET_SHA256?: string;
  readonly SIGNAL_ADMISSION_OPERATOR_SCOPE_JSON?: string;
}

const safety = { authority: "EVIDENCE_ONLY", execution_allowed: false } as const;
const noStore = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const IDENTIFIER = /^[\x21-\x5b\x5d-\x7e]{1,160}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const OUTER_MAX = 278_528;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: noStore });
}
function failure(_redactedReason: string, status: number): Response {
  return json({ schema_version: "TradeOpsSignalAdmissionResponseV1", ...safety,
    receipt_id: null, outcome: "REJECTED", code: null, duplicate: false, stream_state: null }, status);
}
async function bytes(request: Request): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > OUTER_MAX) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
async function registration(db: D1Database, id: string): Promise<ReturnType<typeof readRegistration>> {
  const row = await db.prepare("SELECT registration_json FROM signal_admission_v1_registrations WHERE registration_id=?").bind(id).first<string>("registration_json");
  return typeof row === "string" ? readRegistration(new TextEncoder().encode(row)) : null;
}
function resultStatus(result: AdmissionResult): number {
  if (result.duplicate) return 200;
  if (result.code === "INVALID_EVIDENCE" || result.code === "STALE" || result.code === "FUTURE") return 422;
  if (result.outcome === "REJECTED") return 409;
  return 202;
}

export async function handleSignalAdmission(request: Request, env: SignalAdmissionEnv, clock: () => number): Promise<Response> {
  if (env.SIGNAL_ADMISSION_ENABLED !== "true") return failure("NOT_FOUND", 404);
  if (request.method !== "POST") return failure("METHOD_NOT_ALLOWED", 405);
  if ((request.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return failure("INVALID_CONTENT_TYPE", 400);
  let body: Uint8Array | null;
  try { body = await bytes(request); } catch { return failure("INVALID_REQUEST", 400); }
  if (body === null) return failure("BODY_TOO_LARGE", 413);
  let transport;
  try { transport = await parseAdmissionTransport(body); } catch { return failure("INVALID_REQUEST", 400); }
  try {
    const now = clock();
    const authoritative = await registration(env.DB, transport.registrationId);
    if (!await authenticateRegistration(transport, authoritative, now)) return failure("AUTHENTICATION_FAILED", 401);
    const result = await admitSignal(env.DB, transport, authoritative!, now);
    return json(result, resultStatus(result));
  } catch (error) {
    if (error instanceof AdmissionUnavailableError) return failure("STORAGE_UNAVAILABLE", 503);
    return failure("STORAGE_UNAVAILABLE", 503);
  }
}

function record(value: StrictJsonValue): Record<string, StrictJsonValue> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !isStrictJsonNumber(value) ? value as Record<string, StrictJsonValue> : null;
}
function operatorScope(raw: string | undefined): ReadonlySet<string> | null {
  if (!raw || new TextEncoder().encode(raw).byteLength > 8192) return null;
  try {
    const value = record(parseStrictJson(new TextEncoder().encode(raw)));
    if (!value || Object.keys(value).length !== 1 || !("registration_ids" in value) || !Array.isArray(value.registration_ids)
      || value.registration_ids.length === 0 || value.registration_ids.length > 50) return null;
    const ids = value.registration_ids;
    if (!ids.every(id => typeof id === "string" && IDENTIFIER.test(id))) return null;
    const set = new Set(ids as string[]);
    return set.size === ids.length ? set : null;
  } catch { return null; }
}
function digestBytes(hex: string | undefined): Uint8Array | null {
  if (!hex || !DIGEST.test(hex)) return null;
  return Uint8Array.from(hex.match(/../gu)!, pair => Number.parseInt(pair, 16));
}
async function operatorAuthenticated(request: Request, digest: string | undefined): Promise<boolean> {
  const expected = digestBytes(digest); const header = request.headers.get("authorization");
  if (!expected || !header?.startsWith("Bearer ") || header.length <= 7) return false;
  const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(header.slice(7))));
  let different = 0; for (let i = 0; i < 32; i += 1) different |= expected[i]! ^ actual[i]!;
  return different === 0;
}
function statusTarget(request: Request): { registrationId: string; generation: number } | null {
  const url = new URL(request.url); const keys = [...url.searchParams.keys()];
  if (keys.length !== 2 || new Set(keys).size !== 2 || !keys.includes("registration_id") || !keys.includes("generation")) return null;
  const registrationId = url.searchParams.get("registration_id")!; const generationText = url.searchParams.get("generation")!;
  if (!IDENTIFIER.test(registrationId) || !/^[1-9][0-9]*$/u.test(generationText)) return null;
  const generation = Number(generationText);
  return Number.isSafeInteger(generation) ? { registrationId, generation } : null;
}

export async function handleSignalAdmissionStatus(request: Request, env: SignalAdmissionEnv): Promise<Response> {
  if (env.SIGNAL_ADMISSION_STATUS_ENABLED !== "true") return failure("NOT_FOUND", 404);
  if (request.method !== "GET") return failure("METHOD_NOT_ALLOWED", 405);
  if (request.body !== null || Number(request.headers.get("content-length") ?? "0") !== 0) return failure("INVALID_REQUEST", 400);
  const target = statusTarget(request); if (!target) return failure("INVALID_REQUEST", 400);
  const scope = operatorScope(env.SIGNAL_ADMISSION_OPERATOR_SCOPE_JSON);
  if (!scope || !await operatorAuthenticated(request, env.SIGNAL_ADMISSION_OPERATOR_SECRET_SHA256)) return failure("FORBIDDEN", 403);
  if (!scope.has(target.registrationId)) return failure("FORBIDDEN", 403);
  try {
    const receipts = (await env.DB.prepare(`SELECT sequence,receipt_id,outcome,code,admitted_at FROM signal_admission_v1_receipts
      WHERE registration_id=? AND generation=? ORDER BY sequence DESC LIMIT 50`).bind(target.registrationId, target.generation).all()).results;
    const deliveries = (await env.DB.prepare(`SELECT r.sequence,o.delivery_id,o.receipt_id,o.status,o.delivery_attempts,o.last_dispatch_at_epoch,o.failure_reason
      FROM signal_admission_v1_outbox o JOIN signal_admission_v1_receipts r ON r.receipt_id=o.receipt_id
      WHERE o.registration_id=? AND o.generation=? ORDER BY r.sequence DESC,o.delivery_id LIMIT 50`).bind(target.registrationId, target.generation).all()).results;
    return json({ schema_version: "TradeOpsSignalAdmissionStatusV1", ...safety, registration_id: target.registrationId,
      generation: target.generation, receipts, delivery_summaries: deliveries }, 200);
  } catch { return failure("STORAGE_UNAVAILABLE", 503); }
}

export async function dispatchScheduledSignalAdmission(env: SignalAdmissionEnv, clock: () => number): Promise<void> {
  if (env.SIGNAL_ADMISSION_DISPATCH_ENABLED !== "true" || !env.SIGNAL_EVIDENCE_RECEIVER || !env.SIGNAL_DELIVERY_SECRET) return;
  try {
    await dispatchSignalAdmission(env.DB, body => env.SIGNAL_EVIDENCE_RECEIVER!.fetch("https://signal-evidence.internal/internal/signal-evidence-v1", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.SIGNAL_DELIVERY_SECRET}` }, body, redirect: "manual",
    }), clock);
  } catch { /* Scheduled failures are deliberately redacted and retried durably. */ }
}
