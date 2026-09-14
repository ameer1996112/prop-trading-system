import { readCounterV2 } from './telemetry-values-v2';

export type RecordGapV2 =
  | 'HISTORY_UNAVAILABLE'
  | 'CLOCK_DISCONTINUITY'
  | 'OUTBOX_CORRUPT'
  | 'CAPTURE_FAILED'
  | 'UNSUPPORTED_RECORD';

export type CoverageInputV2 = Readonly<{
  started: boolean;
  produced_events: number;
  acknowledged_events: number;
  scan_finished: boolean;
  scan_through_broker_msc: number | null;
  record_gap: RecordGapV2 | null;
  observation_gap: boolean;
}>;

export type CoverageV2 = Readonly<{
  state: 'NOT_STARTED' | 'CATCHING_UP' | 'UP_TO_DATE' | 'DATA_MISSING';
  through_broker_msc: number | null;
  pending_events: number;
  reason: RecordGapV2 | null;
  observation_gap: boolean;
}>;

const RECORD_GAPS = new Set<RecordGapV2>([
  'HISTORY_UNAVAILABLE',
  'CLOCK_DISCONTINUITY',
  'OUTBOX_CORRUPT',
  'CAPTURE_FAILED',
  'UNSUPPORTED_RECORD',
]);

function invalid(): never {
  throw new Error('TELEMETRY_COVERAGE_INVALID');
}

export function deriveCoverageV2(input: CoverageInputV2): CoverageV2 {
  if (input === null || typeof input !== 'object') invalid();

  const produced = readCounterV2(input.produced_events);
  const acknowledged = readCounterV2(input.acknowledged_events);
  if (acknowledged > produced) invalid();

  if (typeof input.started !== 'boolean' || typeof input.scan_finished !== 'boolean' || typeof input.observation_gap !== 'boolean') invalid();
  if (input.scan_through_broker_msc !== null) readCounterV2(input.scan_through_broker_msc, 1);
  if (input.record_gap !== null && (typeof input.record_gap !== 'string' || !RECORD_GAPS.has(input.record_gap as RecordGapV2))) invalid();

  if (!input.started) {
    if (produced !== 0 || acknowledged !== 0 || input.scan_through_broker_msc !== null || input.scan_finished) invalid();
  } else if (input.scan_finished && input.scan_through_broker_msc === null) {
    invalid();
  }

  const pending = produced - acknowledged;
  const state = !input.started
    ? 'NOT_STARTED'
    : input.record_gap !== null
      ? 'DATA_MISSING'
      : !input.scan_finished || pending !== 0
        ? 'CATCHING_UP'
        : 'UP_TO_DATE';

  // Acknowledged events are supplied only after durable commit; UI ages the watermark separately.
  return Object.freeze({
    state,
    through_broker_msc: state === 'UP_TO_DATE' ? input.scan_through_broker_msc : null,
    pending_events: pending,
    reason: input.record_gap,
    observation_gap: input.observation_gap,
  });
}
