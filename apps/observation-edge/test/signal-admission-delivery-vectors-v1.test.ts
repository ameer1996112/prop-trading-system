import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { validateSignalEvidenceV1 } from '../src/signal-evidence-v1';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

it('shared literal delivery entries preserve actual bridge output and independent delivery/ack hashes', async () => {
  const source = JSON.parse(await readFile(new URL('../../../contracts/vectors/signal-evidence-v1.json', import.meta.url), 'utf8'));
  const vectors = JSON.parse(await readFile(new URL('../../../contracts/vectors/signal-admission-v1.json', import.meta.url), 'utf8'));
  expect(vectors.deliveries).toHaveLength(source.cases.length);
  for (const vector of vectors.deliveries) {
    const original = source.cases.find((item: { case_id: string }) => item.case_id === vector.source_case_id);
    const input = structuredClone(original.input);
    if (vector.normalization !== null) {
      expect(original.input.observation.producer_sequence).toBe(0);
      expect(vector.normalization).toEqual({ producer_sequence: 1, event_id: `${input.observation.producer_instance_id}:1` });
      Object.assign(input.observation, vector.normalization);
    }
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    const result = await validateSignalEvidenceV1(bytes(input), bytes(original.reviewed_binding));
    expect(result.status, vector.case_id).toBe('VALIDATED');
    if (result.status !== 'VALIDATED') throw new Error('literal entry rejected');
    expect(result.entries[0], vector.case_id).toEqual(vector.body.evidence);
    expect(vector.accepted).toBe(result.entries[0]!.status === 'SELECTED');
    const { delivery_body_sha256, ...body } = vector.body;
    expect(delivery_body_sha256).toBe(hash(body));
    expect(body.delivery_id).toBe(hash({ schema_version: 'TradeOpsSignalDeliveryIdentityV1', attempt_key: body.attempt_key, evidence_id: body.evidence_id }));
    expect(body.receipt_id).toBe(hash({ schema_version: 'TradeOpsSignalReceiptIdentityV1', registration_id: body.registration_id, generation: body.generation, sequence: input.observation.producer_sequence }));
    for (const status of ['STORED', 'DUPLICATE']) {
      expect(status === 'STORED' ? vector.stored_ack : vector.duplicate_ack).toEqual({ schema_version: 'TradeOpsSignalDeliveryAckV1', authority: 'EVIDENCE_ONLY', execution_allowed: false, delivery_id: body.delivery_id, delivery_body_sha256, status });
    }
  }
});
