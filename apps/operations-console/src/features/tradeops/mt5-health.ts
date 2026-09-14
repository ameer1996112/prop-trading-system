import { heartbeatStatusAt, parseMt5HealthSummary, type Mt5HealthStatus, type Mt5HealthSummary } from "./mt5-health-contract.mjs";

export class Mt5AuthorizationError extends Error {
  constructor() { super("MT5 health requires Cloudflare Access sign-in."); }
}
export function mt5HeartbeatAge(data: Mt5HealthSummary | null, receivedAtMs: number | null, nowMs: number): number | null {
  if (!data?.current || receivedAtMs === null || !Number.isFinite(receivedAtMs) || !Number.isFinite(nowMs) || nowMs < receivedAtMs) return null;
  return data.server_time_epoch - data.current.last_accepted_epoch + Math.floor((nowMs - receivedAtMs) / 1000);
}
export function mt5HeartbeatStatus(data: Mt5HealthSummary | null, receivedAtMs: number | null, nowMs: number): Mt5HealthStatus {
  const age = mt5HeartbeatAge(data, receivedAtMs, nowMs);
  return age === null ? "UNKNOWN" : heartbeatStatusAt(age);
}

/** One bounded same-origin read. Access credentials exist only in the local proxy. */
export async function loadMt5Health(signal: AbortSignal): Promise<Mt5HealthSummary> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectCancel!: (reason: Error) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectCancel = reject; });
  const cancel = () => { controller.abort(); rejectCancel(new Error("MT5 health is unavailable.")); };
  const deadline = setTimeout(cancel, 6000);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    return await Promise.race([cancelled, (async () => {
      if (signal.aborted) throw new Error();
      const response = await fetch("/api/v1/mt5-health-summary", { method: "GET", signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store", headers: { Accept: "application/json" } });
      controller.signal.throwIfAborted();
      if (response.status === 401 || response.status === 403) throw new Mt5AuthorizationError();
      if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new Error();
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 128 * 1024)) throw new Error();
      if (!response.body) throw new Error();
      reader = response.body.getReader();
      let total = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        total += value.byteLength;
        if (total > 128 * 1024) throw new Error();
        chunks.push(value);
      }
      const bytes = new Uint8Array(total); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return parseMt5HealthSummary(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    })()]);
  } catch (error) {
    if (error instanceof Mt5AuthorizationError) throw error;
    throw new Error("MT5 health is unavailable.");
  } finally {
    clearTimeout(deadline); signal.removeEventListener("abort", cancel); controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}
