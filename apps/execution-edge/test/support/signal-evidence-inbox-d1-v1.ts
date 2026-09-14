import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

// Execute checked-in SQL in real local D1; no table or transaction emulation.
function statements(source: string): string[] {
  const result: string[] = []; let pending = ''; let depth = 0;
  const tokens = source.match(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|\b(?:BEGIN|CASE|END)\b|;|[^'";]+?(?=--|\/\*|'|"|\b(?:BEGIN|CASE|END)\b|;|$)/giu) ?? [];
  for (const token of tokens) {
    if (token.startsWith('--') || token.startsWith('/*')) { pending += ' '; continue; }
    pending += token;
    if (/^(BEGIN|CASE)$/iu.test(token)) depth += 1;
    if (/^END$/iu.test(token)) depth -= 1;
    if (token === ';' && depth === 0) { result.push(pending.trim()); pending = ''; }
  }
  if (pending.trim() || depth !== 0 || result.length === 0) throw new Error('UNPARSED_INBOX_MIGRATION');
  return result;
}

export async function createInboxDb() {
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response(null); } };', compatibilityDate: '2026-07-23', d1Databases: ['DB'], cf: false });
  try {
    const db = await runtime.getD1Database('DB') as unknown as D1Database;
    const directory = new URL('../../migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter(name => /^\d{4}_.*\.sql$/u.test(name)).sort()) {
      await db.batch(statements(await readFile(new URL(file, directory), 'utf8')).map(sql => db.prepare(sql)));
    }
    return { db, dispose: () => runtime.dispose(), count: () => db.prepare('SELECT count(*) AS n FROM signal_evidence_inbox_v1').first<number>('n') };
  } catch (error) { await runtime.dispose(); throw error; }
}
