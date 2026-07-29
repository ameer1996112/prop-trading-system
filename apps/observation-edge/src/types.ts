import type {
  EntryBatchImmutableMetadata,
  EntryBatchSemanticIdentity,
  ValidatedEntryWireBatch,
} from "./rd-entry-wire";
import type {
  EntryV3EventRole,
  EntryV3ExitEvent,
  ValidatedEntryV3Bundle,
} from "./rd-entry-wire-v3";

export type ObservationKind = "incremental" | "snapshot";
export type ReceiptStatus = "RECEIVED" | "DUPLICATE";
export type ObservationSchemaVersion =
  | "1.0"
  | "1.1"
  | "1.2"
  | "2.0"
  | "3.0";
export type StrategyVersion =
  | "1.0.0-phase1"
  | "1.1.0-paper1"
  | "1.2.0-contract1"
  | "2.0.0-contract2"
  | "3.0.0-contract3";

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

export type ValidatedObservation =
  | {
      readonly version: "legacy";
      readonly credential: string;
      readonly canonicalPayload: Readonly<Record<string, CanonicalValue>>;
      readonly metadata: ReceiptMetadata;
      readonly paperCommands: readonly PaperAutomationCommand[];
    }
  | {
      readonly version: "entry-v2";
      readonly credential: string;
      readonly canonicalPayload: Readonly<Record<string, CanonicalValue>>;
      readonly metadata: ReceiptMetadata;
      readonly paperCommands: readonly [];
      readonly batchIdentity: EntryBatchSemanticIdentity;
      readonly batchMetadata: EntryBatchImmutableMetadata;
      readonly chunkIndex: number;
      readonly chunkCount: number;
      readonly entryBatches: readonly ValidatedEntryWireBatch[];
    }
  | {
      readonly version: "entry-v3";
      readonly credential: string;
      readonly canonicalPayload: CanonicalObject;
      readonly metadata: ReceiptMetadata;
      readonly eventRole: EntryV3EventRole;
      readonly producerSequence: number;
      readonly eventId: string;
      readonly isRealtime: boolean;
      readonly detectorCodeHash: string;
      readonly settingsHash: string;
      readonly tickSize: string;
      readonly observedAtEpoch: number;
      readonly marketEvent: import("./rd-entry-wire-v3").EntryV3MarketEvent;
      readonly exitEvents: readonly EntryV3ExitEvent[];
      readonly entryBundles: readonly ValidatedEntryV3Bundle[];
      readonly paperCommands: readonly [];
    };

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

export interface StoredMarketBarHeartbeat {
  readonly receipt_id: string;
  readonly batch_id: string | null;
  readonly schema_version: "1.2" | "2.0";
  readonly producer_role: "LEGACY_REFERENCE" | "ENTRY_V3_CANARY";
  readonly producer_instance_id: string;
  readonly producer_sequence: number;
  readonly strategy_version: "1.2.0-contract1" | "2.0.0-contract2";
  readonly symbol: string;
  readonly ticker_id: string;
  readonly feed: string;
  readonly timeframe: "5";
  readonly bar_open_epoch: number;
  readonly bar_close_epoch: number;
  readonly detector_code_hash: string | null;
  readonly settings_hash: string | null;
  readonly recorded_at: string;
}

export interface StoredEntrySetupEvent {
  readonly event_id: string;
  readonly setup_id: string;
  readonly batch_id: string;
  readonly receipt_id: string;
  readonly confirmed_bar_close_epoch: number;
  readonly proof_input_sha256: string;
  readonly proof_input_json: string;
  readonly recorded_at: string;
}

export interface StoredEntrySetupTerminal {
  readonly setup_id: string;
  readonly terminal_reason:
    | "INVALIDATED"
    | "BOTH_ACTIVE_MODELS_OBSERVED"
    | "RETENTION_EVICTED";
  readonly terminal_epoch: number;
  readonly first_batch_id: string;
  readonly first_receipt_id: string;
  readonly recorded_at: string;
}

export interface StoredEntryCandidate {
  readonly candidate_id: string;
  readonly setup_id: string;
  readonly model:
    | "DIR_CLOSE"
    | "HTF_FLIP"
    | "LEGACY_BREAK_CANDLE"
    | "LEGACY_REJECTION_RESPECT";
  readonly state: "MATCHED" | "BLOCKED" | "REJECTED" | "NORMALIZED";
  readonly event_anchor_epoch: number;
  readonly trigger_ordinal: number;
  readonly direction: "LONG" | "SHORT";
  readonly source_claim_ids_json: string;
  readonly normalized_from:
    | "LEGACY_BREAK_CANDLE"
    | "LEGACY_REJECTION_RESPECT"
    | null;
  readonly identity_sha256: string;
  readonly first_receipt_id: string;
  readonly observed_at_epoch: number;
}

export interface StoredEntryCandidateEvidence {
  readonly evidence_id: string;
  readonly candidate_id: string;
  readonly receipt_id: string;
  readonly observed_trigger_epoch: number | null;
  readonly observed_trigger_ticks: number | null;
  readonly htf_context_minutes_json: string;
  readonly fidelity:
    | "EXACT"
    | "CALIBRATED"
    | "DISCRETIONARY"
    | "UNRESOLVED";
  readonly proof_plane:
    | "CONFIRMED_5M"
    | "LOWER_TIMEFRAME_REPLAY"
    | "EXTERNAL_ARCHIVED_TICK";
  readonly proof_resolution_seconds: number;
  readonly coverage_start_epoch: number;
  readonly coverage_end_epoch: number;
  readonly ambiguity_codes_json: string;
  readonly passed_rule_ids_json: string;
  readonly failed_rule_ids_json: string;
  readonly source_claim_ids_json: string;
  readonly payload_sha256: string;
  readonly identity_sha256: string;
  readonly observed_at_epoch: number;
}

export interface StoredEntryHandling {
  readonly handling_id: string;
  readonly candidate_id: string;
  readonly evidence_id: string;
  readonly receipt_id: string;
  readonly handling_mode:
    | "CLOSE_CONFIRMATION"
    | "INTRABAR_FLIP"
    | "NEXT_CANDLE_WICK"
    | "AGGRESSIVE";
  readonly attempt_kind: "INITIAL" | "RE_ENTRY";
  readonly observed_epoch: number;
  readonly observed_ticks: number | null;
  readonly fidelity:
    | "EXACT"
    | "CALIBRATED"
    | "DISCRETIONARY"
    | "UNRESOLVED";
  readonly source_claim_ids_json: string;
  readonly identity_sha256: string;
}

export interface StoredProducerDiagnostic {
  readonly diagnostic_id: string;
  readonly batch_id: string;
  readonly setup_id: string;
  readonly candidate_refs_json: string;
  readonly evidence_refs_json: string;
  readonly realtime_evidence_refs_json: string;
  readonly handling_refs_json: string;
  readonly diagnostic_selection_json: string | null;
  readonly observed_at: string;
}

export interface StoredEntrySelection {
  readonly selection_id: string;
  readonly batch_id: string;
  readonly setup_id: string;
  readonly policy_version: "rd-entry-arbitration-v2";
  readonly revision: number;
  readonly candidate_ids_considered_json: string;
  readonly canonical_candidate_id: string | null;
  readonly canonical_evidence_id: string | null;
  readonly canonical_model: "DIR_CLOSE" | "HTF_FLIP" | null;
  readonly reason:
    | "ONLY_EXACT_TRIGGER"
    | "EARLIEST_EXACT_TRIGGER"
    | "FALLBACK_TO_CONFIRMED_CLOSE"
    | "NO_EXACT_CANDIDATE"
    | "UNRESOLVED_SOURCE_PRIORITY"
    | "SETUP_INVALIDATED"
    | "NO_CANDIDATE";
  readonly fidelity:
    | "EXACT"
    | "CALIBRATED"
    | "DISCRETIONARY"
    | "UNRESOLVED"
    | null;
  readonly policy_action:
    | "OBSERVE"
    | "PAPER_ELIGIBLE"
    | "SHADOW_ONLY"
    | "NONE";
  readonly action: "OBSERVE" | "PAPER_ELIGIBLE" | "SHADOW_ONLY" | "NONE";
  readonly effective_action_reason: "PROMOTION_IDENTITY_MISMATCH" | null;
  readonly evaluated_at_epoch: number;
}

export interface StoredEntryEvaluationMember {
  readonly selection_id: string;
  readonly object_kind: "CANDIDATE" | "EVIDENCE" | "HANDLING";
  readonly object_id: string;
}

export interface StoredEntryParity {
  readonly parity_id: string;
  readonly batch_id: string;
  readonly setup_id: string;
  readonly producer_diagnostic_id: string;
  readonly selection_id: string;
  readonly parity_status: "MATCH" | "MISMATCH" | "NOT_PROVIDED";
  readonly mismatch_reason:
    | "CANDIDATE_KEYS"
    | "EVIDENCE_DESCRIPTORS"
    | "HANDLING_DESCRIPTORS"
    | "SELECTED_CANDIDATE"
    | "REASON"
    | "FIDELITY"
    | "DIAGNOSTIC_ACTION"
    | "MULTIPLE"
    | null;
  readonly compared_at: string;
}

export interface StoredEntrySourceClaim {
  readonly claim_id: string;
  readonly contract_version: "2.0.0";
  readonly source_id: string;
  readonly youtube_video_id: string;
  readonly published_date: string;
  readonly title_snapshot: string;
  readonly channel_id: "UC54xbL96tU58iez3YbTVTAg";
  readonly channel_handle: "@RD_Forex";
  readonly timestamp_start_seconds: number;
  readonly timestamp_end_seconds: number;
  readonly relationship: "SUPPORTS" | "NARROWS" | "SUPERSEDES";
  readonly summary: string;
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
  readonly setup_id?: string | null;
  readonly selected_entry_model?: "BOC" | "DIR_CLOSE" | "HTF_FLIP" | null;
  readonly co_triggered_models_json?: string;
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
  readonly RD_ENTRY_PAPER_ACCOUNT_IDS?: string;
  readonly RD_ENTRY_PAPER_RISK_BPS?: string;
  readonly RD_ENTRY_V3_DETECTOR_CODE_HASH?: string;
  readonly RD_ENTRY_V3_SETTINGS_HASH?: string;
  readonly RD_ENTRY_V3_SETTINGS_HASHES_JSON?: string;
  readonly RD_ENTRY_PROMOTION_PINE_SHA256?: string;
  readonly RD_ENTRY_PROMOTION_REPORT_SHA256?: string;
  readonly RD_ENTRY_PROMOTION_SOURCE_COMMIT?: string;
  readonly TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256?: string;
  readonly TRADINGVIEW_PAPER_AUTOMATION_CREDENTIAL_SHA256?: string;
  readonly TRADINGVIEW_OBSERVATION_INGRESS_ENABLED?: string;
  readonly TRADINGVIEW_OBSERVATION_MAX_BODY_BYTES?: string;
}
