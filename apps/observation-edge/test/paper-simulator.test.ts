import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { handleRequest } from "../src/index";
import {
  INSERT_AUTOMATED_PAPER_TRADE_INTENT_SQL,
  INSERT_PAPER_TRADE_ALLOCATION_SQL,
  INSERT_PAPER_TRADE_INTENT_SQL,
  INSERT_PAPER_TRADE_SETTLEMENT_SQL,
  LIST_PAPER_SIMULATION_ACCOUNT_STATS_SQL,
  LIST_PAPER_SIMULATION_ROWS_SQL,
  LIST_PAPER_TRADE_ALLOCATIONS_SQL,
  SELECT_PAPER_TRADE_INTENT_SQL,
  SELECT_PAPER_TRADE_SETTLEMENT_SQL,
} from "../src/paper-simulator-queries";
import {
  INSERT_PAPER_KILL_SWITCH_EVENT_SQL,
  INSERT_BLOCKED_PAPER_AUTOMATION_INTENT_SQL,
  LIST_PAPER_ACCOUNT_READINESS_METRICS_SQL,
  SELECT_LATEST_PAPER_AUTOMATION_RECEIPT_SQL,
  SELECT_LATEST_PAPER_KILL_SWITCH_SQL,
  SELECT_BLOCKED_PAPER_AUTOMATION_INTENT_SQL,
  SELECT_PAPER_ACCOUNT_READINESS_METRIC_SQL,
  SELECT_PAPER_KILL_SWITCH_BY_IDEMPOTENCY_SQL,
  SELECT_PAPER_OPEN_INTENT_HEALTH_SQL,
} from "../src/paper-readiness-queries";
import {
  INSERT_RECEIPT_SQL,
  SELECT_RECEIPT_SQL,
} from "../src/queries";
import {
  SELECT_PAPER_ACCOUNT_PROJECTION_SQL,
} from "../src/paper-ledger-queries";
import type {
  Env,
  PaperAccountProjection,
  PaperReadinessAccountInput,
  PaperSimulationAccountStat,
  PaperSimulationRow,
  StoredPaperKillSwitchEvent,
  StoredBlockedPaperAutomationIntent,
  StoredPaperTradeAllocation,
  StoredPaperTradeIntent,
  StoredPaperTradeSettlement,
  StoredReceipt,
} from "../src/types";

const BASE_URL = "https://prop-trading-observation-edge.example";
const PAPER_CREDENTIAL = "paper-simulator-test-secret";
const TRADINGVIEW_CREDENTIAL = "tradingview-automation-test-secret";

function result<T>(results: T[] = [], changes = 0): D1Result<T> {
  return {
    success: true,
    results,
    meta: { changes },
  } as unknown as D1Result<T>;
}

class SimulatorFakeStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: SimulatorFakeD1,
    readonly sql: string,
  ) {}

  bind(...values: unknown[]): SimulatorFakeStatement {
    this.values = values;
    return this;
  }

  async run(): Promise<D1Result> {
    if (this.sql === INSERT_RECEIPT_SQL) {
      const receipt: StoredReceipt = {
        receipt_id: String(this.values[0]),
        received_at: String(this.values[1]),
        idempotency_key: String(this.values[2]),
        payload_sha256: String(this.values[3]),
        schema_version: this.values[4] as "1.0" | "1.1",
        strategy_id: "rd_liquidity_sd_5m_v1",
        strategy_version: this.values[6] as
          | "1.0.0-phase1"
          | "1.1.0-paper1",
        producer_instance_id: String(this.values[7]),
        sequence: Number(this.values[8]),
        symbol: String(this.values[9]),
        ticker_id: String(this.values[10]),
        feed: String(this.values[11]),
        timeframe: "5",
        kind: this.values[13] as "incremental" | "snapshot",
      };
      const exists = this.database.receipts.has(receipt.idempotency_key);
      if (exists) throw new Error("UNIQUE constraint failed");
      this.database.receipts.set(receipt.idempotency_key, receipt);
      return result([], 1);
    }
    if (this.sql === INSERT_AUTOMATED_PAPER_TRADE_INTENT_SQL) {
      const intent: StoredPaperTradeIntent = {
        intent_id: String(this.values[0]),
        idempotency_key: String(this.values[1]),
        payload_sha256: String(this.values[2]),
        symbol: String(this.values[3]),
        side: this.values[4] as "BUY" | "SELL",
        entry_price: String(this.values[5]),
        stop_loss: String(this.values[6]),
        take_profit: String(this.values[7]),
        risk_bps: Number(this.values[8]),
        source: "TRADINGVIEW",
        source_receipt_id: String(this.values[9]),
        created_at: String(this.values[10]),
      };
      if (this.database.blockedIntents.has(intent.intent_id)) {
        throw new Error("paper intent id already blocked");
      }
      const exists = this.database.intents.has(intent.intent_id);
      if (exists) throw new Error("UNIQUE constraint failed");
      this.database.intents.set(intent.intent_id, intent);
      return result([], 1);
    }
    if (this.sql === INSERT_PAPER_TRADE_INTENT_SQL) {
      const intent: StoredPaperTradeIntent = {
        intent_id: String(this.values[0]),
        idempotency_key: String(this.values[1]),
        payload_sha256: String(this.values[2]),
        symbol: String(this.values[3]),
        side: this.values[4] as "BUY" | "SELL",
        entry_price: String(this.values[5]),
        stop_loss: String(this.values[6]),
        take_profit: String(this.values[7]),
        risk_bps: Number(this.values[8]),
        source: "MANUAL",
        source_receipt_id: null,
        created_at: String(this.values[9]),
      };
      if (this.database.blockedIntents.has(intent.intent_id)) {
        throw new Error("paper intent id already blocked");
      }
      const exists = this.database.intents.has(intent.intent_id);
      if (exists) throw new Error("UNIQUE constraint failed");
      this.database.intents.set(intent.intent_id, intent);
      return result([], 1);
    }
    if (this.sql === INSERT_PAPER_TRADE_ALLOCATION_SQL) {
      const riskBps = Number(this.values[0]);
      const accountId = String(this.values[1]);
      const intentId = String(this.values[2]);
      const payloadSha256 = String(this.values[3]);
      const intent = this.database.intents.get(intentId);
      const projection = this.database.projection(accountId);
      if (
        intent === undefined ||
        intent.payload_sha256 !== payloadSha256 ||
        projection === null
      ) {
        throw new Error("allocation guard failed");
      }
      const key = `${intentId}:${accountId}`;
      const exists = this.database.allocations.has(key);
      const riskAmountMinor = Math.trunc(
        (projection.balance_minor * riskBps) / 10_000,
      );
      if (exists) throw new Error("UNIQUE constraint failed");
      this.database.allocations.set(key, {
        allocation_id: String(this.values[4]),
        intent_id: intentId,
        account_id: String(this.values[5]),
        risk_amount_minor: riskAmountMinor,
        balance_before_minor: projection.balance_minor,
        created_at: String(this.values[6]),
      });
      return result([], 1);
    }
    if (this.sql === INSERT_PAPER_TRADE_SETTLEMENT_SQL) {
      const intentId = String(this.values[1]);
      const exists = this.database.settlements.has(intentId);
      if (exists) throw new Error("UNIQUE constraint failed");
      this.database.settlements.set(intentId, {
        settlement_id: String(this.values[0]),
        intent_id: intentId,
        idempotency_key: String(this.values[2]),
        payload_sha256: String(this.values[3]),
        outcome_r_millis: Number(this.values[4]),
        exit_reason: this.values[5] as "STOP" | "TARGET" | "MANUAL",
        settled_at: String(this.values[6]),
      });
      return result([], 1);
    }
    if (this.sql === INSERT_PAPER_KILL_SWITCH_EVENT_SQL) {
      const event: StoredPaperKillSwitchEvent = {
        control_sequence: this.database.nextControlSequence,
        event_id: String(this.values[0]),
        idempotency_key: String(this.values[1]),
        payload_sha256: String(this.values[2]),
        enabled: Number(this.values[3]) as 0 | 1,
        reason: String(this.values[4]),
        changed_at: String(this.values[5]),
      };
      const exists = this.database.killSwitchEvents.has(event.idempotency_key);
      if (!exists) {
        this.database.killSwitchEvents.set(event.idempotency_key, event);
        this.database.nextControlSequence += 1;
      }
      return result([], exists ? 0 : 1);
    }
    if (this.sql === INSERT_BLOCKED_PAPER_AUTOMATION_INTENT_SQL) {
      const intentId = String(this.values[0]);
      if (this.database.intents.has(intentId)) {
        throw new Error("paper intent id already live");
      }
      const exists = this.database.blockedIntents.has(intentId);
      if (exists) throw new Error("UNIQUE constraint failed");
      this.database.blockedIntents.set(intentId, {
        intent_id: intentId,
        source_receipt_id: String(this.values[1]),
        payload_sha256: String(this.values[2]),
        reason_code: this.values[3] as
          | "KILL_SWITCH_ENABLED"
          | "RISK_LIMIT_REACHED"
          | "SAFETY_GATE_RACE"
          | "ACCOUNT_NOT_FOUND"
          | "NON_POSITIVE_BALANCE",
        blocked_at: String(this.values[4]),
      });
      return result([], 1);
    }
    throw new Error("unexpected run statement");
  }

  async first<T>(): Promise<T | null> {
    if (this.sql === SELECT_RECEIPT_SQL) {
      return (
        (this.database.receipts.get(String(this.values[0])) as T | undefined) ??
        null
      );
    }
    if (this.sql === SELECT_PAPER_ACCOUNT_PROJECTION_SQL) {
      return this.database.projection(String(this.values[0])) as T | null;
    }
    if (this.sql === SELECT_PAPER_TRADE_INTENT_SQL) {
      return (
        (this.database.intents.get(String(this.values[0])) as T | undefined) ??
        null
      );
    }
    if (this.sql === SELECT_PAPER_TRADE_SETTLEMENT_SQL) {
      return (
        (this.database.settlements.get(String(this.values[0])) as T | undefined) ??
        null
      );
    }
    if (this.sql === SELECT_LATEST_PAPER_KILL_SWITCH_SQL) {
      return this.database.latestKillSwitch() as T | null;
    }
    if (this.sql === SELECT_PAPER_KILL_SWITCH_BY_IDEMPOTENCY_SQL) {
      return (
        (this.database.killSwitchEvents.get(String(this.values[0])) as
          | T
          | undefined) ?? null
      );
    }
    if (this.sql === SELECT_PAPER_ACCOUNT_READINESS_METRIC_SQL) {
      return (
        (this.database
          .readinessMetrics()
          .find(
            (metric) => metric.account_id === String(this.values[0]),
          ) as T | undefined) ?? null
      );
    }
    if (this.sql === SELECT_BLOCKED_PAPER_AUTOMATION_INTENT_SQL) {
      return (
        (this.database.blockedIntents.get(String(this.values[0])) as
          | T
          | undefined) ?? null
      );
    }
    throw new Error("unexpected first statement");
  }

  async all<T>(): Promise<D1Result<T>> {
    if (this.sql === SELECT_PAPER_ACCOUNT_PROJECTION_SQL) {
      const projection = this.database.projection(String(this.values[0]));
      return result((projection === null ? [] : [projection]) as T[]);
    }
    if (this.sql === SELECT_PAPER_TRADE_INTENT_SQL) {
      const intent = this.database.intents.get(String(this.values[0]));
      return result((intent === undefined ? [] : [intent]) as T[]);
    }
    if (this.sql === SELECT_PAPER_TRADE_SETTLEMENT_SQL) {
      const settlement = this.database.settlements.get(String(this.values[0]));
      return result((settlement === undefined ? [] : [settlement]) as T[]);
    }
    if (this.sql === LIST_PAPER_TRADE_ALLOCATIONS_SQL) {
      const intentId = String(this.values[0]);
      return result(
        [...this.database.allocations.values()]
          .filter((allocation) => allocation.intent_id === intentId)
          .sort((left, right) => left.account_id.localeCompare(right.account_id)) as T[],
      );
    }
    if (this.sql === LIST_PAPER_SIMULATION_ACCOUNT_STATS_SQL) {
      return result(this.database.accountStats() as T[]);
    }
    if (this.sql === LIST_PAPER_SIMULATION_ROWS_SQL) {
      return result(this.database.simulationRows(Number(this.values[0])) as T[]);
    }
    if (this.sql === LIST_PAPER_ACCOUNT_READINESS_METRICS_SQL) {
      return result(this.database.readinessMetrics() as T[]);
    }
    if (this.sql === SELECT_PAPER_ACCOUNT_READINESS_METRIC_SQL) {
      const metric = this.database
        .readinessMetrics()
        .find((candidate) => candidate.account_id === String(this.values[0]));
      return result((metric === undefined ? [] : [metric]) as T[]);
    }
    if (this.sql === SELECT_LATEST_PAPER_AUTOMATION_RECEIPT_SQL) {
      const latest = [...this.database.receipts.values()]
        .filter((receipt) => receipt.schema_version === "1.1")
        .sort((left, right) => right.received_at.localeCompare(left.received_at))[0];
      return result((latest === undefined ? [] : [latest]) as T[]);
    }
    if (this.sql === SELECT_PAPER_OPEN_INTENT_HEALTH_SQL) {
      return result(
        [this.database.openIntentHealth(String(this.values[0]))] as T[],
      );
    }
    if (this.sql === SELECT_LATEST_PAPER_KILL_SWITCH_SQL) {
      const latest = this.database.latestKillSwitch();
      return result((latest === null ? [] : [latest]) as T[]);
    }
    throw new Error("unexpected all statement");
  }

  async execute(): Promise<D1Result> {
    if (
      this.sql === INSERT_RECEIPT_SQL ||
      this.sql === INSERT_AUTOMATED_PAPER_TRADE_INTENT_SQL ||
      this.sql === INSERT_PAPER_TRADE_INTENT_SQL ||
      this.sql === INSERT_PAPER_TRADE_ALLOCATION_SQL ||
      this.sql === INSERT_PAPER_TRADE_SETTLEMENT_SQL ||
      this.sql === INSERT_PAPER_KILL_SWITCH_EVENT_SQL ||
      this.sql === INSERT_BLOCKED_PAPER_AUTOMATION_INTENT_SQL
    ) {
      return this.run();
    }
    return this.all();
  }
}

class SimulatorFakeD1 {
  readonly receipts = new Map<string, StoredReceipt>();
  readonly baseAccounts = new Map<string, PaperAccountProjection>();
  readonly intents = new Map<string, StoredPaperTradeIntent>();
  readonly allocations = new Map<string, StoredPaperTradeAllocation>();
  readonly settlements = new Map<string, StoredPaperTradeSettlement>();
  readonly killSwitchEvents = new Map<string, StoredPaperKillSwitchEvent>();
  readonly blockedIntents = new Map<
    string,
    StoredBlockedPaperAutomationIntent
  >();
  nextControlSequence = 1;
  prepareCalls = 0;

  prepare(sql: string): SimulatorFakeStatement {
    this.prepareCalls += 1;
    return new SimulatorFakeStatement(this, sql);
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const statement of statements as unknown as SimulatorFakeStatement[]) {
      results.push((await statement.execute()) as D1Result<T>);
    }
    return results;
  }

  projection(accountId: string): PaperAccountProjection | null {
    const base = this.baseAccounts.get(accountId);
    if (base === undefined) return null;
    const realized = [...this.allocations.values()]
      .filter((allocation) => allocation.account_id === accountId)
      .reduce((sum, allocation) => {
        const settlement = this.settlements.get(allocation.intent_id);
        if (settlement === undefined) return sum;
        return (
          sum +
          Math.trunc(
            (allocation.risk_amount_minor * settlement.outcome_r_millis) /
              1_000,
          )
        );
      }, 0);
    return {
      ...base,
      ledger_delta_minor: base.ledger_delta_minor + realized,
      balance_minor: base.balance_minor + realized,
    };
  }

  latestKillSwitch(): StoredPaperKillSwitchEvent | null {
    return (
      [...this.killSwitchEvents.values()].sort(
        (left, right) =>
          right.control_sequence - left.control_sequence,
      )[0] ?? null
    );
  }

  readinessMetrics(): PaperReadinessAccountInput[] {
    return [...this.baseAccounts.keys()].map((accountId) => {
      const projection = this.projection(accountId)!;
      const stats = this.accountStats().find(
        (account) => account.account_id === accountId,
      )!;
      return {
        account_id: accountId,
        label: projection.label,
        opening_balance_minor: projection.opening_balance_minor,
        balance_minor: projection.balance_minor,
        daily_pnl_minor: [...this.allocations.values()]
        .filter((allocation) => allocation.account_id === accountId)
        .reduce((sum, allocation) => {
          const settlement = this.settlements.get(allocation.intent_id);
          return settlement === undefined
            ? sum
            : sum +
                Math.trunc(
                  (allocation.risk_amount_minor *
                    settlement.outcome_r_millis) /
                    1_000,
                );
        }, 0),
        open_risk_minor: stats.open_risk_minor,
        open_positions: stats.open_positions,
        max_drawdown_minor: stats.max_drawdown_minor,
      };
    });
  }

  openIntentHealth(staleCutoff: string): {
    open_intents: number;
    stale_open_intents: number;
    oldest_open_intent_at: string | null;
  } {
    const open = [...this.intents.values()].filter(
      (intent) => !this.settlements.has(intent.intent_id),
    );
    return {
      open_intents: open.length,
      stale_open_intents: open.filter(
        (intent) => intent.created_at < staleCutoff,
      ).length,
      oldest_open_intent_at:
        open
          .map((intent) => intent.created_at)
          .sort((left, right) => left.localeCompare(right))[0] ?? null,
    };
  }

  accountStats(): PaperSimulationAccountStat[] {
    return [...this.baseAccounts.keys()].map((accountId) => {
      const projection = this.projection(accountId)!;
      const allocations = [...this.allocations.values()].filter(
        (allocation) => allocation.account_id === accountId,
      );
      let realizedPnl = 0;
      let cumulativePnl = 0;
      let peakPnl = 0;
      let maxDrawdown = 0;
      let settledTrades = 0;
      let winningTrades = 0;
      let losingTrades = 0;
      const settledAllocations = allocations
        .map((allocation) => ({
          allocation,
          settlement: this.settlements.get(allocation.intent_id),
        }))
        .filter(
          (
            value,
          ): value is {
            allocation: StoredPaperTradeAllocation;
            settlement: StoredPaperTradeSettlement;
          } => value.settlement !== undefined,
        )
        .sort((left, right) =>
          left.settlement.settled_at.localeCompare(right.settlement.settled_at),
        );
      for (const { allocation, settlement } of settledAllocations) {
        const pnl = Math.trunc(
          (allocation.risk_amount_minor * settlement.outcome_r_millis) /
            1_000,
        );
        realizedPnl += pnl;
        cumulativePnl += pnl;
        peakPnl = Math.max(peakPnl, cumulativePnl);
        maxDrawdown = Math.max(maxDrawdown, peakPnl - cumulativePnl);
        settledTrades += 1;
        if (pnl > 0) winningTrades += 1;
        if (pnl < 0) losingTrades += 1;
      }
      const open = allocations.filter(
        (allocation) => !this.settlements.has(allocation.intent_id),
      );
      return {
        ...projection,
        realized_pnl_minor: realizedPnl,
        open_risk_minor: open.reduce(
          (sum, allocation) => sum + allocation.risk_amount_minor,
          0,
        ),
        open_positions: open.length,
        settled_trades: settledTrades,
        winning_trades: winningTrades,
        losing_trades: losingTrades,
        max_drawdown_minor: maxDrawdown,
      };
    });
  }

  simulationRows(limit: number): PaperSimulationRow[] {
    const intentIds = [...this.intents.values()]
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, limit)
      .map((intent) => intent.intent_id);
    return intentIds.flatMap((intentId) => {
      const intent = this.intents.get(intentId)!;
      const settlement = this.settlements.get(intentId);
      return [...this.allocations.values()]
        .filter((allocation) => allocation.intent_id === intentId)
        .sort((left, right) => left.account_id.localeCompare(right.account_id))
        .map((allocation) => ({
          intent_id: intentId,
          symbol: intent.symbol,
          side: intent.side,
          entry_price: intent.entry_price,
          stop_loss: intent.stop_loss,
          take_profit: intent.take_profit,
          risk_bps: intent.risk_bps,
          source: intent.source,
          source_receipt_id: intent.source_receipt_id,
          created_at: intent.created_at,
          account_id: allocation.account_id,
          risk_amount_minor: allocation.risk_amount_minor,
          balance_before_minor: allocation.balance_before_minor,
          settlement_id: settlement?.settlement_id ?? null,
          outcome_r_millis: settlement?.outcome_r_millis ?? null,
          exit_reason: settlement?.exit_reason ?? null,
          settled_at: settlement?.settled_at ?? null,
          pnl_minor:
            settlement === undefined
              ? null
              : Math.trunc(
                  (allocation.risk_amount_minor *
                    settlement.outcome_r_millis) /
                    1_000,
                ),
        }));
    });
  }
}

class IntentRaceFakeD1 extends SimulatorFakeD1 {
  private injected = false;

  override async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    const prepared = statements as unknown as SimulatorFakeStatement[];
    if (
      !this.injected &&
      prepared.some((statement) => statement.sql === INSERT_RECEIPT_SQL) &&
      prepared.some(
        (statement) => statement.sql === INSERT_AUTOMATED_PAPER_TRADE_INTENT_SQL,
      )
    ) {
      this.injected = true;
      const payloadSha256 = "c".repeat(64);
      this.intents.set("raced-open", {
        intent_id: "raced-open",
        idempotency_key: "paper-intent:raced-open",
        payload_sha256: payloadSha256,
        symbol: "EURUSD",
        side: "BUY",
        entry_price: "1.17000",
        stop_loss: "1.16800",
        take_profit: "1.17400",
        risk_bps: 25,
        source: "MANUAL",
        source_receipt_id: null,
        created_at: "2026-07-23T10:00:00Z",
      });
      this.allocations.set("raced-open:paper-sandbox-a", {
        allocation_id: "raced-allocation",
        intent_id: "raced-open",
        account_id: "paper-sandbox-a",
        risk_amount_minor: 25_000,
        balance_before_minor: 10_000_000,
        created_at: "2026-07-23T10:00:00Z",
      });
      throw new Error("UNIQUE constraint failed");
    }
    return super.batch<T>(statements);
  }
}

class LowBalanceRaceFakeD1 extends SimulatorFakeD1 {
  private injected = false;

  override async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    const prepared = statements as unknown as SimulatorFakeStatement[];
    if (
      !this.injected &&
      prepared.some((statement) => statement.sql === INSERT_RECEIPT_SQL) &&
      prepared.some(
        (statement) => statement.sql === INSERT_PAPER_TRADE_ALLOCATION_SQL,
      )
    ) {
      this.injected = true;
      const account = this.baseAccounts.get("paper-sandbox-a");
      if (account !== undefined) {
        this.baseAccounts.set("paper-sandbox-a", {
          ...account,
          balance_minor: 0,
        });
      }
      throw new Error("paper safety gate blocked allocation");
    }
    return super.batch<T>(statements);
  }
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function environment(database = new SimulatorFakeD1()): Promise<Env> {
  database.baseAccounts.set("paper-sandbox-a", {
    account_id: "paper-sandbox-a",
    mode: "PAPER_ONLY",
    label: "Paper Sandbox A",
    currency_code: "USD",
    currency_scale: 2,
    opening_balance_minor: 10_000_000,
    ledger_delta_minor: 0,
    balance_minor: 10_000_000,
    last_sequence: 0,
    created_at: "2026-07-23T10:00:00Z",
  });
  database.baseAccounts.set("paper-sandbox-b", {
    account_id: "paper-sandbox-b",
    mode: "PAPER_ONLY",
    label: "Paper Sandbox B",
    currency_code: "USD",
    currency_scale: 2,
    opening_balance_minor: 8_000_000,
    ledger_delta_minor: 0,
    balance_minor: 8_000_000,
    last_sequence: 0,
    created_at: "2026-07-23T10:01:00Z",
  });
  database.killSwitchEvents.set("paper-kill-switch:test-initial", {
    control_sequence: 1,
    event_id: "test-initial",
    idempotency_key: "paper-kill-switch:test-initial",
    payload_sha256: "0".repeat(64),
    enabled: 0,
    reason: "Test automation enabled",
    changed_at: "2026-07-23T10:02:00Z",
  });
  database.nextControlSequence = 2;
  return {
    DB: database as unknown as D1Database,
    PAPER_LEDGER_ENABLED: "true",
    PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256: await digest(PAPER_CREDENTIAL),
    TRADINGVIEW_OBSERVATION_INGRESS_ENABLED: "true",
    TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256: await digest(
      TRADINGVIEW_CREDENTIAL,
    ),
    TRADINGVIEW_OBSERVATION_MAX_BODY_BYTES: "262144",
  };
}

function request(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  credential = PAPER_CREDENTIAL,
): Request {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${credential}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`${BASE_URL}${path}`, init);
}

function killSwitchRequest(
  enabled: boolean,
  reason: string,
  idempotencyKey: string,
): Request {
  return new Request(`${BASE_URL}/api/v1/paper-readiness/kill-switch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAPER_CREDENTIAL}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      schema_version: "1.0",
      enabled,
      reason,
    }),
  });
}

function intent(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "1.0",
    intent_id: "paper-eurusd-001",
    symbol: "EURUSD",
    side: "BUY",
    entry_price: "1.17000",
    stop_loss: "1.16800",
    take_profit: "1.17400",
    risk_bps: 50,
    account_ids: ["paper-sandbox-b", "paper-sandbox-a"],
    ...overrides,
  };
}

function automatedObservation(
  sequence: number,
  paperCommands: unknown[],
  includeTransition = true,
): Request {
  const payload = {
    schema_version: "1.1",
    strategy_id: "rd_liquidity_sd_5m_v1",
    strategy_version: "1.1.0-paper1",
    producer_instance_id: "pine-paper-01",
    sequence,
    idempotency_key: `pine-paper-01:${sequence}`,
    symbol: "EURUSD",
    ticker_id: "VANTAGE:EURUSD",
    feed: "VANTAGE",
    timeframe: "5",
    timezone: "Etc/UTC",
    bar_open_epoch: 1_710_000_000 + sequence * 300,
    bar_close_epoch: 1_710_000_300 + sequence * 300,
    detector_code_hash: "a".repeat(64),
    settings_hash: "b".repeat(64),
    kind: "incremental",
    chunk_index: 0,
    chunk_count: 1,
    transitions: includeTransition
      ? [
          {
        transition_index: 0,
        natural_key: {
          side: "DEMAND",
          zone_key: "zone:1710000000:1709999700:REVERSAL:STANDARD",
          liquidity_key: "liquidity:DEMAND:1709999400:1.168",
          formation_bar_close_epoch: 1_710_000_000,
        },
        from_state: "ARMED",
        to_state: "TRIGGERED",
        reason_code: "TRIGGER_FIRST_FRESH_TAP_AFTER_LIQUIDITY",
        zone: {
          top: 1.171,
          bottom: 1.168,
          origin_bar_open_epoch: 1_709_999_700,
          origin_bar_close_epoch: 1_710_000_000,
        },
        liquidity: {
          price: 1.1675,
          origin_bar_open_epoch: 1_709_999_700,
          origin_bar_close_epoch: 1_710_000_000,
        },
        source_candle: {
          open_epoch: 1_710_000_000 + sequence * 300,
          close_epoch: 1_710_000_300 + sequence * 300,
          open: 1.17,
          high: 1.172,
          low: 1.169,
          close: 1.17,
        },
          },
        ]
      : [],
    paper_commands: paperCommands,
  };
  return new Request(`${BASE_URL}/api/v1/tradingview/observations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      credential: TRADINGVIEW_CREDENTIAL,
      payload,
    }),
  });
}

describe("paper simulator API", () => {
  it("records an empty schema 1.1 incremental delivery heartbeat", async () => {
    const database = new SimulatorFakeD1();
    const response = await handleRequest(
      automatedObservation(103, [], false),
      await environment(database),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      kind: "incremental",
      sequence: 103,
      status: "RECEIVED",
    });
    expect(database.receipts.has("pine-paper-01:103")).toBe(true);
  });

  it("reclassifies a losing OPEN race instead of falsely reporting APPLIED", async () => {
    const database = new IntentRaceFakeD1();
    const env = await environment(database);
    const response = await handleRequest(
      automatedObservation(102, [
        {
          command_version: "1.0",
          action: "OPEN",
          intent: intent({ intent_id: "raced-open" }),
        },
      ]),
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      paper_automation: {
        status: "BLOCKED",
        opened: 0,
        blocked: 1,
        conflicts: 1,
      },
    });
    expect(database.receipts.has("pine-paper-01:102")).toBe(true);
    expect(database.intents.get("raced-open")).toMatchObject({
      payload_sha256: "c".repeat(64),
    });
  });

  it("retries a low-balance OPEN race without discarding SETTLE", async () => {
    const database = new LowBalanceRaceFakeD1();
    const env = await environment(database);
    const created = await handleRequest(
      request("/api/v1/paper-simulations/intents", "POST", intent()),
      env,
    );
    expect(created.status).toBe(201);

    const response = await handleRequest(
      automatedObservation(104, [
        {
          command_version: "1.0",
          action: "OPEN",
          intent: intent({ intent_id: "low-balance-race" }),
        },
        {
          command_version: "1.0",
          action: "SETTLE",
          intent_id: "paper-eurusd-001",
          settlement: {
            schema_version: "1.0",
            outcome_r_millis: 1000,
            exit_reason: "TARGET",
          },
        },
      ]),
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      paper_automation: {
        status: "PARTIAL",
        opened: 0,
        settled: 1,
        blocked: 1,
      },
    });
    expect(database.blockedIntents.get("low-balance-race")).toMatchObject({
      reason_code: "SAFETY_GATE_RACE",
    });
    expect(database.settlements.has("paper-eurusd-001")).toBe(true);
  });

  it("atomically opens and settles a TradingView-sourced multi-account intent", async () => {
    const database = new SimulatorFakeD1();
    const baseEnvironment = await environment(database);
    const env: Env = {
      ...baseEnvironment,
      TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256: await digest(
        "legacy-observation-only-secret",
      ),
      TRADINGVIEW_PAPER_AUTOMATION_CREDENTIAL_SHA256: await digest(
        TRADINGVIEW_CREDENTIAL,
      ),
    };
    const openCommand = {
      command_version: "1.0",
      action: "OPEN",
      intent: intent({ intent_id: "tv-eurusd-001" }),
    };
    const opened = await handleRequest(
      automatedObservation(1, [openCommand]),
      env,
    );
    expect(opened.status).toBe(202);
    await expect(opened.json()).resolves.toMatchObject({
      status: "RECEIVED",
      schema_version: "1.1",
      paper_automation: {
        status: "APPLIED",
        opened: 1,
        settled: 0,
      },
    });
    expect(database.intents.get("tv-eurusd-001")).toMatchObject({
      source: "TRADINGVIEW",
      source_receipt_id: expect.any(String),
    });

    const duplicate = await handleRequest(
      automatedObservation(1, [openCommand]),
      env,
    );
    expect(duplicate.status).toBe(200);
    expect(database.intents).toHaveLength(1);

    const settled = await handleRequest(
      automatedObservation(2, [
        {
          command_version: "1.0",
          action: "SETTLE",
          intent_id: "tv-eurusd-001",
          settlement: {
            schema_version: "1.0",
            outcome_r_millis: 2000,
            exit_reason: "TARGET",
          },
        },
      ]),
      env,
    );
    expect(settled.status).toBe(202);
    await expect(settled.json()).resolves.toMatchObject({
      paper_automation: {
        status: "APPLIED",
        opened: 0,
        settled: 1,
      },
    });
    expect(database.settlements.get("tv-eurusd-001")).toMatchObject({
      outcome_r_millis: 2000,
      exit_reason: "TARGET",
    });
  });

  it("fails authorization before touching D1", async () => {
    const database = new SimulatorFakeD1();
    const env = await environment(database);
    const response = await handleRequest(
      request("/api/v1/paper-simulations/summary", "GET", undefined, "wrong"),
      env,
    );
    expect(response.status).toBe(401);
    expect(database.prepareCalls).toBe(0);
  });

  it("creates one immutable intent with isolated allocations for two accounts", async () => {
    const env = await environment();
    const response = await handleRequest(
      request("/api/v1/paper-simulations/intents", "POST", intent()),
      env,
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      status: "CREATED",
      mode: "PAPER_SIMULATION_ONLY",
      state: "OPEN",
      allocations: [
        { account_id: "paper-sandbox-a", risk_amount_minor: 50_000 },
        { account_id: "paper-sandbox-b", risk_amount_minor: 40_000 },
      ],
    });
  });

  it("returns duplicate for exact replay and conflict for changed content", async () => {
    const env = await environment();
    await handleRequest(
      request("/api/v1/paper-simulations/intents", "POST", intent()),
      env,
    );
    const duplicate = await handleRequest(
      request("/api/v1/paper-simulations/intents", "POST", intent()),
      env,
    );
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ status: "DUPLICATE" });

    const conflict = await handleRequest(
      request(
        "/api/v1/paper-simulations/intents",
        "POST",
        intent({ take_profit: "1.17500" }),
      ),
      env,
    );
    expect(conflict.status).toBe(409);
  });

  it("settles once, projects P&L, and reports per-account drawdown metrics", async () => {
    const env = await environment();
    await handleRequest(
      request("/api/v1/paper-simulations/intents", "POST", intent()),
      env,
    );
    const settlement = {
      schema_version: "1.0",
      outcome_r_millis: 1500,
      exit_reason: "TARGET",
    };
    const settled = await handleRequest(
      request(
        "/api/v1/paper-simulations/intents/paper-eurusd-001/settlement",
        "POST",
        settlement,
      ),
      env,
    );
    expect(settled.status).toBe(201);
    await expect(settled.json()).resolves.toMatchObject({
      status: "SETTLED",
      state: "SETTLED",
      allocations: [
        { account_id: "paper-sandbox-a", pnl_minor: 75_000 },
        { account_id: "paper-sandbox-b", pnl_minor: 60_000 },
      ],
    });

    const summary = await handleRequest(
      request("/api/v1/paper-simulations/summary", "GET"),
      env,
    );
    expect(summary.status).toBe(200);
    await expect(summary.json()).resolves.toMatchObject({
      account_count: 2,
      intent_count: 1,
      accounts: expect.arrayContaining([
        expect.objectContaining({
          account_id: "paper-sandbox-a",
          balance_minor: 10_075_000,
          realized_pnl_minor: 75_000,
          settled_trades: 1,
          winning_trades: 1,
          max_drawdown_minor: 0,
        }),
      ]),
      intents: [
        expect.objectContaining({
          intent_id: "paper-eurusd-001",
          state: "SETTLED",
        }),
      ],
    });

    const duplicate = await handleRequest(
      request(
        "/api/v1/paper-simulations/intents/paper-eurusd-001/settlement",
        "POST",
        settlement,
      ),
      env,
    );
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ status: "DUPLICATE" });

    const conflict = await handleRequest(
      request(
        "/api/v1/paper-simulations/intents/paper-eurusd-001/settlement",
        "POST",
        {
          schema_version: "1.0",
          outcome_r_millis: -1000,
          exit_reason: "STOP",
        },
      ),
      env,
    );
    expect(conflict.status).toBe(409);
  });

  it("rejects invalid price geometry, duplicate accounts, and missing accounts", async () => {
    const env = await environment();
    for (const body of [
      intent({ stop_loss: "1.17100" }),
      intent({ account_ids: ["paper-sandbox-a", "paper-sandbox-a"] }),
      intent({ risk_bps: 501 }),
    ]) {
      const response = await handleRequest(
        request("/api/v1/paper-simulations/intents", "POST", body),
        env,
      );
      expect(response.status).toBe(422);
    }
    const missing = await handleRequest(
      request(
        "/api/v1/paper-simulations/intents",
        "POST",
        intent({ account_ids: ["paper-missing"] }),
      ),
      env,
    );
    expect(missing.status).toBe(404);
  });

  it("reports fresh evidence as ready and stale evidence as degraded", async () => {
    const database = new SimulatorFakeD1();
    const env = await environment(database);
    database.receipts.set("paper-monitor:1", {
      receipt_id: "receipt-monitor-1",
      received_at: new Date().toISOString(),
      idempotency_key: "paper-monitor:1",
      payload_sha256: "a".repeat(64),
      schema_version: "1.1",
      strategy_id: "rd_liquidity_sd_5m_v1",
      strategy_version: "1.1.0-paper1",
      producer_instance_id: "tradingview-paper-eurusd:monitor",
      sequence: 1,
      symbol: "EURUSD",
      ticker_id: "VANTAGE:EURUSD",
      feed: "VANTAGE",
      timeframe: "5",
      kind: "snapshot",
    });
    const ready = await handleRequest(
      request("/api/v1/paper-readiness", "GET"),
      env,
    );
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toMatchObject({
      schema_version: "1.0",
      mode: "PAPER_ONLY",
      state: "READY",
      execution: "DISABLED",
      kill_switch: { enabled: false },
      latest_receipt: {
        producer_instance_id: "tradingview-paper-eurusd:monitor",
      },
      accounts: expect.arrayContaining([
        expect.objectContaining({
          account_id: "paper-sandbox-a",
          state: "READY",
          daily_loss_bps: 0,
        }),
      ]),
      reasons: [],
    });

    const freshReceipt = database.receipts.get("paper-monitor:1")!;
    database.receipts.set("paper-monitor:1", {
      ...freshReceipt,
      received_at: "2026-07-22T10:00:00Z",
    });
    const degraded = await handleRequest(
      request("/api/v1/paper-readiness", "GET"),
      env,
    );
    expect(degraded.status).toBe(200);
    await expect(degraded.json()).resolves.toMatchObject({
      state: "DEGRADED",
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "RECEIPT_STALE" }),
      ]),
    });
  });

  it("audits the kill switch, blocks new opens, and still allows settlement", async () => {
    const database = new SimulatorFakeD1();
    const baseEnvironment = await environment(database);
    const env: Env = {
      ...baseEnvironment,
      TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256: await digest(
        "legacy-observation-only-secret",
      ),
      TRADINGVIEW_PAPER_AUTOMATION_CREDENTIAL_SHA256: await digest(
        TRADINGVIEW_CREDENTIAL,
      ),
    };
    const created = await handleRequest(
      request("/api/v1/paper-simulations/intents", "POST", intent()),
      env,
    );
    expect(created.status).toBe(201);

    const engaged = await handleRequest(
      killSwitchRequest(
        true,
        "Operator stopped new entries for a readiness drill",
        "kill-drill-1",
      ),
      env,
    );
    expect(engaged.status).toBe(201);
    await expect(engaged.json()).resolves.toMatchObject({
      status: "APPLIED",
      kill_switch: { enabled: true },
    });
    const replay = await handleRequest(
      killSwitchRequest(
        true,
        "Operator stopped new entries for a readiness drill",
        "kill-drill-1",
      ),
      env,
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ status: "DUPLICATE" });

    const manualBlocked = await handleRequest(
      request(
        "/api/v1/paper-simulations/intents",
        "POST",
        intent({ intent_id: "blocked-manual" }),
      ),
      env,
    );
    expect(manualBlocked.status).toBe(423);
    const receiptsBefore = database.receipts.size;
    const automatedBlocked = await handleRequest(
      automatedObservation(91, [
        {
          command_version: "1.0",
          action: "OPEN",
          intent: intent({ intent_id: "blocked-automated" }),
        },
        {
          command_version: "1.0",
          action: "SETTLE",
          intent_id: "paper-eurusd-001",
          settlement: {
            schema_version: "1.0",
            outcome_r_millis: -1000,
            exit_reason: "STOP",
          },
        },
      ]),
      env,
    );
    expect(automatedBlocked.status).toBe(202);
    await expect(automatedBlocked.json()).resolves.toMatchObject({
      paper_automation: {
        status: "PARTIAL",
        opened: 0,
        settled: 1,
        blocked: 1,
      },
    });
    expect(database.receipts.size).toBe(receiptsBefore + 1);
    expect(database.blockedIntents.has("blocked-automated")).toBe(true);
    expect(database.settlements.has("paper-eurusd-001")).toBe(true);
    const blockedReplay = await handleRequest(
      automatedObservation(92, [
        {
          command_version: "1.0",
          action: "OPEN",
          intent: intent({ intent_id: "blocked-automated" }),
        },
      ]),
      env,
    );
    expect(blockedReplay.status).toBe(202);
    await expect(blockedReplay.json()).resolves.toMatchObject({
      paper_automation: { status: "BLOCKED", blocked: 1 },
    });
    const blockedConflict = await handleRequest(
      automatedObservation(93, [
        {
          command_version: "1.0",
          action: "OPEN",
          intent: intent({
            intent_id: "blocked-automated",
            risk_bps: 40,
          }),
        },
      ]),
      env,
    );
    expect(blockedConflict.status).toBe(202);
    await expect(blockedConflict.json()).resolves.toMatchObject({
      paper_automation: {
        status: "BLOCKED",
        blocked: 1,
        conflicts: 1,
      },
    });
    const manualTerminalReplay = await handleRequest(
      request(
        "/api/v1/paper-simulations/intents",
        "POST",
        intent({ intent_id: "blocked-automated" }),
      ),
      env,
    );
    expect(manualTerminalReplay.status).toBe(423);
    await expect(manualTerminalReplay.json()).resolves.toMatchObject({
      error: { code: "PAPER_TRADE_INTENT_TERMINALLY_BLOCKED" },
    });
    const manualTerminalConflict = await handleRequest(
      request(
        "/api/v1/paper-simulations/intents",
        "POST",
        intent({ intent_id: "blocked-automated", risk_bps: 40 }),
      ),
      env,
    );
    expect(manualTerminalConflict.status).toBe(409);
    await expect(manualTerminalConflict.json()).resolves.toMatchObject({
      error: { code: "PAPER_TRADE_INTENT_CONFLICT" },
    });
    const ignoredBlockedSettlement = await handleRequest(
      automatedObservation(94, [
        {
          command_version: "1.0",
          action: "SETTLE",
          intent_id: "blocked-automated",
          settlement: {
            schema_version: "1.0",
            outcome_r_millis: 2000,
            exit_reason: "TARGET",
          },
        },
      ]),
      env,
    );
    expect(ignoredBlockedSettlement.status).toBe(202);
    await expect(ignoredBlockedSettlement.json()).resolves.toMatchObject({
      paper_automation: { status: "BLOCKED", blocked: 1 },
    });
    expect(database.settlements.has("blocked-automated")).toBe(false);
    const stopped = await handleRequest(
      request("/api/v1/paper-readiness", "GET"),
      env,
    );
    await expect(stopped.json()).resolves.toMatchObject({
      state: "STOPPED",
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "KILL_SWITCH_ENABLED" }),
      ]),
    });
  });

  it("settles a mixed envelope when another OPEN has no positive balance", async () => {
    const database = new SimulatorFakeD1();
    const env = await environment(database);
    const created = await handleRequest(
      request("/api/v1/paper-simulations/intents", "POST", intent()),
      env,
    );
    expect(created.status).toBe(201);
    const account = database.baseAccounts.get("paper-sandbox-a")!;
    database.baseAccounts.set("paper-sandbox-a", {
      ...account,
      balance_minor: 0,
    });

    const mixed = await handleRequest(
      automatedObservation(101, [
        {
          command_version: "1.0",
          action: "OPEN",
          intent: intent({ intent_id: "zero-balance-open" }),
        },
        {
          command_version: "1.0",
          action: "SETTLE",
          intent_id: "paper-eurusd-001",
          settlement: {
            schema_version: "1.0",
            outcome_r_millis: 1000,
            exit_reason: "TARGET",
          },
        },
      ]),
      env,
    );

    expect(mixed.status).toBe(202);
    await expect(mixed.json()).resolves.toMatchObject({
      paper_automation: {
        status: "PARTIAL",
        opened: 0,
        settled: 1,
        blocked: 1,
        conflicts: 0,
      },
    });
    expect(database.blockedIntents.get("zero-balance-open")).toMatchObject({
      reason_code: "NON_POSITIVE_BALANCE",
    });
    expect(database.settlements.has("paper-eurusd-001")).toBe(true);
  });

  it("fails OPEN closed but preserves SETTLE when control state is missing", async () => {
    const database = new SimulatorFakeD1();
    const env = await environment(database);
    const created = await handleRequest(
      request("/api/v1/paper-simulations/intents", "POST", intent()),
      env,
    );
    expect(created.status).toBe(201);
    database.killSwitchEvents.clear();

    const mixed = await handleRequest(
      automatedObservation(103, [
        {
          command_version: "1.0",
          action: "OPEN",
          intent: intent({ intent_id: "missing-control-open" }),
        },
        {
          command_version: "1.0",
          action: "SETTLE",
          intent_id: "paper-eurusd-001",
          settlement: {
            schema_version: "1.0",
            outcome_r_millis: -1000,
            exit_reason: "STOP",
          },
        },
      ]),
      env,
    );

    expect(mixed.status).toBe(202);
    await expect(mixed.json()).resolves.toMatchObject({
      paper_automation: {
        status: "PARTIAL",
        opened: 0,
        settled: 1,
        blocked: 1,
      },
    });
    expect(database.blockedIntents.get("missing-control-open")).toMatchObject({
      reason_code: "SAFETY_GATE_RACE",
    });
    expect(database.settlements.has("paper-eurusd-001")).toBe(true);
  });

  it("blocks new opens after an account reaches a hard paper risk limit", async () => {
    const env = await environment();
    for (const [intentId, riskBps] of [
      ["daily-loss-a", 200],
      ["daily-loss-b", 200],
      ["daily-loss-c", 110],
    ] as const) {
      const opened = await handleRequest(
        request(
          "/api/v1/paper-simulations/intents",
          "POST",
          intent({ intent_id: intentId, risk_bps: riskBps }),
        ),
        env,
      );
      expect(opened.status).toBe(201);
      const lost = await handleRequest(
        request(
          `/api/v1/paper-simulations/intents/${intentId}/settlement`,
          "POST",
          {
            schema_version: "1.0",
            outcome_r_millis: -1000,
            exit_reason: "STOP",
          },
        ),
        env,
      );
      expect(lost.status).toBe(201);
    }
    const blocked = await handleRequest(
      request(
        "/api/v1/paper-simulations/intents",
        "POST",
        intent({ intent_id: "after-daily-loss" }),
      ),
      env,
    );
    expect(blocked.status).toBe(423);
    await expect(blocked.json()).resolves.toMatchObject({
      error: { code: "PAPER_RISK_LIMIT_REACHED" },
    });
  });

  it("rejects malformed kill-switch controls before mutation", async () => {
    const database = new SimulatorFakeD1();
    const env = await environment(database);
    const missingIdempotency = await handleRequest(
      request(
        "/api/v1/paper-readiness/kill-switch",
        "POST",
        {
          schema_version: "1.0",
          enabled: true,
          reason: "Operator drill",
        },
      ),
      env,
    );
    expect(missingIdempotency.status).toBe(422);
    const malformed = new Request(
      `${BASE_URL}/api/v1/paper-readiness/kill-switch`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAPER_CREDENTIAL}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "bad-control-1",
        },
        body: JSON.stringify({
          schema_version: "1.0",
          enabled: true,
          reason: "ok",
          unexpected: true,
        }),
      },
    );
    const rejected = await handleRequest(malformed, env);
    expect(rejected.status).toBe(422);
    expect(database.killSwitchEvents).toHaveLength(1);
  });

  it("keeps order execution routes absent", async () => {
    const response = await handleRequest(
      new Request(`${BASE_URL}/api/v1/orders`),
      await environment(),
    );
    expect(response.status).toBe(404);
  });
});

const migrations = [
  "0001_observation_receipts.sql",
  "0002_paper_ledger.sql",
  "0003_paper_accounts_no_update.sql",
  "0004_paper_accounts_no_delete.sql",
  "0005_paper_ledger_no_update.sql",
  "0006_paper_ledger_no_delete.sql",
  "0007_paper_ledger_contiguous_sequence.sql",
  "0008_paper_ledger_safe_balance.sql",
  "0009_paper_simulator.sql",
  "0010_paper_trade_intents_no_update.sql",
  "0011_paper_trade_intents_no_delete.sql",
  "0012_paper_trade_allocations_no_update.sql",
  "0013_paper_trade_allocations_no_delete.sql",
  "0014_paper_trade_settlements_no_update.sql",
  "0015_paper_trade_settlements_no_delete.sql",
  "0016_paper_trade_settlement_safe_balance.sql",
  "0017_paper_automation_ingress.sql",
  "0018_paper_readiness_monitor.sql",
  "0019_paper_readiness_atomic_gates.sql",
] as const;

describe("paper simulator D1 migrations", () => {
  it("enforces immutability and projects settled P&L through the account view", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    for (const migration of migrations) {
      database.exec(
        readFileSync(
          fileURLToPath(new URL(`../migrations/${migration}`, import.meta.url)),
          "utf8",
        ),
      );
    }
    const digestValue = "a".repeat(64);
    expect(
      database
        .prepare(
          `SELECT control_sequence, enabled, reason
           FROM paper_kill_switch_events
           ORDER BY control_sequence DESC
           LIMIT 1`,
        )
        .get(),
    ).toEqual({
      control_sequence: 1,
      enabled: 1,
      reason: "INITIAL_FAIL_CLOSED",
    });
    database
      .prepare(
        `INSERT INTO paper_kill_switch_events (
          event_id,
          idempotency_key,
          payload_sha256,
          enabled,
          reason,
          changed_at
        ) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .run(
        "release-a",
        "paper-kill-switch:release-a",
        digestValue,
        "Release migration test",
        "2026-07-23T10:00:00Z",
      );
    database
      .prepare(
        `INSERT INTO paper_accounts VALUES (?, 'PAPER_ONLY', ?, 'USD', 2, ?, ?, ?, ?)`,
      )
      .run(
        "paper-a",
        "Paper A",
        10_000_000,
        "paper-account:paper-a",
        digestValue,
        "2026-07-23T10:00:00Z",
      );
    database
      .prepare(
        `INSERT INTO paper_trade_intents (
          intent_id,
          idempotency_key,
          payload_sha256,
          symbol,
          side,
          entry_price,
          stop_loss,
          take_profit,
          risk_bps,
          created_at
        ) VALUES (?, ?, ?, 'EURUSD', 'BUY', '1.17', '1.16', '1.19', 300, ?)`,
      )
      .run(
        "risk-blocked",
        "paper-intent:risk-blocked",
        digestValue,
        "2026-07-23T10:00:30Z",
      );
    database
      .prepare(
        `INSERT INTO observation_receipts VALUES (
          ?, ?, ?, ?, '1.1', 'rd_liquidity_sd_5m_v1',
          '1.1.0-paper1', 'migration-test', 1, 'EURUSD',
          'VANTAGE:EURUSD', 'VANTAGE', '5', 'snapshot'
        )`,
      )
      .run(
        "receipt-blocked",
        "2026-07-23T10:00:30Z",
        "migration-test:1",
        digestValue,
      );
    expect(() =>
      database
        .prepare(
          `INSERT INTO paper_blocked_automation_intents
           VALUES (?, ?, ?, 'RISK_LIMIT_REACHED', ?)`,
        )
        .run(
          "risk-blocked",
          "receipt-blocked",
          digestValue,
          "2026-07-23T10:00:30Z",
        ),
    ).toThrow(/paper intent id already live/u);
    database
      .prepare(
        `INSERT INTO paper_blocked_automation_intents
         VALUES (?, ?, ?, 'RISK_LIMIT_REACHED', ?)`,
      )
      .run(
        "terminal-blocked",
        "receipt-blocked",
        digestValue,
        "2026-07-23T10:00:30Z",
      );
    expect(() =>
      database
        .prepare(
          `INSERT INTO paper_trade_intents (
            intent_id,
            idempotency_key,
            payload_sha256,
            symbol,
            side,
            entry_price,
            stop_loss,
            take_profit,
            risk_bps,
            created_at
          ) VALUES (?, ?, ?, 'EURUSD', 'BUY', '1.17', '1.16', '1.19', 10, ?)`,
        )
        .run(
          "terminal-blocked",
          "paper-intent:terminal-blocked",
          digestValue,
          "2026-07-23T10:00:30Z",
        ),
    ).toThrow(/paper intent id already blocked/u);
    expect(() =>
      database
        .prepare(
          `INSERT INTO paper_trade_allocations VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "allocation-risk-blocked",
          "risk-blocked",
          "paper-a",
          300_000,
          10_000_000,
          "2026-07-23T10:00:30Z",
        ),
    ).toThrow(/paper safety gate blocked allocation/u);
    expect(() =>
      database
        .prepare(
          `INSERT INTO paper_trade_allocations VALUES (?, ?, ?, NULL, NULL, ?)`,
        )
        .run(
          "allocation-null-risk",
          "risk-blocked",
          "paper-a",
          "2026-07-23T10:00:30Z",
        ),
    ).toThrow(/paper safety gate blocked allocation/u);
    database
      .prepare(
        `INSERT INTO paper_trade_intents (
          intent_id,
          idempotency_key,
          payload_sha256,
          symbol,
          side,
          entry_price,
          stop_loss,
          take_profit,
          risk_bps,
          created_at
        ) VALUES (?, ?, ?, 'EURUSD', 'BUY', '1.17', '1.16', '1.19', 50, ?)`,
      )
      .run(
        "intent-a",
        "paper-intent:intent-a",
        digestValue,
        "2026-07-23T10:01:00Z",
      );
    database
      .prepare(
        `INSERT INTO paper_trade_allocations VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "allocation-a",
        "intent-a",
        "paper-a",
        50_000,
        10_000_000,
        "2026-07-23T10:01:00Z",
      );
    database
      .prepare(
        `INSERT INTO paper_trade_settlements VALUES (?, ?, ?, ?, ?, 'TARGET', ?)`,
      )
      .run(
        "settlement-a",
        "intent-a",
        "paper-settlement:intent-a",
        digestValue,
        1500,
        "2026-07-23T10:02:00Z",
      );
    database
      .prepare(
        `INSERT INTO paper_kill_switch_events (
          event_id,
          idempotency_key,
          payload_sha256,
          enabled,
          reason,
          changed_at
        ) VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .run(
        "engage-a",
        "paper-kill-switch:engage-a",
        digestValue,
        "Migration drill engaged",
        "2026-07-23T10:03:00Z",
      );
    database
      .prepare(
        `INSERT INTO paper_trade_intents (
          intent_id,
          idempotency_key,
          payload_sha256,
          symbol,
          side,
          entry_price,
          stop_loss,
          take_profit,
          risk_bps,
          created_at
        ) VALUES (?, ?, ?, 'EURUSD', 'BUY', '1.17', '1.16', '1.19', 10, ?)`,
      )
      .run(
        "kill-blocked",
        "paper-intent:kill-blocked",
        digestValue,
        "2026-07-23T10:03:00Z",
      );
    expect(() =>
      database
        .prepare(
          `INSERT INTO paper_trade_allocations VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "allocation-kill-blocked",
          "kill-blocked",
          "paper-a",
          10_000,
          10_075_000,
          "2026-07-23T10:03:00Z",
        ),
    ).toThrow(/paper safety gate blocked allocation/u);
    expect(
      database
        .prepare(
          `SELECT balance_minor FROM paper_account_projections WHERE account_id = ?`,
        )
        .get("paper-a"),
    ).toEqual({ balance_minor: 10_075_000 });
    expect(() =>
      database
        .prepare(`UPDATE paper_trade_intents SET symbol = 'GBPUSD'`)
        .run(),
    ).toThrow(/immutable/u);
    expect(() =>
      database.prepare(`DELETE FROM paper_trade_settlements`).run(),
    ).toThrow(/append-only/u);
    expect(
      database
        .prepare(
          `SELECT control_sequence, enabled, reason
           FROM paper_kill_switch_events
           ORDER BY control_sequence DESC
           LIMIT 1`,
        )
        .get(),
    ).toEqual({
      control_sequence: 3,
      enabled: 1,
      reason: "Migration drill engaged",
    });
    expect(() =>
      database
        .prepare(`UPDATE paper_kill_switch_events SET enabled = 0`)
        .run(),
    ).toThrow(/append-only/u);
    expect(() =>
      database.prepare(`DELETE FROM paper_kill_switch_events`).run(),
    ).toThrow(/append-only/u);
    expect(() =>
      database
        .prepare(
          `INSERT INTO paper_kill_switch_events (
            event_id,
            idempotency_key,
            payload_sha256,
            enabled,
            reason,
            changed_at
          ) VALUES ('bad', 'bad', ?, 2, 'invalid control', ?)`,
        )
        .run(digestValue, "2026-07-23T10:03:00Z"),
    ).toThrow(/CHECK constraint/u);
  });

  it("uses ceiling loss thresholds instead of blocking a fractional limit early", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    for (const migration of migrations) {
      database.exec(
        readFileSync(
          fileURLToPath(new URL(`../migrations/${migration}`, import.meta.url)),
          "utf8",
        ),
      );
    }
    const digestValue = "b".repeat(64);
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO paper_kill_switch_events (
          event_id,
          idempotency_key,
          payload_sha256,
          enabled,
          reason,
          changed_at
        ) VALUES ('tiny-release', 'paper-kill-switch:tiny-release', ?, 0, ?, ?)`,
      )
      .run(digestValue, "Release fractional threshold test", now);
    database
      .prepare(
        `INSERT INTO paper_accounts VALUES (
          'paper-tiny', 'PAPER_ONLY', 'Paper Tiny', 'USD', 2, 101,
          'paper-account:paper-tiny', ?, ?
        )`,
      )
      .run(digestValue, now);

    const insertIntent = (intentId: string): void => {
      database
        .prepare(
          `INSERT INTO paper_trade_intents (
            intent_id,
            idempotency_key,
            payload_sha256,
            symbol,
            side,
            entry_price,
            stop_loss,
            take_profit,
            risk_bps,
            created_at
          ) VALUES (?, ?, ?, 'EURUSD', 'BUY', '1.17', '1.16', '1.19', 100, ?)`,
        )
        .run(intentId, `paper-intent:${intentId}`, digestValue, now);
    };
    const insertAllocation = (intentId: string, index: number): void => {
      database
        .prepare(
          `INSERT INTO paper_trade_allocations VALUES (?, ?, ?, 1, ?, ?)`,
        )
        .run(
          `tiny-allocation-${index}`,
          intentId,
          "paper-tiny",
          101 - index,
          now,
        );
    };
    const settleLoss = (intentId: string, index: number): void => {
      database
        .prepare(
          `INSERT INTO paper_trade_settlements
           VALUES (?, ?, ?, ?, -1000, 'STOP', ?)`,
        )
        .run(
          `tiny-settlement-${index}`,
          intentId,
          `paper-settlement:${intentId}`,
          digestValue,
          now,
        );
    };

    for (let index = 0; index < 5; index += 1) {
      const intentId = `tiny-loss-${index}`;
      insertIntent(intentId);
      insertAllocation(intentId, index);
      settleLoss(intentId, index);
    }
    expect(
      database
        .prepare(
          `SELECT daily_pnl_minor
           FROM paper_account_readiness_metrics
           WHERE account_id = 'paper-tiny'`,
        )
        .get(),
    ).toEqual({ daily_pnl_minor: -5 });

    insertIntent("tiny-sixth");
    expect(() => insertAllocation("tiny-sixth", 5)).not.toThrow();
    settleLoss("tiny-sixth", 5);
    insertIntent("tiny-after-limit");
    expect(() => insertAllocation("tiny-after-limit", 6)).toThrow(
      /paper safety gate blocked allocation/u,
    );
  });
});
