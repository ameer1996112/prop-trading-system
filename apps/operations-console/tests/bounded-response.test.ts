import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBounded, loadPaperReadiness, setPaperReadinessKillSwitch } from "../src/lib/api";

const callers: AbortController[] = [];
const closeStreams: (() => void)[] = [];

function caller() {
  const controller = new AbortController();
  callers.push(controller);
  return controller;
}

// Mock only the network boundary: headers arrive, then the real Response body
// remains open until its fetch signal is aborted.
function stalledBodyFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        const abort = () => stream.error(new DOMException("Aborted", "AbortError"));
        init?.signal?.addEventListener("abort", abort, { once: true });
        closeStreams.push(() => {
          init?.signal?.removeEventListener("abort", abort);
          abort();
        });
      },
    });
    return new Response(body, { status: 200 });
  });
}

beforeEach(() => vi.useFakeTimers());

afterEach(async () => {
  callers.splice(0).forEach((controller) => controller.abort());
  closeStreams.splice(0).forEach((close) => close());
  await Promise.resolve();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("bounded response consumption", () => {
  it("can recover a GET on its second attempt after the first body stalls", async () => {
    const stalled = stalledBodyFetch();
    const fetchMock = vi.fn()
      .mockImplementationOnce(stalled)
      .mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchBounded("/health/live", caller().signal);
    await vi.advanceTimersByTimeAsync(6_001);
    const response = await pending;
    expect(await response.text()).toBe("{}");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a GET body after headers and exhausts only the bounded read retries", async () => {
    const fetchMock = stalledBodyFetch();
    vi.stubGlobal("fetch", fetchMock);
    let failure: unknown;
    const pending = loadPaperReadiness("operator-secret", caller().signal).catch((error) => {
      failure = error;
    });

    await vi.advanceTimersByTimeAsync(12_001);
    expect(failure).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forwards caller cancellation after headers without retrying the GET", async () => {
    const fetchMock = stalledBodyFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = caller();
    let failure: unknown;
    const pending = loadPaperReadiness("operator-secret", controller.signal).catch((error) => {
      failure = error;
    });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);

    expect(failure).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a POST body without replaying the potentially applied control", async () => {
    const fetchMock = stalledBodyFetch();
    vi.stubGlobal("fetch", fetchMock);
    let failure: unknown;
    const pending = setPaperReadinessKillSwitch(
      "operator-secret", true, "Timeout drill", caller().signal,
    ).catch((error) => { failure = error; });

    await vi.advanceTimersByTimeAsync(6_001);
    expect(failure).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forwards caller cancellation while reading a POST body", async () => {
    const fetchMock = stalledBodyFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = caller();
    let failure: unknown;
    const pending = setPaperReadinessKillSwitch(
      "operator-secret", true, "Cancel drill", controller.signal,
    ).catch((error) => { failure = error; });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);

    expect(failure).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await pending;
  });

  it("never sends a POST whose caller was already cancelled", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = caller();
    controller.abort();

    await expect(setPaperReadinessKillSwitch(
      "operator-secret", true, "Cancelled drill", controller.signal,
    )).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cleans up deadlines after a complete successful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    const response = await fetchBounded("/health/live", caller().signal);
    expect(await response.text()).toBe("{}");
    expect(vi.getTimerCount()).toBe(0);
  });
});
