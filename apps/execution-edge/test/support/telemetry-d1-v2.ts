import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

type Statement = { sql: string; values: unknown[] };
export type D1FaultsV2 = {
  beforeStatement: number;
  afterCommit: boolean;
  beforeAcceptance?: () => Promise<void>;
  afterAcceptance?: () => Promise<void>;
};

// Only this disposable local Worker executes SQL. The client wrappers below do
// not emulate tables, constraints, transactions, or D1 metadata.
const script = `export default { async fetch(request, env) {
  try {
    const input = await request.json();
    const statements = input.statements.map(s => env.DB.prepare(s.sql).bind(...s.values));
    const results = [];
    if (input.schema) {
      for (const statement of statements) results.push(await statement.run());
    } else results.push(...await env.DB.batch(statements));
    return Response.json(results);
  } catch (error) {
    return Response.json({ code: 'LOCAL_D1_REJECTED', detail: String(error) }, { status: 409 });
  }
} };`;

export async function telemetryD1V2() {
  const runtime = new Miniflare({ modules: true, script, compatibilityDate: '2026-07-23', d1Databases: ['DB'], cf: false });
  const metrics = { reads: 0, writes: 0, maxBatch: 0, queries: 0, allocatedBytes: 0 };
  const faults: D1FaultsV2 = { beforeStatement: -1, afterCommit: false };
  const handles = new WeakMap<object, Statement>();
  async function transport(statements: Statement[], schema = false): Promise<D1Result[]> {
    metrics.maxBatch = Math.max(metrics.maxBatch, schema ? 1 : statements.length);
    metrics.queries += statements.length;
    const response = await runtime.dispatchFetch('http://telemetry-d1.test/sql', {
      method: 'POST', body: JSON.stringify({ statements, schema }),
    });
    if (!response.ok) throw new Error(`LOCAL_D1_REJECTED: ${await response.text()}`);
    const results = await response.json() as D1Result[];
    for (const result of results) {
      metrics.reads += result.meta.rows_read;
      metrics.writes += result.meta.rows_written;
      metrics.allocatedBytes = Math.max(metrics.allocatedBytes, result.meta.size_after);
    }
    return results;
  }
  function connect(): D1Database {
    const db = {
      prepare(sql: string) {
        function prepared(values: unknown[]): D1PreparedStatement {
          const handle = {
            bind: (...bound: unknown[]) => prepared(bound),
            all: async () => (await transport([{ sql, values }]))[0],
            run: async () => (await transport([{ sql, values }]))[0],
            first: async (column?: string) => {
              const row = (await transport([{ sql, values }]))[0]?.results[0] as Record<string, unknown> | undefined;
              return row === undefined ? null : column === undefined ? row : row[column] ?? null;
            },
          } as D1PreparedStatement;
          handles.set(handle, { sql, values });
          return handle;
        }
        return prepared([]);
      },
      async batch(statements: D1PreparedStatement[]) {
        const rows = statements.map((statement) => {
          const row = handles.get(statement);
          if (row === undefined) throw new Error('UNKNOWN_LOCAL_D1_STATEMENT');
          return row;
        });
        const accepting = rows.length === 4 && rows[0]?.sql.includes('INSERT INTO telemetry_session_v2');
        if (accepting) {
          await faults.beforeAcceptance?.();
          if (faults.beforeStatement >= 0) rows.splice(faults.beforeStatement, 0, { sql: 'INSERT INTO telemetry_fault_test VALUES (0)', values: [] });
        }
        const results = await transport(rows);
        if (accepting) {
          const after = faults.afterAcceptance;
          delete faults.afterAcceptance;
          await after?.();
          if (faults.afterCommit) { faults.afterCommit = false; throw new Error('LOCAL_D1_LOST_COMMIT_REPLY'); }
        }
        return results;
      },
    };
    return db as D1Database;
  }
  try {
    const migration = await readFile(new URL('../../migrations/0004_account_telemetry_v2.sql', import.meta.url), 'utf8');
    const pattern = /CREATE (?:TABLE[\s\S]*?\) WITHOUT ROWID;|TRIGGER[\s\S]*?END;)/gu;
    const statements = migration.match(pattern) ?? [];
    if (statements.length === 0 || migration.replace(pattern, '').trim() !== '') throw new Error('UNPARSED_TELEMETRY_MIGRATION');
    await transport([...statements.map((sql) => ({ sql, values: [] })), { sql: 'CREATE TABLE telemetry_fault_test(n INTEGER CHECK(n > 0))', values: [] }], true);
    Object.assign(metrics, { reads: 0, writes: 0, maxBatch: 0, queries: 0, allocatedBytes: 0 });
    return { db: connect(), connect, metrics, faults, close: () => runtime.dispose() };
  } catch (error) { await runtime.dispose(); throw error; }
}

export const localD1V2 = telemetryD1V2;
