import { readdir, readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { installGeneration } from "../../src/signal-admission-store-v1";
import type { Registration } from "../../src/signal-admission-registration-v1";
type Statement = { sql: string; values: unknown[] };
const script = `export default { async fetch(request,env) {
  try {
    const input=await request.json();
    if(input.schema) return Response.json(await env.DB.exec(input.schema));
    return Response.json(await env.DB.batch(input.statements.map(s=>env.DB.prepare(s.sql).bind(...s.values))));
  } catch(error) {return Response.json({detail:String(error)},{status:409});}
}};`;
const tables = new Set(["registrations", "streams", "receipts", "evidence", "receipt_evidence", "attempts", "outbox", "audit", "guards"]);
// Preserve trigger bodies and quoted semicolons while splitting checked-in SQL.
function migrationStatements(source: string): Statement[] {
  const statements: Statement[] = []; let pending = ""; let depth = 0;
  const tokens = source.match(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|\b(?:BEGIN|CASE|END)\b|;|[^'";]+?(?=--|\/\*|'|"|\b(?:BEGIN|CASE|END)\b|;|$)/giu) ?? [];
  for (const token of tokens) {
    if (token.startsWith("--") || token.startsWith("/*")) { pending += " "; continue; }
    pending += token;
    if (/^(BEGIN|CASE)$/iu.test(token)) depth += 1;
    if (/^END$/iu.test(token)) depth -= 1;
    if (token === ";" && depth === 0) { statements.push({ sql: pending.trim(), values: [] }); pending = ""; }
  }
  if (pending.trim() || depth !== 0 || statements.length === 0) throw new Error("unparsed migration");
  return statements;
}
export async function createAdmissionDb() {
  const runtime = new Miniflare({ modules: true, script, compatibilityDate: "2026-07-23", d1Databases: ["DB"], cf: false });
  const handles = new WeakMap<object, Statement>();
  const faults: { afterWrite: number; afterCommit: boolean; beforeBatch?: () => Promise<void> } = { afterWrite: -1, afterCommit: false };
  const metrics = { batches: 0, reads: 0, admissionBatches: 0 };
  async function transport(input: unknown): Promise<D1Result[]> {
    const response = await runtime.dispatchFetch("http://admission-d1.test/sql", { method: "POST", body: JSON.stringify(input) });
    if (!response.ok) throw new Error(await response.text());
    return await response.json() as D1Result[];
  }
  const db = {
    prepare(sql: string) {
      function prepared(values: unknown[]): D1PreparedStatement {
        const statement = {
          bind: (...values: unknown[]) => prepared(values),
          run: async () => (await transport({ statements: [{ sql, values }] }))[0],
          all: async () => { metrics.reads += 1; return (await transport({ statements: [{ sql, values }] }))[0]; },
          first: async (column?: string) => { metrics.reads += 1; const row = (await transport({ statements: [{ sql, values }] }))[0]?.results[0] as Record<string, unknown> | undefined; return row ? column ? row[column] : row : null; },
        } as D1PreparedStatement;
        handles.set(statement, { sql, values }); return statement;
      }
      return prepared([]);
    },
    async batch(statements: D1PreparedStatement[]) {
      metrics.batches += 1;
      const rows = statements.map(s => { const row = handles.get(s); if (!row) throw new Error("unknown statement"); return row; });
      const admission = rows.some(r => r.sql.includes("INSERT INTO signal_admission_v1_receipts")) || rows.some(r => r.sql.includes("SET state='QUARANTINED'"));
      if (admission) {
        metrics.admissionBatches += 1;
        const before = faults.beforeBatch; delete faults.beforeBatch; await before?.();
        if (faults.afterWrite >= 0) {
          const writes = rows.map((r, index) => ({ r, index })).filter(({r}) => !r.sql.includes("signal_admission_v1_guards") && /^(INSERT|UPDATE)/u.test(r.sql));
          const after = writes[faults.afterWrite];
          if (!after) throw new Error("fault boundary missing");
          rows.splice(after.index + 1, 0, {sql:"INSERT INTO local_admission_fault VALUES(0)",values:[]});
        }
      }
      const result = await transport({ statements: rows });
      if (admission && faults.afterCommit) { faults.afterCommit = false; throw new Error("LOCAL_LOST_REPLY"); }
      return result;
    },
  } as D1Database;
  try {
    const directory = new URL("../../migrations/", import.meta.url);
    for (const file of (await readdir(directory)).filter(n => /^\d{4}_.*\.sql$/u.test(n)).sort()) {
      await transport({ statements: migrationStatements(await readFile(new URL(file, directory), "utf8")) });
    }
    await transport({ schema: "CREATE TABLE local_admission_fault(n INTEGER CHECK(n>0));" });
    return { db, faults, metrics, dispose: () => runtime.dispose(),
      provision: (r: Registration) => installGeneration(db, 0, r, "LOCAL_TEST_PROVISION"),
      count: async (table: string) => { if (!tables.has(table)) throw new Error("unknown table"); return await db.prepare(`SELECT count(*) AS n FROM signal_admission_v1_${table}`).first<number>("n"); },
    };
  } catch (error) { await runtime.dispose(); throw error; }
}
