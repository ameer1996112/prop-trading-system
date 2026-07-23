import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

import { FoundationDashboard } from "../src/components/FoundationDashboard";

describe("FoundationDashboard", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    routerRefresh.mockReset();
  });

  it("labels unconfigured data and never renders an empty-success state", () => {
    render(
      <FoundationDashboard
        snapshot={{
          source: "UNCONFIGURED",
          ready: false,
          status: "UNKNOWN",
          gates: [],
          message: "No server configured",
          evaluatedAt: null,
          evidenceLastModifiedAt: null,
        }}
      />,
    );
    expect(screen.getByText("UNCONFIGURED")).toBeInTheDocument();
    expect(screen.getByText(/not an empty-success state/i)).toBeInTheDocument();
    expect(screen.queryByText("READY")).not.toBeInTheDocument();
  });

  it("refreshes the dynamic server snapshot on cadence and stops after unmount", async () => {
    vi.useFakeTimers();
    const rendered = render(
      <FoundationDashboard
        snapshot={{
          source: "SERVER_API",
          ready: false,
          status: "BLOCKED",
          gates: [],
          message: "Fail-closed snapshot",
          evaluatedAt: "2026-07-23T00:00:00Z",
          evidenceLastModifiedAt: null,
        }}
      />,
    );
    expect(screen.getByText("Refresh cadence: 30 seconds")).toBeInTheDocument();
    expect(screen.getByText("BLOCKED")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Last refresh requested: 2026-/u)).toBeInTheDocument();
    rendered.unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });
});
