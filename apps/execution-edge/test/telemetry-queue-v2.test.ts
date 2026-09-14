import { describe, expect, it } from 'vitest';
import { TelemetryQueueV2 } from '../src/telemetry-queue-v2';

describe('telemetry queue v2', () => {
  it('limits running plus queued operations to eight', async () => {
    const queue = new TelemetryQueueV2(); let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const work = Array.from({ length: 8 }, (_, index) => queue.run(async () => { await gate; return index; }));
    await expect(queue.run(async () => 9)).rejects.toThrow('TELEMETRY_BUSY');
    release();
    await expect(Promise.all(work)).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('serializes after an awaited failure and releases capacity for later work', async () => {
    const queue = new TelemetryQueueV2(); const order: string[] = [];
    const first = queue.run(async () => { order.push('first-start'); await Promise.resolve(); order.push('first-throw'); throw new Error('expected'); });
    const second = queue.run(async () => { order.push('second'); return 'second'; });
    await expect(first).rejects.toThrow('expected');
    await expect(second).resolves.toBe('second');
    await expect(queue.run(async () => { order.push('third'); return 'third'; })).resolves.toBe('third');
    expect(order).toEqual(['first-start', 'first-throw', 'second', 'third']);
  });
});
