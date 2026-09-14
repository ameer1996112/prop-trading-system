import { claimSignalDelivery, settleSignalDelivery, type DeliveryClaim } from "./signal-admission-store-v1";
import { parseStrictJson } from "./strict-json";

export type DispatchOutcome = "DISABLED" | "EMPTY" | "ACKNOWLEDGED" | "RETRY" | "EXPIRED" | "FAILED_TERMINAL" | "QUARANTINED";
export type SignalDeliverySender = (body: string) => Promise<Response>;
const ACK_LIMIT = 16 * 1024;
async function acknowledgment(response: Response, claim: DeliveryClaim, signal: AbortSignal): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) return false;
  const chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) return false;
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > ACK_LIMIT) { void reader.cancel().catch(() => {}); return false; }
      chunks.push(part.value);
    }
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = parseStrictJson(bytes);
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const expected = { schema_version: "TradeOpsSignalDeliveryAckV1", authority: "EVIDENCE_ONLY", execution_allowed: false,
      delivery_id: claim.delivery_id, delivery_body_sha256: claim.delivery_body_sha256, status: response.status === 201 ? "STORED" : "DUPLICATE" };
    return Object.keys(value).length === Object.keys(expected).length && Object.entries(expected).every(([key, item]) => (value as Record<string, unknown>)[key] === item);
  } catch { return false; }
}
async function send(sender: SignalDeliverySender, claim: DeliveryClaim): Promise<"ACKNOWLEDGED" | "RETRY" | "FAILED_TERMINAL"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new AbortController();
  try {
    return await Promise.race([
      (async () => {
        const response = await sender(claim.body);
        if (deadline.signal.aborted) { void response.body?.cancel().catch(() => {}); return "RETRY" as const; }
        if (response.redirected || (response.status >= 300 && response.status < 400)) { void response.body?.cancel().catch(() => {}); return "FAILED_TERMINAL" as const; }
        if (response.status === 408 || response.status === 429 || response.status >= 500) { void response.body?.cancel().catch(() => {}); return "RETRY" as const; }
        if (response.status !== 200 && response.status !== 201) { void response.body?.cancel().catch(() => {}); return "FAILED_TERMINAL" as const; }
        return await acknowledgment(response, claim, deadline.signal) ? "ACKNOWLEDGED" as const : "FAILED_TERMINAL" as const;
      })(),
      new Promise<"RETRY">(resolve => { timer = setTimeout(() => { resolve("RETRY"); deadline.abort(); }, 6000); }),
    ]);
  } catch { return "RETRY"; } finally { clearTimeout(timer); }
}
async function storedOutcome(db: D1Database, id: string): Promise<DispatchOutcome> {
  const status = await db.prepare("SELECT status FROM signal_admission_v1_outbox WHERE delivery_id=?").bind(id).first<string>("status");
  return status === "ACKNOWLEDGED" || status === "EXPIRED" || status === "FAILED_TERMINAL" || status === "QUARANTINED" ? status : "RETRY";
}
export async function dispatchSignalAdmission(db: D1Database | null, sender: SignalDeliverySender, clock: () => number): Promise<DispatchOutcome> {
  if (!db) return "DISABLED";
  const claim = await claimSignalDelivery(db, clock());
  if (!claim) return "EMPTY";
  if (claim.status !== "CLAIMED") return claim.status;
  const checked = await settleSignalDelivery(db, claim.token, "CLAIMED", clock());
  if (checked !== "CLAIMED") return await storedOutcome(db, claim.delivery_id);
  const outcome = await send(sender, claim);
  const final = await settleSignalDelivery(db, claim.token, outcome, clock());
  return final && final !== "CLAIMED" ? final : await storedOutcome(db, claim.delivery_id);
}
