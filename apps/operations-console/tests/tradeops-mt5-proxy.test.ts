// @vitest-environment node
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { request, type IncomingHttpHeaders, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

type HealthResult = { status: number; body: unknown };
type HealthSession = { read: (options?: { signal?: AbortSignal }) => Promise<HealthResult>; close: () => void };
type SessionFactory = (options?: { token?: string; fetchImpl?: typeof fetch }) => HealthSession;
type Preview = {
  evaluateRequest: (request: { method: string; url: string; rawHeaders: string[] }, port: number) => { status: number; kind?: string };
  createPreviewServer: (options: { staticRoot: string; port: number; fetchImpl?: typeof fetch; mt5HealthSession?: HealthSession }) => Promise<Server>;
};
const preview: Preview = await import(pathToFileURL(resolve("scripts/tradeops-preview.mjs")).href);
const sessionModule: { createMt5HealthSession?: SessionFactory } = await import(pathToFileURL(resolve("scripts/mt5-health-proxy.mjs")).href).catch(() => ({}));
const localPath = "/api/v1/mt5-health-summary";
const origin = "https://prop-trading-agent-health-console-dry-run.ameer-1996112.workers.dev";
const summary = { schema_version: "AgentHealthSummaryV1", server_time_epoch: 1788436800, status: "UNKNOWN", current: null, recent: [] };
const host = ["Host", "127.0.0.1:4173"];
const policy = (url = localPath, headers = host, method = "GET") => preview.evaluateRequest({ method, url, rawHeaders: headers }, 4173);
function session(fetchImpl: typeof fetch, token?: string) {
  expect(sessionModule.createMt5HealthSession).toBeTypeOf("function");
  return sessionModule.createMt5HealthSession!({ fetchImpl, token });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("MT5 health request boundary", () => {
  it("adds only the dedicated health route without reflecting incoming credentials", () => {
    expect(policy(localPath, [...host, "Authorization", "Bearer paper-private", "Cookie", "access=browser-private", "Cf-Access-Token", "untrusted"])).toEqual({ status: 200, kind: "mt5-health" });
  });
  it.each(["?", "?limit=1", "?upstream=https://evil.test", "?account=1"])("rejects every query %s", (query) => expect(policy(localPath + query).status).toBe(400));
  it.each(["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])("rejects %s", (method) => expect(policy(localPath, host, method).status).toBe(405));
  it.each(["/api/v1/mt5-health-summary/", "/api/v1/health-summary"])("does not add %s", (path) => expect(policy(path).status).toBe(404));
  it("retains origin, host, traversal and fetch-site protections", () => {
    expect(policy(localPath, [...host, "Origin", "https://evil.test"]).status).toBe(403);
    expect(policy(localPath, [...host, "Sec-Fetch-Site", "cross-site"]).status).toBe(403);
    expect(policy(localPath, ["Host", "evil.test:4173"]).status).toBe(403);
    expect(policy("/api/v1/%2e%2e/mt5-health-summary").status).toBe(400);
  });
});

describe("MT5 health preview integration", () => {
  let fixture: string | undefined;
  let server: Server | undefined;
  let responseHeaders: IncomingHttpHeaders;
  afterEach(async () => {
    if (server) {
      const closing = new Promise<void>((done) => server!.close(() => done()));
      server.closeAllConnections();
      await closing;
      server = undefined;
    }
    if (fixture) await rm(fixture, { recursive: true, force: true });
  });
  async function start(mt5HealthSession?: HealthSession, fetchImpl?: typeof fetch) {
    fixture = await mkdtemp(join(tmpdir(), "tradeops-mt5-"));
    await writeFile(join(fixture, "index.html"), "<!doctype html>Fixture");
    server = await preview.createPreviewServer({ staticRoot: fixture, port: 0, mt5HealthSession, fetchImpl });
  }
  function get(path = localPath, headers: Record<string, string> = {}) {
    const address = server!.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    return new Promise<{ status: number; body: string }>((done, reject) => {
      const req = request({ hostname: "127.0.0.1", port: address.port, path, headers }, (response) => {
        responseHeaders = response.headers;
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => done({ status: response.statusCode!, body: Buffer.concat(chunks).toString() }));
      });
      req.on("error", reject);
      req.end();
    });
  }
  it("is disconnected by default and cannot use a supplied browser bearer", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await start(undefined, fetchImpl);
    expect(await get(localPath, { Authorization: "Bearer paper-private", Cookie: "private=browser" })).toEqual({ status: 401, body: '{"error":"AUTH_REQUIRED"}' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("uses only the server-owned Access token and never forwards browser or upstream headers", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(summary, { headers: { "Set-Cookie": "private=secret", Location: "https://evil.test" } }));
    await start(session(fetchImpl, "fixture-access-token"));
    expect(await get(localPath, { Authorization: "Bearer paper-private", Cookie: "access=browser-private", "Cf-Access-Token": "untrusted" })).toEqual({ status: 200, body: JSON.stringify(summary) });
    expect(responseHeaders).toMatchObject({ "cache-control": "no-store", "x-content-type-options": "nosniff", "content-type": "application/json; charset=utf-8" });
    expect(responseHeaders).not.toHaveProperty("set-cookie");
    expect(responseHeaders).not.toHaveProperty("location");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${origin}/api/v1/health-summary`);
    expect(options).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store", credentials: "omit", headers: { Accept: "application/json", "Cf-Access-Token": "fixture-access-token" } });
    expect(Object.keys(options!.headers!)).toHaveLength(2);
  });
  it("purges the session immediately when server.close starts, including in-flight reads", async () => {
    const pending = deferred<Response>();
    const started = deferred<AbortSignal>();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => { started.resolve(options!.signal!); return pending.promise; });
    const health = session(fetchImpl, "fixture-access-token");
    await start(health);
    const reading = health.read();
    const signal = await started.promise;
    server!.close();
    expect(signal.aborted).toBe(true);
    pending.resolve(Response.json(summary));
    expect(await reading).toEqual({ status: 401, body: { error: "AUTH_REQUIRED" } });
    expect(await health.read()).toEqual({ status: 401, body: { error: "AUTH_REQUIRED" } });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("will not publish a settled private read after preview teardown starts", async () => {
    const pending = deferred<HealthResult>();
    const started = deferred<void>();
    await start({ read: () => { started.resolve(); return pending.promise; }, close: () => {} });
    const reading = get();
    await started.promise;
    server!.close();
    pending.resolve({ status: 200, body: summary });
    expect(await reading).toEqual({ status: 401, body: '{"error":"AUTH_REQUIRED"}' });
  });
  it("keeps the health token out of paper routes and rejected requests out of health fetch", async () => {
    const healthFetch = vi.fn<typeof fetch>(async () => Response.json(summary));
    const paperFetch = vi.fn<typeof fetch>(async () => Response.json({ paper: true }));
    await start(session(healthFetch, "fixture-access-token"), paperFetch);
    expect((await get("/api/v1/paper-accounts", { Authorization: "Bearer paper-private" })).status).toBe(200);
    expect(paperFetch.mock.calls[0]![1]!.headers).toEqual({ Accept: "application/json", Authorization: "Bearer paper-private" });
    expect((await get(`${localPath}?limit=1`)).status).toBe(400);
    expect((await get(localPath, { Origin: "https://evil.test" })).status).toBe(403);
    expect(healthFetch).not.toHaveBeenCalled();
  });
  it("a disconnected browser does not cancel another browser's shared health read", async () => {
    const pending = deferred<Response>();
    const started = deferred<AbortSignal>();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => { started.resolve(options!.signal!); return pending.promise; });
    await start(session(fetchImpl, "fixture-access-token"));
    const address = server!.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    const first = request({ hostname: "127.0.0.1", port: address.port, path: localPath });
    first.on("error", () => {});
    first.end();
    const signal = await started.promise;
    const secondReceived = deferred<void>();
    server!.once("request", () => secondReceived.resolve());
    const second = get();
    await secondReceived.promise;
    expect(signal.aborted).toBe(false);
    first.destroy();
    await new Promise((done) => setTimeout(done, 20));
    expect(signal.aborted).toBe(false);
    pending.resolve(Response.json(summary));
    expect(await second).toEqual({ status: 200, body: JSON.stringify(summary) });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("aborts the upstream after the only browser disconnects", async () => {
    const started = deferred<AbortSignal>();
    const aborted = deferred<void>();
    const health = session(async (_url, options) => {
      options!.signal!.addEventListener("abort", () => aborted.resolve(), { once: true });
      started.resolve(options!.signal!);
      return new Promise<Response>(() => {});
    }, "fixture-access-token");
    await start(health);
    const address = server!.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    const local = request({ hostname: "127.0.0.1", port: address.port, path: localPath });
    local.on("error", () => {});
    local.end();
    const signal = await started.promise;
    await new Promise((done) => setTimeout(done, 20));
    expect(signal.aborted).toBe(false);
    local.destroy();
    await aborted.promise;
    expect(signal.aborted).toBe(true);
  });
});

describe("bounded MT5 health session", () => {
  afterEach(() => vi.restoreAllMocks());
  it("does not fetch without an owned credential", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await session(fetchImpl).read()).toEqual({ status: 401, body: { error: "AUTH_REQUIRED" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([302, 401, 403])("purges auth after upstream %s and stops all subsequent upstream reads", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("private-login-body", { status, headers: { Location: "https://secret-login.test" } }));
    const health = session(fetchImpl, "fixture-access-token");
    expect(await health.read()).toEqual({ status: 401, body: { error: "AUTH_REQUIRED" } });
    expect(await health.read()).toEqual({ status: 401, body: { error: "AUTH_REQUIRED" } });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each([301, 307, 308, 400, 429, 500])("returns generic failure for upstream %s without exposing its body", async (status) => {
    const health = session(async () => new Response("upstream-private", { status, headers: { "Content-Type": "application/json" } }), "fixture-access-token");
    expect(await health.read()).toEqual({ status: 502, body: { error: "Upstream unavailable" } });
  });
  it.each(["text/html", "application/problem+json", "application/jsonp", ""])("requires application/json, rejecting %s", async (contentType) => {
    const health = session(async () => new Response(JSON.stringify(summary), { headers: { "Content-Type": contentType } }), "fixture-access-token");
    expect(await health.read()).toEqual({ status: 502, body: { error: "Upstream unavailable" } });
  });
  it.each(["{broken", "<html>private</html>", JSON.stringify({ ...summary, account_login: "secret" }), JSON.stringify({ ...summary, token: "private" }), JSON.stringify({ ...summary, status: "BROKER_READY" })])("rejects malformed or unexpected/sensitive fields without returning them", async (body) => {
    const health = session(async () => new Response(body, { headers: { "Content-Type": "application/json" } }), "fixture-access-token");
    expect(await health.read()).toEqual({ status: 502, body: { error: "Upstream unavailable" } });
  });
  it("bounds streamed bytes at 128 KiB and cancels an overflow", async () => {
    let canceled = false;
    const health = session(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(128 * 1024)); controller.enqueue(new Uint8Array(1)); },
      cancel() { canceled = true; },
    }), { headers: { "Content-Type": "application/json" } }), "fixture-access-token");
    expect(await health.read()).toEqual({ status: 502, body: { error: "Upstream unavailable" } });
    expect(canceled).toBe(true);
  });
  it("accepts exactly 128 KiB when the entire JSON is valid and projects only schema fields", async () => {
    const json = JSON.stringify(summary);
    const health = session(async () => new Response(json.padEnd(128 * 1024), { headers: { "Content-Type": "application/json; charset=utf-8" } }), "fixture-access-token");
    expect(await health.read()).toEqual({ status: 200, body: summary });
  });
  it.each(["fetch", "body"])("applies a six-second deadline including %s and ignores late results", async (phase) => {
    const late = deferred<Response>();
    let signal: AbortSignal | undefined;
    let canceled = false;
    const health = session(async (_url, options) => {
      signal = options!.signal!;
      if (phase === "fetch") return late.promise;
      await new Promise((done) => setTimeout(done, 100));
      return new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { "Content-Type": "application/json" } });
    }, "fixture-access-token");
    const started = performance.now();
    expect(await health.read()).toEqual({ status: 504, body: { error: "Upstream timed out" } });
    expect(performance.now() - started).toBeGreaterThanOrEqual(5800);
    expect(performance.now() - started).toBeLessThan(8500);
    expect(signal!.aborted).toBe(true);
    if (phase === "body") expect(canceled).toBe(true);
    late.resolve(Response.json(summary));
    health.close();
  }, 10000);
  it("deduplicates concurrent requests while one subscriber can cancel independently", async () => {
    const pending = deferred<Response>();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => { signal = options!.signal!; return pending.promise; });
    const health = session(fetchImpl, "fixture-access-token");
    const controller = new AbortController();
    const first = health.read({ signal: controller.signal });
    const second = health.read();
    controller.abort();
    expect(await first).toEqual({ status: 502, body: { error: "Upstream unavailable" } });
    expect(signal!.aborted).toBe(false);
    pending.resolve(Response.json(summary));
    expect(await second).toEqual({ status: 200, body: summary });
    expect(fetchImpl).toHaveBeenCalledOnce();
    health.close();
  });
  it("aborts after the final subscriber leaves without poisoning a subsequent read", async () => {
    const late = deferred<Response>();
    let oldSignal: AbortSignal | undefined;
    let count = 0;
    const health = session(async (_url, options) => {
      if (++count > 1) return Response.json(summary);
      oldSignal = options!.signal!;
      return late.promise;
    }, "fixture-access-token");
    const controller = new AbortController();
    const first = health.read({ signal: controller.signal });
    controller.abort();
    expect(await first).toMatchObject({ status: 502 });
    expect(oldSignal!.aborted).toBe(true);
    expect(await health.read()).toEqual({ status: 200, body: summary });
    late.resolve(new Response("private", { status: 401 }));
    await new Promise((done) => setTimeout(done, 0));
    expect(await health.read()).toEqual({ status: 200, body: summary });
    health.close();
  });
  it("does not start requests from an already-canceled subscriber", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const signal = AbortSignal.abort();
    expect(await session(fetchImpl, "fixture-access-token").read({ signal })).toMatchObject({ status: 502 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("does not log errors, tokens or upstream payloads", async () => {
    const spies = ["log", "warn", "error", "info", "debug"].map((method) => vi.spyOn(console, method as "log").mockImplementation(() => {}));
    const health = session(async () => { throw new Error("fixture-access-token private-upstream-body"); }, "fixture-access-token");
    expect(await health.read()).toEqual({ status: 502, body: { error: "Upstream unavailable" } });
    expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([]);
    health.close();
  });
});
