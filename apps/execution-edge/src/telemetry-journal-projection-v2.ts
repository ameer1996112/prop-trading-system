import { sumFixedV2, type FixedDecimalV2 } from './telemetry-values-v2';
import type { DealV2, TelemetryRequestV2 } from './telemetry-wire-v2';

type Amount = DealV2['profit'];
type Registration = TelemetryRequestV2['registration'];

export type JournalContributionV2 = Readonly<{
  category: 'TRADE_DEAL' | 'ACCOUNT_ACTIVITY';
  position_id: string | null;
  broker_type: DealV2['type'];
  entry: DealV2['entry'];
  cancelled: boolean;
  gross_recorded: DealV2['profit'];
  commission: DealV2['commission'];
  swap: DealV2['swap'];
  fee: DealV2['fee'];
  net_recorded: FixedDecimalV2 | null;
  result_reason: 'MISSING_BROKER_AMOUNT' | null;
  opened_before_tracking: boolean;
  lifetime_complete: false;
  initial_risk: null;
  strategy: 'UNKNOWN';
  opening_origin: 'MANUAL' | 'EA_OR_SCRIPT' | 'UNKNOWN';
  exit_reason: DealV2['reason'] | null;
  opening_volume: FixedDecimalV2 | null;
  closing_volume: FixedDecimalV2 | null;
  portion_reason: 'REVERSAL_SPLIT_UNKNOWN' | 'RECONSTRUCTED_NOT_BROKER_ATTESTED' | null;
  portion_cost_allocation: 'SINGLE_PORTION' | 'UNKNOWN';
  sl: DealV2['sl'];
  tp: DealV2['tp'];
  protection_source: DealV2['protection_source'];
}>;

const tradingTypes = new Set<DealV2['type']>(['BUY', 'SELL', 'BUY_CANCELED', 'SELL_CANCELED']);
const cancelledTypes = new Set<DealV2['type']>(['BUY_CANCELED', 'SELL_CANCELED']);
const manualReasons = new Set<DealV2['reason']>(['CLIENT', 'MOBILE', 'WEB']);

function recordedNet(values: readonly Amount[], scale: number): FixedDecimalV2 | null {
  const fixed: FixedDecimalV2[] = [];
  for (const value of values) {
    if (value.value === null) return null;
    fixed.push(value.value);
  }
  return sumFixedV2(fixed, scale);
}

export function projectDealV2(deal: DealV2, registration: Registration): JournalContributionV2 {
  const trading = tradingTypes.has(deal.type);
  const values = [deal.profit, deal.commission, deal.swap, deal.fee];
  const netRecorded = recordedNet(values, registration.display.currency_scale);
  const split = deal.reversal_split;
  const isInOut = deal.entry === 'INOUT';
  const openedBeforeTracking = deal.position_id !== null && registration.baseline.positions.some((position) => position.position_id === deal.position_id);
  const openingOrigin = !trading || deal.entry !== 'IN'
    ? 'UNKNOWN'
    : manualReasons.has(deal.reason)
      ? 'MANUAL'
      : deal.reason === 'EXPERT'
        ? 'EA_OR_SCRIPT'
        : 'UNKNOWN';
  const openingVolume = !trading
    ? null
    : deal.entry === 'IN'
      ? deal.volume
      : isInOut
        ? split?.opening_volume ?? null
        : null;
  const closingVolume = !trading
    ? null
    : deal.entry === 'OUT' || deal.entry === 'OUT_BY'
      ? deal.volume
      : isInOut
        ? split?.closing_volume ?? null
        : null;
  const portionReason = !isInOut
    ? null
    : split === null
      ? 'REVERSAL_SPLIT_UNKNOWN'
      : 'RECONSTRUCTED_NOT_BROKER_ATTESTED';

  return Object.freeze({
    category: trading ? 'TRADE_DEAL' : 'ACCOUNT_ACTIVITY',
    position_id: deal.position_id,
    broker_type: deal.type,
    entry: deal.entry,
    cancelled: cancelledTypes.has(deal.type),
    gross_recorded: deal.profit,
    commission: deal.commission,
    swap: deal.swap,
    fee: deal.fee,
    net_recorded: netRecorded,
    result_reason: netRecorded === null ? 'MISSING_BROKER_AMOUNT' : null,
    opened_before_tracking: openedBeforeTracking,
    lifetime_complete: false,
    initial_risk: null,
    strategy: 'UNKNOWN',
    opening_origin: openingOrigin,
    exit_reason: trading && (deal.entry === 'OUT' || deal.entry === 'OUT_BY' || isInOut) ? deal.reason : null,
    opening_volume: openingVolume,
    closing_volume: closingVolume,
    portion_reason: portionReason,
    portion_cost_allocation: isInOut ? 'UNKNOWN' : 'SINGLE_PORTION',
    sl: deal.sl,
    tp: deal.tp,
    protection_source: deal.protection_source,
  });
}
