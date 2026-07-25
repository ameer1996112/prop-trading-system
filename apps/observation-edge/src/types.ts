export type ObservationKind = "incremental" | "snapshot";
export type ReceiptStatus = "RECEIVED" | "DUPLICATE";
export type ObservationSchemaVersion = "1.0" | "1.1" | "1.2";
export type StrategyVersion =
  | "1.0.0-phase1"
  | "1.1.0-paper1"
  | "1.2.0-contract1";

export interface ReceiptMetadata {
  readonly idempotencyKey: string;
  readonly schemaVersion: ObservationSchemaVersion;
  readonly strategyId: "rd_liquidity_sd_5m_v1";
  readonly strategyVersion: StrategyVersion;
  readonly producerInstanceId: string;
  readonly sequence: number;
  readonly symbol: string;
  readonly tickerId: string;
  readonly feed: string;
  readonly timeframe: "5";
  readonly kind: ObservationKind;
}

export interface ValidatedObservation {
  readonly credential: string;
  readonly canonicalPayload: Readonly<Record<string, CanonicalValue>>;
  readonly metadata: ReceiptMetadata;
  readonly paperCommands: readonly PaperAutomationCommand[];
}

export type CanonicalScalar = null | boolean | number | string;
export type CanonicalValue =
  | CanonicalScalar
  | readonly CanonicalValue[]
  | CanonicalObject;

export interface CanonicalObject {
  readonly [key: string]: CanonicalValue;
}

export interface StoredReceipt {
  readonly receipt_id: string;
  readonly received_at: string;
  readonly idempotency_key: string;
  readonly payload_sha256: string;
  readonly schema_version: ObservationSchemaVersion;
  readonly strategy_id: "rd_liquidity_sd_5m_v1";
  readonly strategy_version: StrategyVersion;
  readonly producer_instance_id: string;
  readonly sequence: number;
  readonly symbol: string;
  readonly ticker_id: string;
  readonly feed: string;
  readonly timeframe: "5";
  readonly kind: ObservationKind;
}

export interface ObservationReceipt {
  readonly receipt_id: string;
  readonly received_at: string;
  readonly idempotency_key: string;
  readonly payload_sha256: string;
  readonly schema_version: ObservationSchemaVersion;
  readonly strategy_id: "rd_liquidity_sd_5m_v1";
  readonly strategy_version: StrategyVersion;
  readonly producer_instance_id: string;
  readonly sequence: number;
  readonly symbol: string;
  readonly ticker_id: string;
  readonly feed: string;
  readonly timeframe: "5";
  readonly kind: ObservationKind;
  readonly status: ReceiptStatus;
}

export type SetupEvidenceEventKind = "transition" | "active_setup";
export type SetupEvidenceSide = "DEMAND" | "SUPPLY";
export type SetupEvidenceDecision = "WAIT" | "SHADOW_ONLY" | "REJECT";
export type SetupEvidenceEntryModel = "DIR_CLOSE" | "HTF_FLIP";

export interface SetupEvidenceInsert {
  readonly eventIndex: number;
  readonly eventKind: SetupEvidenceEventKind;
  readonly symbol: string;
  readonly side: SetupEvidenceSide;
  readonly zoneKey: string;
  readonly liquidityKey: string;
  readonly formationBarCloseEpoch: number;
  readonly fromState: string | null;
  readonly toState: string;
  readonly reasonCode: string;
  readonly decision: SetupEvidenceDecision;
  readonly entryModel: SetupEvidenceEntryModel | null;
  readonly rulePassesJson: string;
  readonly liquidityFormedEpoch: number | null;
  readonly ownExtremeBrokenEpoch: number | null;
  readonly liquiditySweptEpoch: number | null;
  readonly zoneEngagedEpoch: number | null;
  readonly entryConfirmedEpoch: number | null;
  readonly zoneTop: string;
  readonly zoneBottom: string;
  readonly zoneOriginOpenEpoch: number;
  readonly zoneOriginCloseEpoch: number;
  readonly liquidityPrice: string;
  readonly liquidityOriginOpenEpoch: number;
  readonly liquidityOriginCloseEpoch: number;
  readonly sourceOpenEpoch: number;
  readonly sourceCloseEpoch: number;
  readonly sourceOpen: string;
  readonly sourceHigh: string;
  readonly sourceLow: string;
  readonly sourceClose: string;
}

export interface StoredSetupEvidence {
  readonly evidence_id: string;
  readonly receipt_id: string;
  readonly recorded_at: string;
  readonly event_index: number;
  readonly event_kind: SetupEvidenceEventKind;
  readonly symbol: string;
  readonly side: SetupEvidenceSide;
  readonly zone_key: string;
  readonly liquidity_key: string;
  readonly formation_bar_close_epoch: number;
  readonly from_state: string | null;
  readonly to_state: string;
  readonly reason_code: string;
  readonly decision: SetupEvidenceDecision;
  readonly entry_model: SetupEvidenceEntryModel | null;
  readonly rule_passes_json: string;
  readonly liquidity_formed_epoch: number | null;
  readonly own_extreme_broken_epoch: number | null;
  readonly liquidity_swept_epoch: number | null;
  readonly zone_engaged_epoch: number | null;
  readonly entry_confirmed_epoch: number | null;
  readonly zone_top: string;
  readonly zone_bottom: string;
  readonly zone_origin_open_epoch: number;
  readonly zone_origin_close_epoch: number;
  readonly liquidity_price: string;
  readonly liquidity_origin_open_epoch: number;
  readonly liquidity_origin_close_epoch: number;
  readonly source_open_epoch: number;
  readonly source_close_epoch: number;
  readonly source_open: string;
  readonly source_high: string;
  readonly source_low: string;
  readonly source_close: string;
}

export interface ObservationSetupEvidence
  extends Omit<StoredSetupEvidence, "rule_passes_json"> {
  readonly rule_passes: readonly boolean[];
}

export interface PaperAccountCreateCommand {
  readonly schema_version: "1.0";
  readonly account_id: string;
  readonly label: string;
  readonly currency_code: string;
  readonly currency_scale: number;
  readonly opening_balance_minor: number;
}

export interface PaperLedgerAppendCommand {
  readonly schema_version: "1.0";
  readonly sequence: number;
  readonly entry_kind: "MANUAL_ADJUSTMENT";
  readonly amount_minor: number;
}

export interface StoredPaperAccount {
  readonly account_id: string;
  readonly mode: "PAPER_ONLY";
  readonly label: string;
  readonly currency_code: string;
  readonly currency_scale: number;
  readonly opening_balance_minor: number;
  readonly idempotency_key: string;
  readonly payload_sha256: string;
  readonly created_at: string;
}

export interface PaperAccountProjection {
  readonly account_id: string;
  readonly mode: "PAPER_ONLY";
  readonly label: string;
  readonly currency_code: string;
  readonly currency_scale: number;
  readonly opening_balance_minor: number;
  readonly ledger_delta_minor: number;
  readonly balance_minor: number;
  readonly last_sequence: number;
  readonly created_at: string;
}

export interface StoredPaperLedgerEntry {
  readonly entry_id: string;
  readonly account_id: string;
  readonly sequence: number;
  readonly idempotency_key: string;
  readonly payload_sha256: string;
  readonly entry_kind: "MANUAL_ADJUSTMENT";
  readonly amount_minor: number;
  readonly recorded_at: string;
}

export type PaperTradeSide = "BUY" | "SELL";
export type PaperTradeExitReason = "STOP" | "TARGET" | "MANUAL";

export interface PaperTradeIntentCommand {
  readonly schema_version: "1.0";
  readonly intent_id: string;
  readonly symbol: string;
  readonly side: PaperTradeSide;
  readonly entry_price: string;
  readonly stop_loss: string;
  readonly take_profit: string;
  readonly risk_bps: number;
  readonly account_ids: readonly string[];
}

export interface PaperTradeSettlementCommand {
  readonly schema_version: "1.0";
  readonly outcome_r_millis: number;
  readonly exit_reason: PaperTradeExitReason;
}

export type PaperAutomationCommand =
  | {
      readonly command_version: "1.0";
      readonly action: "OPEN";
      readonly intent: PaperTradeIntentCommand;
    }
  | {
      readonly command_version: "1.0";
      readonly action: "SETTLE";
      readonly intent_id: string;
      readonly settlement: PaperTradeSettlementCommand;
    };

export interface StoredPaperTradeIntent {
  readonly intent_id: string;
  readonly idempotency_key: string;
  readonly payload_sha256: string;
  readonly symbol: string;
  readonly side: PaperTradeSide;
  readonly entry_price: string;
  readonly stop_loss: string;
  readonly take_profit: string;
  readonly risk_bps: number;
  readonly source: "MANUAL" | "TRADINGVIEW";
  readonly source_receipt_id: string | null;
  readonly created_at: string;
}

export interface StoredPaperTradeAllocation {
  readonly allocation_id: string;
  readonly intent_id: string;
  readonly account_id: string;
  readonly risk_amount_minor: number;
  readonly balance_before_minor: number;
  readonly created_at: string;
}

export interface StoredPaperTradeSettlement {
  readonly settlement_id: string;
  readonly intent_id: string;
  readonly idempotency_key: string;
  readonly payload_sha256: string;
  readonly outcome_r_millis: number;
  readonly exit_reason: PaperTradeExitReason;
  readonly settled_at: string;
}

export interface PaperSimulationAccountStat extends PaperAccountProjection {
  readonly realized_pnl_minor: number;
  readonly open_risk_minor: number;
  readonly open_positions: number;
  readonly settled_trades: number;
  readonly winning_trades: number;
  readonly losing_trades: number;
  readonly max_drawdown_minor: number;
}

export interface PaperSimulationRow {
  readonly intent_id: string;
  readonly symbol: string;
  readonly side: PaperTradeSide;
  readonly entry_price: string;
  readonly stop_loss: string;
  readonly take_profit: string;
  readonly risk_bps: number;
  readonly source: "MANUAL" | "TRADINGVIEW";
  readonly source_receipt_id: string | null;
  readonly created_at: string;
  readonly account_id: string;
  readonly risk_amount_minor: number;
  readonly balance_before_minor: number;
  readonly settlement_id: string | null;
  readonly outcome_r_millis: number | null;
  readonly exit_reason: PaperTradeExitReason | null;
  readonly settled_at: string | null;
  readonly pnl_minor: number | null;
}

export type PaperReadinessState = "READY" | "DEGRADED" | "STOPPED";

export type PaperReadinessReasonCode =
  | "KILL_SWITCH_ENABLED"
  | "NO_PAPER_ACCOUNTS"
  | "NO_AUTOMATION_RECEIPT"
  | "RECEIPT_CLOCK_SKEW"
  | "RECEIPT_STALE"
  | "STALE_OPEN_INTENT"
  | "DAILY_LOSS_LIMIT"
  | "TOTAL_DRAWDOWN_LIMIT"
  | "OPEN_RISK_LIMIT"
  | "OPEN_POSITION_LIMIT"
  | "NON_POSITIVE_BALANCE";

export interface PaperReadinessReason {
  readonly code: PaperReadinessReasonCode;
  readonly account_id: string | null;
  readonly message: string;
}

export interface StoredPaperKillSwitchEvent {
  readonly control_sequence: number;
  readonly event_id: string;
  readonly idempotency_key: string;
  readonly payload_sha256: string;
  readonly enabled: 0 | 1;
  readonly reason: string;
  readonly changed_at: string;
}

export interface StoredBlockedPaperAutomationIntent {
  readonly intent_id: string;
  readonly source_receipt_id: string;
  readonly payload_sha256: string;
  readonly reason_code:
    | "KILL_SWITCH_ENABLED"
    | "RISK_LIMIT_REACHED"
    | "SAFETY_GATE_RACE"
    | "ACCOUNT_NOT_FOUND"
    | "NON_POSITIVE_BALANCE";
  readonly blocked_at: string;
}

export interface PaperReadinessAccountInput {
  readonly account_id: string;
  readonly label: string;
  readonly opening_balance_minor: number;
  readonly balance_minor: number;
  readonly daily_pnl_minor: number;
  readonly open_risk_minor: number;
  readonly open_positions: number;
  readonly max_drawdown_minor: number;
}

export interface PaperReadinessLatestReceipt {
  readonly receipt_id: string;
  readonly received_at: string;
  readonly producer_instance_id: string;
  readonly sequence: number;
  readonly symbol: string;
}

export interface PaperReadinessOpenHealth {
  readonly open_intents: number;
  readonly stale_open_intents: number;
  readonly oldest_open_intent_at: string | null;
}

export interface PaperReadinessInput {
  readonly evaluated_at: string;
  readonly kill_switch: {
    readonly enabled: boolean;
    readonly reason: string | null;
    readonly changed_at: string | null;
  };
  readonly latest_receipt: PaperReadinessLatestReceipt | null;
  readonly open_health: PaperReadinessOpenHealth;
  readonly accounts: readonly PaperReadinessAccountInput[];
}

export interface PaperReadinessReport {
  readonly schema_version: "1.0";
  readonly mode: "PAPER_ONLY";
  readonly state: PaperReadinessState;
  readonly evaluated_at: string;
  readonly thresholds: {
    readonly receipt_max_age_seconds: number;
    readonly stale_trade_seconds: number;
    readonly max_daily_loss_bps: number;
    readonly max_total_drawdown_bps: number;
    readonly max_open_risk_bps: number;
    readonly max_open_positions: number;
  };
  readonly kill_switch: PaperReadinessInput["kill_switch"];
  readonly latest_receipt:
    | (PaperReadinessLatestReceipt & { readonly age_seconds: number | null })
    | null;
  readonly open_health: PaperReadinessOpenHealth;
  readonly accounts: readonly {
    readonly account_id: string;
    readonly label: string;
    readonly state: "READY" | "STOPPED";
    readonly daily_pnl_minor: number;
    readonly daily_loss_bps: number;
    readonly total_drawdown_bps: number;
    readonly open_risk_bps: number;
    readonly open_positions: number;
    readonly reasons: readonly PaperReadinessReason[];
  }[];
  readonly reasons: readonly PaperReadinessReason[];
  readonly execution: "DISABLED";
}

export interface Env {
  readonly DB: D1Database;
  readonly ASSETS?: Fetcher;
  readonly CF_VERSION_METADATA?: {
    readonly id: string;
    readonly tag: string;
    readonly timestamp: string;
  };
  readonly PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256?: string;
  readonly PAPER_LEDGER_ENABLED?: string;
  readonly RD_ENTRY_CANONICAL_PAPER_ENABLED?: string;
  readonly RD_ENTRY_PROMOTION_PINE_SHA256?: string;
  readonly RD_ENTRY_PROMOTION_REPORT_SHA256?: string;
  readonly RD_ENTRY_PROMOTION_SOURCE_COMMIT?: string;
  readonly TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256?: string;
  readonly TRADINGVIEW_PAPER_AUTOMATION_CREDENTIAL_SHA256?: string;
  readonly TRADINGVIEW_OBSERVATION_INGRESS_ENABLED?: string;
  readonly TRADINGVIEW_OBSERVATION_MAX_BODY_BYTES?: string;
}
