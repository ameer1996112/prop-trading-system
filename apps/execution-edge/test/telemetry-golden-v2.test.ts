import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { canonicalStringify, sha256Hex } from '../src/canonical';
import { responseBytesV2 } from '../src/telemetry-wire-v2';
import { dealFixture, fixture, NOW } from './support/telemetry-fixture-v2';

it('matches the cross-language canonical request and response fixture byte-for-byte', async () => {
  const request = await fixture(1, 0, [dealFixture()]);
  const requestBytes = canonicalStringify(request);
  const responseBytes = await responseBytesV2(request, 1, NOW);
  const expected = {
    fixture_version: 'TelemetryGoldenV2',
    synthetic: true,
    request_bytes: requestBytes,
    request_bytes_sha256: await sha256Hex(requestBytes),
    response_bytes: responseBytes,
    response_bytes_sha256: await sha256Hex(responseBytes),
  };
  const saved = JSON.parse(await readFile(new URL('../../../mt5/TradeOpsAgent/fixtures/agent-sync-v2.json', import.meta.url), 'utf8'));
  expect(saved).toEqual(expected);
});
