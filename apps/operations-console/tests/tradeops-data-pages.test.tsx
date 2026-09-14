import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OriginalDataPage } from "../src/features/tradeops/OriginalDataPage";

afterEach(cleanup);
describe("original data page layouts", () => {
  it("keeps every original Analytics section even without historical data", () => {
    render(<OriginalDataPage view="analytics"><p>Loaded paper metrics</p></OriginalDataPage>);
    for (const name of ["Performance Intelligence", "Performance Score", "Intelligence Insights", "Strategy Breakdown", "Breakdown Analysis", "Time-of-Day Analysis", "Pattern Analysis", "Rolling Metrics", "Streak Analysis", "Zone & Setup Analysis"]) expect(screen.getByRole("heading", { name })).toBeVisible();
    expect(screen.getByRole("group", { name: "Analytics period" })).toBeVisible();
  });
  it("keeps the original Fleet Summary and Journal summary sections", () => {
    const { rerender } = render(<OriginalDataPage view="risk"><p>Paper readiness</p></OriginalDataPage>);
    expect(screen.getByRole("heading", { name: "Fleet Summary" })).toBeVisible();
    rerender(<OriginalDataPage view="journal"><p>Paper journal</p></OriginalDataPage>);
    expect(screen.getByRole("region", { name: "Journal statistics" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Symbol Breakdown" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Pattern Analysis" })).toBeVisible();
  });
  it("retains Accounts credential disclosure without enabling broker writes", () => {
    render(<OriginalDataPage view="accounts"><p>Paper data</p></OriginalDataPage>);
    fireEvent.click(screen.getByText("Manage Broker Credentials"));
    expect(screen.getByRole("button", { name: "Add broker profile" })).toBeDisabled();
    expect(screen.getByText(/Broker credential management is unavailable/)).toBeVisible();
  });
  it("retains Risk monitor and rules tabs with disabled unsupported controls", () => {
    render(<OriginalDataPage view="risk"><p>Readiness data</p></OriginalDataPage>);
    fireEvent.click(screen.getByRole("tab", { name: "Risk Rules" }));
    expect(screen.getByRole("columnheader", { name: "Risk %" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add Rule" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "Monitor" }));
    expect(screen.getByText("Readiness data")).toBeVisible();
  });
  it("keeps Journal table/calendar selection and unknown historical charts", () => {
    render(<OriginalDataPage view="journal"><p>Paper journal table</p></OriginalDataPage>);
    expect(screen.getByRole("heading", { name: "Equity Curve" })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(screen.getByText(/Calendar PnL unavailable/)).toBeVisible();
    expect(screen.queryByText("Paper journal table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    expect(screen.getByText("Paper journal table")).toBeVisible();
  });
});
