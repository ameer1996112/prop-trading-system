// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type ChildProcess, type SpawnOptions } from "node:child_process";
import { type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

type SpawnImpl = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
type AcquireToken = (options?: { spawnImpl?: SpawnImpl; signal?: AbortSignal }) => Promise<string>;
type Cli = {
  parsePreviewArgs?: (args: string[]) => { port: number; mt5Health: boolean };
  parsePort: (args: string[]) => number;
  startPreview?: (args: string[], options?: { acquireTokenImpl?: AcquireToken; createServerImpl?: (options: { port: number; mt5HealthSession: { close: () => void } }) => Promise<Server>; signal?: AbortSignal }) => Promise<Server>;
};
const access: { acquireMt5AccessToken?: AcquireToken } = await import(pathToFileURL(resolve("scripts/mt5-health-access.mjs")).href).catch(() => ({}));
const cli: Cli = await import(pathToFileURL(resolve("scripts/tradeops-preview.mjs")).href);
const origin = "https://prop-trading-agent-health-console-dry-run.ameer-1996112.workers.dev";
// Synthetic, non-authenticating JWT-shaped data; never a real credential.
const fixtureToken = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c2lnbmF0dXJl";
const safeError = "MT5 Access authentication required";

function childFixture() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
  const spawnImpl = vi.fn<SpawnImpl>(() => child as unknown as ChildProcess);
  return { child, spawnImpl };
}
function acquire(spawnImpl: SpawnImpl, signal?: AbortSignal) {
  expect(access.acquireMt5AccessToken).toBeTypeOf("function");
  return access.acquireMt5AccessToken!({ spawnImpl, signal });
}
function parse(args: string[]) {
  expect(cli.parsePreviewArgs).toBeTypeOf("function");
  return cli.parsePreviewArgs!(args);
}

describe("explicit preview health arguments", () => {
  it("remains disconnected without the explicit flag", () => {
    expect(parse([])).toEqual({ port: 4173, mt5Health: false });
    expect(parse(["--port", "4174"])).toEqual({ port: 4174, mt5Health: false });
  });
  it.each([["--mt5-health"], ["--mt5-health", "--port", "4173"], ["--port", "4173", "--mt5-health"]])("accepts the flag once alongside port %j", (...args) => {
    expect(parse(args)).toEqual({ port: 4173, mt5Health: true });
  });
  it.each([["--mt5-health", "--mt5-health"], ["--token", fixtureToken], ["--upstream", "https://evil.test"], ["--mt5-health=true"], ["--mt5-health", "--port", "0"], ["--mt5-health", "--port", "04173"], ["--port", "--mt5-health", "4173"], ["--port", "4173", "--port", "4174"]])("rejects unsupported arguments without reflecting them", (...args) => {
    expect(() => parse(args)).toThrow("Use --mt5-health once and/or --port with an integer from 1 to 65535");
  });
  it("preserves the existing parsePort API", () => {
    expect(cli.parsePort([])).toBe(4173);
    expect(cli.parsePort(["--port", "65535"])).toBe(65535);
    expect(() => cli.parsePort(["--mt5-health"])).toThrow("Use --port with an integer from 1 to 65535");
  });
});

describe("captured Access startup authentication", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it("invokes only the fixed app login with captured pipes and no shell or token argument/environment", async () => {
    const { child, spawnImpl } = childFixture();
    const result = acquire(spawnImpl);
    child.stdout.write(fixtureToken.slice(0, 15));
    child.stdout.write(`${fixtureToken.slice(15)}\n`);
    child.stderr.write("private browser-login-url and diagnostic");
    child.emit("close", 0);
    expect(await result).toBe(fixtureToken);
    expect(spawnImpl).toHaveBeenCalledOnce();
    expect(spawnImpl.mock.calls[0]).toEqual(["cloudflared", ["access", "login", "--app", origin, "--no-verbose"], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }]);
  });
  it.each(["", "not-a-jwt", `${fixtureToken}\n${fixtureToken}`, `token: ${fixtureToken}`, `${fixtureToken}\r\nPrivate-Header: value`, "a.b.c "])("rejects malformed stdout with a generic error", async (stdout) => {
    const { child, spawnImpl } = childFixture();
    const result = acquire(spawnImpl);
    const rejection = expect(result).rejects.toThrow(safeError);
    child.stdout.write(stdout);
    child.emit("close", 0);
    await rejection;
  });
  it.each(["stdout", "stderr"] as const)("terminates if captured %s exceeds 32 KiB", async (stream) => {
    const { child, spawnImpl } = childFixture();
    const result = acquire(spawnImpl);
    const rejection = expect(result).rejects.toThrow(safeError);
    child[stream].write("x".repeat(32 * 1024 + 1));
    await rejection;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
  it("rejects token text over 16 KiB even within the capture limit", async () => {
    const { child, spawnImpl } = childFixture();
    const result = acquire(spawnImpl);
    const rejection = expect(result).rejects.toThrow(safeError);
    child.stdout.write(`a.${"b".repeat(16384)}.c`);
    child.emit("close", 0);
    await rejection;
  });
  it("bounds login at two minutes and ignores token output after timeout", async () => {
    vi.useFakeTimers();
    const { child, spawnImpl } = childFixture();
    const result = acquire(spawnImpl);
    const rejection = expect(result).rejects.toThrow(safeError);
    await vi.advanceTimersByTimeAsync(120000);
    await rejection;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("close", 0);
  });
  it("cancels the child when startup is interrupted", async () => {
    const { child, spawnImpl } = childFixture();
    const controller = new AbortController();
    const result = acquire(spawnImpl, controller.signal);
    const rejection = expect(result).rejects.toThrow(safeError);
    controller.abort();
    await rejection;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
  it("does not spawn after startup was already canceled", async () => {
    const { spawnImpl } = childFixture();
    await expect(acquire(spawnImpl, AbortSignal.abort())).rejects.toThrow(safeError);
    expect(spawnImpl).not.toHaveBeenCalled();
  });
  it.each(["exit", "spawn-event", "spawn-throw"])("redacts %s failure and never logs stdout/stderr/errors", async (failure) => {
    const spies = ["log", "warn", "error", "info", "debug"].map((method) => vi.spyOn(console, method as "log").mockImplementation(() => {}));
    const { child, spawnImpl } = childFixture();
    if (failure === "spawn-throw") spawnImpl.mockImplementation(() => { throw new Error(fixtureToken); });
    const result = acquire(spawnImpl);
    const rejection = expect(result).rejects.toThrow(safeError);
    if (failure !== "spawn-throw") {
      child.stdout.write(fixtureToken);
      child.stderr.write(`secret diagnostic ${fixtureToken}`);
      if (failure === "exit") child.emit("close", 1);
      else child.emit("error", new Error(fixtureToken));
    }
    await rejection;
    expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([]);
  });
});

describe("preview startup ownership", () => {
  it.each([false, true])("authenticates only for explicit enabled=%s", async (enabled) => {
    expect(cli.startPreview).toBeTypeOf("function");
    const acquireTokenImpl = vi.fn<AcquireToken>(async () => fixtureToken);
    const server = { close: vi.fn() } as unknown as Server;
    const createServerImpl = vi.fn(async () => server);
    expect(await cli.startPreview!(enabled ? ["--mt5-health", "--port", "4174"] : ["--port", "4174"], { acquireTokenImpl, createServerImpl })).toBe(server);
    expect(acquireTokenImpl).toHaveBeenCalledTimes(enabled ? 1 : 0);
    expect(createServerImpl).toHaveBeenCalledWith({ port: 4174, mt5HealthSession: { read: expect.any(Function), close: expect.any(Function) } });
  });
  it("starts a disconnected preview without retrying login after authentication failure", async () => {
    expect(cli.startPreview).toBeTypeOf("function");
    const acquireTokenImpl = vi.fn<AcquireToken>(async () => { throw new Error(safeError); });
    const server = { close: vi.fn() } as unknown as Server;
    const createServerImpl = vi.fn(async () => server);
    expect(await cli.startPreview!(["--mt5-health"], { acquireTokenImpl, createServerImpl })).toBe(server);
    expect(acquireTokenImpl).toHaveBeenCalledOnce();
    expect(createServerImpl).toHaveBeenCalledOnce();
  });
});
