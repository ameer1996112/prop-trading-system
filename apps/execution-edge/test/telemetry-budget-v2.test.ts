import { expect, it } from 'vitest';
import { acceptTelemetryV2, JOURNAL_SQL_V2, scopeV2 } from '../src/telemetry-repository-v2';
import { localD1V2 } from './support/telemetry-d1-v2';
import { dealFixture, fixture, NOW } from './support/telemetry-fixture-v2';

it('measures a synthetic idle day, burst, exact retries, and journal index access', { timeout: 300_000 }, async () => {
  const local = await localD1V2();
  try {
    for (let sequence = 1; sequence <= 5_760; sequence += 1) {
      await acceptTelemetryV2(local.db, await fixture(sequence), NOW);
    }
    const idle = { ...local.metrics };
    expect(idle.writes).toBeGreaterThan(0);
    expect(idle.writes).toBeLessThan(5_760 * 12);
    expect(idle.reads).toBeLessThan(5_760 * 80);
    expect(idle.maxBatch).toBeLessThanOrEqual(4);
    expect(await local.db.prepare('SELECT COUNT(*) AS n FROM telemetry_receipt_v2').first<number>('n')).toBe(5_760);

    const burst = await fixture(5_761, 0, Array.from({ length: 32 }, (_, index) => dealFixture(index + 1)));
    const beforeBurst = { ...local.metrics };
    await acceptTelemetryV2(local.db, burst, NOW);
    const burstWrites = local.metrics.writes - beforeBurst.writes;
    const burstQueries = local.metrics.queries - beforeBurst.queries;
    expect(burstWrites).toBeLessThan(400);
    expect(burstQueries).toBeLessThan(20);

    const beforeRetries = local.metrics.writes;
    for (let retry = 0; retry < 100; retry += 1) await acceptTelemetryV2(local.db, burst, NOW + 1_000);
    const retryWrites = local.metrics.writes - beforeRetries;
    expect(retryWrites).toBe(0);

    const plan = await local.db.prepare(`EXPLAIN QUERY PLAN ${JOURNAL_SQL_V2}`)
      .bind(await scopeV2(burst), Number.MAX_SAFE_INTEGER).all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail);
    expect(details.some((detail) => /SEARCH/u.test(detail))).toBe(true);
    expect(details.some((detail) => /SCAN\s+telemetry_event_v2/iu.test(detail))).toBe(false);
    expect(details.some((detail) => /TEMP\s+B-TREE/iu.test(detail))).toBe(false);

    console.info('telemetry_budget_v2', {
      idle,
      burstWrites,
      burstQueries,
      retries: 100,
      retryWrites,
      allocatedDatabaseBytes: local.metrics.allocatedBytes,
      queryPlanDetail: details,
    });
  } finally {
    await local.close();
  }
});
