export interface RdEntryPromotionBinding {
  readonly report_sha256: string;
  readonly source_commit: string;
  readonly pine_artifact_sha256: string;
  readonly rule_contract_version: string;
  readonly producer_strategy_version: string;
  readonly detector_code_hash: string;
  readonly settings_hash: string;
  readonly build_metadata_digest: string;
}

export const RD_ENTRY_PROMOTION_BINDING: RdEntryPromotionBinding | null = null;
