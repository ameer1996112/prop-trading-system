import { describe, expect, it } from "vitest";

import { evaluatePaperReadiness } from "../src/paper-readiness";
import type { PaperReadinessInput } from "../src/types";

function input(
  overrides: Partial<PaperReadinessInput> = {},
): PaperReadinessInput {
  return {
    evaluated_at: "2026-07-23T15:00:00Z",
    kill_switch: {
      enabled: false,
      reason: "Automation released after operator review",
      changed_at: "2026-07-23T14:00:00Z",
    },
    latest_receipt: {
      receipt_id: "receipt-a",
      received_at: "2026-07-23T14:55:00Z",
      producer_instance_id: "tradingview-paper-eurusd:1",
      sequence: 12,
      symbol: "EURUSD",
    },
    open_health: {
      open_intents: 0,
      stale_open_intents: 0,
      oldest_open_intent_at: null,
    },
    accounts: [
      {
        account_id: "paper-a",
        label: "Paper A",
        opening_balance_minor: 10_000_000,
        balance_minor: 10_000_000,
        daily_pnl_minor: 0,
        open_risk_minor: 100_000,
        open_positions: 2,
        max_drawdown_minor: 200_000,
      },
    ],
    ...overrides,
  };
}

describe("paper readiness evaluation", () => {
  it("is ready only when evidence and every account remain inside limits", () => {
    expect(evaluatePaperReadiness(input())).toMatchObject({
      state: "READY",
      latest_receipt: { age_seconds: 300 },
      accounts: [
        {
          account_id: "paper-a",
          state: "READY",
          open_risk_bps: 100,
          total_drawdown_bps: 200,
        },
      ],
      reasons: [],
      execution: "DISABLED",
    });
  });

  it("degrades for missing receipts and stale open trades", () => {
    expect(
      evaluatePaperReadiness(
        input({
          latest_receipt: null,
          open_health: {
            open_intents: 2,
            stale_open_intents: 1,
            oldest_open_intent_at: "2026-07-22T10:00:00Z",
          },
        }),
      ),
    ).toMatchObject({
      state: "DEGRADED",
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "NO_AUTOMATION_RECEIPT" }),
        expect.objectContaining({ code: "STALE_OPEN_INTENT" }),
      ]),
    });
  });

  it("stops on hard daily-loss, drawdown, exposure, or position breaches", () => {
    const report = evaluatePaperReadiness(
      input({
        accounts: [
          {
            account_id: "paper-a",
            label: "Paper A",
            opening_balance_minor: 10_000_000,
            balance_minor: 9_000_000,
            daily_pnl_minor: -500_000,
            open_risk_minor: 200_000,
            open_positions: 5,
            max_drawdown_minor: 1_000_000,
          },
        ],
      }),
    );
    expect(report.state).toBe("STOPPED");
    expect(report.accounts[0]).toMatchObject({
      state: "STOPPED",
      daily_loss_bps: 500,
      total_drawdown_bps: 1000,
      open_risk_bps: 222,
    });
    expect(report.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "DAILY_LOSS_LIMIT",
        "TOTAL_DRAWDOWN_LIMIT",
        "OPEN_RISK_LIMIT",
        "OPEN_POSITION_LIMIT",
      ]),
    );
  });

  it("stops when open risk exceeds the cap by less than one whole basis point", () => {
    const report = evaluatePaperReadiness(
      input({
        accounts: [
          {
            account_id: "paper-a",
            label: "Paper A",
            opening_balance_minor: 10_000_000,
            balance_minor: 10_000_000,
            daily_pnl_minor: 0,
            open_risk_minor: 200_001,
            open_positions: 1,
            max_drawdown_minor: 0,
          },
        ],
      }),
    );
    expect(report).toMatchObject({
      state: "STOPPED",
      accounts: [{ state: "STOPPED", open_risk_bps: 200 }],
      reasons: [
        expect.objectContaining({ code: "OPEN_RISK_LIMIT" }),
      ],
    });
  });
});
