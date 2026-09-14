import { describe, expect, it } from 'vitest';
import { parseTelemetryV2, type DealV2 } from '../src/telemetry-wire-v2';
import { projectDealV2 } from '../src/telemetry-journal-projection-v2';
import { dealFixture, f, missing, positionFixture, r, signFixture, unsignedFixture } from './support/telemetry-fixture-v2';

async function parsedDeal(mutate?: (raw: any, event: any) => void) {
  const event: any = dealFixture();
  const raw: any = unsignedFixture(1, 0, [event]);
  mutate?.(raw, event);
  const request = await parseTelemetryV2(await signFixture(raw));
  return { request, deal: request.events[0]!.record as DealV2 };
}

describe('telemetry journal projection v2', () => {
  it('projects each known broker amount exactly once without claiming a closed trade', async () => {
    const { request, deal } = await parsedDeal();
    const result = projectDealV2(deal, request.registration);
    expect(result).toMatchObject({ category: 'TRADE_DEAL', gross_recorded: r('10.00'), commission: r('-0.20'), swap: r('-0.05'), fee: r('-0.05'), net_recorded: f('9.70'), result_reason: null, lifetime_complete: false, initial_risk: null, strategy: 'UNKNOWN', closing_volume: f('0.10'), exit_reason: 'TP', portion_cost_allocation: 'SINGLE_PORTION' });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each(['profit', 'commission', 'swap', 'fee'])('marks a missing %s as unknown rather than zero', async (amount) => {
    const { request, deal } = await parsedDeal((_raw, event) => { event.record[amount] = missing(); });
    const result: any = projectDealV2(deal, request.registration);
    expect(result).toMatchObject({ net_recorded: null, result_reason: 'MISSING_BROKER_AMOUNT' });
    expect(result[amount === 'profit' ? 'gross_recorded' : amount]).toEqual(missing());
  });

  it('projects standalone commissions as account activity with their recorded amount', async () => {
    const { request, deal } = await parsedDeal((_raw, event) => {
      Object.assign(event.record, { type: 'COMMISSION', entry: 'NONE', order_id: null, position_id: null, symbol: null, volume: null, profit: r('-5.00'), commission: r('0.00'), swap: r('0.00'), fee: r('0.00') });
    });
    expect(projectDealV2(deal, request.registration)).toMatchObject({ category: 'ACCOUNT_ACTIVITY', gross_recorded: r('-5.00'), net_recorded: f('-5.00'), opening_origin: 'UNKNOWN', opening_volume: null, closing_volume: null, exit_reason: null });
  });

  it.each([
    ['CLIENT', 'MANUAL'], ['MOBILE', 'MANUAL'], ['WEB', 'MANUAL'], ['EXPERT', 'EA_OR_SCRIPT'], ['UNKNOWN', 'UNKNOWN'],
  ])('derives opening origin from %s without inventing a strategy', async (reason, origin) => {
    const { request, deal } = await parsedDeal((_raw, event) => { event.record.entry = 'IN'; event.record.reason = reason; });
    expect(projectDealV2(deal, request.registration)).toMatchObject({ opening_origin: origin, opening_volume: f('0.10'), strategy: 'UNKNOWN', exit_reason: null });
  });

  it.each(['SL', 'TP'])('retains %s as the exit reason only for closing entries', async (reason) => {
    const { request, deal } = await parsedDeal((_raw, event) => { event.record.reason = reason; });
    expect(projectDealV2(deal, request.registration)).toMatchObject({ exit_reason: reason, closing_volume: f('0.10') });
  });

  it('keeps an unknown INOUT split explicit and records costs once', async () => {
    const { request, deal } = await parsedDeal((_raw, event) => { event.record.entry = 'INOUT'; event.record.reversal_split = null; });
    expect(projectDealV2(deal, request.registration)).toMatchObject({ net_recorded: f('9.70'), opening_volume: null, closing_volume: null, portion_reason: 'REVERSAL_SPLIT_UNKNOWN', portion_cost_allocation: 'UNKNOWN' });
  });

  it('projects reconstructed INOUT volumes without reallocating costs', async () => {
    const { request, deal } = await parsedDeal((_raw, event) => {
      event.record.entry = 'INOUT'; event.record.reversal_split = { source: 'RECONSTRUCTED_POSITION_VOLUME', closing_volume: f('0.04'), opening_volume: f('0.06') };
    });
    expect(projectDealV2(deal, request.registration)).toMatchObject({ gross_recorded: r('10.00'), commission: r('-0.20'), swap: r('-0.05'), fee: r('-0.05'), net_recorded: f('9.70'), opening_volume: f('0.06'), closing_volume: f('0.04'), portion_reason: 'RECONSTRUCTED_NOT_BROKER_ATTESTED', portion_cost_allocation: 'UNKNOWN' });
  });

  it('marks only baseline position IDs as opened before tracking', async () => {
    const old = await parsedDeal((raw) => { raw.registration.baseline.position_count = 1; raw.registration.baseline.positions = [positionFixture()]; });
    const newPosition = await parsedDeal();
    expect(projectDealV2(old.deal, old.request.registration)).toMatchObject({ opened_before_tracking: true, lifetime_complete: false, initial_risk: null });
    expect(projectDealV2(newPosition.deal, newPosition.request.registration)).toMatchObject({ opened_before_tracking: false });
  });

  it('preserves every partial fill as an independent contribution', async () => {
    const first: any = dealFixture(1); first.record.volume = f('0.04'); first.record.profit = r('4.00');
    const second: any = dealFixture(2); second.record.volume = f('0.06'); second.record.profit = r('6.00');
    const request = await parseTelemetryV2(await signFixture(unsignedFixture(2, 0, [first, second])));
    expect(projectDealV2(request.events[0]!.record as DealV2, request.registration)).toMatchObject({ closing_volume: f('0.04'), gross_recorded: r('4.00') });
    expect(projectDealV2(request.events[1]!.record as DealV2, request.registration)).toMatchObject({ closing_volume: f('0.06'), gross_recorded: r('6.00') });
  });

  it('keeps cancellation facts instead of synthesizing a negative rewrite', async () => {
    const { request, deal } = await parsedDeal((_raw, event) => { event.record.type = 'BUY_CANCELED'; });
    expect(projectDealV2(deal, request.registration)).toMatchObject({ category: 'TRADE_DEAL', cancelled: true, gross_recorded: r('10.00'), net_recorded: f('9.70'), broker_type: 'BUY_CANCELED' });
  });
});
