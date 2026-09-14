import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OriginalClock } from "../src/features/tradeops/OriginalClock";
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("updates the original display clocks locally and allows a tab-memory timezone choice", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-03T06:00:00Z"));
  render(<OriginalClock />);
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.getByText("06:00:01")).toBeInTheDocument();
  expect(screen.getByText("09:00:01")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Clock timezone"), { target: { value: "America/New_York" } });
  expect(screen.getByText("02:00:01")).toBeInTheDocument();
});
