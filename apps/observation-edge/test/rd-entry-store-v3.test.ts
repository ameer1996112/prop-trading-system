import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  appendEntryV3Observation,
  EntryV3StoreConflict,
} from "../src/rd-entry-store-v3";
import {
  selectionIdV3,
  type EntrySelectionV3,
} from "../src/rd-entry-domain-v3";
import { validateEntryV3Payload } from "../src/rd-entry-wire-v3";
import { parseStrictJson } from "../src/strict-json";
import type { Env, ValidatedObservation } from "../src/types";

type SqliteInput =
  | null
  | number
  | bigint
  | string
  | NodeJS.ArrayBufferView;

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const root = fileURLToPath(new URL("../", import.meta.url));
  for (const migration of readdirSync(`${root}/migrations`)
    .filter((name) => /^\d{4}_.*\.sql$/u.test(name))
    .sort()) {
    database.exec(readFileSync(`${root}/migrations/${migration}`, "utf8"));
  }
  return database;
}

class SqliteStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    private readonly hideFirstRow: () => boolean = () => false,
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    this.values = values;
    return this;
  }

  execute(): D1Result {
    if (/^\s*SELECT\b/iu.test(this.sql)) {
      return {
        success: true,
        results: this.database
          .prepare(this.sql)
          .all(...(this.values as SqliteInput[])),
        meta: {},
      } as unknown as D1Result;
    }
    const result = this.database
      .prepare(this.sql)
      .run(...(this.values as SqliteInput[]));
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes) },
    } as unknown as D1Result;
  }

  async first<T>(): Promise<T | null> {
    if (this.hideFirstRow()) return null;
    return (
      (this.database
        .prepare(this.sql)
        .get(...(this.values as SqliteInput[])) as T | undefined) ?? null
    );
  }

  async all<T>(): Promise<D1Result<T>> {
    return this.execute() as D1Result<T>;
  }

  async run(): Promise<D1Result> {
    return this.execute();
  }
}

class SqliteD1 {
  readonly database = migratedDatabase();
  failNextAllocationReadiness = false;
  failNextBatchUnrelated = false;
  hideNextPaperLinkRead = false;
  hideNextPaperSettlementRead = false;
  hideNextPaperExitApplicationRead = false;

  prepare(sql: string): D1PreparedStatement {
    return new SqliteStatement(
      this.database,
      sql,
      () => {
        if (
          this.hideNextPaperLinkRead &&
          sql.includes("FROM observation_entry_v3_paper_links")
        ) {
          this.hideNextPaperLinkRead = false;
          return true;
        }
        if (
          this.hideNextPaperSettlementRead &&
          sql.includes("FROM paper_trade_settlements")
        ) {
          this.hideNextPaperSettlementRead = false;
          return true;
        }
        if (
          this.hideNextPaperExitApplicationRead &&
          sql.includes("FROM observation_entry_v3_exit_applications")
        ) {
          this.hideNextPaperExitApplicationRead = false;
          return true;
        }
        return false;
      },
    ) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.database.exec("BEGIN");
    try {
      if (
        this.failNextBatchUnrelated &&
        statements.some((statement) =>
          (statement as unknown as SqliteStatement).sql.includes(
            "INSERT INTO observation_receipts",
          ),
        )
      ) {
        this.failNextBatchUnrelated = false;
        throw new Error("injected unrelated batch failure");
      }
      const results = statements.map((statement) =>
        (() => {
          const item = statement as unknown as SqliteStatement;
          if (
            this.failNextAllocationReadiness &&
            item.sql.includes("INSERT INTO paper_trade_allocations")
          ) {
            this.failNextAllocationReadiness = false;
            throw new Error("paper safety gate blocked allocation");
          }
          return item.execute();
        })(),
      ) as D1Result<T>[];
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const vectorDocument = JSON.parse(
  readFileSync(
    new URL(
      "../../../contracts/vectors/rd-entry-arbitration-v3.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  cases: Array<{
    case_id: string;
    input: Record<string, unknown>;
    expected: {
      candidates: Array<Record<string, unknown>>;
      evidence: Array<Record<string, unknown>>;
      selection: Record<string, unknown>;
    };
  }>;
};
const detectorHash = "a".repeat(64);
const settingsHash = "b".repeat(64);
const commonRuleIds = [
  "LIQ_ACTUAL_EXTREME_SWEPT",
  "LIQ_DISTANCE_INFLUENCES_ZONE",
  "LIQ_EVENT_ORDER",
  "LIQ_INTERNAL_REBREAK",
  "LIQ_NORMAL_TWO_OPPOSITE_CANDLES",
  "LIQ_ONE_CANDLE_EXCEPTION",
  "LIQ_OWN_EXTREME_SAME_LEG",
  "LIQ_REPLACEMENT_AFTER_STALE_MOVE",
  "LIQ_STRICT_OWN_EXTREME_BREAK",
  "TIMEFRAME_FIVE_MINUTE_ONLY",
  "ZONE_ACCURACY_BOUNDS",
  "ZONE_FRESH_UNTAPPED",
  "ZONE_ORIGIN_OPPOSITE_CANDLE",
  "ZONE_PRE_ENTRY_CLOSE_OUTSIDE",
] as const;

function strict(value: unknown) {
  return parseStrictJson(new TextEncoder().encode(JSON.stringify(value)));
}

function payloadFor(caseId: string): Record<string, unknown> {
  const vector = structuredClone(
    vectorDocument.cases.find((item) => item.case_id === caseId)!,
  );
  const input = vector.input;
  const selection = vector.expected.selection;
  const canonicalEvidence =
    vector.expected.evidence.find(
      (item) => item.evidence_id === selection.canonical_evidence_id,
    ) ?? vector.expected.evidence[0]!;
  const entryTicks = canonicalEvidence.observed_trigger_ticks as number;
  const direction = input.direction as "LONG" | "SHORT";
  const confirmedBar =
    selection.canonical_model === "DIR_CLOSE"
      ? input.confirmed_bar
      : null;
  return {
    schema_version: "3.0",
    strategy_id: "rd_liquidity_sd_5m_v1",
    strategy_version: "3.0.0-contract3",
    rule_contract_version: "3.0.0",
    execution_mode: "PAPER_ONLY",
    producer_instance_id: "pine-v3-store",
    producer_sequence: canonicalEvidence.trigger_sequence,
    event_id: `pine-v3-store:${caseId}`,
    is_realtime: canonicalEvidence.proof_plane === "REALTIME_TICK",
    symbol: "EURUSD",
    ticker_id: "OANDA:EURUSD",
    feed: "OANDA",
    timeframe: "5",
    tick_size: "0.00001",
    detector_code_hash: detectorHash,
    settings_hash: settingsHash,
    observed_at_epoch: Math.max(
      input.observed_at_epoch as number,
      selection.evaluated_at_epoch as number,
    ),
    market_event: {
      epoch: canonicalEvidence.observed_trigger_epoch,
      sequence: canonicalEvidence.trigger_sequence,
      tick_price_ticks: entryTicks,
      barstate_isconfirmed: confirmedBar !== null,
      confirmed_bar: confirmedBar,
    },
    exit_events: [],
    setups: [
      {
        setup: {
          setup_id: input.setup_id,
          direction,
          zone_top_ticks: input.zone_top_ticks,
          zone_bottom_ticks: input.zone_bottom_ticks,
          zone_engaged_epoch: input.zone_engaged_epoch,
          invalidated_before_entry: input.setup_invalidated,
          common_fidelity: input.common_fidelity,
          common_rule_results: commonRuleIds.map((rule_id) => ({
            rule_id,
            passed: true,
          })),
        },
        candidates: vector.expected.candidates,
        evidence: vector.expected.evidence,
        selection_proposal: selection,
        trade_plan: {
          direction,
          entry_ticks: entryTicks,
          stop_ticks: direction === "LONG" ? entryTicks - 10 : entryTicks + 10,
          target_ticks: direction === "LONG" ? entryTicks + 40 : entryTicks - 40,
        },
      },
    ],
  };
}

async function oneCandlePayloadFor(
  caseId: string,
): Promise<Record<string, unknown>> {
  const value = payloadFor(caseId);
  value.schema_version = "3.1";
  value.strategy_version = "3.1.0-contract3";
  value.rule_contract_version = "3.1.0";
  const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
  const setup = bundle.setup as Record<string, unknown>;
  setup.liquidity_cohort = "ONE_CANDLE";
  setup.one_candle_enabled = true;
  setup.common_fidelity = "DISCRETIONARY";
  const rules = setup.common_rule_results as Array<Record<string, unknown>>;
  for (const rule of rules) {
    if (
      rule.rule_id === "LIQ_NORMAL_TWO_OPPOSITE_CANDLES" ||
      rule.rule_id === "LIQ_INTERNAL_REBREAK"
    ) {
      rule.passed = false;
    }
  }
  const selection = bundle.selection_proposal as Record<string, unknown>;
  selection.canonical_candidate_id = null;
  selection.canonical_evidence_id = null;
  selection.canonical_model = null;
  selection.reason = "NO_EXACT_CANDIDATE";
  selection.action = "SHADOW_ONLY";
  selection.fidelity = null;
  selection.co_triggered_models = [];
  selection.selection_id = await selectionIdV3(
    selection as unknown as EntrySelectionV3,
  );
  return value;
}

async function observation(
  payload: Record<string, unknown>,
): Promise<Extract<ValidatedObservation, { version: "entry-v3" }>> {
  return {
    version: "entry-v3",
    credential: "test",
    ...(await validateEntryV3Payload(strict(payload))),
    paperCommands: [],
  };
}

function retagBundle(
  source: Extract<
    ValidatedObservation,
    { version: "entry-v3" }
  >["entryBundles"][number],
  tag: number,
) {
  const bundle = structuredClone(source) as unknown as {
    setup: { setup_id: string };
    candidates: Array<{ candidate_id: string; setup_id: string }>;
    evidence: Array<{
      evidence_id: string;
      candidate_id: string;
    }>;
    selectionProposal: {
      selection_id: string;
      setup_id: string;
      candidate_ids_considered: string[];
      canonical_candidate_id: string | null;
      canonical_evidence_id: string | null;
    };
    evaluation: {
      candidates: Array<{ candidate_id: string; setup_id: string }>;
      evidence: Array<{ evidence_id: string; candidate_id: string }>;
      selection: {
        selection_id: string;
        setup_id: string;
        candidate_ids_considered: string[];
        canonical_candidate_id: string | null;
        canonical_evidence_id: string | null;
      };
    };
  };
  const setupId = `setup-readiness-${tag}`;
  const candidateId = tag.toString(16).padStart(1, "0").repeat(64);
  const evidenceId = ((tag + 5) % 16).toString(16).repeat(64);
  const selectionId = ((tag + 10) % 16).toString(16).repeat(64);
  bundle.setup.setup_id = setupId;
  for (const candidate of [...bundle.candidates, ...bundle.evaluation.candidates]) {
    candidate.setup_id = setupId;
    candidate.candidate_id = candidateId;
  }
  for (const evidence of [...bundle.evidence, ...bundle.evaluation.evidence]) {
    evidence.candidate_id = candidateId;
    evidence.evidence_id = evidenceId;
  }
  for (const selection of [
    bundle.selectionProposal,
    bundle.evaluation.selection,
  ]) {
    selection.setup_id = setupId;
    selection.selection_id = selectionId;
    selection.candidate_ids_considered = [candidateId];
    selection.canonical_candidate_id = candidateId;
    selection.canonical_evidence_id = evidenceId;
  }
  return bundle as unknown as Extract<
    ValidatedObservation,
    { version: "entry-v3" }
  >["entryBundles"][number];
}

function observationWithBundles(
  source: Extract<ValidatedObservation, { version: "entry-v3" }>,
  eventId: string,
  sequence: number,
  bundles: Extract<
    ValidatedObservation,
    { version: "entry-v3" }
  >["entryBundles"],
): Extract<ValidatedObservation, { version: "entry-v3" }> {
  return {
    ...source,
    eventId,
    producerSequence: sequence,
    metadata: {
      ...source.metadata,
      idempotencyKey: eventId,
      sequence,
    },
    entryBundles: bundles,
  };
}

function env(database: SqliteD1, overrides: Partial<Env> = {}): Env {
  return {
    DB: database as unknown as D1Database,
    RD_ENTRY_PAPER_ACCOUNT_IDS: "paper-primary",
    RD_ENTRY_PAPER_RISK_BPS: "50",
    RD_ENTRY_V3_DETECTOR_CODE_HASH: detectorHash,
    RD_ENTRY_V3_SETTINGS_HASH: settingsHash,
    ...overrides,
  };
}

function installPaperAccount(database: SqliteD1): void {
  database.database
    .prepare(
      `INSERT INTO paper_accounts (
        account_id, mode, label, currency_code, currency_scale,
        opening_balance_minor, idempotency_key, payload_sha256, created_at
      ) VALUES (?, 'PAPER_ONLY', ?, 'USD', 2, ?, ?, ?, ?)`,
    )
    .run(
      "paper-primary",
      "Primary",
      5_000_000,
      "paper-account:paper-primary",
      "9".repeat(64),
      "2026-07-28T00:00:00.000Z",
    );
  database.database
    .prepare(
      `INSERT INTO paper_kill_switch_events (
        event_id, idempotency_key, payload_sha256, enabled, reason, changed_at
      ) VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .run(
      "paper-kill-switch-test-disabled",
      "paper-kill-switch:test-disabled",
      "8".repeat(64),
      "TEST_DISABLED",
      "2026-07-28T00:00:01.000Z",
    );
}

async function payloadDigest(payload: Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function realtimeExitPayload(
  base: Record<string, unknown>,
  eventId: string,
  exitReason: "STOP_LOSS" | "TARGET" | "AMBIGUOUS_SAME_BAR_EXIT",
): Record<string, unknown> {
  const value = structuredClone(base);
  const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
  const setup = bundle.setup as Record<string, unknown>;
  const plan = bundle.trade_plan as Record<string, unknown>;
  const priceTicks =
    exitReason === "STOP_LOSS"
      ? plan.stop_ticks
      : exitReason === "TARGET"
        ? plan.target_ticks
        : plan.entry_ticks;
  value.event_id = eventId;
  value.producer_sequence = 999;
  value.is_realtime = true;
  value.observed_at_epoch = 3000;
  value.market_event = {
    epoch: 3000,
    sequence: 999,
    tick_price_ticks: priceTicks,
    barstate_isconfirmed: false,
    confirmed_bar: null,
  };
  value.exit_events = [
    {
      event_id: `${eventId}:exit`,
      setup_id: setup.setup_id,
      exit_reason: exitReason,
      epoch: 3000,
      sequence: 999,
      price_ticks: priceTicks,
    },
  ];
  return value;
}

function historicalSameBarExitPayload(
  base: Record<string, unknown>,
  eventId: string,
): Record<string, unknown> {
  const value = realtimeExitPayload(
    base,
    eventId,
    "AMBIGUOUS_SAME_BAR_EXIT",
  );
  const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
  const plan = bundle.trade_plan as Record<string, number>;
  const entryTicks = plan.entry_ticks!;
  const stopTicks = plan.stop_ticks!;
  const targetTicks = plan.target_ticks!;
  value.is_realtime = false;
  value.market_event = {
    epoch: 3000,
    sequence: 999,
    tick_price_ticks: entryTicks,
    barstate_isconfirmed: true,
    confirmed_bar: {
      open_epoch: 2700,
      close_epoch: 3000,
      open_ticks: entryTicks,
      high_ticks: Math.max(stopTicks, targetTicks),
      low_ticks: Math.min(stopTicks, targetTicks),
      close_ticks: entryTicks,
    },
  };
  return value;
}

function setExitSequence(
  payload: Record<string, unknown>,
  sequence: number,
): void {
  payload.producer_sequence = sequence;
  (payload.market_event as Record<string, unknown>).sequence = sequence;
  (payload.exit_events as Array<Record<string, unknown>>)[0]!.sequence =
    sequence;
}

describe("RD entry v3 persistence", () => {
  it("installs the v3 entry and paper decision schema", () => {
    const database = migratedDatabase();
    const names = database
      .prepare(
        "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'trigger')",
      )
      .all() as Array<{ type: string; name: string }>;
    const tableNames = names
      .filter((item) => item.type === "table")
      .map((item) => item.name);
    const triggerNames = names
      .filter((item) => item.type === "trigger")
      .map((item) => item.name);

    expect(tableNames).toEqual(
      expect.arrayContaining([
        "observation_entry_v3_events",
        "observation_entry_v3_candidates",
        "observation_entry_v3_evidence",
        "observation_entry_v3_selections",
        "observation_entry_v3_selection_members",
        "observation_entry_v3_parity",
        "observation_entry_v3_paper_links",
        "observation_entry_v3_shadow_positions",
        "observation_entry_v3_exit_applications",
        "observation_entry_v3_event_dispositions",
      ]),
    );
    expect(triggerNames).toEqual(
      expect.arrayContaining([
        "observation_entry_v3_candidates_no_update",
        "observation_entry_v3_candidates_no_delete",
        "observation_entry_v3_selections_no_update",
        "observation_entry_v3_selections_no_delete",
        "observation_entry_v3_parity_no_update",
        "observation_entry_v3_parity_no_delete",
        "observation_entry_v3_paper_links_no_update",
        "observation_entry_v3_paper_links_no_delete",
        "observation_entry_v3_shadow_positions_no_delete",
        "observation_entry_v3_exit_applications_no_update",
        "observation_entry_v3_exit_applications_no_delete",
        "observation_entry_v3_event_dispositions_no_update",
        "observation_entry_v3_event_dispositions_no_delete",
      ]),
    );
    database.close();
  });

  it("opens one intent, preserves BOC, and replays idempotently", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = payloadFor("strict_long_boc_only");
    const validated = await observation(payload);
    const digest = await payloadDigest(payload);

    const first = await appendEntryV3Observation(
      env(database),
      validated,
      digest,
    );
    const second = await appendEntryV3Observation(
      env(database),
      validated,
      digest,
    );

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.evaluations).toEqual(first.evaluations);
    expect(second.paperIntentIds).toEqual(first.paperIntentIds);
    expect(first.paperIntentIds).toHaveLength(1);
    expect(
      database.database
        .prepare("SELECT model FROM observation_entry_v3_candidates")
        .all(),
    ).toEqual([{ model: "BOC" }]);
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_intents")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM observation_entry_v3_events")
        .get(),
    ).toEqual({ count: 1 });
  });

  it("stores a reviewed-hash mismatch but allocates nothing", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = payloadFor("strict_long_boc_only");
    payload.detector_code_hash = "c".repeat(64);
    const validated = await observation(payload);
    const result = await appendEntryV3Observation(
      env(database),
      validated,
      await payloadDigest(payload),
    );

    expect(result.evaluations[0]).toMatchObject({
      effectiveAction: "SHADOW_ONLY",
      effectiveActionReason: "PROMOTION_IDENTITY_MISMATCH",
    });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM observation_entry_v3_events")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_intents")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("accepts the reviewed settings hash bound to the exact ticker", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = payloadFor("strict_long_boc_only");
    const validated = await observation(payload);
    const pairBoundEnv = {
      ...env(database, { RD_ENTRY_V3_SETTINGS_HASH: "c".repeat(64) }),
      RD_ENTRY_V3_SETTINGS_HASHES_JSON: JSON.stringify({
        "OANDA:EURUSD": settingsHash,
      }),
    };

    const result = await appendEntryV3Observation(
      pairBoundEnv,
      validated,
      await payloadDigest(payload),
    );

    expect(result.evaluations[0]).toMatchObject({
      effectiveAction: "PAPER_ELIGIBLE",
      effectiveActionReason: null,
    });
    expect(result.paperIntentIds).toHaveLength(1);
  });

  it("fails closed when the reviewed map has no entry for the ticker", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = payloadFor("strict_long_boc_only");
    const validated = await observation(payload);
    const pairBoundEnv = {
      ...env(database),
      RD_ENTRY_V3_SETTINGS_HASHES_JSON: JSON.stringify({
        "OANDA:USDJPY": settingsHash,
      }),
    };

    const result = await appendEntryV3Observation(
      pairBoundEnv,
      validated,
      await payloadDigest(payload),
    );

    expect(result.evaluations[0]).toMatchObject({
      effectiveAction: "SHADOW_ONLY",
      effectiveActionReason: "PROMOTION_IDENTITY_MISMATCH",
    });
    expect(result.paperIntentIds).toEqual([]);
  });

  it("fails closed when the reviewed settings map is malformed", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = payloadFor("strict_long_boc_only");
    const validated = await observation(payload);
    const pairBoundEnv = {
      ...env(database),
      RD_ENTRY_V3_SETTINGS_HASHES_JSON:
        '{"OANDA:EURUSD":"' + settingsHash + '",}',
    };

    const result = await appendEntryV3Observation(
      pairBoundEnv,
      validated,
      await payloadDigest(payload),
    );

    expect(result.evaluations[0]).toMatchObject({
      effectiveAction: "SHADOW_ONLY",
      effectiveActionReason: "PROMOTION_IDENTITY_MISMATCH",
    });
    expect(result.paperIntentIds).toEqual([]);
  });

  it("downgrades invalid paper configuration without partial allocation", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = payloadFor("strict_long_boc_only");
    const result = await appendEntryV3Observation(
      env(database, { RD_ENTRY_PAPER_RISK_BPS: "0" }),
      await observation(payload),
      await payloadDigest(payload),
    );

    expect(result.evaluations[0]).toMatchObject({
      effectiveAction: "SHADOW_ONLY",
      effectiveActionReason: "PAPER_CONFIGURATION_UNAVAILABLE",
    });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_allocations")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("freezes one setup attempt when a later event repeats the candidate", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const firstPayload = payloadFor("strict_long_boc_only");
    await appendEntryV3Observation(
      env(database),
      await observation(firstPayload),
      await payloadDigest(firstPayload),
    );
    const laterPayload = payloadFor("strict_long_boc_only");
    laterPayload.event_id = "pine-v3-store:strict-long-later";
    laterPayload.producer_sequence =
      (laterPayload.producer_sequence as number) + 100;
    const result = await appendEntryV3Observation(
      env(database),
      await observation(laterPayload),
      await payloadDigest(laterPayload),
    );

    expect(result.evaluations[0]).toMatchObject({
      effectiveAction: "SHADOW_ONLY",
      effectiveActionReason: "NOT_SELECTED_ALREADY_OPEN",
    });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_intents")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM observation_entry_v3_paper_links")
        .get(),
    ).toEqual({ count: 1 });
  });

  it("an exit-only event without a durable link cannot authorize paper", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = payloadFor("strict_long_boc_only");
    const bundle = (payload.setups as Array<Record<string, unknown>>)[0]!;
    const setup = bundle.setup as Record<string, unknown>;
    const plan = bundle.trade_plan as Record<string, unknown>;
    payload.event_id = "pine-v3-store:orphan-exit";
    payload.producer_sequence = 999;
    payload.observed_at_epoch = 3000;
    payload.market_event = {
      epoch: 3000,
      sequence: 999,
      tick_price_ticks: plan.target_ticks,
      barstate_isconfirmed: false,
      confirmed_bar: null,
    };
    payload.exit_events = [
      {
        event_id: "orphan-exit:target",
        setup_id: setup.setup_id,
        exit_reason: "TARGET",
        epoch: 3000,
        sequence: 999,
        price_ticks: plan.target_ticks,
      },
    ];

    await appendEntryV3Observation(
      env(database),
      await observation(payload),
      await payloadDigest(payload),
    );
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM observation_entry_v3_events")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_intents")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_settlements")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("stores same-event BOC and flip as distinct candidates with one intent", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = payloadFor("boc_flip_same_event");
    await appendEntryV3Observation(
      env(database),
      await observation(payload),
      await payloadDigest(payload),
    );

    expect(
      database.database
        .prepare(
          "SELECT model FROM observation_entry_v3_candidates ORDER BY model",
        )
        .all(),
    ).toEqual([{ model: "BOC" }, { model: "HTF_FLIP" }]);
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_intents")
        .get(),
    ).toEqual({ count: 1 });
  });

  it("tracks discretionary BOC and terminates it without account risk", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const entryPayload = payloadFor("discretionary_boc_shadow");
    await appendEntryV3Observation(
      env(database),
      await observation(entryPayload),
      await payloadDigest(entryPayload),
    );
    const exitPayload = realtimeExitPayload(
      entryPayload,
      "pine-v3-store:discretionary-target",
      "TARGET",
    );
    await appendEntryV3Observation(
      env(database),
      await observation(exitPayload),
      await payloadDigest(exitPayload),
    );

    expect(
      database.database
        .prepare(
          `SELECT state, outcome_r_millis
           FROM observation_entry_v3_shadow_positions`,
        )
        .get(),
    ).toEqual({ state: "TARGET_HIT", outcome_r_millis: 4000 });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_allocations")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("persists an enabled one-candle selection and immutable shadow cohort without paper", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const entryPayload = await oneCandlePayloadFor(
      "discretionary_boc_shadow",
    );
    const result = await appendEntryV3Observation(
      env(database),
      await observation(entryPayload),
      await payloadDigest(entryPayload),
    );

    expect(result.evaluations[0]?.effectiveAction).toBe("SHADOW_ONLY");
    expect(
      database.database
        .prepare(
          `SELECT liquidity_cohort, one_candle_enabled, action
           FROM observation_entry_v3_selections`,
        )
        .get(),
    ).toMatchObject({
      liquidity_cohort: "ONE_CANDLE",
      one_candle_enabled: 1,
      action: "SHADOW_ONLY",
    });
    expect(
      database.database
        .prepare("SELECT * FROM observation_entry_v3_paper_links")
        .all(),
    ).toHaveLength(0);
    expect(
      database.database
        .prepare(
          `SELECT liquidity_cohort, one_candle_enabled, state
           FROM observation_entry_v3_shadow_positions`,
        )
        .get(),
    ).toMatchObject({
      liquidity_cohort: "ONE_CANDLE",
      one_candle_enabled: 1,
      state: "OPEN",
    });
    expect(() =>
      database.database
        .prepare(
          `UPDATE observation_entry_v3_shadow_positions
           SET liquidity_cohort = 'TWO_PLUS_CANDLES'`,
        )
        .run(),
    ).toThrow();
  });

  it.each([
    {
      caseId: "strict_long_boc_only",
      model: "BOC",
      exitReason: "STOP_LOSS" as const,
      terminalState: "STOPPED",
      outcomeRMillis: -1000,
    },
    {
      caseId: "opened_selection_is_frozen",
      model: "DIR_CLOSE",
      exitReason: "TARGET" as const,
      terminalState: "TARGET_HIT",
      outcomeRMillis: 4000,
    },
    {
      caseId: "flip_before_boc",
      model: "HTF_FLIP",
      exitReason: "AMBIGUOUS_SAME_BAR_EXIT" as const,
      terminalState: "AMBIGUOUS",
      outcomeRMillis: null,
    },
  ])(
    "simulates one-candle $model through $terminalState without paper",
    async ({
      caseId,
      model,
      exitReason,
      terminalState,
      outcomeRMillis,
    }) => {
      const database = new SqliteD1();
      installPaperAccount(database);
      const entryPayload = await oneCandlePayloadFor(caseId);
      entryPayload.producer_sequence = Math.max(
        1,
        entryPayload.producer_sequence as number,
      );
      const entry = await appendEntryV3Observation(
        env(database),
        await observation(entryPayload),
        await payloadDigest(entryPayload),
      );

      expect(entry.paperIntentIds).toHaveLength(0);
      expect(
        database.database
          .prepare(
            `SELECT candidate.model, shadow.state
             FROM observation_entry_v3_shadow_positions AS shadow
             JOIN observation_entry_v3_candidates AS candidate
               ON candidate.candidate_id = shadow.candidate_id`,
          )
          .all(),
      ).toEqual([{ model, state: "OPEN" }]);
      expect(
        database.database
          .prepare("SELECT * FROM paper_trade_intents")
          .all(),
      ).toHaveLength(0);

      const exitEventId = `pine-v3-store:one-candle-${model.toLowerCase()}-${terminalState.toLowerCase()}`;
      const exitPayload =
        exitReason === "AMBIGUOUS_SAME_BAR_EXIT"
          ? historicalSameBarExitPayload(entryPayload, exitEventId)
          : realtimeExitPayload(entryPayload, exitEventId, exitReason);
      await appendEntryV3Observation(
        env(database),
        await observation(exitPayload),
        await payloadDigest(exitPayload),
      );

      expect(
        database.database
          .prepare(
            `SELECT state, outcome_r_millis
             FROM observation_entry_v3_shadow_positions`,
          )
          .get(),
      ).toEqual({
        state: terminalState,
        outcome_r_millis: outcomeRMillis,
      });
      expect(
        database.database
          .prepare("SELECT * FROM paper_trade_intents")
          .all(),
      ).toHaveLength(0);
      expect(
        database.database
          .prepare("SELECT * FROM paper_trade_settlements")
          .all(),
      ).toHaveLength(0);
    },
  );

  it("selects the earliest matched one-candle trigger after blocked candidates", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = await oneCandlePayloadFor(
      "close_fallback_after_blocked_aggressive_models",
    );
    payload.producer_sequence = 1;
    payload.is_realtime = true;
    const result = await appendEntryV3Observation(
      env(database),
      await observation(payload),
      await payloadDigest(payload),
    );

    expect(result.inserted).toBe(true);
    expect(result.paperIntentIds).toHaveLength(0);
    expect(
      database.database
        .prepare(
          `SELECT candidate.model,
                  candidate.state AS candidate_state,
                  shadow.state AS shadow_state
           FROM observation_entry_v3_shadow_positions AS shadow
           JOIN observation_entry_v3_candidates AS candidate
             ON candidate.candidate_id = shadow.candidate_id`,
        )
        .all(),
    ).toEqual([
      {
        model: "DIR_CLOSE",
        candidate_state: "MATCHED",
        shadow_state: "OPEN",
      },
    ]);
  });

  it("stores a blocked-only one-candle receipt without opening shadow or paper", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = await oneCandlePayloadFor(
      "realtime_claim_not_realtime",
    );
    const result = await appendEntryV3Observation(
      env(database),
      await observation(payload),
      await payloadDigest(payload),
    );

    expect(result.inserted).toBe(true);
    expect(result.paperIntentIds).toHaveLength(0);
    expect(
      database.database
        .prepare("SELECT * FROM observation_entry_v3_shadow_positions")
        .all(),
    ).toHaveLength(0);
    expect(
      database.database
        .prepare("SELECT * FROM paper_trade_intents")
        .all(),
    ).toHaveLength(0);
  });

  it("does not open a one-candle shadow for a setup already linked to paper", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const normalPayload = payloadFor("strict_long_boc_only");
    await appendEntryV3Observation(
      env(database),
      await observation(normalPayload),
      await payloadDigest(normalPayload),
    );

    const oneCandlePayload = await oneCandlePayloadFor(
      "strict_long_boc_only",
    );
    oneCandlePayload.producer_instance_id =
      "pine-v3-store-one-candle-after-paper";
    oneCandlePayload.event_id =
      "pine-v3-store-one-candle-after-paper:entry";
    await appendEntryV3Observation(
      env(database),
      await observation(oneCandlePayload),
      await payloadDigest(oneCandlePayload),
    );

    expect(
      database.database
        .prepare("SELECT * FROM observation_entry_v3_paper_links")
        .all(),
    ).toHaveLength(1);
    expect(
      database.database
        .prepare("SELECT * FROM observation_entry_v3_shadow_positions")
        .all(),
    ).toHaveLength(0);
  });

  it("downgrades a forged one-candle paper promotion before paper checks", async () => {
    const database = new SqliteD1();
    const payload = await oneCandlePayloadFor("strict_long_boc_only");
    const validated = await observation(payload);
    const bundle = validated.entryBundles[0]!;
    const candidate = bundle.evaluation.candidates[0]!;
    const evidence = bundle.evaluation.evidence.find(
      (item) => item.candidate_id === candidate.candidate_id,
    )!;
    Object.assign(
      bundle.evaluation.selection as unknown as Record<string, unknown>,
      {
        canonical_candidate_id: candidate.candidate_id,
        canonical_evidence_id: evidence.evidence_id,
        canonical_model: candidate.model,
        reason: "ONLY_EXACT_TRIGGER",
        fidelity: evidence.fidelity,
        action: "PAPER_ELIGIBLE",
      },
    );

    const result = await appendEntryV3Observation(
      env(database, { RD_ENTRY_V3_DETECTOR_CODE_HASH: "c".repeat(64) }),
      validated,
      await payloadDigest(payload),
    );

    expect(result.evaluations[0]).toMatchObject({
      effectiveAction: "SHADOW_ONLY",
      effectiveActionReason: "ONE_CANDLE_EXPERIMENT_NOT_PROMOTED",
    });
    expect(result.paperIntentIds).toEqual([]);
    const replay = await appendEntryV3Observation(
      env(database, { RD_ENTRY_V3_DETECTOR_CODE_HASH: "c".repeat(64) }),
      validated,
      await payloadDigest(payload),
    );
    expect(replay.inserted).toBe(false);
    expect(replay.evaluations[0]).toMatchObject({
      effectiveAction: "SHADOW_ONLY",
      effectiveActionReason: "ONE_CANDLE_EXPERIMENT_NOT_PROMOTED",
    });
    expect(replay.paperIntentIds).toEqual([]);
    expect(
      database.database
        .prepare(
          `SELECT action, effective_action_reason
           FROM observation_entry_v3_selections`,
        )
        .get(),
    ).toEqual({
      action: "SHADOW_ONLY",
      effective_action_reason: "ONE_CANDLE_EXPERIMENT_NOT_PROMOTED",
    });
    expect(
      database.database
        .prepare("SELECT * FROM paper_trade_intents")
        .all(),
    ).toHaveLength(0);
  });

  it("keeps one-candle shadow ownership when a later normal decision is paper-eligible", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const oneCandlePayload = await oneCandlePayloadFor(
      "strict_long_boc_only",
    );
    await appendEntryV3Observation(
      env(database),
      await observation(oneCandlePayload),
      await payloadDigest(oneCandlePayload),
    );

    const normalPayload = payloadFor("strict_long_boc_only");
    normalPayload.producer_instance_id =
      "pine-v3-store-paper-after-one-candle";
    normalPayload.event_id =
      "pine-v3-store-paper-after-one-candle:entry";
    const validatedNormal = await observation(normalPayload);
    const digest = await payloadDigest(normalPayload);
    const first = await appendEntryV3Observation(
      env(database),
      validatedNormal,
      digest,
    );
    const replay = await appendEntryV3Observation(
      env(database),
      validatedNormal,
      digest,
    );

    expect(first.evaluations[0]).toMatchObject({
      effectiveAction: "SHADOW_ONLY",
      effectiveActionReason: "NOT_SELECTED_ALREADY_OPEN",
    });
    expect(replay.inserted).toBe(false);
    expect(replay.evaluations).toEqual(first.evaluations);
    expect(
      database.database
        .prepare("SELECT * FROM observation_entry_v3_shadow_positions")
        .all(),
    ).toHaveLength(1);
    expect(
      database.database
        .prepare("SELECT * FROM paper_trade_intents")
        .all(),
    ).toHaveLength(0);
    expect(
      database.database
        .prepare("SELECT * FROM observation_entry_v3_paper_links")
        .all(),
    ).toHaveLength(0);
  });

  it("does not apply experimental ownership to a legacy two-plus shadow", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const fallbackPayload = payloadFor("strict_long_boc_only");
    const fallback = await appendEntryV3Observation(
      env(database, { RD_ENTRY_PAPER_RISK_BPS: "0" }),
      await observation(fallbackPayload),
      await payloadDigest(fallbackPayload),
    );

    expect(fallback.evaluations[0]).toMatchObject({
      effectiveAction: "SHADOW_ONLY",
      effectiveActionReason: "PAPER_CONFIGURATION_UNAVAILABLE",
    });
    expect(
      database.database
        .prepare(
          `SELECT liquidity_cohort, one_candle_enabled
           FROM observation_entry_v3_shadow_positions`,
        )
        .get(),
    ).toEqual({
      liquidity_cohort: "TWO_PLUS_CANDLES",
      one_candle_enabled: 0,
    });

    const normalPayload = payloadFor("strict_long_boc_only");
    normalPayload.producer_instance_id =
      "pine-v3-store-paper-after-two-plus-shadow";
    normalPayload.event_id =
      "pine-v3-store-paper-after-two-plus-shadow:entry";
    const result = await appendEntryV3Observation(
      env(database),
      await observation(normalPayload),
      await payloadDigest(normalPayload),
    );

    expect(result.evaluations[0]).toMatchObject({
      effectiveAction: "PAPER_ELIGIBLE",
      effectiveActionReason: null,
    });
    expect(
      database.database
        .prepare("SELECT * FROM paper_trade_intents")
        .all(),
    ).toHaveLength(1);
    expect(
      database.database
        .prepare("SELECT * FROM observation_entry_v3_paper_links")
        .all(),
    ).toHaveLength(1);
    expect(
      database.database
        .prepare("SELECT * FROM observation_entry_v3_shadow_positions")
        .all(),
    ).toHaveLength(1);
  });

  it("does not route a one-candle exit into an existing normal paper link", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const normalEntry = payloadFor("strict_long_boc_only");
    await appendEntryV3Observation(
      env(database),
      await observation(normalEntry),
      await payloadDigest(normalEntry),
    );

    const oneCandle = await oneCandlePayloadFor("strict_long_boc_only");
    const oneCandleExit = realtimeExitPayload(
      oneCandle,
      "pine-v3-store:one-candle-cannot-settle-paper",
      "TARGET",
    );
    const result = await appendEntryV3Observation(
      env(database),
      await observation(oneCandleExit),
      await payloadDigest(oneCandleExit),
    );

    expect(result.paperIntentIds).toHaveLength(0);
    expect(
      database.database
        .prepare("SELECT * FROM paper_trade_intents")
        .all(),
    ).toHaveLength(1);
    expect(
      database.database
        .prepare("SELECT * FROM paper_trade_settlements")
        .all(),
    ).toHaveLength(0);
    expect(
      database.database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM observation_entry_v3_exit_applications
           WHERE target_kind = 'PAPER'`,
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it("does not route a normal exit into an existing one-candle shadow", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const oneCandleEntry = await oneCandlePayloadFor(
      "strict_long_boc_only",
    );
    await appendEntryV3Observation(
      env(database),
      await observation(oneCandleEntry),
      await payloadDigest(oneCandleEntry),
    );

    const normalExit = realtimeExitPayload(
      payloadFor("strict_long_boc_only"),
      "pine-v3-store:normal-cannot-settle-one-candle",
      "TARGET",
    );
    await expect(
      appendEntryV3Observation(
        env(database),
        await observation(normalExit),
        await payloadDigest(normalExit),
      ),
    ).rejects.toThrow(/stored v3 shadow cohort/u);
    expect(
      database.database
        .prepare(
          `SELECT state, outcome_r_millis
           FROM observation_entry_v3_shadow_positions`,
        )
        .get(),
    ).toEqual({ state: "OPEN", outcome_r_millis: null });
    expect(
      database.database
        .prepare("SELECT * FROM paper_trade_settlements")
        .all(),
    ).toHaveLength(0);
  });

  it("rejects a stored decision whose cohort no longer matches the validated setup", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = payloadFor("strict_long_boc_only");
    const validated = await observation(payload);
    const digest = await payloadDigest(payload);
    await appendEntryV3Observation(env(database), validated, digest);
    database.database.exec(
      `DROP TRIGGER observation_entry_v3_selections_no_update;
       DROP TRIGGER observation_entry_v3_selections_liquidity_cohort_update_guard;
       UPDATE observation_entry_v3_selections
       SET liquidity_cohort = 'ONE_CANDLE', one_candle_enabled = 1;`,
    );

    await expect(
      appendEntryV3Observation(env(database), validated, digest),
    ).rejects.toThrow(/stored v3 decision cohort/u);
  });

  it("refuses to settle a stored shadow position under a different cohort", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const entryPayload = payloadFor("discretionary_boc_shadow");
    await appendEntryV3Observation(
      env(database),
      await observation(entryPayload),
      await payloadDigest(entryPayload),
    );
    database.database.exec(
      `DROP TRIGGER observation_entry_v3_shadow_positions_state_guard;
       DROP TRIGGER observation_entry_v3_shadow_positions_liquidity_cohort_update_guard;
       UPDATE observation_entry_v3_shadow_positions
       SET liquidity_cohort = 'ONE_CANDLE', one_candle_enabled = 1;`,
    );
    const exitPayload = realtimeExitPayload(
      entryPayload,
      "pine-v3-store:wrong-cohort-shadow-target",
      "TARGET",
    );

    await expect(
      appendEntryV3Observation(
        env(database),
        await observation(exitPayload),
        await payloadDigest(exitPayload),
      ),
    ).rejects.toThrow(/stored v3 shadow cohort/u);
    expect(
      database.database
        .prepare("SELECT state FROM observation_entry_v3_shadow_positions")
        .get(),
    ).toEqual({ state: "OPEN" });
  });

  it("tracks a reviewed DIR_CLOSE through target when paper configuration is unavailable", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const paperUnavailable = env(database, {
      RD_ENTRY_PAPER_RISK_BPS: "0",
    });
    const entryPayload = payloadFor(
      "close_fallback_after_blocked_aggressive_models",
    );
    entryPayload.is_realtime = true;
    entryPayload.producer_sequence = 1;
    const entry = await appendEntryV3Observation(
      paperUnavailable,
      await observation(entryPayload),
      await payloadDigest(entryPayload),
    );

    expect(entry.evaluations[0]).toMatchObject({
      effectiveAction: "SHADOW_ONLY",
      effectiveActionReason: "PAPER_CONFIGURATION_UNAVAILABLE",
    });

    const exitPayload = realtimeExitPayload(
      entryPayload,
      "pine-v3-store:paper-unavailable-dir-close-target",
      "TARGET",
    );
    await appendEntryV3Observation(
      paperUnavailable,
      await observation(exitPayload),
      await payloadDigest(exitPayload),
    );

    expect(
      database.database
        .prepare(
          `SELECT candidate.model, shadow.state, shadow.outcome_r_millis
           FROM observation_entry_v3_shadow_positions AS shadow
           JOIN observation_entry_v3_candidates AS candidate
             ON candidate.candidate_id = shadow.candidate_id`,
        )
        .get(),
    ).toEqual({
      model: "DIR_CLOSE",
      state: "TARGET_HIT",
      outcome_r_millis: 4000,
    });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_allocations")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("settles one linked intent from a strictly later exact exit", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const entryPayload = payloadFor("strict_long_boc_only");
    await appendEntryV3Observation(
      env(database),
      await observation(entryPayload),
      await payloadDigest(entryPayload),
    );
    const exitPayload = realtimeExitPayload(
      entryPayload,
      "pine-v3-store:strict-stop",
      "STOP_LOSS",
    );
    await appendEntryV3Observation(
      env(database),
      await observation(exitPayload),
      await payloadDigest(exitPayload),
    );

    expect(
      database.database
        .prepare(
          "SELECT outcome_r_millis, exit_reason FROM paper_trade_settlements",
        )
        .get(),
    ).toEqual({ outcome_r_millis: -1000, exit_reason: "STOP" });
  });

  it("does not settle an economic exit from an overlapping historical bar", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const entryPayload = payloadFor("strict_long_boc_only");
    await appendEntryV3Observation(
      env(database),
      await observation(entryPayload),
      await payloadDigest(entryPayload),
    );
    const exitPayload = structuredClone(entryPayload);
    const bundle = (exitPayload.setups as Array<Record<string, unknown>>)[0]!;
    const setup = bundle.setup as Record<string, unknown>;
    const plan = bundle.trade_plan as Record<string, unknown>;
    exitPayload.event_id = "pine-v3-store:overlapping-target";
    exitPayload.producer_sequence = 1000;
    exitPayload.is_realtime = false;
    exitPayload.observed_at_epoch = 2400;
    exitPayload.market_event = {
      epoch: 2400,
      sequence: 1000,
      tick_price_ticks: plan.target_ticks,
      barstate_isconfirmed: true,
      confirmed_bar: {
        open_epoch: 2100,
        close_epoch: 2400,
        open_ticks: plan.entry_ticks,
        high_ticks: plan.target_ticks,
        low_ticks: (plan.stop_ticks as number) + 1,
        close_ticks: plan.target_ticks,
      },
    };
    exitPayload.exit_events = [
      {
        event_id: "pine-v3-store:overlapping-target:exit",
        setup_id: setup.setup_id,
        exit_reason: "TARGET",
        epoch: 2400,
        sequence: 1000,
        price_ticks: plan.target_ticks,
      },
    ];
    await appendEntryV3Observation(
      env(database),
      await observation(exitPayload),
      await payloadDigest(exitPayload),
    );

    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_settlements")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM observation_entry_v3_events")
        .get(),
    ).toEqual({ count: 2 });
  });

  it("persists a mismatched-hash exit without settling or terminalizing", async () => {
    const paper = new SqliteD1();
    installPaperAccount(paper);
    const strictEntry = payloadFor("strict_long_boc_only");
    await appendEntryV3Observation(
      env(paper),
      await observation(strictEntry),
      await payloadDigest(strictEntry),
    );
    const strictExit = realtimeExitPayload(
      strictEntry,
      "pine-v3-store:mismatched-paper-exit",
      "TARGET",
    );
    strictExit.detector_code_hash = "c".repeat(64);
    await appendEntryV3Observation(
      env(paper),
      await observation(strictExit),
      await payloadDigest(strictExit),
    );
    expect(
      paper.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_settlements")
        .get(),
    ).toEqual({ count: 0 });

    const shadow = new SqliteD1();
    installPaperAccount(shadow);
    const discretionaryEntry = payloadFor("discretionary_boc_shadow");
    await appendEntryV3Observation(
      env(shadow),
      await observation(discretionaryEntry),
      await payloadDigest(discretionaryEntry),
    );
    const shadowExit = realtimeExitPayload(
      discretionaryEntry,
      "pine-v3-store:mismatched-shadow-exit",
      "TARGET",
    );
    shadowExit.settings_hash = "c".repeat(64);
    await appendEntryV3Observation(
      env(shadow),
      await observation(shadowExit),
      await payloadDigest(shadowExit),
    );
    expect(
      shadow.database
        .prepare("SELECT state FROM observation_entry_v3_shadow_positions")
        .get(),
    ).toEqual({ state: "OPEN" });
    expect(
      shadow.database
        .prepare("SELECT COUNT(*) AS count FROM observation_entry_v3_events")
        .get(),
    ).toEqual({ count: 2 });
  });

  it("retries a readiness-trigger race as audit-only configuration failure", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    database.failNextAllocationReadiness = true;
    const payload = payloadFor("strict_long_boc_only");
    const result = await appendEntryV3Observation(
      env(database),
      await observation(payload),
      await payloadDigest(payload),
    );

    expect(result.evaluations[0]).toMatchObject({
      effectiveAction: "SHADOW_ONLY",
      effectiveActionReason: "PAPER_CONFIGURATION_UNAVAILABLE",
    });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM observation_entry_v3_events")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_intents")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("propagates an unrelated batch failure when a paper link already existed", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const first = payloadFor("strict_long_boc_only");
    await appendEntryV3Observation(
      env(database),
      await observation(first),
      await payloadDigest(first),
    );
    const later = payloadFor("strict_long_boc_only");
    later.producer_instance_id = "pine-v3-existing-link-failure";
    later.event_id = "pine-v3-existing-link-failure:1";
    database.failNextBatchUnrelated = true;

    await expect(
      appendEntryV3Observation(
        env(database),
        await observation(later),
        await payloadDigest(later),
      ),
    ).rejects.toThrow("injected unrelated batch failure");
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM observation_entry_v3_events")
        .get(),
    ).toEqual({ count: 1 });
  });

  it("recovers only a true paper-link uniqueness race with a durable winner", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const first = payloadFor("strict_long_boc_only");
    await appendEntryV3Observation(
      env(database),
      await observation(first),
      await payloadDigest(first),
    );
    const raced = payloadFor("strict_long_boc_only");
    raced.producer_instance_id = "pine-v3-link-race";
    raced.event_id = "pine-v3-link-race:1";
    database.hideNextPaperLinkRead = true;

    const result = await appendEntryV3Observation(
      env(database),
      await observation(raced),
      await payloadDigest(raced),
    );

    expect(result.evaluations[0]).toMatchObject({
      effectiveAction: "SHADOW_ONLY",
      effectiveActionReason: "NOT_SELECTED_ALREADY_OPEN",
    });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_intents")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM observation_entry_v3_events")
        .get(),
    ).toEqual({ count: 2 });
  });

  it("rejects conflicting paper and shadow terminals after storing audit", async () => {
    const paper = new SqliteD1();
    installPaperAccount(paper);
    const strictEntry = payloadFor("strict_long_boc_only");
    await appendEntryV3Observation(
      env(paper),
      await observation(strictEntry),
      await payloadDigest(strictEntry),
    );
    const stop = realtimeExitPayload(
      strictEntry,
      "pine-v3-store:paper-stop-first",
      "STOP_LOSS",
    );
    await appendEntryV3Observation(
      env(paper),
      await observation(stop),
      await payloadDigest(stop),
    );
    const target = realtimeExitPayload(
      strictEntry,
      "pine-v3-store:paper-target-conflict",
      "TARGET",
    );
    target.producer_sequence = 1001;
    (target.market_event as Record<string, unknown>).sequence = 1001;
    (
      target.exit_events as Array<Record<string, unknown>>
    )[0]!.sequence = 1001;
    await expect(
      appendEntryV3Observation(
        env(paper),
        await observation(target),
        await payloadDigest(target),
      ),
    ).rejects.toMatchObject({ code: "EXIT_CONFLICT" });
    await expect(
      appendEntryV3Observation(
        env(paper),
        await observation(target),
        await payloadDigest(target),
      ),
    ).rejects.toMatchObject({ code: "EXIT_CONFLICT" });
    expect(
      paper.database
        .prepare("SELECT COUNT(*) AS count FROM observation_entry_v3_events")
        .get(),
    ).toEqual({ count: 3 });
    expect(
      paper.database
        .prepare(
          `SELECT disposition, conflict_code
           FROM observation_entry_v3_event_dispositions
           WHERE event_id = ?`,
        )
        .get(target.event_id as string),
    ).toEqual({
      disposition: "CONFLICT",
      conflict_code: "EXIT_CONFLICT",
    });

    const shadow = new SqliteD1();
    installPaperAccount(shadow);
    const discretionaryEntry = payloadFor("discretionary_boc_shadow");
    await appendEntryV3Observation(
      env(shadow),
      await observation(discretionaryEntry),
      await payloadDigest(discretionaryEntry),
    );
    const firstTarget = realtimeExitPayload(
      discretionaryEntry,
      "pine-v3-store:shadow-target-first",
      "TARGET",
    );
    await appendEntryV3Observation(
      env(shadow),
      await observation(firstTarget),
      await payloadDigest(firstTarget),
    );
    const laterStop = realtimeExitPayload(
      discretionaryEntry,
      "pine-v3-store:shadow-stop-conflict",
      "STOP_LOSS",
    );
    laterStop.producer_sequence = 1002;
    (laterStop.market_event as Record<string, unknown>).sequence = 1002;
    (
      laterStop.exit_events as Array<Record<string, unknown>>
    )[0]!.sequence = 1002;
    await expect(
      appendEntryV3Observation(
        env(shadow),
        await observation(laterStop),
        await payloadDigest(laterStop),
      ),
    ).rejects.toMatchObject({ code: "EXIT_CONFLICT" });
    expect(
      shadow.database
        .prepare("SELECT state FROM observation_entry_v3_shadow_positions")
        .get(),
    ).toEqual({ state: "TARGET_HIT" });
    expect(
      shadow.database
        .prepare("SELECT COUNT(*) AS count FROM observation_entry_v3_events")
        .get(),
    ).toEqual({ count: 3 });
  });

  it("checks an existing paper terminal before exit applicability", async () => {
    const stopped = new SqliteD1();
    installPaperAccount(stopped);
    const entry = payloadFor("strict_long_boc_only");
    await appendEntryV3Observation(
      env(stopped),
      await observation(entry),
      await payloadDigest(entry),
    );
    const stop = realtimeExitPayload(
      entry,
      "pine-v3-store:terminal-first-stop",
      "STOP_LOSS",
    );
    await appendEntryV3Observation(
      env(stopped),
      await observation(stop),
      await payloadDigest(stop),
    );
    const duplicate = await appendEntryV3Observation(
      env(stopped),
      await observation(stop),
      await payloadDigest(stop),
    );
    expect(duplicate.inserted).toBe(false);

    const ambiguous = realtimeExitPayload(
      entry,
      "pine-v3-store:terminal-later-ambiguous",
      "AMBIGUOUS_SAME_BAR_EXIT",
    );
    setExitSequence(ambiguous, 1001);
    ambiguous.is_realtime = false;
    ambiguous.market_event = {
      epoch: 3000,
      sequence: 1001,
      tick_price_ticks: 111,
      barstate_isconfirmed: true,
      confirmed_bar: {
        open_epoch: 2700,
        close_epoch: 3000,
        open_ticks: 111,
        high_ticks: 151,
        low_ticks: 101,
        close_ticks: 111,
      },
    };
    await expect(
      appendEntryV3Observation(
        env(stopped),
        await observation(ambiguous),
        await payloadDigest(ambiguous),
      ),
    ).rejects.toMatchObject({ code: "EXIT_CONFLICT" });

    const wrongSide = new SqliteD1();
    installPaperAccount(wrongSide);
    await appendEntryV3Observation(
      env(wrongSide),
      await observation(entry),
      await payloadDigest(entry),
    );
    await appendEntryV3Observation(
      env(wrongSide),
      await observation(stop),
      await payloadDigest(stop),
    );
    const wrongTarget = realtimeExitPayload(
      entry,
      "pine-v3-store:terminal-wrong-side-target",
      "TARGET",
    );
    setExitSequence(wrongTarget, 1002);
    const plan = (
      (wrongTarget.setups as Array<Record<string, unknown>>)[0]!
        .trade_plan as Record<string, unknown>
    );
    const wrongPrice = (plan.entry_ticks as number) + 1;
    plan.target_ticks = wrongPrice;
    (wrongTarget.market_event as Record<string, unknown>).tick_price_ticks =
      wrongPrice;
    (
      wrongTarget.exit_events as Array<Record<string, unknown>>
    )[0]!.price_ticks = wrongPrice;
    await expect(
      appendEntryV3Observation(
        env(wrongSide),
        await observation(wrongTarget),
        await payloadDigest(wrongTarget),
      ),
    ).rejects.toMatchObject({ code: "EXIT_CONFLICT" });
  });

  it("reloads a concurrent paper terminal winner and stores a stable conflict", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const entry = payloadFor("strict_long_boc_only");
    await appendEntryV3Observation(
      env(database),
      await observation(entry),
      await payloadDigest(entry),
    );
    const stop = realtimeExitPayload(
      entry,
      "pine-v3-store:concurrent-terminal-stop",
      "STOP_LOSS",
    );
    await appendEntryV3Observation(
      env(database),
      await observation(stop),
      await payloadDigest(stop),
    );
    const target = realtimeExitPayload(
      entry,
      "pine-v3-store:concurrent-terminal-target",
      "TARGET",
    );
    setExitSequence(target, 1003);
    database.hideNextPaperSettlementRead = true;
    database.hideNextPaperExitApplicationRead = true;

    await expect(
      appendEntryV3Observation(
        env(database),
        await observation(target),
        await payloadDigest(target),
      ),
    ).rejects.toMatchObject({ code: "EXIT_CONFLICT" });
    await expect(
      appendEntryV3Observation(
        env(database),
        await observation(target),
        await payloadDigest(target),
      ),
    ).rejects.toMatchObject({ code: "EXIT_CONFLICT" });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM observation_entry_v3_events")
        .get(),
    ).toEqual({ count: 3 });
  });

  it("keeps ambiguity open when only a changed plan spans the durable levels", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const entryPayload = payloadFor("discretionary_boc_shadow");
    await appendEntryV3Observation(
      env(database),
      await observation(entryPayload),
      await payloadDigest(entryPayload),
    );
    const ambiguous = structuredClone(entryPayload);
    const bundle = (ambiguous.setups as Array<Record<string, unknown>>)[0]!;
    const setup = bundle.setup as Record<string, unknown>;
    const plan = bundle.trade_plan as Record<string, unknown>;
    plan.stop_ticks = 105;
    plan.target_ticks = 120;
    ambiguous.event_id = "pine-v3-store:changed-plan-ambiguity";
    ambiguous.producer_sequence = 1003;
    ambiguous.is_realtime = false;
    ambiguous.observed_at_epoch = 2700;
    ambiguous.market_event = {
      epoch: 2700,
      sequence: 1003,
      tick_price_ticks: 111,
      barstate_isconfirmed: true,
      confirmed_bar: {
        open_epoch: 2400,
        close_epoch: 2700,
        open_ticks: 111,
        high_ticks: 120,
        low_ticks: 105,
        close_ticks: 111,
      },
    };
    ambiguous.exit_events = [
      {
        event_id: "pine-v3-store:changed-plan-ambiguity:exit",
        setup_id: setup.setup_id,
        exit_reason: "AMBIGUOUS_SAME_BAR_EXIT",
        epoch: 2700,
        sequence: 1003,
        price_ticks: 111,
      },
    ];
    await appendEntryV3Observation(
      env(database),
      await observation(ambiguous),
      await payloadDigest(ambiguous),
    );

    expect(
      database.database
        .prepare("SELECT state FROM observation_entry_v3_shadow_positions")
        .get(),
    ).toEqual({ state: "OPEN" });
  });

  it("downgrades paper-incompatible decimal conversion after audit validation", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = payloadFor("strict_long_boc_only");
    payload.tick_size = "0.000000001";
    const result = await appendEntryV3Observation(
      env(database),
      await observation(payload),
      await payloadDigest(payload),
    );
    expect(result.evaluations[0]).toMatchObject({
      effectiveAction: "SHADOW_ONLY",
      effectiveActionReason: "PAPER_CONFIGURATION_UNAVAILABLE",
    });
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_intents")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("stores producer parity disagreement without changing edge authority", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = payloadFor("strict_long_boc_only");
    const validated = await observation(payload);
    const bundle = validated.entryBundles[0]!;
    (
      bundle as unknown as {
        selectionProposal: Record<string, unknown>;
      }
    ).selectionProposal = {
      ...bundle.selectionProposal,
      action: "SHADOW_ONLY",
    };
    const result = await appendEntryV3Observation(
      env(database),
      validated,
      await payloadDigest(payload),
    );
    expect(result.evaluations[0]).toMatchObject({
      effectiveAction: "PAPER_ELIGIBLE",
      parityStatus: "MISMATCH",
      parityMismatchReason: "ACTION",
    });
  });

  it("classifies receipt, event, and producer-sequence conflicts", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = payloadFor("strict_long_boc_only");
    const validated = await observation(payload);
    const digest = await payloadDigest(payload);
    await appendEntryV3Observation(env(database), validated, digest);
    await expect(
      appendEntryV3Observation(env(database), validated, "f".repeat(64)),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const sequenceCollision = payloadFor("strict_long_boc_only");
    sequenceCollision.event_id = "pine-v3-store:sequence-collision";
    await expect(
      appendEntryV3Observation(
        env(database),
        await observation(sequenceCollision),
        await payloadDigest(sequenceCollision),
      ),
    ).rejects.toMatchObject({ code: "PRODUCER_SEQUENCE_CONFLICT" });
  });

  it("counts readiness only for new unlinked setup attempts", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const sourcePayload = payloadFor("strict_long_boc_only");
    const source = await observation(sourcePayload);
    const bundles = [1, 2, 3, 4].map((tag) =>
      retagBundle(source.entryBundles[0]!, tag),
    );
    for (let index = 0; index < 3; index += 1) {
      const eventId = `readiness-existing:${index + 1}`;
      await appendEntryV3Observation(
        env(database),
        observationWithBundles(
          source,
          eventId,
          2000 + index,
          [bundles[index]!],
        ),
        await payloadDigest({ eventId }),
      );
    }

    const result = await appendEntryV3Observation(
      env(database),
      observationWithBundles(
        source,
        "readiness-one-new",
        2004,
        bundles,
      ),
      await payloadDigest({ eventId: "readiness-one-new" }),
    );

    expect(
      result.evaluations.map((item) => ({
        setup: item.evaluation.selection.setup_id,
        action: item.effectiveAction,
        reason: item.effectiveActionReason,
      })),
    ).toEqual([
      {
        setup: "setup-readiness-1",
        action: "SHADOW_ONLY",
        reason: "NOT_SELECTED_ALREADY_OPEN",
      },
      {
        setup: "setup-readiness-2",
        action: "SHADOW_ONLY",
        reason: "NOT_SELECTED_ALREADY_OPEN",
      },
      {
        setup: "setup-readiness-3",
        action: "SHADOW_ONLY",
        reason: "NOT_SELECTED_ALREADY_OPEN",
      },
      {
        setup: "setup-readiness-4",
        action: "PAPER_ELIGIBLE",
        reason: null,
      },
    ]);
    expect(
      database.database
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_intents")
        .get(),
    ).toEqual({ count: 4 });
  });

  it("enforces append-only v3 audit rows at the database boundary", async () => {
    const database = new SqliteD1();
    installPaperAccount(database);
    const payload = payloadFor("strict_long_boc_only");
    await appendEntryV3Observation(
      env(database),
      await observation(payload),
      await payloadDigest(payload),
    );
    expect(() =>
      database.database.exec(
        "UPDATE observation_entry_v3_candidates SET state = 'REJECTED'",
      ),
    ).toThrow(/append-only/u);
    expect(() =>
      database.database.exec("DELETE FROM observation_entry_v3_parity"),
    ).toThrow(/append-only/u);
    expect(() =>
      database.database.exec(
        "UPDATE observation_entry_v3_event_dispositions SET disposition = 'CONFLICT'",
      ),
    ).toThrow(/append-only/u);
    expect(() =>
      database.database.exec(
        "DELETE FROM observation_entry_v3_event_dispositions",
      ),
    ).toThrow(/append-only/u);
  });
});
