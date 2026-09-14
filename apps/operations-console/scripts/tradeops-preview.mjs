import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMt5HealthSession } from "./mt5-health-proxy.mjs";
import { acquireMt5AccessToken } from "./mt5-health-access.mjs";

export const UPSTREAM = "https://prop-trading-observation-edge.ameer-1996112.workers.dev";
export const ROUTES = new Map([
  ["/health/live", { protected: false, limit: null }],
  ["/api/v1/observation-receipts", { protected: false, limit: 200 }],
  ["/api/v1/paper-accounts", { protected: true, limit: 200 }],
  ["/api/v1/paper-simulations/summary", { protected: true, limit: 200 }],
  ["/api/v1/paper-readiness", { protected: true, limit: null }],
  ["/api/v1/rd-entry-decisions", { protected: true, limit: 200 }],
]);

function headerValues(rawHeaders, name) {
  const values = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() === name) values.push(rawHeaders[i + 1]);
  }
  return values;
}

// Validate the original request target before any URL/path normalization.
export function evaluateRequest({ method, url, rawHeaders }, port) {
  const hosts = headerValues(rawHeaders, "host");
  const origins = headerValues(rawHeaders, "origin");
  const fetchSites = headerValues(rawHeaders, "sec-fetch-site");
  if (hosts.length !== 1 || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(hosts[0]) ||
      origins.length > 1 || (origins.length === 1 && origins[0] !== `http://${hosts[0]}`) ||
      fetchSites.length > 1 || fetchSites.some((value) => value.toLowerCase() === "cross-site")) {
    return { status: 403 };
  }
  if (method !== "GET") return { status: 405 };
  if (!url.startsWith("/") || url.startsWith("//") || /[\\\x00-\x20#]/.test(url)) return { status: 400 };
  const queryAt = url.indexOf("?");
  const rawPath = queryAt < 0 ? url : url.slice(0, queryAt);
  if (/%(?:2f|5c|00)/i.test(rawPath)) return { status: 400 };
  let pathname;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    return { status: 400 };
  }
  if (/[\\\x00-\x1f]/.test(pathname) || pathname.split("/").some((part) => part === "." || part === "..")) {
    return { status: 400 };
  }
  const authorizations = headerValues(rawHeaders, "authorization");
  const credential = authorizations[0]?.match(/^Bearer ([\x21-\x7e]{1,1024})$/)?.[1];
  if (authorizations.length > 1 || (authorizations.length === 1 && (!credential || credential.length > 1024))) {
    return { status: 400 };
  }
  if (pathname === "/api/v1/mt5-health-summary") {
    return queryAt >= 0 ? { status: 400 } : { status: 200, kind: "mt5-health" };
  }
  const route = ROUTES.get(pathname);
  if (!route) {
    if (/^\/(?:api|health)(?:\/|$)/.test(pathname)) return { status: 404 };
    return { status: 200, kind: "static", pathname };
  }
  let query = "";
  if (queryAt >= 0) {
    const params = [...new URLSearchParams(url.slice(queryAt + 1))];
    if (!route.limit || params.length !== 1 || params[0][0] !== "limit" ||
        !/^[1-9][0-9]*$/.test(params[0][1]) || Number(params[0][1]) > route.limit) {
      return { status: 400 };
    }
    query = `?limit=${params[0][1]}`;
  }
  const headers = { Accept: "application/json" };
  if (route.protected && credential) headers.Authorization = `Bearer ${credential}`;
  return { status: 200, kind: "proxy", upstreamUrl: `${UPSTREAM}${pathname}${query}`, headers };
}

const STATIC_ROOT = fileURLToPath(new URL("../out/", import.meta.url));
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 6000;
const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
]);
const SAFE_ERRORS = new Map([
  [401, "AUTH_REQUIRED"],
  [400, "Invalid request"],
  [403, "Request forbidden"],
  [404, "Not found"],
  [405, "Method not allowed"],
  [500, "Preview unavailable"],
  [502, "Upstream unavailable"],
  [504, "Upstream timed out"],
]);

function sendError(response, status) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: SAFE_ERRORS.get(status) }));
}

function isContained(root, path) {
  const suffix = relative(root, path);
  return suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

async function serveStatic(response, root, pathname) {
  let path;
  let contentType;
  try {
    path = await realpath(resolve(root, `.${pathname}`));
    if (!isContained(root, path)) return sendError(response, 404);
    if ((await stat(path)).isDirectory()) path = await realpath(resolve(path, "index.html"));
    if (!isContained(root, path) || !(await stat(path)).isFile()) return sendError(response, 404);
    contentType = MIME_TYPES.get(extname(path));
    if (!contentType) return sendError(response, 404);
  } catch {
    return sendError(response, 404);
  }
  response.writeHead(200, { "Content-Type": contentType });
  // Pipeline owns stream cleanup when the browser disconnects.
  await pipeline(createReadStream(path), response).catch(() => response.destroy());
}

async function proxyJson(response, policy, fetchImpl) {
  const controller = new AbortController();
  let timedOut = false;
  let reader;
  const cancel = () => controller.abort();
  const deadline = setTimeout(() => { timedOut = true; cancel(); }, UPSTREAM_TIMEOUT_MS);
  // IncomingMessage.close also fires after a normal body-less GET completes.
  // ServerResponse.close tracks the browser connection we actually depend on.
  response.once("close", cancel);
  const aborted = new Promise((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("Canceled")), { once: true });
  });
  try {
    const result = await Promise.race([
      aborted,
      (async () => {
        const upstream = await fetchImpl(policy.upstreamUrl, {
          method: "GET", headers: policy.headers, redirect: "error",
          credentials: "omit", cache: "no-store", signal: controller.signal,
        });
        reader = upstream.body?.getReader();
        controller.signal.throwIfAborted();
        const mediaType = (upstream.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
        if (upstream.status < 200 || upstream.status >= 600 || (upstream.status >= 300 && upstream.status < 400) ||
            !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(mediaType)) {
          throw new Error("Invalid upstream response");
        }
        const chunks = [];
        let total = 0;
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            controller.signal.throwIfAborted();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_BODY_BYTES) throw new Error("Upstream body too large");
            chunks.push(Buffer.from(value));
          }
        }
        return { status: upstream.status, mediaType, body: Buffer.concat(chunks, total) };
      })(),
    ]);
    if (!response.destroyed) {
      response.writeHead(result.status, { "Content-Type": `${result.mediaType}; charset=utf-8` });
      response.end(result.body);
    }
  } catch {
    sendError(response, timedOut ? 504 : 502);
  } finally {
    clearTimeout(deadline);
    response.off("close", cancel);
    cancel();
    // Never await an untrusted stream's cancellation promise.
    if (reader) void reader.cancel().catch(() => {});
  }
}

// Injection is for local tests only. The CLI below always uses the fixed root
// and upstream; neither environment variables nor arguments can override them.
export async function createPreviewServer({ staticRoot = STATIC_ROOT, fetchImpl = fetch, port = 4173, mt5HealthSession = createMt5HealthSession() } = {}) {
  let root;
  let closing = false;
  try {
    root = await realpath(staticRoot);
    const index = await realpath(resolve(root, "index.html"));
    if (!isContained(root, index) || !(await stat(index)).isFile()) throw new Error();
  } catch {
    mt5HealthSession.close();
    throw new Error("Exported index.html is required");
  }
  const server = createServer({ maxHeaderSize: 8192, headersTimeout: 10000, requestTimeout: 10000 }, (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const policy = evaluateRequest(request, server.address().port);
    if (policy.status !== 200) return sendError(response, policy.status);
    if (policy.kind === "mt5-health") {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      response.once("close", cancel);
      void mt5HealthSession.read({ signal: controller.signal }).then((result) => {
        if (response.destroyed || response.writableEnded || controller.signal.aborted) return;
        if (closing) return sendError(response, 401);
        response.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(result.body));
      }).catch(() => sendError(response, 502)).finally(() => response.off("close", cancel));
      return;
    }
    const work = policy.kind === "proxy"
      ? proxyJson(response, policy, fetchImpl)
      : serveStatic(response, root, policy.pathname);
    void work.catch(() => sendError(response, 500));
  });
  // Purge at the start of shutdown, not only after active sockets have closed.
  const close = server.close;
  server.close = function (...args) {
    closing = true;
    mt5HealthSession.close();
    return close.apply(this, args);
  };
  server.once("close", () => mt5HealthSession.close());
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      done();
    });
  }).catch((error) => { mt5HealthSession.close(); throw error; });
  return server;
}

export function parsePort(args) {
  if (args.length === 0) return 4173;
  if (args.length !== 2 || args[0] !== "--port" || !/^[1-9][0-9]*$/.test(args[1]) || Number(args[1]) > 65535) {
    throw new Error("Use --port with an integer from 1 to 65535");
  }
  return Number(args[1]);
}

export function parsePreviewArgs(args) {
  const flags = args.filter((arg) => arg === "--mt5-health");
  try {
    if (flags.length > 1 || (flags.length === 1 && args[0] !== "--mt5-health" && args.at(-1) !== "--mt5-health")) throw new Error();
    return { port: parsePort(args.filter((arg) => arg !== "--mt5-health")), mt5Health: flags.length === 1 };
  } catch {
    throw new Error("Use --mt5-health once and/or --port with an integer from 1 to 65535");
  }
}

export async function startPreview(args, {
  acquireTokenImpl = acquireMt5AccessToken,
  createServerImpl = createPreviewServer,
  onAuthStart = () => {},
  onAuthRequired = () => {},
  signal,
} = {}) {
  const { port, mt5Health } = parsePreviewArgs(args);
  signal?.throwIfAborted();
  let token;
  if (mt5Health) {
    onAuthStart();
    try { token = await acquireTokenImpl({ signal }); }
    catch {
      signal?.throwIfAborted();
      onAuthRequired();
    }
  }
  const mt5HealthSession = createMt5HealthSession({ token });
  token = undefined;
  try {
    signal?.throwIfAborted();
    const server = await createServerImpl({ port, mt5HealthSession });
    if (signal?.aborted) {
      server.close();
      server.closeAllConnections();
      signal.throwIfAborted();
    }
    return server;
  } catch (error) {
    mt5HealthSession.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  let server;
  const shutdown = () => {
    controller.abort();
    server?.close();
    server?.closeAllConnections();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    server = await startPreview(process.argv.slice(2), {
      signal: controller.signal,
      onAuthStart: () => console.log("MT5 health: complete Cloudflare Access sign-in in your browser if prompted."),
      onAuthRequired: () => console.warn("MT5 health: AUTH_REQUIRED. Preview will start disconnected; restart with --mt5-health to retry sign-in."),
    });
    console.log(`TradeOps preview: http://127.0.0.1:${server.address().port}`);
    server.once("close", () => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
    });
  } catch {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    console.error("Preview could not start. Build the static export and use an available local port (--port 1..65535); --mt5-health enables Access sign-in.");
    process.exitCode = 1;
  }
}
