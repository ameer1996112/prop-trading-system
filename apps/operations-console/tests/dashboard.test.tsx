import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  loadApiHealth: vi.fn(),
  loadObservationReceipts: vi.fn(),
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    loadApiHealth: apiMocks.loadApiHealth,
    loadObservationReceipts: apiMocks.loadObservationReceipts,
  };
});

import { FoundationDashboard } from "../src/components/FoundationDashboard";

beforeEach(() => {
  apiMocks.loadApiHealth.mockResolvedValue({
    state: "ONLINE",
    paperSimulator: "ENABLED",
    execution: "DISABLED",
    message: "Observation API is online.",
  });
  apiMocks.loadObservationReceipts.mockResolvedValue({
    state: "EMPTY",
    ingressEnabled: true,
    count: 0,
    items: [],
    message: "No receipts.",
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("FoundationDashboard", () => {
  it("starts fail-closed, then renders verified API and ingress state", async () => {
    render(<FoundationDashboard />);

    expect(screen.getByText("PAPER LAB")).toBeInTheDocument();
    expect(screen.getAllByText("NO EXECUTION").length).toBeGreaterThan(0);
    expect(screen.getByText("OFFLINE")).toBeInTheDocument();
    expect(screen.getByText("BLOCKED")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("ONLINE")).toBeInTheDocument());
    expect(screen.getAllByText("ENABLED")).toHaveLength(2);
    expect(screen.getByText(/no broker connection/i)).toBeInTheDocument();
    expect(screen.getByText(/three-model entry arbitration/i)).toBeInTheDocument();
  });

  it("keeps API and ingress fail-closed when polling cannot verify them", async () => {
    apiMocks.loadApiHealth.mockResolvedValue({
      state: "OFFLINE",
      paperSimulator: "UNKNOWN",
      execution: "UNKNOWN",
      message: "Health unavailable.",
    });
    apiMocks.loadObservationReceipts.mockResolvedValue({
      state: "ERROR",
      ingressEnabled: null,
      count: 0,
      items: [],
      message: "Receipt state unavailable.",
    });

    render(<FoundationDashboard />);

    await waitFor(() => expect(screen.getByText("Ledger unavailable")).toBeInTheDocument());
    expect(screen.getByText("OFFLINE")).toBeInTheDocument();
    expect(screen.getByText("BLOCKED")).toBeInTheDocument();
    expect(screen.queryByText("ENABLED")).not.toBeInTheDocument();
  });

  it("polls both endpoints every 30 seconds and stops after unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const rendered = render(<FoundationDashboard />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiMocks.loadApiHealth).toHaveBeenCalledTimes(1);
    expect(apiMocks.loadObservationReceipts).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(apiMocks.loadApiHealth).toHaveBeenCalledTimes(2);
    expect(apiMocks.loadObservationReceipts).toHaveBeenCalledTimes(2);
    expect(screen.getByText("2026-07-23 12:00:30 UTC")).toBeInTheDocument();

    rendered.unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(apiMocks.loadApiHealth).toHaveBeenCalledTimes(2);
    expect(apiMocks.loadObservationReceipts).toHaveBeenCalledTimes(2);
  });
});
