import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  LOADING_OBSERVATION_RECEIPTS,
  ObservationReceiptsPanel,
} from "../src/components/ObservationReceipts";
import type {
  ObservationReceipt,
  ObservationReceiptsSnapshot,
} from "../src/lib/api";

const baseReceipt: ObservationReceipt = {
  symbol: "EURUSD",
  feed: "OANDA",
  kind: "ALERT_OBSERVATION",
  sequence: 42,
  status: "RECEIVED",
  receivedAt: "2026-07-23T10:00:00Z",
};

function snapshot(
  state: ObservationReceiptsSnapshot["state"],
  overrides: Partial<ObservationReceiptsSnapshot> = {},
): ObservationReceiptsSnapshot {
  return {
    state,
    ingressEnabled: state === "BLOCKED" ? false : true,
    count: 0,
    items: [],
    message: `${state.toLowerCase()} observation state`,
    ...overrides,
  };
}

afterEach(cleanup);

describe("ObservationReceiptsPanel", () => {
  it("renders an accessible, fail-closed loading state", () => {
    render(<ObservationReceiptsPanel snapshot={LOADING_OBSERVATION_RECEIPTS} />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { name: "Alert receipts" })).toBeInTheDocument();
    expect(screen.getByText("Verifying ledger")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each([
    ["ERROR", "Ledger unavailable"],
    ["EMPTY", "Ledger is empty"],
    ["BLOCKED", "Ingress blocked"],
  ] as const)("renders the %s state without implying receipt success", (state, heading) => {
    render(<ObservationReceiptsPanel snapshot={snapshot(state)} />);

    expect(screen.getByText(heading)).toBeInTheDocument();
    expect(screen.getByText(state)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders receipt cards and outcome counts without forbidden values", () => {
    const items: ObservationReceipt[] = [
      baseReceipt,
      { ...baseReceipt, symbol: "GBPUSD", sequence: 43, status: "DUPLICATE" },
      { ...baseReceipt, symbol: "USDJPY", sequence: 44, status: "REJECTED" },
    ];
    render(
      <ObservationReceiptsPanel
        snapshot={snapshot("RECEIVED", {
          count: items.length,
          items,
          message: "Safe metadata returned.",
        })}
      />,
    );

    const list = screen.getByRole("list", { name: "Observation receipt cards" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("DUPLICATE")).toBeInTheDocument();
    expect(within(list).getByText("REJECTED")).toBeInTheDocument();
    expect(screen.getAllByText(/execution disconnected/i)).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(
      /idempotency|payload fingerprint|credential|account secret/i,
    );
  });

  it("keeps historical safe metadata visible when ingress is blocked", () => {
    render(
      <ObservationReceiptsPanel
        snapshot={snapshot("BLOCKED", {
          count: 1,
          items: [baseReceipt],
          message: "Ingress disabled.",
        })}
      />,
    );

    expect(screen.getByText("Ingress blocked")).toBeInTheDocument();
    expect(screen.getByText("EURUSD")).toBeInTheDocument();
  });
});
