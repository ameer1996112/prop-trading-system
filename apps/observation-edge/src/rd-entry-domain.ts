import type { CanonicalValue } from "./types";
import { canonicalStringify } from "./validation";

export const ACTIVE_ENTRY_MODELS = ["DIR_CLOSE", "HTF_FLIP"] as const;
export const ALL_ENTRY_MODELS = [
  ...ACTIVE_ENTRY_MODELS,
  "LEGACY_BREAK_CANDLE",
  "LEGACY_REJECTION_RESPECT",
] as const;
export const HTF_CONTEXT_MINUTES = [15, 30, 60] as const;
export const SELECTION_ACTIONS = [
  "OBSERVE",
  "PAPER_ELIGIBLE",
  "SHADOW_ONLY",
  "NONE",
] as const;

export type EntryDirection = "LONG" | "SHORT";
export type EntryModelV2 = (typeof ALL_ENTRY_MODELS)[number];
export type CandidateState = "MATCHED" | "BLOCKED" | "REJECTED" | "NORMALIZED";
export type CandidateFidelity =
  | "EXACT"
  | "CALIBRATED"
  | "DISCRETIONARY"
  | "UNRESOLVED";
export type ProofPlane =
  | "CONFIRMED_5M"
  | "LOWER_TIMEFRAME_REPLAY"
  | "REALTIME_TICK"
  | "EXTERNAL_ARCHIVED_TICK";
export type HandlingMode =
  | "CLOSE_CONFIRMATION"
  | "INTRABAR_FLIP"
  | "NEXT_CANDLE_WICK"
  | "AGGRESSIVE";
export type AttemptKind = "INITIAL" | "RE_ENTRY";
export type SetupAttemptTerminalReason =
  | "INVALIDATED"
  | "BOTH_ACTIVE_MODELS_OBSERVED"
  | "RETENTION_EVICTED";
export type SelectionAction = (typeof SELECTION_ACTIONS)[number];
export type SelectionReason =
  | "ONLY_EXACT_TRIGGER"
  | "EARLIEST_EXACT_TRIGGER"
  | "FALLBACK_TO_CONFIRMED_CLOSE"
  | "NO_EXACT_CANDIDATE"
  | "UNRESOLVED_SOURCE_PRIORITY"
  | "SETUP_INVALIDATED"
  | "NO_CANDIDATE";
export type AmbiguityCode =
  | "SHADOW_SAME_CHILD_BAR_ORDER"
  | "SHADOW_MISSING_INTRABAR_COVERAGE"
  | "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE";

export interface OrderedCandle {
  readonly open_epoch: number;
  readonly close_epoch: number;
  readonly open_ticks: number;
  readonly high_ticks: number;
  readonly low_ticks: number;
  readonly close_ticks: number;
}

export interface SetupEntryFacts {
  readonly setup_id: string;
  readonly direction: EntryDirection;
  readonly zone_top_ticks: number;
  readonly zone_bottom_ticks: number;
  readonly zone_engaged_epoch: number | null;
  readonly invalidated_before_entry: boolean;
  readonly common_fidelity: CandidateFidelity;
  readonly terminal_reason: SetupAttemptTerminalReason | null;
  readonly terminal_epoch: number | null;
}

export interface HTFFlipProofTranscript {
  readonly context_minutes: 15 | 30 | 60;
  readonly htf_open_epoch: number;
  readonly htf_open_ticks: number;
  readonly scan_cutoff_epoch: number;
  readonly proof_resolution_seconds: number;
  readonly coverage_start_epoch: number;
  readonly coverage_end_epoch: number;
  readonly expected_child_count: number;
  readonly observed_child_count: number;
  readonly gap_present: boolean;
  readonly full_lifecycle_ordered: boolean;
  readonly destination_seen_before_contact: boolean;
  readonly contact_candle: OrderedCandle | null;
  readonly recross_candle: OrderedCandle | null;
  readonly same_child: boolean;
}

export interface HTFFlipProof {
  readonly matched: boolean;
  readonly event_anchor_epoch: number;
  readonly trigger_epoch: number | null;
  readonly trigger_ticks: number | null;
  readonly htf_context_minutes: readonly (15 | 30 | 60)[];
  readonly fidelity: CandidateFidelity;
  readonly proof_plane: ProofPlane;
  readonly proof_resolution_seconds: number;
  readonly coverage_start_epoch: number;
  readonly coverage_end_epoch: number;
  readonly coverage_expected_child_count: number;
  readonly coverage_observed_child_count: number;
  readonly coverage_gap_detected: boolean;
  readonly contact_child: OrderedCandle | null;
  readonly recross_child: OrderedCandle | null;
  readonly destination_seen_before_contact: boolean;
  readonly ambiguity_codes: readonly AmbiguityCode[];
  readonly transcript_sha256: string;
  readonly full_lifecycle_ordered: boolean;
  readonly transcript: HTFFlipProofTranscript;
}

export interface EntryMatchRequest {
  readonly setup: SetupEntryFacts;
  readonly confirmed_bar: OrderedCandle;
  readonly htf_proofs: readonly HTFFlipProof[];
  readonly generic_break_detected: boolean;
  readonly rejection_respect_detected: boolean;
  readonly attempt_kind: AttemptKind;
  readonly trigger_ordinal: number;
}

export interface EntryCandidate {
  readonly candidate_id: string;
  readonly setup_id: string;
  readonly model: EntryModelV2;
  readonly state: CandidateState;
  readonly event_anchor_epoch: number;
  readonly trigger_ordinal: number;
  readonly direction: EntryDirection;
  readonly source_claim_ids: readonly string[];
  readonly normalized_from: EntryModelV2 | null;
  readonly observed_at_epoch: number;
}

export interface EntryCandidateEvidence {
  readonly evidence_id: string;
  readonly candidate_id: string;
  readonly observed_trigger_epoch: number | null;
  readonly observed_trigger_ticks: number | null;
  readonly htf_context_minutes: readonly (15 | 30 | 60)[];
  readonly fidelity: CandidateFidelity;
  readonly proof_plane: ProofPlane;
  readonly proof_resolution_seconds: number;
  readonly coverage_start_epoch: number;
  readonly coverage_end_epoch: number;
  readonly ambiguity_codes: readonly AmbiguityCode[];
  readonly passed_rule_ids: readonly string[];
  readonly failed_rule_ids: readonly string[];
  readonly source_claim_ids: readonly string[];
  readonly payload_sha256: string;
  readonly observed_at_epoch: number;
}

export interface EntryHandlingObservation {
  readonly handling_id: string;
  readonly candidate_id: string;
  readonly evidence_id: string;
  readonly handling_mode: HandlingMode;
  readonly attempt_kind: AttemptKind;
  readonly observed_epoch: number;
  readonly observed_ticks: number | null;
  readonly fidelity: CandidateFidelity;
  readonly source_claim_ids: readonly string[];
}

export interface EntrySelection {
  readonly selection_id: string;
  readonly setup_id: string;
  readonly policy_version: "rd-entry-arbitration-v2";
  readonly revision: number;
  readonly candidate_ids_considered: readonly string[];
  readonly canonical_candidate_id: string | null;
  readonly canonical_evidence_id: string | null;
  readonly canonical_model: EntryModelV2 | null;
  readonly reason: SelectionReason;
  readonly fidelity: CandidateFidelity | null;
  readonly action: SelectionAction;
  readonly evaluated_at_epoch: number;
}

export interface EntryEvaluation {
  readonly candidates: readonly EntryCandidate[];
  readonly evidence: readonly EntryCandidateEvidence[];
  readonly handling: readonly EntryHandlingObservation[];
  readonly selection: EntrySelection;
}

type CanonicalJsonScalar = null | boolean | number | string;

export type CanonicalJsonShape<T> = T extends CanonicalJsonScalar
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends readonly (infer Item)[]
      ? readonly CanonicalJsonShape<Item>[]
      : T extends object
        ? { readonly [Key in keyof T]: CanonicalJsonShape<T[Key]> }
        : never;

export type CanonicalJsonInput<T> = T extends CanonicalJsonShape<T> ? T : never;

export class RdEntryCanonicalizationError extends TypeError {
  constructor() {
    super("RD entry value is not canonical JSON");
    this.name = "RdEntryCanonicalizationError";
  }
}

function canonicalizationError(): never {
  throw new RdEntryCanonicalizationError();
}

function projectCanonicalValue(
  value: unknown,
  ancestors: Set<object>,
): CanonicalValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : canonicalizationError();
  }
  if (typeof value !== "object") {
    return canonicalizationError();
  }
  if (ancestors.has(value)) {
    return canonicalizationError();
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        Object.getOwnPropertySymbols(value).length !== 0
      ) {
        return canonicalizationError();
      }

      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        lengthDescriptor === undefined ||
        !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0
      ) {
        return canonicalizationError();
      }
      const length = lengthDescriptor.value as number;
      if (Object.getOwnPropertyNames(value).length !== length + 1) {
        return canonicalizationError();
      }

      const projected: CanonicalValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        ) {
          return canonicalizationError();
        }
        projected.push(projectCanonicalValue(descriptor.value, ancestors));
      }
      return projected;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Object.getOwnPropertySymbols(value).length !== 0
    ) {
      return canonicalizationError();
    }

    const projected: Record<string, CanonicalValue> = Object.create(null) as
      Record<string, CanonicalValue>;
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (!descriptor.enumerable || !("value" in descriptor)) {
        return canonicalizationError();
      }
      projected[key] = projectCanonicalValue(descriptor.value, ancestors);
    }
    return projected;
  } finally {
    ancestors.delete(value);
  }
}

export function rdEntryCanonicalValue<const T>(
  value: CanonicalJsonInput<T>,
): CanonicalValue {
  return projectCanonicalValue(value, new Set<object>());
}

export function canonicalStringifyRdEntry<const T>(
  value: CanonicalJsonInput<T>,
): string {
  return canonicalStringify(projectCanonicalValue(value, new Set<object>()));
}
