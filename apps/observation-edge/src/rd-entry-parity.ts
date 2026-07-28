import type {
  EntryEvaluation,
  EntrySelection,
} from "./rd-entry-domain";
import type {
  ProducerCandidateReference,
  ProducerDiagnostic,
  ProducerEvidenceReference,
} from "./rd-entry-wire";
import { canonicalStringify } from "./validation";

export type ParityStatus = "MATCH" | "MISMATCH" | "NOT_PROVIDED";
export type ParityMismatchReason =
  | "CANDIDATE_KEYS"
  | "EVIDENCE_DESCRIPTORS"
  | "HANDLING_DESCRIPTORS"
  | "SELECTED_CANDIDATE"
  | "REASON"
  | "FIDELITY"
  | "DIAGNOSTIC_ACTION"
  | "MULTIPLE";

export interface EntryParityResult {
  readonly status: ParityStatus;
  readonly mismatchReason: ParityMismatchReason | null;
}

function producerCandidateKey(value: ProducerCandidateReference): string {
  return [
    value.model,
    value.event_anchor_epoch,
    value.trigger_ordinal,
  ].join(":");
}

function backendCandidateKey(
  value: EntryEvaluation["candidates"][number],
): string {
  return [value.model, value.event_anchor_epoch, value.trigger_ordinal].join(
    ":",
  );
}

function backendCandidateDescriptor(
  value: EntryEvaluation["candidates"][number],
): string {
  return canonicalStringify({
    key: backendCandidateKey(value),
    normalized_from: value.normalized_from,
    source_claim_ids: value.source_claim_ids,
    state: value.state,
  });
}

function producerCandidateDescriptor(
  value: ProducerCandidateReference,
): string {
  return canonicalStringify({
    key: producerCandidateKey(value),
    normalized_from: value.normalized_from,
    source_claim_ids: value.source_claim_ids,
    state: value.state,
  });
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\n") === [...right].sort().join("\n");
}

function backendEvidenceDescriptor(
  item: EntryEvaluation["evidence"][number],
  backend: EntryEvaluation,
): string {
  const candidate = backend.candidates.find(
    (value) => value.candidate_id === item.candidate_id,
  );
  if (candidate === undefined) throw new TypeError("orphan backend evidence");
  return [
    backendCandidateKey(candidate),
    item.proof_plane,
    item.proof_resolution_seconds,
    item.coverage_start_epoch,
    item.coverage_end_epoch,
    item.observed_trigger_epoch,
    item.observed_trigger_ticks,
    item.htf_context_minutes.join(","),
    item.fidelity,
    item.ambiguity_codes.join(","),
    item.passed_rule_ids.join(","),
    item.failed_rule_ids.join(","),
    item.source_claim_ids.join(","),
  ].join(":");
}

function producerEvidenceDescriptor(
  item: ProducerEvidenceReference,
): string {
  return [
    producerCandidateKey(item.candidate),
    item.proof_plane,
    item.proof_resolution_seconds,
    item.coverage_start_epoch,
    item.coverage_end_epoch,
    item.observed_trigger_epoch,
    item.observed_trigger_ticks,
    item.htf_context_minutes.join(","),
    item.fidelity,
    item.ambiguity_codes.join(","),
    item.passed_rule_ids.join(","),
    item.failed_rule_ids.join(","),
    item.source_claim_ids.join(","),
  ].join(":");
}

export function compareProducerDiagnostic(
  backend: EntryEvaluation,
  producer: ProducerDiagnostic,
): EntryParityResult {
  const failures: ParityMismatchReason[] = [];
  if (
    !sameKeys(
      backend.candidates.map(backendCandidateDescriptor),
      producer.candidates.map(producerCandidateDescriptor),
    )
  ) {
    failures.push("CANDIDATE_KEYS");
  }
  if (
    !sameKeys(
      backend.evidence.map((item) =>
        backendEvidenceDescriptor(item, backend),
      ),
      producer.evidence.map(producerEvidenceDescriptor),
    )
  ) {
    failures.push("EVIDENCE_DESCRIPTORS");
  }
  if (
    !sameKeys(
      backend.handling.map((item) => {
        const candidate = backend.candidates.find(
          (value) => value.candidate_id === item.candidate_id,
        );
        const evidence = backend.evidence.find(
          (value) => value.evidence_id === item.evidence_id,
        );
        if (candidate === undefined || evidence === undefined) {
          throw new TypeError("orphan backend handling");
        }
        return [
          backendCandidateKey(candidate),
          item.handling_mode,
          item.attempt_kind,
          item.observed_epoch,
          item.observed_ticks,
          backendEvidenceDescriptor(evidence, backend),
          item.fidelity,
          item.source_claim_ids.join(","),
        ].join(":");
      }),
      producer.handling.map((item) =>
        [
          producerCandidateKey(item.candidate),
          item.handling_mode,
          item.attempt_kind,
          item.observed_epoch,
          item.observed_ticks,
          producerEvidenceDescriptor(item.evidence),
          item.fidelity,
          item.source_claim_ids.join(","),
        ].join(":"),
      ),
    )
  ) {
    failures.push("HANDLING_DESCRIPTORS");
  }
  if (producer.selection === null) {
    return failures.length === 0
      ? { status: "NOT_PROVIDED", mismatchReason: null }
      : {
          status: "MISMATCH",
          mismatchReason: failures.length === 1 ? failures[0]! : "MULTIPLE",
        };
  }
  const canonical = backend.candidates.find(
    (item) =>
      item.candidate_id === backend.selection.canonical_candidate_id,
  );
  if (
    (canonical === undefined ? null : backendCandidateKey(canonical)) !==
    producer.selection.semantic_key
  ) {
    failures.push("SELECTED_CANDIDATE");
  }
  if (backend.selection.reason !== producer.selection.reason) {
    failures.push("REASON");
  }
  if (backend.selection.fidelity !== producer.selection.fidelity) {
    failures.push("FIDELITY");
  }
  const expectedDiagnosticAction =
    backend.selection.action === "NONE" ? "NONE" : "SHADOW_ONLY";
  if (producer.selection.action !== expectedDiagnosticAction) {
    failures.push("DIAGNOSTIC_ACTION");
  }
  return failures.length === 0
    ? { status: "MATCH", mismatchReason: null }
    : {
        status: "MISMATCH",
        mismatchReason: failures.length === 1 ? failures[0]! : "MULTIPLE",
      };
}

export type EffectiveEntrySelection = EntrySelection & {
  readonly policy_action: EntrySelection["action"];
  readonly effective_action_reason: "PROMOTION_IDENTITY_MISMATCH" | null;
};

export function effectiveSelection(
  policy: EntrySelection,
  parity: EntryParityResult,
  canonicalPaperEnabled: boolean,
  promotionIdentityMismatch: boolean,
): EffectiveEntrySelection {
  return {
    ...policy,
    policy_action: policy.action,
    effective_action_reason:
      promotionIdentityMismatch && policy.action === "PAPER_ELIGIBLE"
        ? "PROMOTION_IDENTITY_MISMATCH"
        : null,
    action:
      parity.status === "MATCH" &&
      canonicalPaperEnabled &&
      !promotionIdentityMismatch
        ? policy.action
        : policy.action === "NONE"
          ? "NONE"
          : "SHADOW_ONLY",
  };
}
