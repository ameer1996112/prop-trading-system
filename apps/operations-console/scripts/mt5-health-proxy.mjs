import { parseMt5HealthSummary } from "../src/features/tradeops/mt5-health-contract.mjs";

export const MT5_HEALTH_ORIGIN = "https://prop-trading-agent-health-console-dry-run.ameer-1996112.workers.dev";
const HEALTH_URL = `${MT5_HEALTH_ORIGIN}/api/v1/health-summary`;
const MAX_BODY_BYTES = 128 * 1024;
const TIMEOUT_MS = 6000;
const authRequired = () => ({ status: 401, body: { error: "AUTH_REQUIRED" } });
const unavailable = () => ({ status: 502, body: { error: "Upstream unavailable" } });

// The CLI supplies this credential once. No login, credential refresh, arbitrary
// destination or response cache exists in this read-only session.
export function createMt5HealthSession({ token, fetchImpl = fetch } = {}) {
  let ownedToken = typeof token === "string" && /^[\x21-\x7e]{1,16384}$/.test(token) ? token : undefined;
  token = undefined;
  let closed = false;
  let flight = null;

  async function run(active) {
    const { controller } = active;
    let timedOut = false;
    let reader;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);
    const aborted = new Promise((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("Canceled")), { once: true });
    });
    try {
      return await Promise.race([
        aborted,
        (async () => {
          const upstream = await fetchImpl(HEALTH_URL, {
            method: "GET", redirect: "manual", credentials: "omit", cache: "no-store",
            headers: { Accept: "application/json", "Cf-Access-Token": ownedToken },
            signal: controller.signal,
          });
          // A fetch implementation may resolve after abort. Never inspect its
          // status or let that old response invalidate a later active read.
          if (controller.signal.aborted) {
            void upstream.body?.cancel().catch(() => {});
            controller.signal.throwIfAborted();
          }
          reader = upstream.body?.getReader();
          if ([302, 401, 403].includes(upstream.status)) {
            ownedToken = undefined;
            return authRequired();
          }
          const mediaType = (upstream.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
          if (upstream.status !== 200 || mediaType !== "application/json") throw new Error("Invalid response");
          const chunks = [];
          let total = 0;
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              controller.signal.throwIfAborted();
              if (done) break;
              total += value.byteLength;
              if (total > MAX_BODY_BYTES) throw new Error("Invalid response");
              chunks.push(Buffer.from(value));
            }
          }
          const json = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
          const body = parseMt5HealthSummary(JSON.parse(json));
          controller.signal.throwIfAborted();
          return { status: 200, body };
        })(),
      ]);
    } catch {
      if (closed || !ownedToken) return authRequired();
      return timedOut ? { status: 504, body: { error: "Upstream timed out" } } : unavailable();
    } finally {
      clearTimeout(deadline);
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      if (flight === active) flight = null;
    }
  }

  function read({ signal } = {}) {
    if (closed || !ownedToken) return Promise.resolve(authRequired());
    if (signal?.aborted) return Promise.resolve(unavailable());
    if (!flight) {
      const active = { controller: new AbortController(), subscribers: 0, promise: null };
      flight = active;
      active.promise = run(active);
    }
    const active = flight;
    active.subscribers += 1;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", cancel);
        active.subscribers -= 1;
        if (active.subscribers === 0 && flight === active) {
          flight = null;
          active.controller.abort();
        }
        resolve(closed || !ownedToken ? authRequired() : result);
      };
      const cancel = () => finish(unavailable());
      signal?.addEventListener("abort", cancel, { once: true });
      active.promise.then(finish);
    });
  }

  function close() {
    closed = true;
    ownedToken = undefined;
    const active = flight;
    flight = null;
    active?.controller.abort();
  }

  return { read, close };
}
