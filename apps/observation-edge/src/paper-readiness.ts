import type {
  PaperReadinessAccountInput,
  PaperReadinessInput,
  PaperReadinessReason,
  PaperReadinessReport,
  PaperReadinessState,
} from "./types";

export const PAPER_READINESS_THRESHOLDS = {
  receipt_max_age_seconds: 900,
  stale_trade_seconds: 86_400,
  max_daily_loss_bps: 500,
  max_total_drawdown_bps: 1_000,
  max_open_risk_bps: 200,
  max_open_positions: 4,
} as const;

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function ratioBps(numerator: number, denominator: number): number {
  if (numerator <= 0 || denominator <= 0) return 0;
  const value = (BigInt(numerator) * 10_000n) / BigInt(denominator);
  return Number(value > MAX_SAFE_BIGINT ? MAX_SAFE_BIGINT : value);
}

function ratioExceedsBps(
  numerator: number,
  denominator: number,
  limitBps: number,
): boolean {
  if (numerator <= 0 || denominator <= 0) return false;
  return (
    BigInt(numerator) * 10_000n >
    BigInt(denominator) * BigInt(limitBps)
  );
}

function accountReport(account: PaperReadinessAccountInput) {
  const dailyLossMinor = Math.max(0, -account.daily_pnl_minor);
  const dailyLossBps = ratioBps(dailyLossMinor, account.opening_balance_minor);
  const totalDrawdownBps = ratioBps(
    account.max_drawdown_minor,
    account.opening_balance_minor,
  );
  const openRiskBps = ratioBps(
    account.open_risk_minor,
    account.balance_minor,
  );
  const reasons: PaperReadinessReason[] = [];
  if (account.balance_minor <= 0) {
    reasons.push({
      code: "NON_POSITIVE_BALANCE",
      account_id: account.account_id,
      message: `${account.label} has no positive paper balance.`,
    });
  }
  if (dailyLossBps >= PAPER_READINESS_THRESHOLDS.max_daily_loss_bps) {
    reasons.push({
      code: "DAILY_LOSS_LIMIT",
      account_id: account.account_id,
      message: `${account.label} reached the daily-loss limit.`,
    });
  }
  if (
    totalDrawdownBps >=
    PAPER_READINESS_THRESHOLDS.max_total_drawdown_bps
  ) {
    reasons.push({
      code: "TOTAL_DRAWDOWN_LIMIT",
      account_id: account.account_id,
      message: `${account.label} reached the total-drawdown limit.`,
    });
  }
  if (
    ratioExceedsBps(
      account.open_risk_minor,
      account.balance_minor,
      PAPER_READINESS_THRESHOLDS.max_open_risk_bps,
    )
  ) {
    reasons.push({
      code: "OPEN_RISK_LIMIT",
      account_id: account.account_id,
      message: `${account.label} exceeds the aggregate open-risk limit.`,
    });
  }
  if (
    account.open_positions >
    PAPER_READINESS_THRESHOLDS.max_open_positions
  ) {
    reasons.push({
      code: "OPEN_POSITION_LIMIT",
      account_id: account.account_id,
      message: `${account.label} exceeds the open-position limit.`,
    });
  }
  return {
    account_id: account.account_id,
    label: account.label,
    state: reasons.length === 0 ? ("READY" as const) : ("STOPPED" as const),
    daily_pnl_minor: account.daily_pnl_minor,
    daily_loss_bps: dailyLossBps,
    total_drawdown_bps: totalDrawdownBps,
    open_risk_bps: openRiskBps,
    open_positions: account.open_positions,
    reasons,
  };
}

export function paperAccountAllowsNewOpen(
  account: PaperReadinessAccountInput,
  candidateRiskMinor: number,
  candidatePositions = 1,
): boolean {
  if (
    !Number.isSafeInteger(candidateRiskMinor) ||
    candidateRiskMinor <= 0 ||
    !Number.isSafeInteger(candidatePositions) ||
    candidatePositions < 1
  ) {
    return false;
  }
  const openRiskMinor = account.open_risk_minor + candidateRiskMinor;
  const openPositions = account.open_positions + candidatePositions;
  if (
    !Number.isSafeInteger(openRiskMinor) ||
    !Number.isSafeInteger(openPositions)
  ) {
    return false;
  }
  return (
    accountReport({
      ...account,
      open_risk_minor: openRiskMinor,
      open_positions: openPositions,
    }).state === "READY"
  );
}

export function evaluatePaperReadiness(
  input: PaperReadinessInput,
): PaperReadinessReport {
  const reasons: PaperReadinessReason[] = [];
  const accounts = input.accounts.map(accountReport);
  if (input.kill_switch.enabled) {
    reasons.push({
      code: "KILL_SWITCH_ENABLED",
      account_id: null,
      message: `Kill switch engaged: ${input.kill_switch.reason}`,
    });
  }
  if (accounts.length === 0) {
    reasons.push({
      code: "NO_PAPER_ACCOUNTS",
      account_id: null,
      message: "No paper accounts are registered.",
    });
  }
  for (const account of accounts) reasons.push(...account.reasons);

  let receiptAgeSeconds: number | null = null;
  if (input.latest_receipt === null) {
    reasons.push({
      code: "NO_AUTOMATION_RECEIPT",
      account_id: null,
      message: "No TradingView paper-automation receipt has been recorded.",
    });
  } else {
    const receiptTime = Date.parse(input.latest_receipt.received_at);
    const evaluatedTime = Date.parse(input.evaluated_at);
    receiptAgeSeconds = Math.floor((evaluatedTime - receiptTime) / 1_000);
    if (!Number.isFinite(receiptAgeSeconds) || receiptAgeSeconds < -60) {
      receiptAgeSeconds = null;
      reasons.push({
        code: "RECEIPT_CLOCK_SKEW",
        account_id: null,
        message: "The latest automation receipt has an invalid clock offset.",
      });
    } else {
      receiptAgeSeconds = Math.max(0, receiptAgeSeconds);
      if (
        receiptAgeSeconds >
        PAPER_READINESS_THRESHOLDS.receipt_max_age_seconds
      ) {
        reasons.push({
          code: "RECEIPT_STALE",
          account_id: null,
          message: "TradingView paper-automation receipts are stale.",
        });
      }
    }
  }
  if (input.open_health.stale_open_intents > 0) {
    reasons.push({
      code: "STALE_OPEN_INTENT",
      account_id: null,
      message: `${input.open_health.stale_open_intents} open paper intent(s) are stale.`,
    });
  }
  const stopped =
    input.kill_switch.enabled ||
    accounts.some((account) => account.state === "STOPPED");
  const state: PaperReadinessState = stopped
    ? "STOPPED"
    : reasons.length > 0
      ? "DEGRADED"
      : "READY";
  return {
    schema_version: "1.0",
    mode: "PAPER_ONLY",
    state,
    evaluated_at: input.evaluated_at,
    thresholds: PAPER_READINESS_THRESHOLDS,
    kill_switch: input.kill_switch,
    latest_receipt:
      input.latest_receipt === null
        ? null
        : {
            ...input.latest_receipt,
            age_seconds: receiptAgeSeconds,
          },
    open_health: input.open_health,
    accounts,
    reasons,
    execution: "DISABLED",
  };
}
