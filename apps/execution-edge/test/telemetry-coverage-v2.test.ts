import { describe, expect, it } from 'vitest';
import { deriveCoverageV2, type CoverageInputV2 } from '../src/telemetry-coverage-v2';

const complete = (overrides: Partial<CoverageInputV2> = {}): CoverageInputV2 => ({
  started: true,
  produced_events: 3,
  acknowledged_events: 3,
  scan_finished: true,
  scan_through_broker_msc: 100000,
  record_gap: null,
  observation_gap: false,
  ...overrides,
});

describe('telemetry coverage v2', () => {
  it('derives frozen up-to-date coverage', () => {
    const result = deriveCoverageV2(complete());
    expect(result).toEqual({ state: 'UP_TO_DATE', through_broker_msc: 100000, pending_events: 0, reason: null, observation_gap: false });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('reports catching up for pending or unfinished scans without a watermark', () => {
    expect(deriveCoverageV2(complete({ acknowledged_events: 2 }))).toEqual({ state: 'CATCHING_UP', through_broker_msc: null, pending_events: 1, reason: null, observation_gap: false });
    expect(deriveCoverageV2(complete({ scan_finished: false }))).toEqual({ state: 'CATCHING_UP', through_broker_msc: null, pending_events: 0, reason: null, observation_gap: false });
  });

  it('prioritizes every known record gap over pending state', () => {
    const gaps = ['HISTORY_UNAVAILABLE', 'CLOCK_DISCONTINUITY', 'OUTBOX_CORRUPT', 'CAPTURE_FAILED', 'UNSUPPORTED_RECORD'] as const;
    for (const record_gap of gaps) {
      expect(deriveCoverageV2(complete({ acknowledged_events: 2, record_gap }))).toEqual({ state: 'DATA_MISSING', through_broker_msc: null, pending_events: 1, reason: record_gap, observation_gap: false });
    }
  });

  it('preserves observation gaps while supporting deal completeness', () => {
    expect(deriveCoverageV2(complete({ observation_gap: true }))).toEqual({ state: 'UP_TO_DATE', through_broker_msc: 100000, pending_events: 0, reason: null, observation_gap: true });
  });

  it('allows a legitimate completed empty history', () => {
    expect(deriveCoverageV2(complete({ produced_events: 0, acknowledged_events: 0 }))).toEqual({ state: 'UP_TO_DATE', through_broker_msc: 100000, pending_events: 0, reason: null, observation_gap: false });
  });

  it('reports not started for an untouched scan', () => {
    expect(deriveCoverageV2({ started: false, produced_events: 0, acknowledged_events: 0, scan_finished: false, scan_through_broker_msc: null, record_gap: null, observation_gap: false })).toEqual({ state: 'NOT_STARTED', through_broker_msc: null, pending_events: 0, reason: null, observation_gap: false });
  });

  it('rejects contradictory, malformed, and unsafe inputs', () => {
    const invalids: CoverageInputV2[] = [
      complete({ acknowledged_events: 4 }),
      complete({ scan_through_broker_msc: null }),
      { ...complete(), started: false },
      complete({ started: 1 as unknown as boolean }),
      complete({ scan_finished: 'yes' as unknown as boolean }),
      complete({ observation_gap: null as unknown as boolean }),
      complete({ record_gap: 'UNKNOWN' as unknown as CoverageInputV2['record_gap'] }),
    ];
    for (const input of invalids) expect(() => deriveCoverageV2(input)).toThrow('TELEMETRY_COVERAGE_INVALID');
    expect(() => deriveCoverageV2(complete({ produced_events: -1 }))).toThrow('TELEMETRY_COUNTER_INVALID');
    expect(() => deriveCoverageV2(complete({ acknowledged_events: Number.MAX_SAFE_INTEGER + 1 }))).toThrow('TELEMETRY_COUNTER_INVALID');
    expect(() => deriveCoverageV2(complete({ scan_through_broker_msc: 0 }))).toThrow('TELEMETRY_COUNTER_INVALID');
  });

  it('accepts not-started metadata only when counters and scan state are untouched', () => {
    expect(deriveCoverageV2({ started: false, produced_events: 0, acknowledged_events: 0, scan_finished: false, scan_through_broker_msc: null, record_gap: 'HISTORY_UNAVAILABLE', observation_gap: true })).toEqual({ state: 'NOT_STARTED', through_broker_msc: null, pending_events: 0, reason: 'HISTORY_UNAVAILABLE', observation_gap: true });
  });
});
