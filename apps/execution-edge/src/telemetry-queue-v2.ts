export class TelemetryQueueV2 {
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.queued >= 8) throw new Error('TELEMETRY_BUSY');
    this.queued += 1;
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    try { return await result; }
    finally { this.queued -= 1; }
  }
}
