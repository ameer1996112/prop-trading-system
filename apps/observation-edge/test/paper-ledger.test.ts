import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { handleRequest } from "../src/index";
import {
  validatePaperAccountId,
} from "../src/paper-ledger-contract";
import {
  INSERT_PAPER_ACCOUNT_SQL,
  INSERT_PAPER_LEDGER_ENTRY_SQL,
  LIST_PAPER_ACCOUNT_PROJECTIONS_SQL,
  LIST_PAPER_LEDGER_ENTRIES_SQL,
  SELECT_PAPER_ACCOUNT_BY_IDEMPOTENCY_SQL,
  SELECT_PAPER_ACCOUNT_PROJECTION_SQL,
  SELECT_PAPER_LEDGER_ENTRY_BY_IDEMPOTENCY_SQL,
} from "../src/paper-ledger-queries";
import type {
  Env,
  PaperAccountProjection,
  StoredPaperAccount,
  StoredPaperLedgerEntry,
} from "../src/types";

const PAPER_CREDENTIAL = "paper-admin-test-secret";
const TRADINGVIEW_CREDENTIAL = "tradingview-only-secret";
const BASE_URL = "https://prop-trading-observation-edge.example";
const MAX_SAFE_INTEGER = 9_007_199_254_740_991;

class PaperFakeStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: PaperFakeD1,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): PaperFakeStatement {
    this.values = values;
    return this;
  }

  get query(): string {
    return this.sql;
  }

  get bindings(): readonly unknown[] {
    return this.values;
  }

  async run(): Promise<D1Result> {
    if (this.sql === INSERT_PAPER_ACCOUNT_SQL) {
      const account: StoredPaperAccount = {
        account_id: String(this.values[0]),
        mode: "PAPER_ONLY",
        label: String(this.values[1]),
        currency_code: String(this.values[2]),
        currency_scale: Number(this.values[3]),
        opening_balance_minor: Number(this.values[4]),
        idempotency_key: String(this.values[5]),
        payload_sha256: String(this.values[6]),
        created_at: String(this.values[7]),
      };
      const exists =
        this.database.accounts.has(account.account_id) ||
        [...this.database.accounts.values()].some(
          (item) => item.idempotency_key === account.idempotency_key,
        );
      if (!exists) {
        this.database.accounts.set(account.account_id, account);
      }
      return result(exists ? 0 : 1);
    }

    if (this.sql === INSERT_PAPER_LEDGER_ENTRY_SQL) {
      const accountId = String(this.values[0]);
      const sequence = Number(this.values[2]);
      const amountMinor = Number(this.values[5]);
      const account = this.database.accounts.get(accountId);
      const current = this.database.projection(accountId);
      const idempotencyKey = String(this.values[3]);
      const duplicate = [...this.database.entries.values()].some(
        (entry) =>
          entry.idempotency_key === idempotencyKey ||
          (entry.account_id === accountId && entry.sequence === sequence),
      );
      const canInsert =
        account !== undefined &&
        current !== null &&
        sequence === current.last_sequence + 1 &&
        BigInt(current.balance_minor) + BigInt(amountMinor) >=
          -BigInt(MAX_SAFE_INTEGER) &&
        BigInt(current.balance_minor) + BigInt(amountMinor) <=
          BigInt(MAX_SAFE_INTEGER) &&
        BigInt(current.ledger_delta_minor) + BigInt(amountMinor) >=
          -BigInt(MAX_SAFE_INTEGER) &&
        BigInt(current.ledger_delta_minor) + BigInt(amountMinor) <=
          BigInt(MAX_SAFE_INTEGER) &&
        !duplicate;
      if (canInsert) {
        const entry: StoredPaperLedgerEntry = {
          entry_id: String(this.values[1]),
          account_id: accountId,
          sequence,
          idempotency_key: idempotencyKey,
          payload_sha256: String(this.values[4]),
          entry_kind: "MANUAL_ADJUSTMENT",
          amount_minor: amountMinor,
          recorded_at: String(this.values[6]),
        };
        this.database.entries.set(entry.entry_id, entry);
      }
      return result(canInsert ? 1 : 0);
    }
    throw new Error("unexpected run statement");
  }

  async first<T>(): Promise<T | null> {
    if (this.sql === SELECT_PAPER_ACCOUNT_BY_IDEMPOTENCY_SQL) {
      const idempotencyKey = String(this.values[0]);
      const account = [...this.database.accounts.values()].find(
        (item) => item.idempotency_key === idempotencyKey,
      );
      return (account as T | undefined) ?? null;
    }
    if (this.sql === SELECT_PAPER_ACCOUNT_PROJECTION_SQL) {
      return this.database.projection(String(this.values[0])) as T | null;
    }
    if (this.sql === SELECT_PAPER_LEDGER_ENTRY_BY_IDEMPOTENCY_SQL) {
      const idempotencyKey = String(this.values[0]);
      const entry = [...this.database.entries.values()].find(
        (item) => item.idempotency_key === idempotencyKey,
      );
      return (entry as T | undefined) ?? null;
    }
    throw new Error("unexpected first statement");
  }

  async all<T>(): Promise<D1Result<T>> {
    if (this.sql === SELECT_PAPER_ACCOUNT_PROJECTION_SQL) {
      const projection = this.database.projection(String(this.values[0]));
      return {
        success: true,
        results: (projection === null ? [] : [projection]) as T[],
        meta: {},
      } as unknown as D1Result<T>;
    }
    if (this.sql === LIST_PAPER_ACCOUNT_PROJECTIONS_SQL) {
      const limit = Number(this.values[0]);
      const projections = [...this.database.accounts.values()]
        .sort((left, right) => {
          const byCreated = right.created_at.localeCompare(left.created_at);
          return byCreated !== 0
            ? byCreated
            : left.account_id.localeCompare(right.account_id);
        })
        .map((account) => this.database.projection(account.account_id))
        .filter(
          (projection): projection is PaperAccountProjection =>
            projection !== null,
        )
        .slice(0, limit) as T[];
      return {
        success: true,
        results: projections,
        meta: {},
      } as unknown as D1Result<T>;
    }
    if (this.sql === LIST_PAPER_LEDGER_ENTRIES_SQL) {
      const accountId = String(this.values[0]);
      const before =
        this.values[1] === null ? null : Number(this.values[1]);
      const limit = Number(this.values[3]);
      const entries = [...this.database.entries.values()]
        .filter(
          (entry) =>
            entry.account_id === accountId &&
            (before === null || entry.sequence < before),
        )
        .sort((left, right) => right.sequence - left.sequence)
        .slice(0, limit) as T[];
      return {
        success: true,
        results: entries,
        meta: {},
      } as unknown as D1Result<T>;
    }
    throw new Error("unexpected all statement");
  }
}

class PaperFakeD1 {
  readonly accounts = new Map<string, StoredPaperAccount>();
  readonly entries = new Map<string, StoredPaperLedgerEntry>();
  readonly preparedSql: string[] = [];
  batchCalls = 0;
  afterBatchSnapshot: (() => void) | null = null;

  prepare(sql: string): PaperFakeStatement {
    this.preparedSql.push(sql);
    return new PaperFakeStatement(this, sql);
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.batchCalls += 1;
    const snapshot = new PaperFakeD1();
    for (const [key, account] of this.accounts) {
      snapshot.accounts.set(key, account);
    }
    for (const [key, entry] of this.entries) {
      snapshot.entries.set(key, entry);
    }
    this.afterBatchSnapshot?.();
    const typedStatements = statements as unknown as PaperFakeStatement[];
    const results: D1Result<T>[] = [];
    for (const statement of typedStatements) {
      const snapshotStatement = new PaperFakeStatement(
        snapshot,
        statement.query,
      ).bind(...statement.bindings);
      results.push(await snapshotStatement.all<T>());
    }
    return results;
  }

  projection(accountId: string): PaperAccountProjection | null {
    const account = this.accounts.get(accountId);
    if (account === undefined) {
      return null;
    }
    const entries = [...this.entries.values()].filter(
      (entry) => entry.account_id === accountId,
    );
    const ledgerDelta = entries.reduce(
      (total, entry) => total + entry.amount_minor,
      0,
    );
    return {
      account_id: account.account_id,
      mode: account.mode,
      label: account.label,
      currency_code: account.currency_code,
      currency_scale: account.currency_scale,
      opening_balance_minor: account.opening_balance_minor,
      ledger_delta_minor: ledgerDelta,
      balance_minor: account.opening_balance_minor + ledgerDelta,
      last_sequence: entries.reduce(
        (maximum, entry) => Math.max(maximum, entry.sequence),
        0,
      ),
      created_at: account.created_at,
    };
  }
}

class FailingPaperD1 {
  prepare(): never {
    throw new Error("D1 unavailable");
  }
}

function result(changes: number): D1Result {
  return {
    success: true,
    results: [],
    meta: { changes },
  } as unknown as D1Result;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function environment(
  database: PaperFakeD1 | FailingPaperD1 = new PaperFakeD1(),
  overrides: Partial<Env> = {},
): Promise<Env> {
  return {
    DB: database as unknown as D1Database,
    PAPER_LEDGER_ENABLED: "true",
    PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256: await sha256(PAPER_CREDENTIAL),
    TRADINGVIEW_OBSERVATION_INGRESS_ENABLED: "true",
    TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256: await sha256(
      TRADINGVIEW_CREDENTIAL,
    ),
    ...overrides,
  };
}

function accountBody(
  accountId = "paper-alpha",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: "1.0",
    account_id: accountId,
    label: `Paper ${accountId}`,
    currency_code: "USD",
    currency_scale: 2,
    opening_balance_minor: 5_000_000,
    ...overrides,
  };
}

function entryBody(
  sequence: number,
  amountMinor: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: "1.0",
    sequence,
    entry_kind: "MANUAL_ADJUSTMENT",
    amount_minor: amountMinor,
    ...overrides,
  };
}

function paperRequest(
  path: string,
  method: "GET" | "POST",
  requestBody?: Record<string, unknown> | string,
  credential = PAPER_CREDENTIAL,
): Request {
  const headers = new Headers({
    authorization: `Bearer ${credential}`,
  });
  let payload: string | undefined;
  if (requestBody !== undefined) {
    headers.set("content-type", "application/json");
    payload =
      typeof requestBody === "string"
        ? requestBody
        : JSON.stringify(requestBody);
  }
  const init: RequestInit = { method, headers };
  if (payload !== undefined) {
    init.body = payload;
  }
  return new Request(`${BASE_URL}${path}`, init);
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function createAccount(
  env: Env,
  accountId: string,
  openingBalanceMinor: number,
): Promise<Response> {
  return handleRequest(
    paperRequest(
      "/api/v1/paper-accounts",
      "POST",
      accountBody(accountId, {
        opening_balance_minor: openingBalanceMinor,
      }),
    ),
    env,
  );
}

async function appendEntry(
  env: Env,
  accountId: string,
  sequence: number,
  amountMinor: number,
): Promise<Response> {
  return handleRequest(
    paperRequest(
      `/api/v1/paper-accounts/${accountId}/ledger-entries`,
      "POST",
      entryBody(sequence, amountMinor),
    ),
    env,
  );
}

describe("protected paper ledger", () => {
  it.each([".", ".."])(
    "rejects ambiguous dot-segment account id %s at create and path validation",
    async (accountId) => {
      const database = new PaperFakeD1();
      const env = await environment(database);
      const response = await handleRequest(
        paperRequest(
          "/api/v1/paper-accounts",
          "POST",
          accountBody(accountId),
        ),
        env,
      );

      expect(response.status).toBe(422);
      expect((await json(response)).error).toMatchObject({
        code: "INVALID_PAPER_ACCOUNT",
      });
      expect(() => validatePaperAccountId(accountId)).toThrow();
      expect(database.accounts).toHaveLength(0);
      expect(database.preparedSql).toHaveLength(0);
    },
  );

  it("fails closed before parsing or touching D1", async () => {
    const database = new PaperFakeD1();
    const disabled = {
      DB: database as unknown as D1Database,
    } as Env;
    const response = await handleRequest(
      paperRequest("/api/v1/paper-accounts", "POST", "not-json"),
      disabled,
    );

    expect(response.status).toBe(503);
    expect((await json(response)).error).toMatchObject({
      code: "PAPER_LEDGER_DISABLED",
    });
    expect(database.preparedSql).toHaveLength(0);
  });

  it("uses a separate Bearer credential and never echoes rejected secrets", async () => {
    const database = new PaperFakeD1();
    const env = await environment(database);
    const missing = await handleRequest(
      new Request(`${BASE_URL}/api/v1/paper-accounts`),
      env,
    );
    const crossCredential = await handleRequest(
      paperRequest(
        "/api/v1/paper-accounts",
        "GET",
        undefined,
        TRADINGVIEW_CREDENTIAL,
      ),
      env,
    );
    const rejected = "never-echo-paper-secret";
    const bad = await handleRequest(
      paperRequest(
        "/api/v1/paper-accounts",
        "GET",
        undefined,
        rejected,
      ),
      env,
    );
    const badText = await bad.text();

    expect(missing.status).toBe(401);
    expect(crossCredential.status).toBe(401);
    expect(bad.status).toBe(401);
    expect(badText).not.toContain(rejected);
    expect(database.preparedSql).toHaveLength(0);
  });

  it("creates, replays, conflicts, and lists an immutable account", async () => {
    const database = new PaperFakeD1();
    const env = await environment(database);
    const first = await createAccount(env, "paper-alpha", 5_000_000);
    const duplicate = await createAccount(env, "paper-alpha", 5_000_000);
    const conflict = await handleRequest(
      paperRequest(
        "/api/v1/paper-accounts",
        "POST",
        accountBody("paper-alpha", { label: "Changed label" }),
      ),
      env,
    );
    const listed = await handleRequest(
      paperRequest("/api/v1/paper-accounts?limit=50", "GET"),
      env,
    );

    expect(first.status).toBe(201);
    expect(await json(first)).toMatchObject({
      status: "CREATED",
      mode: "PAPER_ONLY",
      balance_minor: 5_000_000,
      last_sequence: 0,
    });
    expect(duplicate.status).toBe(200);
    expect((await json(duplicate)).status).toBe("DUPLICATE");
    expect(conflict.status).toBe(409);
    expect((await json(conflict)).error).toMatchObject({
      code: "PAPER_ACCOUNT_CONFLICT",
    });
    expect(await json(listed)).toMatchObject({
      mode: "PAPER_ONLY",
      count: 1,
    });
    expect(database.accounts).toHaveLength(1);
    const stored = database.accounts.get("paper-alpha");
    expect(stored).not.toHaveProperty("credential");
    expect(stored).not.toHaveProperty("payload");
  });

  it("isolates balances and sequences across two accounts", async () => {
    const database = new PaperFakeD1();
    const env = await environment(database);
    await createAccount(env, "paper-alpha", 1_000_000);
    await createAccount(env, "paper-beta", 2_000_000);
    expect((await appendEntry(env, "paper-alpha", 1, 25_000)).status).toBe(201);
    expect((await appendEntry(env, "paper-beta", 1, -50_000)).status).toBe(201);

    const listed = await handleRequest(
      paperRequest("/api/v1/paper-accounts", "GET"),
      env,
    );
    const items = (await json(listed)).items as Record<string, unknown>[];
    const alpha = items.find((item) => item.account_id === "paper-alpha");
    const beta = items.find((item) => item.account_id === "paper-beta");

    expect(alpha).toMatchObject({
      balance_minor: 1_025_000,
      ledger_delta_minor: 25_000,
      last_sequence: 1,
    });
    expect(beta).toMatchObject({
      balance_minor: 1_950_000,
      ledger_delta_minor: -50_000,
      last_sequence: 1,
    });
  });

  it("implements replay, conflicting replay, sequence-gap, and missing-account semantics", async () => {
    const env = await environment();
    await createAccount(env, "paper-alpha", 100_000);
    const first = await appendEntry(env, "paper-alpha", 1, -10_000);
    const duplicate = await appendEntry(env, "paper-alpha", 1, -10_000);
    const conflict = await appendEntry(env, "paper-alpha", 1, -9_999);
    const gap = await appendEntry(env, "paper-alpha", 3, 1_000);
    const missing = await appendEntry(env, "paper-missing", 1, 1_000);

    expect(first.status).toBe(201);
    expect((await json(first)).status).toBe("RECORDED");
    expect(duplicate.status).toBe(200);
    expect((await json(duplicate)).status).toBe("DUPLICATE");
    expect(conflict.status).toBe(409);
    expect((await json(conflict)).error).toMatchObject({
      code: "PAPER_LEDGER_CONFLICT",
    });
    expect(gap.status).toBe(409);
    expect((await json(gap)).error).toMatchObject({
      code: "PAPER_LEDGER_SEQUENCE_CONFLICT",
    });
    expect(missing.status).toBe(404);
  });

  it("keeps balances inside the cross-language safe integer range", async () => {
    const env = await environment();
    await createAccount(env, "paper-max", MAX_SAFE_INTEGER);
    const overflow = await appendEntry(env, "paper-max", 1, 1);
    const valid = await appendEntry(
      env,
      "paper-max",
      1,
      -MAX_SAFE_INTEGER,
    );
    const unsafeDelta = await appendEntry(
      env,
      "paper-max",
      2,
      -MAX_SAFE_INTEGER,
    );

    expect(overflow.status).toBe(422);
    expect((await json(overflow)).error).toMatchObject({
      code: "PAPER_BALANCE_OUT_OF_RANGE",
    });
    expect(valid.status).toBe(201);
    expect(unsafeDelta.status).toBe(422);

    await createAccount(env, "paper-min", 0);
    expect(
      (await appendEntry(env, "paper-min", 1, -MAX_SAFE_INTEGER)).status,
    ).toBe(201);
    expect((await appendEntry(env, "paper-min", 2, -1)).status).toBe(422);
  });

  it("rejects malformed, duplicate-key, unsafe, and oversized bodies", async () => {
    const env = await environment();
    const extra = await handleRequest(
      paperRequest(
        "/api/v1/paper-accounts",
        "POST",
        accountBody("paper-extra", { provider: "forbidden" }),
      ),
      env,
    );
    const unsafe = await handleRequest(
      paperRequest(
        "/api/v1/paper-accounts",
        "POST",
        `{"schema_version":"1.0","account_id":"paper-unsafe","label":"Paper unsafe","currency_code":"USD","currency_scale":2,"opening_balance_minor":9007199254740992}`,
      ),
      env,
    );
    const duplicateKey = await handleRequest(
      paperRequest(
        "/api/v1/paper-accounts",
        "POST",
        `{"schema_version":"1.0","account_id":"paper-dup","account_id":"paper-dup","label":"Paper dup","currency_code":"USD","currency_scale":2,"opening_balance_minor":100}`,
      ),
      env,
    );
    const corrupt = await handleRequest(
      paperRequest(
        "/api/v1/paper-accounts",
        "POST",
        accountBody("paper-corrupt", { label: "bad\\label" }),
      ),
      env,
    );
    const oversizedValue = "x".repeat(17_000);
    const oversized = await handleRequest(
      paperRequest(
        "/api/v1/paper-accounts",
        "POST",
        `{"private":"${oversizedValue}"}`,
      ),
      env,
    );

    expect(extra.status).toBe(422);
    expect(unsafe.status).toBe(422);
    expect(duplicateKey.status).toBe(422);
    expect(corrupt.status).toBe(422);
    expect(oversized.status).toBe(413);
    expect(await oversized.text()).not.toContain(oversizedValue);
  });

  it("handles concurrent identical appends with one durable winner", async () => {
    const database = new PaperFakeD1();
    const env = await environment(database);
    await createAccount(env, "paper-race", 100_000);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        appendEntry(env, "paper-race", 1, 5_000),
      ),
    );

    expect(responses.filter((response) => response.status === 201)).toHaveLength(
      1,
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(
      7,
    );
    expect(database.entries).toHaveLength(1);
  });

  it("paginates one account's entries without leaking another account", async () => {
    const env = await environment();
    await createAccount(env, "paper-alpha", 100_000);
    await createAccount(env, "paper-beta", 100_000);
    await appendEntry(env, "paper-alpha", 1, 1_000);
    await appendEntry(env, "paper-alpha", 2, 2_000);
    await appendEntry(env, "paper-beta", 1, 9_000);
    const response = await handleRequest(
      paperRequest(
        "/api/v1/paper-accounts/paper-alpha/ledger-entries?before_sequence=2&limit=1",
        "GET",
      ),
      env,
    );
    const responseBody = await json(response);
    const items = responseBody.items as Record<string, unknown>[];

    expect(response.status).toBe(200);
    expect(responseBody).toMatchObject({
      account_id: "paper-alpha",
      count: 1,
      balance_minor: 103_000,
    });
    expect(items[0]).toMatchObject({
      account_id: "paper-alpha",
      sequence: 1,
    });
    expect(JSON.stringify(responseBody)).not.toContain("paper-beta");
  });

  it("reads account projection and entry page from one D1 batch snapshot", async () => {
    const database = new PaperFakeD1();
    const env = await environment(database);
    await createAccount(env, "paper-snapshot", 100_000);
    await appendEntry(env, "paper-snapshot", 1, 1_000);
    database.afterBatchSnapshot = () => {
      database.afterBatchSnapshot = null;
      database.entries.set("concurrent-entry", {
        entry_id: "concurrent-entry",
        account_id: "paper-snapshot",
        sequence: 2,
        idempotency_key: "paper-ledger:paper-snapshot:2",
        payload_sha256: "f".repeat(64),
        entry_kind: "MANUAL_ADJUSTMENT",
        amount_minor: 2_000,
        recorded_at: "2026-07-23T00:00:02.000Z",
      });
    };

    const response = await handleRequest(
      paperRequest(
        "/api/v1/paper-accounts/paper-snapshot/ledger-entries",
        "GET",
      ),
      env,
    );
    const responseBody = await json(response);
    const items = responseBody.items as Record<string, unknown>[];

    expect(response.status).toBe(200);
    expect(database.batchCalls).toBe(1);
    expect(database.entries).toHaveLength(2);
    expect(responseBody).toMatchObject({
      balance_minor: 101_000,
      last_sequence: 1,
      count: 1,
    });
    expect(items.map((item) => item.sequence)).toEqual([1]);
  });

  it("sanitizes storage failures and exposes no execution routes", async () => {
    const env = await environment(new FailingPaperD1());
    const storage = await handleRequest(
      paperRequest("/api/v1/paper-accounts", "GET"),
      env,
    );
    expect(storage.status).toBe(503);

    for (const path of [
      "/api/v1/orders",
      "/api/v1/trades",
      "/api/v1/positions",
      "/api/v1/brokers",
    ]) {
      const response = await handleRequest(
        paperRequest(path, "POST", { schema_version: "1.0" }),
        env,
      );
      expect(response.status).toBe(404);
    }
  });
});

const PAPER_MIGRATION_FILES = [
  "0002_paper_ledger.sql",
  "0003_paper_accounts_no_update.sql",
  "0004_paper_accounts_no_delete.sql",
  "0005_paper_ledger_no_update.sql",
  "0006_paper_ledger_no_delete.sql",
  "0007_paper_ledger_contiguous_sequence.sql",
  "0008_paper_ledger_safe_balance.sql",
] as const;

function paperMigrationChain(): string[] {
  const root = fileURLToPath(new URL("..", import.meta.url));
  return PAPER_MIGRATION_FILES.map((file) =>
    readFileSync(`${root}/migrations/${file}`, "utf8"),
  );
}

function migratedPaperDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const migration of paperMigrationChain()) {
    database.exec(migration);
  }
  return database;
}

function insertDirectPaperAccount(
  database: DatabaseSync,
  accountId: string,
  openingBalanceMinor = 100,
): void {
  database
    .prepare(`
      INSERT INTO paper_accounts (
        account_id,
        mode,
        label,
        currency_code,
        currency_scale,
        opening_balance_minor,
        idempotency_key,
        payload_sha256,
        created_at
      ) VALUES (?, 'PAPER_ONLY', ?, 'USD', 2, ?, ?, ?, ?)
    `)
    .run(
      accountId,
      `Paper ${accountId}`,
      openingBalanceMinor,
      `paper-account:${accountId}`,
      "a".repeat(64),
      "2026-07-23T00:00:00.000Z",
    );
}

function insertDirectPaperEntry(
  database: DatabaseSync,
  accountId: string,
  sequence: number,
  amountMinor: number,
): void {
  database
    .prepare(`
      INSERT INTO paper_ledger_entries (
        entry_id,
        account_id,
        sequence,
        idempotency_key,
        payload_sha256,
        entry_kind,
        amount_minor,
        recorded_at
      ) VALUES (?, ?, ?, ?, ?, 'MANUAL_ADJUSTMENT', ?, ?)
    `)
    .run(
      `entry-${accountId}-${sequence}`,
      accountId,
      sequence,
      `paper-ledger:${accountId}:${sequence}`,
      "b".repeat(64),
      amountMinor,
      "2026-07-23T00:00:01.000Z",
    );
}

describe("paper ledger migration", () => {
  it.each([".", ".."])(
    "rejects direct SQLite insertion of dot-segment account id %s",
    (accountId) => {
      const database = migratedPaperDatabase();
      try {
        expect(() =>
          insertDirectPaperAccount(database, accountId),
        ).toThrow(/CHECK constraint failed/);
        expect(
          database
            .prepare("SELECT COUNT(*) AS count FROM paper_accounts")
            .get(),
        ).toMatchObject({ count: 0 });
      } finally {
        database.close();
      }
    },
  );

  it("enforces account and ledger immutability across the ordered chain", () => {
    const database = migratedPaperDatabase();
    try {
      insertDirectPaperAccount(database, "immutable");
      insertDirectPaperEntry(database, "immutable", 1, 10);

      expect(() =>
        database
          .prepare(
            "UPDATE paper_accounts SET label = 'Changed' WHERE account_id = 'immutable'",
          )
          .run(),
      ).toThrow(/paper_accounts_are_immutable/);
      expect(() =>
        database
          .prepare("DELETE FROM paper_accounts WHERE account_id = 'immutable'")
          .run(),
      ).toThrow(/paper_accounts_are_immutable/);
      expect(() =>
        database
          .prepare(
            "UPDATE paper_ledger_entries SET amount_minor = 11 WHERE account_id = 'immutable'",
          )
          .run(),
      ).toThrow(/paper_ledger_is_append_only/);
      expect(() =>
        database
          .prepare(
            "DELETE FROM paper_ledger_entries WHERE account_id = 'immutable'",
          )
          .run(),
      ).toThrow(/paper_ledger_is_append_only/);
    } finally {
      database.close();
    }
  });

  it("enforces contiguous sequence across the ordered chain", () => {
    const database = migratedPaperDatabase();
    try {
      insertDirectPaperAccount(database, "sequence");
      expect(() =>
        insertDirectPaperEntry(database, "sequence", 2, 10),
      ).toThrow(/paper_ledger_sequence_conflict/);
    } finally {
      database.close();
    }
  });

  it("enforces safe balance across the ordered chain", () => {
    const database = migratedPaperDatabase();
    try {
      insertDirectPaperAccount(database, "safe-balance", MAX_SAFE_INTEGER);
      expect(() =>
        insertDirectPaperEntry(database, "safe-balance", 1, 1),
      ).toThrow(/paper_balance_out_of_safe_range/);
    } finally {
      database.close();
    }
  });

  it("is immutable, safe-range constrained, and free of execution columns", () => {
    const migrations = paperMigrationChain().map((migration) =>
      migration.toLowerCase(),
    );
    const schemaMigration = migrations[0] ?? "";
    const triggerMigrations = migrations.slice(1);
    const fullChain = migrations.join("\n");

    expect(schemaMigration).toContain("mode = 'paper_only'");
    expect(schemaMigration).toContain("entry_kind = 'manual_adjustment'");
    expect(schemaMigration).toContain("account_id not in ('.', '..')");
    expect(schemaMigration).not.toContain("create trigger");
    expect(triggerMigrations).toHaveLength(6);
    for (const triggerMigration of triggerMigrations) {
      expect(
        triggerMigration.match(/create trigger if not exists/g),
      ).toHaveLength(1);
    }
    expect(fullChain).toContain("paper_ledger_contiguous_sequence");
    expect(fullChain).toContain("paper_ledger_safe_balance");
    expect(fullChain).toContain("paper_accounts_no_update");
    expect(fullChain).toContain("paper_ledger_no_delete");
    expect(fullChain).not.toMatch(
      /^\s*(broker|provider|order|trade|position|fill)[a-z_]*\s+/gm,
    );
  });
});
