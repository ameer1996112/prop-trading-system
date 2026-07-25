import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { handleRequest } from "../src/index";
import {
  INSERT_RECEIPT_SQL,
  INSERT_SETUP_EVIDENCE_SQL,
  LIST_RECEIPTS_SQL,
  LIST_SETUP_EVIDENCE_SQL,
  SELECT_RECEIPT_SQL,
} from "../src/queries";
import type { Env, StoredReceipt, StoredSetupEvidence } from "../src/types";

const CREDENTIAL = "edge-test-secret";
const BASE_URL = "https://prop-trading-observation-edge.example";

class FakeStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: FakeD1,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): FakeStatement {
    this.values = values;
    return this;
  }

  async run(): Promise<D1Result> {
    if (this.sql === INSERT_RECEIPT_SQL) {
      const record: StoredReceipt = {
        receipt_id: String(this.values[0]),
        received_at: String(this.values[1]),
        idempotency_key: String(this.values[2]),
        payload_sha256: String(this.values[3]),
        schema_version: String(this.values[4]) as StoredReceipt["schema_version"],
        strategy_id: String(this.values[5]) as "rd_liquidity_sd_5m_v1",
        strategy_version: String(this.values[6]) as StoredReceipt["strategy_version"],
        producer_instance_id: String(this.values[7]),
        sequence: Number(this.values[8]),
        symbol: String(this.values[9]),
        ticker_id: String(this.values[10]),
        feed: String(this.values[11]),
        timeframe: String(this.values[12]) as "5",
        kind: String(this.values[13]) as "incremental" | "snapshot",
      };
      if (this.database.records.has(record.idempotency_key)) {
        throw new Error(
          "D1_ERROR: UNIQUE constraint failed: observation_receipts.idempotency_key",
        );
      }
      this.database.records.set(record.idempotency_key, record);
      return {
        success: true,
        results: [],
        meta: { changes: 1 },
      } as unknown as D1Result;
    }
    if (this.sql === INSERT_SETUP_EVIDENCE_SQL) {
      if (this.database.failEvidenceWrites) {
        throw new Error("D1_ERROR: injected evidence failure");
      }
      const receiptId = String(this.values[0]);
      const recordedAt = String(this.values[1]);
      const rows = JSON.parse(String(this.values[2])) as Record<string, unknown>[];
      for (const row of rows) {
        const nullableNumber = (value: unknown): number | null =>
          value === null ? null : Number(value);
        const record: StoredSetupEvidence = {
          evidence_id: String(row.evidenceId),
          receipt_id: receiptId,
          recorded_at: recordedAt,
          event_index: Number(row.eventIndex),
          event_kind: String(row.eventKind) as StoredSetupEvidence["event_kind"],
          symbol: String(row.symbol),
          side: String(row.side) as StoredSetupEvidence["side"],
          zone_key: String(row.zoneKey),
          liquidity_key: String(row.liquidityKey),
          formation_bar_close_epoch: Number(row.formationBarCloseEpoch),
          from_state:
            row.fromState === null ? null : String(row.fromState),
          to_state: String(row.toState),
          reason_code: String(row.reasonCode),
          decision: String(row.decision) as StoredSetupEvidence["decision"],
          entry_model:
            row.entryModel === null
              ? null
              : (String(row.entryModel) as StoredSetupEvidence["entry_model"]),
          rule_passes_json: String(row.rulePassesJson),
          liquidity_formed_epoch: nullableNumber(row.liquidityFormedEpoch),
          own_extreme_broken_epoch: nullableNumber(row.ownExtremeBrokenEpoch),
          liquidity_swept_epoch: nullableNumber(row.liquiditySweptEpoch),
          zone_engaged_epoch: nullableNumber(row.zoneEngagedEpoch),
          entry_confirmed_epoch: nullableNumber(row.entryConfirmedEpoch),
          zone_top: String(row.zoneTop),
          zone_bottom: String(row.zoneBottom),
          zone_origin_open_epoch: Number(row.zoneOriginOpenEpoch),
          zone_origin_close_epoch: Number(row.zoneOriginCloseEpoch),
          liquidity_price: String(row.liquidityPrice),
          liquidity_origin_open_epoch: Number(row.liquidityOriginOpenEpoch),
          liquidity_origin_close_epoch: Number(row.liquidityOriginCloseEpoch),
          source_open_epoch: Number(row.sourceOpenEpoch),
          source_close_epoch: Number(row.sourceCloseEpoch),
          source_open: String(row.sourceOpen),
          source_high: String(row.sourceHigh),
          source_low: String(row.sourceLow),
          source_close: String(row.sourceClose),
        };
        const receiptExists = [...this.database.records.values()].some(
          (receipt) => receipt.receipt_id === record.receipt_id,
        );
        if (!receiptExists) {
          throw new Error("D1_ERROR: FOREIGN KEY constraint failed");
        }
        const duplicate = [...this.database.evidence.values()].some(
          (existing) =>
            existing.receipt_id === record.receipt_id &&
            existing.event_kind === record.event_kind &&
            existing.event_index === record.event_index,
        );
        if (duplicate) {
          throw new Error(
            "D1_ERROR: UNIQUE constraint failed: observation_setup_evidence",
          );
        }
        this.database.evidence.set(record.evidence_id, record);
      }
      return {
        success: true,
        results: [],
        meta: { changes: rows.length },
      } as unknown as D1Result;
    }
    throw new Error("unexpected run statement");
  }

  async first<T>(): Promise<T | null> {
    if (!this.sql.includes("WHERE idempotency_key = ?")) {
      throw new Error("unexpected first statement");
    }
    return (
      (this.database.records.get(String(this.values[0])) as T | undefined) ?? null
    );
  }

  async all<T>(): Promise<D1Result<T>> {
    const limit = Number(this.values[0]);
    let results: T[];
    if (this.sql === LIST_RECEIPTS_SQL) {
      results = [...this.database.records.values()]
        .sort((left, right) => {
          const byTime = right.received_at.localeCompare(left.received_at);
          return byTime !== 0
            ? byTime
            : right.receipt_id.localeCompare(left.receipt_id);
        })
        .slice(0, limit) as T[];
    } else if (this.sql === LIST_SETUP_EVIDENCE_SQL) {
      results = [...this.database.evidence.values()]
        .sort((left, right) => {
          const byTime = right.recorded_at.localeCompare(left.recorded_at);
          return byTime !== 0
            ? byTime
            : right.evidence_id.localeCompare(left.evidence_id);
        })
        .slice(0, limit) as T[];
    } else {
      throw new Error("unexpected all statement");
    }
    return {
      success: true,
      results,
      meta: {},
    } as unknown as D1Result<T>;
  }
}

class FakeD1 {
  readonly records = new Map<string, StoredReceipt>();
  readonly evidence = new Map<string, StoredSetupEvidence>();
  readonly preparedSql: string[] = [];

  constructor(readonly failEvidenceWrites = false) {}

  prepare(sql: string): FakeStatement {
    this.preparedSql.push(sql);
    return new FakeStatement(this, sql);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const receiptSnapshot = new Map(this.records);
    const evidenceSnapshot = new Map(this.evidence);
    try {
      const results: D1Result[] = [];
      for (const statement of statements) {
        results.push(await (statement as unknown as FakeStatement).run());
      }
      return results;
    } catch (error) {
      this.records.clear();
      this.evidence.clear();
      for (const [key, value] of receiptSnapshot) {
        this.records.set(key, value);
      }
      for (const [key, value] of evidenceSnapshot) {
        this.evidence.set(key, value);
      }
      throw error;
    }
  }
}

class FailingD1 {
  prepare(): never {
    throw new Error("D1 unavailable");
  }
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function environment(
  database: FakeD1 | FailingD1 = new FakeD1(),
  overrides: Partial<Env> = {},
): Promise<Env> {
  return {
    DB: database as unknown as D1Database,
    TRADINGVIEW_OBSERVATION_INGRESS_ENABLED: "true",
    TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256: await sha256(CREDENTIAL),
    TRADINGVIEW_OBSERVATION_MAX_BODY_BYTES: "262144",
    ...overrides,
  };
}

function incrementalPayload(): Record<string, unknown> {
  return {
    schema_version: "1.0",
    strategy_id: "rd_liquidity_sd_5m_v1",
    strategy_version: "1.0.0-phase1",
    producer_instance_id: "pine-lab-01",
    sequence: 1,
    idempotency_key: "pine-lab-01:1",
    symbol: "XAUUSD",
    ticker_id: "OANDA:XAUUSD",
    feed: "OANDA",
    timeframe: "5",
    timezone: "Etc/UTC",
    bar_open_epoch: 1_710_000_000_000,
    bar_close_epoch: 1_710_000_300_000,
    detector_code_hash: "a".repeat(64),
    settings_hash: "b".repeat(64),
    kind: "incremental",
    chunk_index: 0,
    chunk_count: 1,
    transitions: [
      {
        transition_index: 0,
        natural_key: {
          side: "DEMAND",
          zone_key: "demand|1710000000000",
          liquidity_key: "swing-low|1709999700000",
          formation_bar_close_epoch: 1_710_000_000_000,
        },
        from_state: null,
        to_state: "WAITING_FOR_ELIGIBILITY",
        reason_code: "WAIT_SETUP_ELIGIBILITY",
        zone: {
          top: 2_150.25,
          bottom: 2_149.75,
          origin_bar_open_epoch: 1_709_999_700_000,
          origin_bar_close_epoch: 1_710_000_000_000,
        },
        liquidity: {
          price: 2_149.5,
          origin_bar_open_epoch: 1_709_999_700_000,
          origin_bar_close_epoch: 1_710_000_000_000,
        },
        source_candle: {
          open_epoch: 1_710_000_000_000,
          close_epoch: 1_710_000_300_000,
          open: 2_150,
          high: 2_151,
          low: 2_149.5,
          close: 2_150.5,
        },
      },
    ],
  };
}

const CONTRACT_OPEN_RULES = [
  ["ZONE_ORIGIN_OPPOSITE_CANDLE", "EXACT"],
  ["ZONE_ACCURACY_BOUNDS", "UNRESOLVED"],
  ["ZONE_FRESH_UNTAPPED", "EXACT"],
  ["ZONE_FIRST_ENGAGEMENT", "EXACT"],
  ["ZONE_PRE_ENTRY_CLOSE_OUTSIDE", "EXACT"],
  ["LIQ_NORMAL_TWO_OPPOSITE_CANDLES", "EXACT"],
  ["LIQ_ONE_CANDLE_EXCEPTION", "DISCRETIONARY"],
  ["LIQ_OWN_EXTREME_SAME_LEG", "EXACT"],
  ["LIQ_STRICT_OWN_EXTREME_BREAK", "EXACT"],
  ["LIQ_ACTUAL_EXTREME_SWEPT", "EXACT"],
  ["LIQ_EVENT_ORDER", "EXACT"],
  ["LIQ_INTERNAL_REBREAK", "CALIBRATED"],
  ["LIQ_DISTANCE_INFLUENCES_ZONE", "DISCRETIONARY"],
  ["LIQ_REPLACEMENT_AFTER_STALE_MOVE", "DISCRETIONARY"],
  ["LIQ_MULTIPLE_CANDIDATE_ARBITRATION", "UNRESOLVED"],
  ["ENTRY_DIR_CLOSE", "EXACT"],
  ["ENTRY_HTF_FLIP", "EXACT"],
  ["ENTRY_HTF_BOUNDARY_CAUTION", "DISCRETIONARY"],
  ["MANAGEMENT_STOP_TRIGGER_CANDLE", "UNRESOLVED"],
  ["MANAGEMENT_TP_BE_TABLE", "UNRESOLVED"],
  ["RISK_SESSION_PROFILE", "CALIBRATED"],
  ["TIMEFRAME_FIVE_MINUTE_ONLY", "EXACT"],
] as const;

function contractRuleEvidence(): Record<string, unknown> {
  return {
    decision: "WAIT",
    entry_model: "DIR_CLOSE",
    rule_passes: CONTRACT_OPEN_RULES.map(
      ([ruleId]) =>
        ruleId === "LIQ_EVENT_ORDER" ||
        ruleId === "TIMEFRAME_FIVE_MINUTE_ONLY",
    ),
    lifecycle: {
      liquidity_formed_epoch: 1_709_999_400_000,
      own_extreme_broken_epoch: 1_709_999_700_000,
      liquidity_swept_epoch: 1_710_000_000_000,
      zone_engaged_epoch: 1_710_000_100_000,
      entry_confirmed_epoch: null,
    },
  };
}

function contractIncrementalPayload(): Record<string, unknown> {
  const payload = incrementalPayload();
  payload.schema_version = "1.2";
  payload.strategy_version = "1.2.0-contract1";
  payload.rule_contract_version = "1.0.0";
  payload.execution_mode = "OBSERVATION_ONLY";
  payload.rule_catalog = CONTRACT_OPEN_RULES.map(([ruleId, fidelity]) => ({
    rule_id: ruleId,
    fidelity,
  }));
  const transition = (payload.transitions as Record<string, unknown>[])[0];
  if (transition !== undefined) {
    transition.rule_evidence = contractRuleEvidence();
  }
  return payload;
}

function snapshotPayload(): Record<string, unknown> {
  const payload = incrementalPayload();
  delete payload.chunk_index;
  delete payload.chunk_count;
  delete payload.transitions;
  payload.sequence = 0;
  payload.idempotency_key = "pine-lab-01:0";
  payload.kind = "snapshot";
  payload.last_confirmed_bar_close_epoch = 1_710_000_300_000;
  payload.active_setups = [];
  return payload;
}

function contractSnapshotPayload(): Record<string, unknown> {
  const payload = contractIncrementalPayload();
  const transition = (
    payload.transitions as Record<string, unknown>[]
  )[0] as Record<string, unknown>;
  const evidence = transition.rule_evidence as Record<string, unknown>;
  const lifecycle = evidence.lifecycle as Record<string, unknown>;
  const rulePasses = evidence.rule_passes as boolean[];
  const eventOrderIndex = CONTRACT_OPEN_RULES.findIndex(
    ([ruleId]) => ruleId === "LIQ_EVENT_ORDER",
  );

  evidence.entry_model = null;
  lifecycle.liquidity_swept_epoch = null;
  lifecycle.zone_engaged_epoch = null;
  lifecycle.entry_confirmed_epoch = null;
  if (eventOrderIndex !== -1) {
    rulePasses[eventOrderIndex] = false;
  }

  delete payload.chunk_index;
  delete payload.chunk_count;
  delete payload.transitions;
  payload.sequence = 0;
  payload.idempotency_key = "pine-lab-01:0";
  payload.kind = "snapshot";
  payload.last_confirmed_bar_close_epoch = payload.bar_close_epoch;
  payload.active_setups = [
    {
      natural_key: transition.natural_key,
      state: "WAITING_FOR_ELIGIBILITY",
      reason_code: transition.reason_code,
      zone: transition.zone,
      liquidity: transition.liquidity,
      source_candle: transition.source_candle,
      rule_evidence: evidence,
    },
  ];
  return payload;
}

function postBody(payload: Record<string, unknown>, credential = CREDENTIAL): Request {
  return new Request(`${BASE_URL}/api/v1/tradingview/observations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential, payload }),
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("observation edge Worker", () => {
  it("keeps liveness public while ingress defaults fail-closed", async () => {
    const disabled = {
      DB: new FakeD1() as unknown as D1Database,
    } as Env;
    const live = await handleRequest(
      new Request(`${BASE_URL}/health/live`),
      disabled,
    );
    const posted = await handleRequest(
      new Request(`${BASE_URL}/api/v1/tradingview/observations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
      disabled,
    );
    const listed = await handleRequest(
      new Request(`${BASE_URL}/api/v1/observation-receipts`),
      disabled,
    );

    expect(live.status).toBe(200);
    expect(await body(live)).toEqual({
      status: "ALIVE",
      mode: "OBSERVATION_ONLY",
      paper_simulator: "DISABLED",
      canonical_paper: "DISABLED",
      deployment_version: {
        id: null,
        tag: null,
      },
      execution: "DISABLED",
    });
    expect(posted.status).toBe(503);
    expect((await body(posted)).error).toMatchObject({
      code: "INGRESS_DISABLED",
    });
    expect(listed.status).toBe(503);
  });

  it("persists one metadata receipt and implements duplicate/conflict semantics", async () => {
    const database = new FakeD1();
    const env = await environment(database);
    const first = await handleRequest(postBody(incrementalPayload()), env);
    const duplicate = await handleRequest(postBody(incrementalPayload()), env);
    const conflicting = incrementalPayload();
    conflicting.settings_hash = "c".repeat(64);
    const conflict = await handleRequest(postBody(conflicting), env);
    const listed = await handleRequest(
      new Request(`${BASE_URL}/api/v1/observation-receipts?limit=50`),
      env,
    );

    const firstBody = await body(first);
    const duplicateBody = await body(duplicate);
    const listBody = await body(listed);
    expect(first.status).toBe(202);
    expect(firstBody.status).toBe("RECEIVED");
    expect(duplicate.status).toBe(200);
    expect(duplicateBody.status).toBe("DUPLICATE");
    expect(duplicateBody.receipt_id).toBe(firstBody.receipt_id);
    expect(conflict.status).toBe(409);
    expect((await body(conflict)).error).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(listed.status).toBe(200);
    expect(listBody).toMatchObject({
      mode: "OBSERVATION_ONLY",
      ingress_enabled: true,
      count: 1,
    });
    expect(database.records).toHaveLength(1);
    expect(database.evidence).toHaveLength(0);
    const stored = [...database.records.values()][0];
    expect(stored).toBeDefined();
    expect(stored).not.toHaveProperty("credential");
    expect(stored).not.toHaveProperty("payload");
    expect(database.preparedSql).toContain(INSERT_RECEIPT_SQL);
    expect(database.preparedSql).toContain(SELECT_RECEIPT_SQL);
    expect(database.preparedSql).toContain(LIST_RECEIPTS_SQL);
  });

  it("accepts the required empty snapshot form", async () => {
    const env = await environment();
    const response = await handleRequest(postBody(snapshotPayload()), env);
    const responseBody = await body(response);

    expect(response.status).toBe(202);
    expect(responseBody).toMatchObject({
      kind: "snapshot",
      sequence: 0,
      status: "RECEIVED",
    });
  });

  it("accepts a contract-versioned snapshot with a waiting active setup", async () => {
    const response = await handleRequest(
      postBody(contractSnapshotPayload()),
      await environment(),
    );

    expect(response.status).toBe(202);
    expect(await body(response)).toMatchObject({
      kind: "snapshot",
      schema_version: "1.2",
      sequence: 0,
      status: "RECEIVED",
      strategy_version: "1.2.0-contract1",
    });
  });

  it("atomically persists and returns sanitized contract setup evidence", async () => {
    const database = new FakeD1();
    const env = await environment(database);
    const first = await handleRequest(
      postBody(contractIncrementalPayload()),
      env,
    );
    const duplicate = await handleRequest(
      postBody(contractIncrementalPayload()),
      env,
    );
    const listed = await handleRequest(
      new Request(`${BASE_URL}/api/v1/observation-setup-evidence?limit=10`),
      env,
    );

    expect(first.status).toBe(202);
    expect(duplicate.status).toBe(200);
    expect((await body(duplicate)).status).toBe("DUPLICATE");
    expect(database.records).toHaveLength(1);
    expect(database.evidence).toHaveLength(1);
    expect(database.preparedSql).toContain(INSERT_SETUP_EVIDENCE_SQL);
    expect(database.preparedSql).toContain(LIST_SETUP_EVIDENCE_SQL);

    const stored = [...database.evidence.values()][0];
    expect(stored).toMatchObject({
      event_index: 0,
      event_kind: "transition",
      symbol: "XAUUSD",
      side: "DEMAND",
      zone_key: "demand|1710000000000",
      liquidity_key: "swing-low|1709999700000",
      from_state: null,
      to_state: "WAITING_FOR_ELIGIBILITY",
      reason_code: "WAIT_SETUP_ELIGIBILITY",
      decision: "WAIT",
      entry_model: "DIR_CLOSE",
      source_open: "2150",
      source_high: "2151",
      source_low: "2149.5",
      source_close: "2150.5",
    });
    expect(stored).not.toHaveProperty("credential");
    expect(stored).not.toHaveProperty("payload");
    expect(stored).not.toHaveProperty("canonical_payload");
    expect(JSON.parse(stored?.rule_passes_json ?? "[]")).toHaveLength(22);

    const listedBody = await body(listed);
    expect(listed.status).toBe(200);
    expect(listedBody).toMatchObject({
      mode: "OBSERVATION_ONLY",
      execution: "DISABLED",
      count: 1,
    });
    const items = listedBody.items as Record<string, unknown>[];
    expect(items[0]).toMatchObject({
      receipt_id: stored?.receipt_id,
      event_index: 0,
      event_kind: "transition",
      symbol: "XAUUSD",
      decision: "WAIT",
    });
    expect(items[0]?.rule_passes).toHaveLength(22);
    expect(items[0]).not.toHaveProperty("rule_passes_json");
    expect(JSON.stringify(listedBody)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(listedBody)).not.toContain("canonical_payload");
  });

  it("rolls back the contract receipt when evidence persistence fails", async () => {
    const database = new FakeD1(true);
    const response = await handleRequest(
      postBody(contractIncrementalPayload()),
      await environment(database),
    );

    expect(response.status).toBe(503);
    expect(database.records).toHaveLength(0);
    expect(database.evidence).toHaveLength(0);
  });

  it("accepts contract-versioned shadow evidence and an empty 1.2 heartbeat", async () => {
    const evidenceDatabase = new FakeD1();
    const evidenceResponse = await handleRequest(
      postBody(contractIncrementalPayload()),
      await environment(evidenceDatabase),
    );
    const heartbeat = contractIncrementalPayload();
    heartbeat.transitions = [];
    heartbeat.sequence = 2;
    heartbeat.idempotency_key = "pine-lab-01:2";
    const heartbeatDatabase = new FakeD1();
    const heartbeatResponse = await handleRequest(
      postBody(heartbeat),
      await environment(heartbeatDatabase),
    );

    expect(evidenceResponse.status).toBe(202);
    expect(await body(evidenceResponse)).toMatchObject({
      schema_version: "1.2",
      strategy_version: "1.2.0-contract1",
      status: "RECEIVED",
    });
    expect(heartbeatResponse.status).toBe(202);
    expect(evidenceDatabase.evidence).toHaveLength(1);
    expect(heartbeatDatabase.records).toHaveLength(1);
    expect(heartbeatDatabase.evidence).toHaveLength(0);
  });

  it("retains same-bar ambiguity as validated shadow evidence", async () => {
    const payload = contractIncrementalPayload();
    const transition = (payload.transitions as Record<string, unknown>[])[0];
    const evidence = transition?.rule_evidence as Record<string, unknown>;
    if (transition !== undefined) {
      transition.from_state = "ARMED";
      transition.to_state = "SHADOW_ONLY";
      transition.reason_code = "SHADOW_AMBIGUOUS_SAME_BAR_ORDER";
    }
    const lifecycle = evidence.lifecycle as Record<string, unknown>;
    lifecycle.zone_engaged_epoch = lifecycle.liquidity_swept_epoch;
    evidence.decision = "SHADOW_ONLY";
    const rulePasses = evidence.rule_passes as boolean[];
    const eventOrderIndex = CONTRACT_OPEN_RULES.findIndex(
      ([ruleId]) => ruleId === "LIQ_EVENT_ORDER",
    );
    if (eventOrderIndex !== -1) {
      rulePasses[eventOrderIndex] = false;
    }

    const response = await handleRequest(postBody(payload), await environment());

    expect(response.status).toBe(202);
  });

  it("retains rejected engagement when prerequisite lifecycle events are absent", async () => {
    const payload = contractIncrementalPayload();
    const transition = (payload.transitions as Record<string, unknown>[])[0];
    const evidence = transition?.rule_evidence as Record<string, unknown>;
    if (transition !== undefined) {
      transition.to_state = "REJECTED";
      transition.reason_code = "REJECT_TARGET_TAP_WITHOUT_ELIGIBILITY";
    }
    const lifecycle = evidence.lifecycle as Record<string, unknown>;
    lifecycle.own_extreme_broken_epoch = null;
    lifecycle.liquidity_swept_epoch = null;
    evidence.decision = "REJECT";
    const rulePasses = evidence.rule_passes as boolean[];
    const eventOrderIndex = CONTRACT_OPEN_RULES.findIndex(
      ([ruleId]) => ruleId === "LIQ_EVENT_ORDER",
    );
    if (eventOrderIndex !== -1) {
      rulePasses[eventOrderIndex] = false;
    }

    const response = await handleRequest(postBody(payload), await environment());

    expect(response.status).toBe(202);
  });

  it.each([
    [
      "missing contract version",
      (payload: Record<string, unknown>) => {
        delete payload.rule_contract_version;
      },
    ],
    [
      "missing rule catalog",
      (payload: Record<string, unknown>) => {
        delete payload.rule_catalog;
      },
    ],
    [
      "executable mode",
      (payload: Record<string, unknown>) => {
        payload.execution_mode = "PAPER_OPEN";
      },
    ],
    [
      "missing rule evidence",
      (payload: Record<string, unknown>) => {
        const transition = (payload.transitions as Record<string, unknown>[])[0];
        if (transition !== undefined) {
          delete transition.rule_evidence;
        }
      },
    ],
    [
      "paper open decision",
      (payload: Record<string, unknown>) => {
        const transition = (payload.transitions as Record<string, unknown>[])[0];
        const evidence = transition?.rule_evidence as Record<string, unknown>;
        evidence.decision = "PAPER_OPEN";
      },
    ],
    [
      "wrong frozen fidelity",
      (payload: Record<string, unknown>) => {
        const catalog = payload.rule_catalog as Record<string, unknown>[];
        catalog[0]!.fidelity = "DISCRETIONARY";
      },
    ],
    [
      "event-order claim without strict lifecycle",
      (payload: Record<string, unknown>) => {
        const transition = (payload.transitions as Record<string, unknown>[])[0];
        const evidence = transition?.rule_evidence as Record<string, unknown>;
        const lifecycle = evidence.lifecycle as Record<string, unknown>;
        lifecycle.zone_engaged_epoch = lifecycle.liquidity_swept_epoch;
      },
    ],
    [
      "paper command field on observation-only schema",
      (payload: Record<string, unknown>) => {
        payload.paper_commands = [];
      },
    ],
  ])("rejects malformed 1.2 evidence: %s", async (_name, mutate) => {
    const payload = contractIncrementalPayload();
    mutate(payload);

    const response = await handleRequest(
      postBody(payload),
      await environment(),
    );

    expect(response.status).toBe(422);
    expect((await body(response)).error).toMatchObject({
      code: "INVALID_OBSERVATION",
    });
  });

  it("rejects a bad credential without echoing it", async () => {
    const rejected = "do-not-echo-this-secret";
    const env = await environment();
    const response = await handleRequest(
      postBody(incrementalPayload(), rejected),
      env,
    );
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).toContain("INVALID_CREDENTIAL");
    expect(text).not.toContain(rejected);
  });

  it("bounds the body before parsing and never echoes oversized content", async () => {
    const oversized = "private-" + "x".repeat(2_000);
    const env = await environment(new FakeD1(), {
      TRADINGVIEW_OBSERVATION_MAX_BODY_BYTES: "1024",
    });
    const response = await handleRequest(
      postBody(incrementalPayload(), oversized),
      env,
    );
    const text = await response.text();

    expect(response.status).toBe(413);
    expect(text).toContain("BODY_TOO_LARGE");
    expect(text).not.toContain(oversized);
  });

  it.each([
    ["extra keys", (payload: Record<string, unknown>) => (payload.extra = true)],
    [
      "corrupt backslash identifier",
      (payload: Record<string, unknown>) => {
        payload.producer_instance_id = "pine\\corrupt";
        payload.idempotency_key = "pine\\corrupt:1";
      },
    ],
    [
      "idempotency mismatch",
      (payload: Record<string, unknown>) =>
        (payload.idempotency_key = "pine-lab-01:2"),
    ],
    [
      "unsafe integer",
      (payload: Record<string, unknown>) =>
        (payload.sequence = 9_007_199_254_740_992),
    ],
    [
      "invalid zone geometry",
      (payload: Record<string, unknown>) => {
        const transition = (payload.transitions as Record<string, unknown>[])[0];
        const zone = transition?.zone as Record<string, unknown>;
        zone.top = 2_149;
      },
    ],
    [
      "future transition candle",
      (payload: Record<string, unknown>) => {
        const transition = (payload.transitions as Record<string, unknown>[])[0];
        const candle = transition?.source_candle as Record<string, unknown>;
        candle.close_epoch = 1_710_000_600_000;
      },
    ],
    [
      "non-contiguous transition index",
      (payload: Record<string, unknown>) => {
        const transition = (payload.transitions as Record<string, unknown>[])[0];
        if (transition !== undefined) {
          transition.transition_index = 1;
        }
      },
    ],
    [
      "empty incremental transitions",
      (payload: Record<string, unknown>) => (payload.transitions = []),
    ],
  ])("rejects malformed contract: %s", async (_name, mutate) => {
    const payload = incrementalPayload();
    mutate(payload);
    const response = await handleRequest(
      postBody(payload),
      await environment(),
    );
    expect(response.status).toBe(422);
    expect((await body(response)).error).toMatchObject({
      code: "INVALID_OBSERVATION",
    });
  });

  it("rejects duplicate object keys and non-finite JSON spellings", async () => {
    const env = await environment();
    const payloadJson = JSON.stringify(incrementalPayload());
    const duplicate = new Request(
      `${BASE_URL}/api/v1/tradingview/observations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: `{"credential":"${CREDENTIAL}","credential":"${CREDENTIAL}","payload":${payloadJson}}`,
      },
    );
    const nonFinite = new Request(
      `${BASE_URL}/api/v1/tradingview/observations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credential: CREDENTIAL,
          payload: incrementalPayload(),
        }).replace('"top":2150.25', '"top":NaN'),
      },
    );

    expect((await handleRequest(duplicate, env)).status).toBe(422);
    expect((await handleRequest(nonFinite, env)).status).toBe(422);
  });

  it("sanitizes D1 failures and validates list limits", async () => {
    const failingEnv = await environment(new FailingD1());
    const post = await handleRequest(postBody(incrementalPayload()), failingEnv);
    const list = await handleRequest(
      new Request(`${BASE_URL}/api/v1/observation-receipts`),
      failingEnv,
    );
    const validEnv = await environment();
    const invalidLimit = await handleRequest(
      new Request(`${BASE_URL}/api/v1/observation-receipts?limit=201`),
      validEnv,
    );
    const invalidEvidenceLimit = await handleRequest(
      new Request(
        `${BASE_URL}/api/v1/observation-setup-evidence?limit=0&limit=1`,
      ),
      validEnv,
    );

    expect(post.status).toBe(503);
    expect(list.status).toBe(503);
    expect(invalidLimit.status).toBe(422);
    expect(invalidEvidenceLimit.status).toBe(422);
    expect(await body(invalidEvidenceLimit)).toMatchObject({
      error: { code: "INVALID_LIMIT" },
    });
  });

  it("rejects unsupported methods and malformed media without invoking D1", async () => {
    const database = new FakeD1();
    const env = await environment(database);
    const method = await handleRequest(
      new Request(`${BASE_URL}/api/v1/tradingview/observations`),
      env,
    );
    const media = await handleRequest(
      new Request(`${BASE_URL}/api/v1/tradingview/observations`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "secret raw content",
      }),
      env,
    );

    expect(method.status).toBe(405);
    expect(media.status).toBe(422);
    expect(database.preparedSql).toHaveLength(0);
  });
});

describe("deployment contract", () => {
  it("routes only API/health through the Worker and keeps the credential a secret", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const config = JSON.parse(
      readFileSync(`${root}/wrangler.jsonc`, "utf8"),
    ) as Record<string, unknown>;
    const assets = config.assets as Record<string, unknown>;
    const databases = config.d1_databases as Record<string, unknown>[];
    const variables = config.vars as Record<string, unknown>;

    expect(config.compatibility_date).toBe("2026-07-23");
    expect(config.workers_dev).toBe(true);
    expect(config.preview_urls).toBe(false);
    expect(assets.directory).toBe("../operations-console/out");
    expect(assets.run_worker_first).toEqual(["/api/*", "/health/*"]);
    expect(databases[0]?.binding).toBe("DB");
    expect(variables).not.toHaveProperty(
      "TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256",
    );
  });

  it("defines metadata-only D1 storage with atomic idempotency", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const migration = readFileSync(
      `${root}/migrations/0001_observation_receipts.sql`,
      "utf8",
    ).toLowerCase();

    expect(migration).toContain("idempotency_key text not null unique");
    expect(migration).toContain("payload_sha256 text not null");
    expect(migration).not.toMatch(/^\s*(credential|payload)\s+text/gm);
    expect(INSERT_RECEIPT_SQL).toContain("INSERT INTO observation_receipts");
    expect(INSERT_RECEIPT_SQL).not.toContain("INSERT OR IGNORE");
  });

  it("upgrades receipt storage for contract-v2 without breaking references", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const migration = readFileSync(
      `${root}/migrations/0020_observation_receipts_contract_v2.sql`,
      "utf8",
    ).toLowerCase();

    expect(migration).toContain("pragma defer_foreign_keys = on");
    expect(migration).toContain(
      "schema_version in ('1.0', '1.1', '1.2')",
    );
    expect(migration).toContain(
      "(schema_version = '1.2' and strategy_version = '1.2.0-contract1')",
    );
    expect(migration).toContain(
      "insert into observation_receipts_contract_v2",
    );
    expect(migration).toContain("from observation_receipts");
    expect(migration).toContain(
      "rename to observation_receipts",
    );
    expect(migration).toContain("pragma foreign_key_check");
    expect(migration).toContain("pragma defer_foreign_keys = off");
    expect(migration).not.toMatch(/^\s*(credential|payload)\s+text/gm);
  });

  it("stores sanitized setup evidence with strict receipt ownership", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const migration = readFileSync(
      `${root}/migrations/0021_observation_setup_evidence.sql`,
      "utf8",
    ).toLowerCase();

    expect(migration).toContain(
      "references observation_receipts(receipt_id) on delete cascade",
    );
    expect(migration).toContain(
      "unique (receipt_id, event_kind, event_index)",
    );
    expect(migration).toContain("json_array_length(rule_passes_json) = 22");
    expect(migration).toContain(
      "idx_observation_setup_evidence_recorded",
    );
    expect(migration).toContain("pragma foreign_key_check");
    expect(migration).not.toMatch(
      /^\s*(credential|payload|raw_payload|canonical_payload)\s+text/gm,
    );
  });
});
