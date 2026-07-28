import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type {
  EntryEvaluation,
  EntryMatchRequest,
} from "../src/rd-entry-domain";
import {
  compareProducerDiagnostic,
  effectiveSelection,
} from "../src/rd-entry-parity";
import {
  appendEntryV2Observation,
  assembleValidatedChunks,
  type StoredValidatedChunk,
} from "../src/rd-entry-store";
import { SOURCE_CLAIM_CATALOG } from "../src/rd-entry-source-catalog";
import type {
  EntryBatchImmutableMetadata,
  ProducerDiagnostic,
  ValidatedEntryWireBatch,
} from "../src/rd-entry-wire";
import type { Env, ValidatedObservation } from "../src/types";

const CANDIDATE_ID = "c".repeat(64);
const EVIDENCE_ID = "e".repeat(64);
const HANDLING_ID = "f".repeat(64);
const SELECTION_ID = "1".repeat(64);
const SOURCE_CLAIM_IDS = ["standard-close-2024-03"] as const;
type SqliteInput =
  | null
  | number
  | bigint
  | string
  | NodeJS.ArrayBufferView;

function backendEvaluation(): EntryEvaluation {
  return {
    candidates: [
      {
        candidate_id: CANDIDATE_ID,
        setup_id: "setup-a",
        model: "DIR_CLOSE",
        state: "MATCHED",
        event_anchor_epoch: 1_721_808_300,
        trigger_ordinal: 1,
        direction: "LONG",
        source_claim_ids: SOURCE_CLAIM_IDS,
        normalized_from: null,
        observed_at_epoch: 1_721_808_300,
      },
    ],
    evidence: [
      {
        evidence_id: EVIDENCE_ID,
        candidate_id: CANDIDATE_ID,
        observed_trigger_epoch: 1_721_808_300,
        observed_trigger_ticks: 103,
        htf_context_minutes: [],
        fidelity: "EXACT",
        proof_plane: "CONFIRMED_5M",
        proof_resolution_seconds: 300,
        coverage_start_epoch: 1_721_808_000,
        coverage_end_epoch: 1_721_808_300,
        ambiguity_codes: [],
        passed_rule_ids: ["ENTRY_DIR_CLOSE"],
        failed_rule_ids: [],
        source_claim_ids: SOURCE_CLAIM_IDS,
        payload_sha256: "9".repeat(64),
        observed_at_epoch: 1_721_808_300,
      },
    ],
    handling: [
      {
        handling_id: HANDLING_ID,
        candidate_id: CANDIDATE_ID,
        evidence_id: EVIDENCE_ID,
        handling_mode: "CLOSE_CONFIRMATION",
        attempt_kind: "INITIAL",
        observed_epoch: 1_721_808_300,
        observed_ticks: 103,
        fidelity: "EXACT",
        source_claim_ids: SOURCE_CLAIM_IDS,
      },
    ],
    selection: {
      selection_id: SELECTION_ID,
      setup_id: "setup-a",
      policy_version: "rd-entry-arbitration-v2",
      revision: 1,
      candidate_ids_considered: [CANDIDATE_ID],
      canonical_candidate_id: CANDIDATE_ID,
      canonical_evidence_id: EVIDENCE_ID,
      canonical_model: "DIR_CLOSE",
      reason: "ONLY_EXACT_TRIGGER",
      fidelity: "EXACT",
      action: "PAPER_ELIGIBLE",
      evaluated_at_epoch: 1_721_808_300,
    },
  };
}

function producerMatch(): ProducerDiagnostic {
  const candidate = {
    model: "DIR_CLOSE",
    state: "MATCHED",
    event_anchor_epoch: 1_721_808_300,
    trigger_ordinal: 1,
    normalized_from: null,
    source_claim_ids: SOURCE_CLAIM_IDS,
  } as const;
  const evidence = {
    candidate,
    observed_trigger_epoch: 1_721_808_300,
    observed_trigger_ticks: 103,
    htf_context_minutes: [],
    fidelity: "EXACT",
    proof_plane: "CONFIRMED_5M",
    proof_resolution_seconds: 300,
    coverage_start_epoch: 1_721_808_000,
    coverage_end_epoch: 1_721_808_300,
    ambiguity_codes: [],
    passed_rule_ids: ["ENTRY_DIR_CLOSE"],
    failed_rule_ids: [],
    source_claim_ids: SOURCE_CLAIM_IDS,
  } as const;
  return {
    candidates: [candidate],
    evidence: [evidence],
    realtime_evidence: [],
    handling: [
      {
        candidate,
        evidence,
        handling_mode: "CLOSE_CONFIRMATION",
        attempt_kind: "INITIAL",
        observed_epoch: 1_721_808_300,
        observed_ticks: 103,
        fidelity: "EXACT",
        source_claim_ids: SOURCE_CLAIM_IDS,
      },
    ],
    selection: {
      version: "PINE_DIAGNOSTIC_ONLY",
      semantic_key: "DIR_CLOSE:1721808300:1",
      model: "DIR_CLOSE",
      event_anchor_epoch: 1_721_808_300,
      trigger_ordinal: 1,
      reason: "ONLY_EXACT_TRIGGER",
      fidelity: "EXACT",
      action: "SHADOW_ONLY",
    },
  };
}

const BATCH_METADATA: EntryBatchImmutableMetadata = {
  strategy_id: "rd_liquidity_sd_5m_v1",
  strategy_version: "2.0.0-contract2",
  rule_contract_version: "2.0.0",
  execution_mode: "OBSERVATION_ONLY",
  symbol: "EURUSD",
  ticker_id: "OANDA:EURUSD",
  feed: "OANDA",
  timeframe: "5",
  tick_size: "0.00001",
  bar_open_epoch: 1_721_808_000,
  detector_code_hash: "a".repeat(64),
  settings_hash: "b".repeat(64),
};

function chunk({
  chunkIndex,
  chunkCount,
  setupId,
  batchMetadata = BATCH_METADATA,
}: {
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly setupId: string;
  readonly batchMetadata?: EntryBatchImmutableMetadata;
}): StoredValidatedChunk {
  return {
    batchId: "d".repeat(64),
    batchIdentity: {
      producer_instance_id: "pine-v3-store",
      sequence: 1,
      kind: "incremental",
      bar_close_epoch: 1_721_808_300,
    },
    batchMetadata,
    chunkIndex,
    chunkCount,
    payloadSha256: String(chunkIndex + 1).repeat(64),
    receiptId: `receipt-${chunkIndex}`,
    entryBatches: [
      {
        setupId,
        retainedContext: [],
        events: [],
        producerDiagnostic: {
          candidates: [],
          evidence: [],
          realtime_evidence: [],
          handling: [],
          selection: null,
        },
      },
    ],
  };
}

class SqliteStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly recordQuery: () => void,
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    this.recordQuery();
    return (
      (this.database
        .prepare(this.sql)
        .get(...(this.values as SqliteInput[])) as T | undefined) ??
      null
    );
  }

  async all<T>(): Promise<D1Result<T>> {
    this.recordQuery();
    return {
      success: true,
      results: this.database
        .prepare(this.sql)
        .all(...(this.values as SqliteInput[])) as T[],
      meta: {},
    } as unknown as D1Result<T>;
  }

  async run(): Promise<D1Result> {
    this.recordQuery();
    const result = this.database
      .prepare(this.sql)
      .run(...(this.values as SqliteInput[]));
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes) },
    } as unknown as D1Result;
  }
}

class FirstBatchPairBarrier {
  private arrivals = 0;
  private release: (() => void) | null = null;
  private readonly released = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  async wait(): Promise<void> {
    if (this.arrivals >= 2) return;
    this.arrivals += 1;
    if (this.arrivals === 2) this.release?.();
    await this.released;
  }
}

class SqliteD1 {
  readonly database = new DatabaseSync(":memory:");
  queryCount = 0;
  maxBatchStatementCount = 0;
  readonly batchErrors: string[] = [];
  private batchTail: Promise<void> = Promise.resolve();

  constructor(public batchBarrier?: FirstBatchPairBarrier) {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const migrations = readdirSync(`${root}/migrations`)
      .filter((name) => /^\d{4}_.*\.sql$/u.test(name))
      .sort();
    for (const migration of migrations) {
      this.database.exec("BEGIN");
      try {
        this.database.exec(
          readFileSync(`${root}/migrations/${migration}`, "utf8"),
        );
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.database, sql, () => {
      this.queryCount += 1;
    });
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    await this.batchBarrier?.wait();
    this.maxBatchStatementCount = Math.max(
      this.maxBatchStatementCount,
      statements.length,
    );
    const previous = this.batchTail;
    let release: () => void = () => undefined;
    this.batchTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.database.exec("BEGIN");
    try {
      const results: D1Result[] = [];
      for (const statement of statements) {
        results.push(
          await (statement as unknown as SqliteStatement).run(),
        );
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.batchErrors.push(String(error));
      this.database.exec("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  }

  rows<T>(sql: string, ...values: unknown[]): T[] {
    return this.database
      .prepare(sql)
      .all(...(values as SqliteInput[])) as T[];
  }

  close(): void {
    this.database.close();
  }
}

function entryEvent(
  setupId: string,
  closeEpoch: number,
  directionalClose = true,
): EntryMatchRequest {
  return {
    setup: {
      setup_id: setupId,
      direction: "LONG",
      zone_top_ticks: 100,
      zone_bottom_ticks: 90,
      zone_engaged_epoch: closeEpoch - 290,
      invalidated_before_entry: false,
      common_fidelity: "EXACT",
      terminal_reason: null,
      terminal_epoch: null,
    },
    confirmed_bar: {
      open_epoch: closeEpoch - 300,
      close_epoch: closeEpoch,
      open_ticks: 99,
      high_ticks: directionalClose ? 105 : 100,
      low_ticks: 95,
      close_ticks: directionalClose ? 103 : 99,
    },
    htf_proofs: [],
    generic_break_detected: false,
    rejection_respect_detected: false,
    attempt_kind: "INITIAL",
    trigger_ordinal: 1,
  };
}

function entrySetup(
  setupId: string,
  closeEpoch: number,
  directionalClose = true,
): ValidatedEntryWireBatch {
  return {
    setupId,
    retainedContext: [],
    events: [entryEvent(setupId, closeEpoch, directionalClose)],
    producerDiagnostic: {
      candidates: [],
      evidence: [],
      realtime_evidence: [],
      handling: [],
      selection: null,
    },
  };
}

function entryObservation({
  producerInstanceId = "pine-v3-store",
  sequence = 1,
  kind = "incremental",
  closeEpoch = 1_721_808_300,
  chunkIndex = 0,
  chunkCount = 1,
  setups = [entrySetup(`setup-${sequence}`, closeEpoch)],
  metadata = {},
}: {
  readonly producerInstanceId?: string;
  readonly sequence?: number;
  readonly kind?: "snapshot" | "incremental";
  readonly closeEpoch?: number;
  readonly chunkIndex?: number;
  readonly chunkCount?: number;
  readonly setups?: readonly ValidatedEntryWireBatch[];
  readonly metadata?: Partial<EntryBatchImmutableMetadata>;
} = {}): Extract<ValidatedObservation, { version: "entry-v2" }> {
  const batchMetadata = {
    ...BATCH_METADATA,
    bar_open_epoch: closeEpoch - 300,
    ...metadata,
  };
  return {
    version: "entry-v2",
    credential: "not-persisted",
    canonicalPayload: {},
    metadata: {
      idempotencyKey:
        `${producerInstanceId}:${sequence}:${kind}:${closeEpoch}:${chunkIndex}`,
      schemaVersion: "2.0",
      strategyId: "rd_liquidity_sd_5m_v1",
      strategyVersion: "2.0.0-contract2",
      producerInstanceId,
      sequence,
      symbol: batchMetadata.symbol,
      tickerId: batchMetadata.ticker_id,
      feed: batchMetadata.feed,
      timeframe: "5",
      kind,
    },
    paperCommands: [],
    batchIdentity: {
      producer_instance_id: producerInstanceId,
      sequence,
      kind,
      bar_close_epoch: closeEpoch,
    },
    batchMetadata,
    chunkIndex,
    chunkCount,
    entryBatches: setups,
  };
}

function sqliteEnv(database: SqliteD1): Env {
  return {
    DB: database as unknown as D1Database,
  };
}

describe("entry producer/backend parity", () => {
  it("keeps producer diagnostics separate when they match", () => {
    const result = compareProducerDiagnostic(
      backendEvaluation(),
      producerMatch(),
    );

    expect(result).toEqual({ status: "MATCH", mismatchReason: null });
  });

  it("forces mismatch to shadow without rewriting the policy result", () => {
    const policy = backendEvaluation().selection;
    const matching = producerMatch();
    const parity = compareProducerDiagnostic(backendEvaluation(), {
      ...matching,
      selection: {
        ...matching.selection!,
        semantic_key: "DIR_CLOSE:1721808600:1",
        model: "DIR_CLOSE",
        event_anchor_epoch: 1_721_808_600,
        trigger_ordinal: 1,
      },
    });

    expect(parity).toEqual({
      status: "MISMATCH",
      mismatchReason: "SELECTED_CANDIDATE",
    });
    expect(effectiveSelection(policy, parity, false, false)).toMatchObject({
      policy_action: policy.action,
      action: "SHADOW_ONLY",
      effective_action_reason: null,
    });
  });

  it("distinguishes an omitted selection from mismatching references", () => {
    const matching = producerMatch();

    expect(
      compareProducerDiagnostic(backendEvaluation(), {
        ...matching,
        selection: null,
      }),
    ).toEqual({ status: "NOT_PROVIDED", mismatchReason: null });
    expect(
      compareProducerDiagnostic(backendEvaluation(), {
        ...matching,
        candidates: [],
        selection: null,
      }),
    ).toEqual({
      status: "MISMATCH",
      mismatchReason: "CANDIDATE_KEYS",
    });
  });

  it("excludes realtime diagnostic evidence from parity", () => {
    const matching = producerMatch();

    expect(
      compareProducerDiagnostic(backendEvaluation(), {
        ...matching,
        realtime_evidence: [
          {
            ...matching.evidence[0]!,
            proof_plane: "REALTIME_TICK",
            proof_resolution_seconds: 0,
            coverage_start_epoch: 1_721_808_301,
            coverage_end_epoch: 1_721_808_301,
          },
        ],
      }),
    ).toEqual({ status: "MATCH", mismatchReason: null });
  });

  it("records an armed promotion identity mismatch separately", () => {
    const policy = backendEvaluation().selection;

    expect(
      effectiveSelection(
        policy,
        { status: "MATCH", mismatchReason: null },
        false,
        true,
      ),
    ).toMatchObject({
      policy_action: "PAPER_ELIGIBLE",
      action: "SHADOW_ONLY",
      effective_action_reason: "PROMOTION_IDENTITY_MISMATCH",
    });
  });

  it.each(["NONE", "SHADOW_ONLY"] as const)(
    "does not label a non-promotable %s policy as an identity downgrade",
    (action) => {
      const policy = {
        ...backendEvaluation().selection,
        action,
      };

      expect(
        effectiveSelection(
          policy,
          { status: "MATCH", mismatchReason: null },
          false,
          true,
        ),
      ).toMatchObject({
        policy_action: action,
        action,
        effective_action_reason: null,
      });
    },
  );
});

describe("entry chunk assembly", () => {
  it("sorts a complete out-of-order batch", async () => {
    const result = await assembleValidatedChunks([
      chunk({ chunkIndex: 1, chunkCount: 2, setupId: "setup-b" }),
      chunk({ chunkIndex: 0, chunkCount: 2, setupId: "setup-a" }),
    ]);

    expect(result.status).toBe("COMPLETE");
    expect(result.setups.map((item) => item.setupId)).toEqual([
      "setup-a",
      "setup-b",
    ]);
    expect(
      result.setups.map((item) => [
        item.origin.chunkIndex,
        item.origin.receiptId,
      ]),
    ).toEqual([
      [0, "receipt-0"],
      [1, "receipt-1"],
    ]);
  });

  it("reports missing indexes without exposing partial setups", async () => {
    await expect(
      assembleValidatedChunks([
        chunk({ chunkIndex: 1, chunkCount: 3, setupId: "setup-b" }),
      ]),
    ).resolves.toEqual({
      status: "INCOMPLETE",
      missingIndexes: [0, 2],
      setups: [],
    });
  });

  it("rejects duplicate setups across chunks", async () => {
    await expect(
      assembleValidatedChunks([
        chunk({ chunkIndex: 0, chunkCount: 2, setupId: "setup-a" }),
        chunk({ chunkIndex: 1, chunkCount: 2, setupId: "setup-a" }),
      ]),
    ).rejects.toThrow("DUPLICATE_SETUP_ACROSS_CHUNKS");
  });

  it("rejects inconsistent chunk counts distinctly", async () => {
    await expect(
      assembleValidatedChunks([
        chunk({ chunkIndex: 0, chunkCount: 2, setupId: "setup-a" }),
        chunk({ chunkIndex: 1, chunkCount: 3, setupId: "setup-b" }),
      ]),
    ).rejects.toThrow("INCONSISTENT_CHUNK_COUNT");
  });

  it.each([
    ["symbol", { symbol: "GBPUSD" }],
    ["ticker ID", { ticker_id: "OANDA:GBPUSD" }],
    ["feed", { feed: "FXCM" }],
    ["tick size", { tick_size: "0.0001" }],
    ["detector hash", { detector_code_hash: "c".repeat(64) }],
    ["settings hash", { settings_hash: "d".repeat(64) }],
  ] satisfies readonly [
    string,
    Partial<EntryBatchImmutableMetadata>,
  ][])("rejects an immutable %s mismatch", async (_name, change) => {
    await expect(
      assembleValidatedChunks([
        chunk({ chunkIndex: 0, chunkCount: 2, setupId: "setup-a" }),
        chunk({
          chunkIndex: 1,
          chunkCount: 2,
          setupId: "setup-b",
          batchMetadata: { ...BATCH_METADATA, ...change },
        }),
      ]),
    ).rejects.toThrow("INCONSISTENT_BATCH_METADATA");
  });
});

describe("entry D1 authority persistence", () => {
  it("persists a complete evaluation atomically in shadow", async () => {
    const database = new SqliteD1();
    try {
      const result = await appendEntryV2Observation(
        sqliteEnv(database),
        entryObservation(),
        "7".repeat(64),
      );

      expect(result).toMatchObject({
        status: "ACCEPTED",
        inserted: true,
        assemblyStatus: "COMPLETE",
        missingChunkIndexes: [],
      });
      if (result.status !== "ACCEPTED") {
        throw new Error("expected accepted result");
      }
      expect(result.evaluations).toHaveLength(1);
      expect(result.evaluations[0]).toMatchObject({
        parityStatus: "MISMATCH",
        parityMismatchReason: "MULTIPLE",
        selection: {
          policy_action: "PAPER_ELIGIBLE",
          action: "SHADOW_ONLY",
          effective_action_reason: null,
        },
      });
      expect(
        database.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_entry_candidates",
        )[0]?.count,
      ).toBeGreaterThan(0);
      expect(
        database.rows<{
          policy_action: string;
          action: string;
        }>(
          "SELECT policy_action, action FROM observation_entry_selections",
        ),
      ).toEqual([
        {
          policy_action: "PAPER_ELIGIBLE",
          action: "SHADOW_ONLY",
        },
      ]);
      expect(
        database.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM paper_trade_intents",
        )[0]?.count,
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("preserves each setup origin through out-of-order chunk persistence", async () => {
    const database = new SqliteD1();
    try {
      const closeEpoch = 1_721_808_300;
      const second = entryObservation({
        chunkIndex: 1,
        chunkCount: 2,
        setups: [entrySetup("setup-b", closeEpoch, false)],
      });
      const first = entryObservation({
        chunkIndex: 0,
        chunkCount: 2,
        setups: [entrySetup("setup-a", closeEpoch, false)],
      });

      const incomplete = await appendEntryV2Observation(
        sqliteEnv(database),
        second,
        "2".repeat(64),
      );
      const complete = await appendEntryV2Observation(
        sqliteEnv(database),
        first,
        "1".repeat(64),
      );

      expect(incomplete).toMatchObject({
        status: "ACCEPTED",
        assemblyStatus: "INCOMPLETE",
        missingChunkIndexes: [0],
      });
      expect(complete).toMatchObject({
        status: "ACCEPTED",
        assemblyStatus: "COMPLETE",
      });
      const receipts = database.rows<{
        idempotency_key: string;
        receipt_id: string;
      }>(
        "SELECT idempotency_key, receipt_id FROM observation_receipts",
      );
      const receiptByKey = new Map(
        receipts.map((item) => [item.idempotency_key, item.receipt_id]),
      );
      expect(
        database.rows<{
          setup_id: string;
          receipt_id: string;
        }>(
          `SELECT setup_id, receipt_id
           FROM observation_entry_setup_events
           ORDER BY setup_id`,
        ),
      ).toEqual([
        {
          setup_id: "setup-a",
          receipt_id: receiptByKey.get(first.metadata.idempotencyKey),
        },
        {
          setup_id: "setup-b",
          receipt_id: receiptByKey.get(second.metadata.idempotencyKey),
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("distinguishes stored chunk-count and immutable metadata conflicts", async () => {
    const countDatabase = new SqliteD1();
    try {
      const first = entryObservation({
        chunkCount: 2,
        setups: [entrySetup("setup-count-a", 1_721_808_300, false)],
      });
      const conflictingCount = entryObservation({
        chunkIndex: 1,
        chunkCount: 3,
        setups: [entrySetup("setup-count-b", 1_721_808_300, false)],
      });

      await expect(
        appendEntryV2Observation(
          sqliteEnv(countDatabase),
          first,
          "1".repeat(64),
        ),
      ).resolves.toMatchObject({
        status: "ACCEPTED",
        assemblyStatus: "INCOMPLETE",
      });
      await expect(
        appendEntryV2Observation(
          sqliteEnv(countDatabase),
          conflictingCount,
          "2".repeat(64),
        ),
      ).rejects.toMatchObject({ code: "INCONSISTENT_CHUNK_COUNT" });
      expect(
        countDatabase.rows<{ reason: string }>(
          "SELECT reason FROM observation_entry_quarantine",
        ),
      ).toEqual([{ reason: "INCONSISTENT_CHUNK_COUNT" }]);
      expect(
        countDatabase.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_receipts",
        )[0]?.count,
      ).toBe(1);
    } finally {
      countDatabase.close();
    }

    const metadataDatabase = new SqliteD1();
    try {
      const first = entryObservation({
        chunkCount: 2,
        setups: [entrySetup("setup-metadata-a", 1_721_808_300, false)],
      });
      const conflictingMetadata = entryObservation({
        chunkIndex: 1,
        chunkCount: 2,
        setups: [entrySetup("setup-metadata-b", 1_721_808_300, false)],
        metadata: {
          symbol: "GBPUSD",
          ticker_id: "OANDA:GBPUSD",
        },
      });

      await appendEntryV2Observation(
        sqliteEnv(metadataDatabase),
        first,
        "3".repeat(64),
      );
      await expect(
        appendEntryV2Observation(
          sqliteEnv(metadataDatabase),
          conflictingMetadata,
          "4".repeat(64),
        ),
      ).rejects.toMatchObject({ code: "INCONSISTENT_BATCH_METADATA" });
      expect(
        metadataDatabase.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_receipts",
        )[0]?.count,
      ).toBe(1);
    } finally {
      metadataDatabase.close();
    }
  });

  it("quarantines duplicate setups across persisted chunks", async () => {
    const database = new SqliteD1();
    try {
      const first = entryObservation({
        chunkCount: 2,
        setups: [entrySetup("setup-duplicate", 1_721_808_300, false)],
      });
      const second = entryObservation({
        chunkIndex: 1,
        chunkCount: 2,
        setups: [entrySetup("setup-duplicate", 1_721_808_300, false)],
      });

      await appendEntryV2Observation(
        sqliteEnv(database),
        first,
        "5".repeat(64),
      );
      await expect(
        appendEntryV2Observation(
          sqliteEnv(database),
          second,
          "6".repeat(64),
        ),
      ).rejects.toMatchObject({
        code: "DUPLICATE_SETUP_ACROSS_CHUNKS",
      });
      expect(
        database.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_entry_batch_completions",
        )[0]?.count,
      ).toBe(0);
      expect(
        database.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_receipts",
        )[0]?.count,
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it("preflights official catalog rows before inserting evaluations", async () => {
    const database = new SqliteD1();
    try {
      const claim = SOURCE_CLAIM_CATALOG[0];
      database.database
        .prepare(
          `INSERT INTO observation_entry_source_claims (
            claim_id, contract_version, source_id, youtube_video_id,
            published_date, title_snapshot, channel_id, channel_handle,
            timestamp_start_seconds, timestamp_end_seconds, relationship,
            summary
          ) VALUES (?, '2.0.0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          claim.claim_id,
          claim.source_id,
          claim.youtube_video_id,
          claim.published_date,
          claim.title_snapshot,
          claim.channel_id,
          claim.channel_handle,
          claim.timestamp_start_seconds,
          claim.timestamp_end_seconds,
          claim.relationship,
          `${claim.summary} changed`,
        );

      await expect(
        appendEntryV2Observation(
          sqliteEnv(database),
          entryObservation(),
          "7".repeat(64),
        ),
      ).rejects.toMatchObject({ code: "IMMUTABLE_ID_CONFLICT" });
      expect(
        database.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_entry_selections",
        )[0]?.count,
      ).toBe(0);
      expect(
        database.rows<{ reason: string }>(
          "SELECT reason FROM observation_entry_quarantine",
        ),
      ).toEqual([{ reason: "IMMUTABLE_ID_CONFLICT" }]);
    } finally {
      database.close();
    }
  });

  it("fails closed when a repeated candidate identity hash differs", async () => {
    const database = new SqliteD1();
    try {
      const setupId = "setup-candidate-conflict";
      await appendEntryV2Observation(
        sqliteEnv(database),
        entryObservation({
          setups: [entrySetup(setupId, 1_721_808_300)],
        }),
        "8".repeat(64),
      );
      const candidate = database.rows<{ candidate_id: string }>(
        "SELECT candidate_id FROM observation_entry_candidates LIMIT 1",
      )[0];
      if (candidate === undefined) {
        throw new Error("expected a stored candidate");
      }
      database.database.exec(
        "DROP TRIGGER observation_entry_candidates_no_update",
      );
      database.database.exec("PRAGMA ignore_check_constraints = ON");
      database.database
        .prepare(
          `UPDATE observation_entry_candidates
           SET identity_sha256 = ?
           WHERE candidate_id = ?`,
        )
        .run("0".repeat(64), candidate.candidate_id);
      const laterEvent = entryEvent(setupId, 1_721_808_600, false);
      const laterSetup: ValidatedEntryWireBatch = {
        ...entrySetup(setupId, 1_721_808_600, false),
        events: [
          {
            ...laterEvent,
            setup: {
              ...laterEvent.setup,
              zone_engaged_epoch: 1_721_808_010,
            },
          },
        ],
      };

      await expect(
        appendEntryV2Observation(
          sqliteEnv(database),
          entryObservation({
            sequence: 2,
            closeEpoch: 1_721_808_600,
            setups: [laterSetup],
          }),
          "9".repeat(64),
        ),
      ).rejects.toMatchObject({ code: "IMMUTABLE_ID_CONFLICT" });
      expect(
        database.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_entry_selections",
        )[0]?.count,
      ).toBe(1);
      expect(
        database.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_receipts",
        )[0]?.count,
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it("accepts out-of-order sequence chronology and quarantines one conflict", async () => {
    const database = new SqliteD1();
    try {
      const values = [
        entryObservation({
          sequence: 3,
          closeEpoch: 1_721_808_900,
          setups: [entrySetup("setup-sequence-3", 1_721_808_900, false)],
        }),
        entryObservation({
          sequence: 1,
          closeEpoch: 1_721_808_300,
          setups: [entrySetup("setup-sequence-1", 1_721_808_300, false)],
        }),
        entryObservation({
          sequence: 2,
          closeEpoch: 1_721_808_600,
          setups: [entrySetup("setup-sequence-2", 1_721_808_600, false)],
        }),
      ];
      for (const [index, value] of values.entries()) {
        await expect(
          appendEntryV2Observation(
            sqliteEnv(database),
            value,
            String(index + 3).repeat(64),
          ),
        ).resolves.toMatchObject({ status: "ACCEPTED" });
      }

      expect(
        database.rows<{
          producer_sequence: number;
          bar_close_epoch: number;
        }>(
          `SELECT producer_sequence, bar_close_epoch
           FROM observation_entry_batches
           ORDER BY producer_sequence`,
        ),
      ).toEqual([
        { producer_sequence: 1, bar_close_epoch: 1_721_808_300 },
        { producer_sequence: 2, bar_close_epoch: 1_721_808_600 },
        { producer_sequence: 3, bar_close_epoch: 1_721_808_900 },
      ]);

      const conflictValue = entryObservation({
        sequence: 2,
        kind: "snapshot",
        closeEpoch: 1_721_808_600,
        setups: [
          entrySetup("setup-sequence-2-conflict", 1_721_808_600, false),
        ],
      });
      const firstConflict = await appendEntryV2Observation(
        sqliteEnv(database),
        conflictValue,
        "8".repeat(64),
      );
      const repeatedConflict = await appendEntryV2Observation(
        sqliteEnv(database),
        conflictValue,
        "8".repeat(64),
      );

      expect(firstConflict).toMatchObject({
        status: "CONFLICT",
        conflictCode: "SEQUENCE_CONFLICT",
        record: null,
      });
      expect(repeatedConflict).toEqual(firstConflict);
      expect(
        database.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_entry_quarantine",
        )[0]?.count,
      ).toBe(1);
      expect(
        database.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_receipts",
        )[0]?.count,
      ).toBe(3);

      await expect(
        appendEntryV2Observation(
          sqliteEnv(database),
          entryObservation({
            sequence: 4,
            closeEpoch: 1_721_808_900,
            setups: [
              entrySetup("setup-close-conflict", 1_721_808_900, false),
            ],
          }),
          "9".repeat(64),
        ),
      ).resolves.toMatchObject({
        status: "CONFLICT",
        conflictCode: "BAR_CLOSE_CONFLICT",
        record: null,
      });
      await expect(
        appendEntryV2Observation(
          sqliteEnv(database),
          entryObservation({
            sequence: 4,
            closeEpoch: 1_721_808_750,
            setups: [
              entrySetup("setup-time-conflict", 1_721_808_750, false),
            ],
          }),
          "a".repeat(64),
        ),
      ).resolves.toMatchObject({
        status: "CONFLICT",
        conflictCode: "SEQUENCE_TIME_CONFLICT",
        record: null,
      });
      await expect(
        appendEntryV2Observation(
          sqliteEnv(database),
          entryObservation({
            sequence: 4,
            closeEpoch: 1_721_809_200,
            setups: [
              entrySetup("setup-identity-conflict", 1_721_809_200, false),
            ],
            metadata: { detector_code_hash: "c".repeat(64) },
          }),
          "b".repeat(64),
        ),
      ).resolves.toMatchObject({
        status: "CONFLICT",
        conflictCode: "PRODUCER_IDENTITY_CONFLICT",
        record: null,
      });
      expect(
        database.rows<{ reason: string }>(
          `SELECT reason
           FROM observation_entry_quarantine
           ORDER BY reason`,
        ),
      ).toEqual([
        { reason: "BAR_CLOSE_CONFLICT" },
        { reason: "PRODUCER_IDENTITY_CONFLICT" },
        { reason: "SEQUENCE_CONFLICT" },
        { reason: "SEQUENCE_TIME_CONFLICT" },
      ]);
    } finally {
      database.close();
    }
  });

  it("keeps producer continuity chains independent", async () => {
    const database = new SqliteD1();
    try {
      const first = entryObservation({
        producerInstanceId: "pine-v3-a",
        setups: [entrySetup("setup-producer-a", 1_721_808_300, false)],
      });
      const second = entryObservation({
        producerInstanceId: "pine-v3-b",
        setups: [entrySetup("setup-producer-b", 1_721_808_300, false)],
      });

      await expect(
        appendEntryV2Observation(
          sqliteEnv(database),
          first,
          "a".repeat(64),
        ),
      ).resolves.toMatchObject({ status: "ACCEPTED" });
      await expect(
        appendEntryV2Observation(
          sqliteEnv(database),
          second,
          "b".repeat(64),
        ),
      ).resolves.toMatchObject({ status: "ACCEPTED" });

      expect(
        database.rows<{ producer_instance_id: string }>(
          `SELECT producer_instance_id
           FROM observation_entry_batches
           ORDER BY producer_instance_id`,
        ),
      ).toEqual([
        { producer_instance_id: "pine-v3-a" },
        { producer_instance_id: "pine-v3-b" },
      ]);
    } finally {
      database.close();
    }
  });

  it.each([
    {
      name: "inverted close chronology",
      first: entryObservation({
        sequence: 1,
        closeEpoch: 1_721_808_600,
        setups: [entrySetup("setup-race-time-a", 1_721_808_600, false)],
      }),
      second: entryObservation({
        sequence: 2,
        closeEpoch: 1_721_808_300,
        setups: [entrySetup("setup-race-time-b", 1_721_808_300, false)],
      }),
      conflictCode: "SEQUENCE_TIME_CONFLICT",
      triggerMessage: "observation_entry_batches sequence time conflict",
    },
    {
      name: "mixed producer identity",
      first: entryObservation({
        sequence: 1,
        closeEpoch: 1_721_808_300,
        setups: [entrySetup("setup-race-identity-a", 1_721_808_300, false)],
      }),
      second: entryObservation({
        sequence: 2,
        closeEpoch: 1_721_808_600,
        setups: [entrySetup("setup-race-identity-b", 1_721_808_600, false)],
        metadata: { detector_code_hash: "c".repeat(64) },
      }),
      conflictCode: "PRODUCER_IDENTITY_CONFLICT",
      triggerMessage: "observation_entry_batches producer identity conflict",
    },
  ] as const)(
    "serializes a real SQLite $name interleaving before commit",
    async ({ first, second, conflictCode, triggerMessage }) => {
      const database = new SqliteD1(new FirstBatchPairBarrier());
      try {
        const results = await Promise.all([
          appendEntryV2Observation(
            sqliteEnv(database),
            first,
            "a".repeat(64),
          ),
          appendEntryV2Observation(
            sqliteEnv(database),
            second,
            "b".repeat(64),
          ),
        ]);

        expect(
          results.filter((item) => item.status === "ACCEPTED"),
        ).toHaveLength(1);
        expect(
          results.filter((item) => item.status === "CONFLICT"),
        ).toEqual([
          expect.objectContaining({
            status: "CONFLICT",
            conflictCode,
            record: null,
          }),
        ]);
        expect(
          database.rows<{ count: number }>(
            "SELECT COUNT(*) AS count FROM observation_entry_batches",
          )[0]?.count,
        ).toBe(1);
        expect(
          database.rows<{ reason: string }>(
            "SELECT reason FROM observation_entry_quarantine",
          ),
        ).toEqual([{ reason: conflictCode }]);
        expect(database.batchErrors).toEqual(
          expect.arrayContaining([
            expect.stringContaining(triggerMessage),
          ]),
        );
      } finally {
        database.close();
      }
    },
  );

  it("retries an actual immutable-selection trigger race with a fresh revision", async () => {
    const database = new SqliteD1();
    try {
      const setupId = "setup-selection-race";
      await appendEntryV2Observation(
        sqliteEnv(database),
        entryObservation({
          producerInstanceId: "pine-v3-selection-race-prime",
          setups: [
            entrySetup(
              "setup-selection-race-prime",
              1_721_808_300,
              false,
            ),
          ],
        }),
        "0".repeat(64),
      );
      database.batchBarrier = new FirstBatchPairBarrier();
      const first = entryObservation({
        producerInstanceId: "pine-v3-selection-race",
        sequence: 1,
        closeEpoch: 1_721_808_300,
        setups: [entrySetup(setupId, 1_721_808_300, false)],
      });
      const laterEvent = entryEvent(setupId, 1_721_808_600, false);
      const second = entryObservation({
        producerInstanceId: "pine-v3-selection-race",
        sequence: 2,
        closeEpoch: 1_721_808_600,
        setups: [
          {
            ...entrySetup(setupId, 1_721_808_600, false),
            events: [
              {
                ...laterEvent,
                setup: {
                  ...laterEvent.setup,
                  zone_engaged_epoch: 1_721_808_010,
                },
              },
            ],
          },
        ],
      });

      const results = await Promise.all([
        appendEntryV2Observation(
          sqliteEnv(database),
          first,
          "c".repeat(64),
        ),
        appendEntryV2Observation(
          sqliteEnv(database),
          second,
          "d".repeat(64),
        ),
      ]);

      expect(
        results.map((item) => item.status),
      ).toEqual(["ACCEPTED", "ACCEPTED"]);
      expect(
        database.rows<{ revision: number }>(
          `SELECT revision
           FROM observation_entry_selections
           WHERE setup_id = ?
           ORDER BY revision`,
          setupId,
        ),
      ).toEqual([{ revision: 1 }, { revision: 2 }]);
      expect(
        database.rows<{ count: number }>(
          `SELECT COUNT(*) AS count
           FROM observation_receipts
           WHERE producer_instance_id = ?`,
          "pine-v3-selection-race",
        )[0]?.count,
      ).toBe(2);
      expect(database.batchErrors).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "observation_entry_selections immutable insert conflict",
          ),
        ]),
      );
    } finally {
      database.close();
    }
  });

  it("keeps a 256-setup accepted batch within 1,000 D1 queries", async () => {
    const database = new SqliteD1();
    try {
      let setupIndex = 0;
      const chunks = Array.from({ length: 12 }, (_value, chunkIndex) => {
        const setupCount = chunkIndex === 11 ? 25 : 21;
        return entryObservation({
          chunkIndex,
          chunkCount: 12,
          setups: Array.from({ length: setupCount }, () => {
            const setup = entrySetup(
              `setup-query-budget-${String(setupIndex).padStart(3, "0")}`,
              1_721_808_300,
              true,
            );
            setupIndex += 1;
            return setup;
          }),
        });
      });
      const payloadHashCharacters = "0123456789ab";
      for (const [chunkIndex, chunk] of chunks.slice(0, 11).entries()) {
        await expect(
          appendEntryV2Observation(
            sqliteEnv(database),
            chunk,
            payloadHashCharacters[chunkIndex]!.repeat(64),
          ),
        ).resolves.toMatchObject({
          status: "ACCEPTED",
          assemblyStatus: "INCOMPLETE",
        });
      }
      database.queryCount = 0;
      database.maxBatchStatementCount = 0;

      const result = await appendEntryV2Observation(
        sqliteEnv(database),
        chunks[11]!,
        payloadHashCharacters[11]!.repeat(64),
      );
      expect(result).toMatchObject({
        status: "ACCEPTED",
        assemblyStatus: "COMPLETE",
      });
      if (result.status !== "ACCEPTED") {
        throw new Error("expected accepted max-complexity batch");
      }
      expect(result.evaluations).toHaveLength(256);
      expect(
        database.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_entry_candidates",
        )[0]?.count,
      ).toBe(256);
      expect(
        database.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_entry_candidate_evidence",
        )[0]?.count,
      ).toBe(256);
      expect(
        database.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_entry_handling",
        )[0]?.count,
      ).toBe(256);
      expect(database.queryCount).toBeLessThanOrEqual(1_000);
      expect(database.maxBatchStatementCount).toBeLessThanOrEqual(1_000);
    } finally {
      database.close();
    }
  });

  it("replays an identical chunk without duplicating immutable rows", async () => {
    const database = new SqliteD1();
    try {
      const value = entryObservation({
        setups: [entrySetup("setup-replay", 1_721_808_300, false)],
      });
      const first = await appendEntryV2Observation(
        sqliteEnv(database),
        value,
        "a".repeat(64),
      );
      const replay = await appendEntryV2Observation(
        sqliteEnv(database),
        value,
        "a".repeat(64),
      );

      expect(first).toMatchObject({
        status: "ACCEPTED",
        inserted: true,
      });
      expect(replay).toMatchObject({
        status: "ACCEPTED",
        inserted: false,
        record:
          first.status === "ACCEPTED"
            ? { receipt_id: first.record.receipt_id }
            : {},
      });
      expect(
        database.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_entry_setup_events",
        )[0]?.count,
      ).toBe(1);
      expect(
        database.rows<{ count: number }>(
          "SELECT COUNT(*) AS count FROM observation_entry_selections",
        )[0]?.count,
      ).toBe(1);
    } finally {
      database.close();
    }
  });
});
