import { afterEach, describe, expect, it, vi } from "vitest";

import { loadApiHealth } from "../src/lib/api";

function response(body: unknown, status = 200): Response {
  return {
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("loadApiHealth", () => {
  it("uses the same origin by default and accepts only the observation runtime", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        status: "ALIVE",
        mode: "OBSERVATION_ONLY",
        paper_simulator: "ENABLED",
        execution: "DISABLED",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadApiHealth()).resolves.toMatchObject({ state: "ONLINE" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/health/live",
      expect.objectContaining({
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("uses the optional public API base without a trailing slash", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://lab.example/");
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        status: "ALIVE",
        mode: "OBSERVATION_ONLY",
        paper_simulator: "DISABLED",
        execution: "DISABLED",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await loadApiHealth();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://lab.example/health/live",
      expect.any(Object),
    );
  });

  it.each([
    [{ status: "READY", mode: "FOUNDATION_OBSERVATION_ONLY" }, 200],
    [{ status: "ALIVE", mode: "EXECUTION" }, 200],
    [{ status: "ALIVE", mode: "FOUNDATION_OBSERVATION_ONLY" }, 503],
  ])("fails closed on malformed or unhealthy responses", async (body, status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body, status)));
    await expect(loadApiHealth()).resolves.toMatchObject({ state: "OFFLINE" });
  });

  it("fails closed on duplicate JSON keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        text: async () =>
          '{"status":"ALIVE","status":"ALIVE","mode":"FOUNDATION_OBSERVATION_ONLY"}',
      } as Response),
    );
    await expect(loadApiHealth()).resolves.toMatchObject({ state: "OFFLINE" });
  });

  it("aborts a hanging health request at the bounded timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      ),
    );

    const pending = loadApiHealth();
    await vi.advanceTimersByTimeAsync(2_501);
    await expect(pending).resolves.toMatchObject({ state: "OFFLINE" });
  });
});
