import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type { Env } from "../../src/types";

type SqliteInput = null | number | bigint | string | NodeJS.ArrayBufferView;

class SqliteStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
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

export class ProposalTestD1 {
  readonly database = new DatabaseSync(":memory:");
  failBatchAtSqlFragment: string | null = null;

  constructor() {
    this.database.exec("PRAGMA foreign_keys = ON");
    const root = fileURLToPath(new URL("../../", import.meta.url));
    for (const migration of readdirSync(`${root}/migrations`)
      .filter((name) => /^\d{4}_.*\.sql$/u.test(name))
      .sort()) {
      this.database.exec(readFileSync(`${root}/migrations/${migration}`, "utf8"));
    }
  }

  prepare(sql: string): D1PreparedStatement {
    return new SqliteStatement(this.database, sql) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => {
        const item = statement as unknown as SqliteStatement;
        if (
          this.failBatchAtSqlFragment !== null &&
          item.sql.includes(this.failBatchAtSqlFragment)
        ) {
          this.failBatchAtSqlFragment = null;
          throw new Error("injected proposal batch failure");
        }
        return item.execute();
      }) as D1Result<T>[];
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const vector = JSON.parse(
  readFileSync(
    new URL(
      "../../../../contracts/vectors/rd-entry-execution-proposal-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  reviewed_bindings: Record<string, Record<string, unknown>>;
  accept_cases: Array<{ proposal: Record<string, unknown> }>;
};

export function proposal(
  sequence = 1,
  changes: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...structuredClone(vector.accept_cases[0]!.proposal),
    producer_sequence: sequence,
    ...changes,
  };
}

export function proposalEnv(
  database: ProposalTestD1,
  changes: Partial<Env> = {},
): Env {
  return {
    DB: database as unknown as D1Database,
    RD_EXECUTION_PROPOSAL_V1_REVIEWED_IDENTITIES_JSON: JSON.stringify(
      Object.values(vector.reviewed_bindings),
    ),
    RD_EXECUTION_CANDIDATE_EMISSION_ENABLED: "false",
    RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED: "false",
    RD_EXECUTION_RECEIVER_MANIFEST_SHA256: "INERT_NOT_CONFIGURED",
    ...changes,
  };
}
