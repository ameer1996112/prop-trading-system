// @vitest-environment node
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RequestPolicy = {
  status: number;
  kind?: "proxy" | "static";
  pathname?: string;
  upstreamUrl?: string;
  headers?: Record<string, string>;
};
type PreviewModule = {
  evaluateRequest: (request: {
    method: string;
    url: string;
    rawHeaders: string[];
  }, port: number) => RequestPolicy;
  createPreviewServer: (options: {
    staticRoot: string;
    fetchImpl: typeof fetch;
    port: number;
  }) => Promise<Server>;
  parsePort: (args: string[]) => number;
};

const { evaluateRequest, createPreviewServer, parsePort }: PreviewModule = await import(
  pathToFileURL(resolve(process.cwd(), "scripts/tradeops-preview.mjs")).href
);
const host = ["Host", "127.0.0.1:4173"];
const check = (url: string, rawHeaders = host, method = "GET") =>
  evaluateRequest({ method, url, rawHeaders }, 4173);

describe("preview request policy", () => {
  it.each([
    ["/health/live", false],
    ["/api/v1/observation-receipts", false],
    ["/api/v1/paper-accounts", true],
    ["/api/v1/paper-simulations/summary", true],
    ["/api/v1/paper-readiness", true],
    ["/api/v1/rd-entry-decisions", true],
  ])("allows only the fixed upstream route %s", (path, protectedRoute) => {
    expect(check(path, [...host, "Authorization", "Bearer fixture-token", "Cookie", "secret=1", "X-Host", "evil.test"])).toEqual({
      status: 200,
      kind: "proxy",
      upstreamUrl: `https://prop-trading-observation-edge.ameer-1996112.workers.dev${path}`,
      headers: protectedRoute
        ? { Accept: "application/json", Authorization: "Bearer fixture-token" }
        : { Accept: "application/json" },
    });
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])("rejects %s without forwarding", (method) => {
    expect(check("/api/v1/paper-accounts", host, method).status).toBe(405);
  });

  it.each(["/api/v1/admin", "/api/v1/paper-accounts/", "/api", "/health", "/health/ready"])("rejects unlisted API/health path %s", (path) => {
    expect(check(path).status).toBe(404);
  });

  it.each(["1", "200"])("accepts canonical limit %s", (limit) => {
    expect(check(`/api/v1/paper-accounts?limit=${limit}`).upstreamUrl).toBe(
      `https://prop-trading-observation-edge.ameer-1996112.workers.dev/api/v1/paper-accounts?limit=${limit}`,
    );
  });

  it.each(["0", "201", "-1", "01", "1.0", "1e2", "+1", "%201", "", "NaN"])("rejects noncanonical/out-of-bounds limit %s", (limit) => {
    expect(check(`/api/v1/paper-accounts?limit=${limit}`).status).toBe(400);
  });

  it.each([
    "/api/v1/paper-accounts?limit=1&limit=2",
    "/api/v1/paper-accounts?limit=1&%6cimit=2",
    "/api/v1/paper-accounts?host=evil.test",
    "/api/v1/paper-accounts?limit=1&x=2",
    "/health/live?limit=1",
    "/api/v1/paper-readiness?limit=1",
    "/health/live?",
  ])("rejects duplicate, unknown, or disallowed query in %s", (path) => {
    expect(check(path).status).toBe(400);
  });

  it.each([
    "https://evil.test/api/v1/paper-accounts",
    "http://127.0.0.1:4173/health/live",
    "//evil.test/health/live",
    "/health/live#fragment",
    "/../package.json",
    "/%2e%2e/package.json",
    "/safe/%2E./package.json",
    "/safe%2f..%2fpackage.json",
    "/safe%5cfile.js",
    "/safe\\file.js",
    "/safe%00.js",
    "/bad%escape.js",
  ])("rejects unsafe request target %s", (path) => {
    expect(check(path).status).toBe(400);
  });

  it.each([
    [],
    ["Host", "evil.test:4173"],
    ["Host", "127.0.0.1:4174"],
    ["Host", "localhost"],
    [...host, "Host", "localhost:4173"],
    [...host, "Origin", "http://evil.test"],
    [...host, "Origin", "http://localhost:4173"],
    [...host, "Origin", "null"],
    [...host, "Origin", "http://127.0.0.1:4173", "Origin", "http://127.0.0.1:4173"],
    [...host, "Sec-Fetch-Site", "cross-site"],
  ].map((headers) => [headers]))("rejects unsafe browser/host metadata %j", (headers) => {
    expect(check("/health/live", headers).status).toBe(403);
  });

  it.each(["127.0.0.1", "localhost"])("accepts an exact matching %s origin and actual port", (hostname) => {
    expect(evaluateRequest({ method: "GET", url: "/", rawHeaders: ["Host", `${hostname}:51234`, "Origin", `http://${hostname}:51234`, "Sec-Fetch-Site", "same-origin"] }, 51234)).toEqual({ status: 200, kind: "static", pathname: "/" });
  });

  it.each(["Bearer", "Bearer ", "Basic abc", "Bearer a b", "Bearer a\tb", "Bearer a\r\nX-Injected: yes", `Bearer ${"a".repeat(1025)}`])("rejects malformed authorization %s", (authorization) => {
    expect(check("/api/v1/paper-accounts", [...host, "Authorization", authorization]).status).toBe(400);
  });

  it("rejects duplicate authorization even on public routes", () => {
    expect(check("/health/live", [...host, "Authorization", "Bearer one", "authorization", "Bearer two"]).status).toBe(400);
  });

  it.each(["a", "a".repeat(1024)])("accepts bounded bearer credentials", (token) => {
    expect(check("/api/v1/paper-accounts", [...host, "Authorization", `Bearer ${token}`]).headers?.Authorization).toBe(`Bearer ${token}`);
  });

  it("accepts the Worker's visible-ASCII bearer punctuation contract", () => {
    const token = "!#$%&'()*+,-./:;<=>?@[\\]^_`{|}~\"";
    expect(check("/api/v1/paper-accounts", [...host, "Authorization", `Bearer ${token}`]).headers?.Authorization).toBe(`Bearer ${token}`);
  });

  it("does not invent a protected credential", () => {
    expect(check("/api/v1/paper-accounts").headers).toEqual({ Accept: "application/json" });
  });
});

describe("preview server", () => {
  let fixture: string;
  let staticRoot: string;
  let server: Server | undefined;
  let port: number;
  let calls: { url: string; options: RequestInit }[];

  beforeEach(async () => {
    fixture = await mkdtemp(join(tmpdir(), "tradeops-preview-"));
    staticRoot = join(fixture, "out");
    await mkdir(join(staticRoot, "_next", "static"), { recursive: true });
    await writeFile(join(staticRoot, "index.html"), "<!doctype html><title>Fixture preview</title>");
    await writeFile(join(staticRoot, "_next/static/app.js"), "window.fixture = true;");
    await writeFile(join(staticRoot, "third-party-notices.txt"), "Fixture attribution");
    await writeFile(join(staticRoot, "unsupported.ts"), "private source");
    await writeFile(join(fixture, "outside.html"), "outside secret");
    await symlink(join(fixture, "outside.html"), join(staticRoot, "escape.html"));
    await symlink(fixture, join(staticRoot, "escape-dir"));
    calls = [];
  });

  afterEach(async () => {
    if (server) {
      const closing = new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done()));
      server.closeAllConnections();
      await closing;
      server = undefined;
    }
    vi.restoreAllMocks();
    await rm(fixture, { recursive: true, force: true });
  });

  async function start(respond: (options: RequestInit) => Response | Promise<Response> = () => Response.json({ fixture: true })) {
    const fetchImpl: typeof fetch = async (input, options = {}) => {
      calls.push({ url: String(input), options });
      return respond(options);
    };
    server = await createPreviewServer({ staticRoot, fetchImpl, port: 0 });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture listener");
    expect(address.address).toBe("127.0.0.1");
    port = address.port;
  }

  function get(path: string, extraHeaders: string[] = [], method = "GET") {
    return new Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }>((done, reject) => {
      const local = request({ hostname: "127.0.0.1", port, method, path, headers: ["Host", `127.0.0.1:${port}`, ...extraHeaders] }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => done({ status: response.statusCode!, body: Buffer.concat(chunks).toString(), headers: response.headers }));
      });
      local.on("error", reject);
      local.end();
    });
  }

  it("serves the export, known assets, and plain-text attribution without caching", async () => {
    await start();
    expect(await get("/")).toMatchObject({ status: 200, body: "<!doctype html><title>Fixture preview</title>", headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    expect(await get("/_next/static/app.js")).toMatchObject({ status: 200, body: "window.fixture = true;", headers: { "content-type": "text/javascript; charset=utf-8" } });
    expect(await get("/third-party-notices.txt")).toMatchObject({ status: 200, body: "Fixture attribution", headers: { "content-type": "text/plain; charset=utf-8" } });
    expect(calls).toHaveLength(0);
  });

  it.each(["/missing", "/package.json", "/unsupported.ts", "/escape.html", "/escape-dir/outside.html"])("returns 404 instead of disclosing %s", async (path) => {
    await start();
    const response = await get(path);
    expect(response.status).toBe(404);
    expect(response.body).not.toMatch(/secret|private source|Fixture preview/);
    expect(calls).toHaveLength(0);
  });

  it.each(["/../outside.html", "/%2e%2e/outside.html", "/escape-dir%2foutside.html", "/%00.html", "/%5coutside.html"])("rejects raw unsafe static target %s", async (path) => {
    await start();
    expect((await get(path)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses startup without a contained exported index", async () => {
    await rm(join(staticRoot, "index.html"));
    await expect(start()).rejects.toThrow("Exported index.html is required");
    await symlink(join(fixture, "outside.html"), join(staticRoot, "index.html"));
    await expect(start()).rejects.toThrow("Exported index.html is required");
  });

  it.each([
    ["/api/v1/observation-receipts?limit=200", false],
    ["/api/v1/paper-accounts?limit=1", true],
  ])("isolates headers for %s and preserves JSON response status", async (path, protectedRoute) => {
    await start(() => new Response('{"message":"fixture"}', { status: 429, headers: { "content-type": "application/problem+json; charset=utf-8", "set-cookie": "upstream-secret", "access-control-allow-origin": "*", "location": "https://evil.test" } }));
    const response = await get(path, ["Authorization", "Bearer fixture-secret", "Cookie", "private=fixture-cookie", "X-Unrelated", "drop-me"]);
    expect(response).toMatchObject({ status: 429, body: '{"message":"fixture"}', headers: { "content-type": "application/problem+json; charset=utf-8", "cache-control": "no-store" } });
    expect(response.headers).not.toHaveProperty("set-cookie");
    expect(response.headers).not.toHaveProperty("access-control-allow-origin");
    expect(response.headers).not.toHaveProperty("location");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://prop-trading-observation-edge.ameer-1996112.workers.dev${path}`);
    expect(calls[0]?.options).toMatchObject({ method: "GET", redirect: "error", cache: "no-store", credentials: "omit", headers: protectedRoute ? { Accept: "application/json", Authorization: "Bearer fixture-secret" } : { Accept: "application/json" } });
    expect(Object.keys(calls[0]!.options.headers!)).toHaveLength(protectedRoute ? 2 : 1);
  });

  it("rejects mutations, unknown paths, forged host/origin, absolute-form targets, and duplicate authorization without fetching", async () => {
    await start();
    expect((await get("/api/v1/paper-accounts", [], "POST")).status).toBe(405);
    expect((await get("/api/v1/unknown")).status).toBe(404);
    expect((await get("/health/live", ["Host", "evil.test"])).status).toBe(403);
    expect((await get("/health/live", ["Origin", "http://evil.test"])).status).toBe(403);
    expect((await get("/health/live", ["Sec-Fetch-Site", "cross-site"])).status).toBe(403);
    expect((await get("https://evil.test/health/live")).status).toBe(400);
    expect((await get("/api/v1/paper-accounts", ["Authorization", "Bearer a b"])).status).toBe(400);
    expect((await get("/api/v1/paper-accounts", ["Authorization", "Bearer one", "authorization", "Bearer two"])).status).toBe(400);
    expect((await get("/api/v1/paper-accounts?limit=201")).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("forwards a visible-ASCII punctuation credential at the HTTP boundary", async () => {
    await start();
    const token = "!#$%&'*+,-./:;<=>?@[]^_`{|}~";
    expect((await get("/api/v1/paper-accounts", ["Authorization", `Bearer ${token}`])).status).toBe(200);
    expect(calls[0]?.options.headers).toEqual({ Accept: "application/json", Authorization: `Bearer ${token}` });
  });

  it.each(["text/html", "text/plain", "application/jsonp", ""])("rejects upstream content type %s with a fixed 502", async (contentType) => {
    await start(() => new Response("upstream-secret", { headers: { "Content-Type": contentType } }));
    expect(await get("/health/live")).toMatchObject({ status: 502, body: '{"error":"Upstream unavailable"}' });
    expect(calls).toHaveLength(1);
  });

  it.each([301, 302, 307, 308])("rejects upstream status %s even if fake fetch returns a redirect", async (status) => {
    await start(() => new Response('{"private":"upstream-secret"}', { status, headers: { "Content-Type": "application/json", Location: "https://evil.test" } }));
    expect(await get("/health/live")).toMatchObject({ status: 502, body: '{"error":"Upstream unavailable"}' });
    expect(calls).toHaveLength(1);
  });

  it("bounds the streamed body at 2 MiB and cancels an overflowing stream", async () => {
    let canceled = false;
    await start(() => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); },
      cancel() { canceled = true; },
    }), { headers: { "Content-Type": "application/json" } }));
    expect(await get("/health/live")).toMatchObject({ status: 502, body: '{"error":"Upstream unavailable"}' });
    expect(canceled).toBe(true);
    expect(calls[0]?.options.signal?.aborted).toBe(true);
  });

  it("accepts exactly 2 MiB without truncating the JSON", async () => {
    const body = `"${"a".repeat(2 * 1024 * 1024 - 2)}"`;
    await start(() => new Response(body, { headers: { "Content-Type": "application/json" } }));
    expect(await get("/health/live")).toMatchObject({ status: 200, body });
  });

  it.each(["request", "request and streamed body"])("enforces one six-second deadline for %s", async (phase) => {
    let canceled = false;
    await start(async () => {
      if (phase === "request") return new Promise<Response>(() => {});
      await new Promise((done) => setTimeout(done, 3100));
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('{"pending":')); },
        cancel() { canceled = true; },
      }), { headers: { "Content-Type": "application/json" } });
    });
    const started = performance.now();
    expect(await get("/health/live")).toMatchObject({ status: 504, body: '{"error":"Upstream timed out"}' });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(5800);
    expect(elapsed).toBeLessThan(8500);
    expect(calls[0]?.options.signal?.aborted).toBe(true);
    if (phase !== "request") expect(canceled).toBe(true);
    expect(calls).toHaveLength(1);
  }, 10000);

  it("aborts upstream when the local response disconnects, not when the GET request body completes", async () => {
    let signal: AbortSignal;
    let markStarted: () => void;
    const started = new Promise<void>((done) => { markStarted = done; });
    let markAborted: () => void;
    const aborted = new Promise<void>((done) => { markAborted = done; });
    await start(async (options) => {
      signal = options.signal!;
      signal.addEventListener("abort", () => markAborted(), { once: true });
      markStarted();
      return new Promise<Response>(() => {});
    });
    const local = request({ hostname: "127.0.0.1", port, path: "/health/live" });
    local.on("error", () => {});
    local.end();
    await started;
    await new Promise((done) => setTimeout(done, 30));
    expect(signal!.aborted).toBe(false);
    local.destroy();
    await aborted;
    expect(signal!.aborted).toBe(true);
  });

  it("does not log credentials, request details, upstream bodies, or thrown error contents", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info"), vi.spyOn(console, "debug")];
    spies.forEach((spy) => spy.mockImplementation(() => {}));
    await start(() => { throw new Error("fixture-secret fixture-cookie upstream-secret"); });
    expect(await get("/api/v1/paper-accounts", ["Authorization", "Bearer fixture-secret", "Cookie", "private=fixture-cookie"])).toMatchObject({ status: 502, body: '{"error":"Upstream unavailable"}' });
    expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("preview CLI port policy", () => {
  it("defaults to 4173 and permits an explicitly bounded port only", () => {
    expect(parsePort([])).toBe(4173);
    expect(parsePort(["--port", "4174"])).toBe(4174);
    expect(parsePort(["--port", "1"])).toBe(1);
    expect(parsePort(["--port", "65535"])).toBe(65535);
  });
  it.each([["--root", "/tmp"], ["--upstream", "https://evil.test"], ["--port", "0"], ["--port", "65536"], ["--port", "04173"], ["--port", "1.5"], ["--port"], ["--port", "4173", "extra"]])("rejects unsupported CLI arguments %j", (...args) => {
    expect(() => parsePort(args)).toThrow("Use --port with an integer from 1 to 65535");
  });
});
