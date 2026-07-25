# RD Entry Edge and Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dual-version RD entry ingestion to the Cloudflare observation edge, persist every immutable candidate/evidence/handling fact plus revisioned canonical selections in D1, and expose the audit trail in the operations console.

**Architecture:** The existing schema `1.0`, `1.1`, and `1.2` branches and
routes remain frozen. A schema `2.0` branch expands compact Pine facts,
independently mirrors the Python matcher/arbitrator against
`contracts/vectors/rd-entry-arbitration-v2.json`, assembles deterministic
chunks, and writes normalized append-only D1 projections only after a batch is
complete. Parity matches and mismatches are both retained as audit facts, with
non-matches forced to shadow. One nested read projection feeds a strict
fail-closed React panel; no v2 result is converted into an existing paper
command.

**Tech Stack:** Cloudflare Workers, D1/SQLite STRICT tables, TypeScript 5.9, Web Crypto SHA-256, Vitest 4, Next.js 16, React 19, Testing Library

## Global Constraints

- Strategy scope is RD Forex/RD Concepts 5-minute behavior only.
- Official source channel is exactly `@RD_Forex`, channel ID `UC54xbL96tU58iez3YbTVTAg`.
- Active entry models are exactly `DIR_CLOSE` and `HTF_FLIP`.
- Legacy models are exactly `LEGACY_BREAK_CANDLE` and `LEGACY_REJECTION_RESPECT`.
- First touch emits `ZONE_ENGAGED`, never an entry.
- One semantic candidate is recorded per model per setup attempt; matching
  continues after the first model so another model can still be captured.
- Re-entry is `attempt_kind = RE_ENTRY`, not a trigger model.
- `setup_id` is attempt-scoped. An initial attempt has
  `attempt_kind=INITIAL,trigger_ordinal=1`; an isolated re-entry has a new setup
  attempt ID, `attempt_kind=RE_ENTRY,trigger_ordinal>=2`, and never coexists in
  the same event stream as the initial attempt.
- One flip may retain contexts `15`, `30`, and `60` without a timeframe priority.
- Only complete replayable `EXACT` evidence may be `PAPER_ELIGIBLE`.
- Realtime-only, missing-coverage, same-child-order, calibrated, discretionary, and unresolved evidence is shadow-only.
- The exact earlier `HTF_FLIP` wins; an exact `DIR_CLOSE` is labeled fallback
  only when non-realtime, replay-observed non-exact flip evidence was observed
  strictly earlier; ambiguity-coded evidence can establish that timing without
  becoming exact-eligible.
- New rule contract is exactly `2.0.0`.
- New observation schema is exactly `2.0`.
- New producer strategy version is exactly `2.0.0-contract2`.
- Policy version is exactly `rd-entry-arbitration-v2`.
- A Pine alert envelope is strictly less than `35,000` characters.
- `chunk_count` is `1..12`. Pine fails closed instead of emitting a
  thirteenth chunk; this leaves a safety margin below TradingView's alert
  auto-stop threshold.
- A completed batch or snapshot contains at most `256` setup bundles.
- One setup contains at most `4` candidate references.
- One candidate contains at most `4` evidence references and one setup contains
  at most `16` evidence references.
- One setup contains at most `4` handling references.
- Pine schema `2.0` emits `attempt_kind = INITIAL` only.
- Schema `2.0` batch `kind` is exactly lowercase `snapshot|incremental`;
  snapshots carry all retained active/engaged setup bundles and incrementals
  carry changed bundles or an empty confirmed-bar heartbeat.
- Every `f.x` transcript belongs to exactly one `f.b` bar emitted in the same
  setup bundle. Pine omits a previously emitted transcript after its cutoff
  rolls outside the bounded `f.b` window; the edge reuses the immutable event
  it already stored and never synthesizes a 5-minute event from `f.x` alone.
- Consume `contracts/vectors/rd-entry-arbitration-v2.json`; do not duplicate or edit its expected results in this plan.
- Preserve schema `1.0`, `1.1`, and `1.2` request validation and receipt behavior.
- Preserve `POST /api/v1/tradingview/observations`, `GET /api/v1/observation-receipts`, and `GET /api/v1/observation-setup-evidence`.
- Authenticated strict schema `2.0` is accepted under the existing observation-ingress gate for shadow collection.
- Effective `PAPER_ELIGIBLE` is guarded by
  `canonicalPaperSelectionConfigured(env, identity)`: the reviewed generated
  binding must be non-null; the flag and three evidence environment values must
  exactly match it; live Cloudflare Version Metadata must match its build tag;
  and the current batch detector/settings identity must equal the approved
  hashes. The deployed flag defaults to `"false"`, the environment evidence
  values are absent, and the generated binding is `null`.
- The FastAPI/PostgreSQL ingress remains v1-only and is outside this plan.
- Real execution remains prohibited; no v2 type, SQL enum, route, or UI action may express a broker command.
- Do not route schema `2.0` through `PaperAutomationCommand`, `appendAutomatedObservation()`, or any paper-intent insert.
- Store validated credential-free chunk JSON only; never store the envelope credential or unvalidated request body.
- All identity hashes use lowercase canonical JSON plus SHA-256.
- Candidate, evidence, handling, completion, selection, source-claim, parity-failure, and quarantine rows are immutable.
- Every implementation task ends with its targeted tests passing and a commit.

---

### Task 1: Freeze the TypeScript v2 domain surface and feature gate

**Files:**
- Create: `apps/observation-edge/src/rd-entry-domain.ts`
- Create: `apps/observation-edge/src/generated/rd-entry-promotion-binding.ts`
- Create: `apps/observation-edge/test/rd-entry-domain.test.ts`
- Modify: `apps/observation-edge/src/types.ts:1`
- Modify: `apps/observation-edge/src/types.ts:421`
- Modify: `apps/observation-edge/src/index.ts:98`
- Modify: `apps/observation-edge/src/index.ts:2700`
- Modify: `apps/observation-edge/wrangler.jsonc:23`
- Modify: `apps/observation-edge/test/worker.test.ts:427`

**Interfaces:**
- Consumes: `CanonicalValue` and `canonicalStringify()` from the existing edge.
- Produces: the exact v2 TypeScript unions and interfaces used by validation, matcher, storage, API, and console translation.
- Produces:
  `canonicalPaperSelectionConfigured(env: Env, identity: EntryCodeIdentity):
  boolean`.
- Produces: a generated, source-controlled promotion binding whose shadow value
  is exactly `null`; arbitrary environment hashes can never authorize a
  detector/settings identity that was not committed.

- [ ] **Step 1: Write the failing closed-enum and feature-gate tests**

Create `apps/observation-edge/test/rd-entry-domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  ACTIVE_ENTRY_MODELS,
  ALL_ENTRY_MODELS,
  HTF_CONTEXT_MINUTES,
  SELECTION_ACTIONS,
} from "../src/rd-entry-domain";
import { handleRequest } from "../src/index";
import type { Env } from "../src/types";

describe("RD entry v2 closed domain", () => {
  it("freezes models, HTF contexts, and non-executable actions", () => {
    expect(ACTIVE_ENTRY_MODELS).toEqual(["DIR_CLOSE", "HTF_FLIP"]);
    expect(ALL_ENTRY_MODELS).toEqual([
      "DIR_CLOSE",
      "HTF_FLIP",
      "LEGACY_BREAK_CANDLE",
      "LEGACY_REJECTION_RESPECT",
    ]);
    expect(HTF_CONTEXT_MINUTES).toEqual([15, 30, 60]);
    expect(SELECTION_ACTIONS).toEqual([
      "OBSERVE",
      "PAPER_ELIGIBLE",
      "SHADOW_ONLY",
      "NONE",
    ]);
    expect(SELECTION_ACTIONS.join(" ")).not.toMatch(/EXECUTE|BROKER|ORDER/u);
  });

  it("reports canonical paper disabled when its flag is absent", async () => {
    const response = await handleRequest(
      new Request("https://edge.example/health/live"),
      { DB: {} as D1Database } as Env,
    );
    expect(await response.json()).toMatchObject({
      canonical_paper: "DISABLED",
    });
  });

  it("keeps canonical paper disabled until all committed promotion evidence is bound", async () => {
    const env = {
      DB: {} as D1Database,
      RD_ENTRY_CANONICAL_PAPER_ENABLED: "true",
    } as Env;
    const response = await handleRequest(
      new Request("https://edge.example/health/live"),
      env,
    );
    expect(await response.json()).toMatchObject({
      canonical_paper: "DISABLED",
    });
  });

  it("does not enable canonical paper from arbitrary well-formed bindings", async () => {
    const env = {
      DB: {} as D1Database,
      RD_ENTRY_CANONICAL_PAPER_ENABLED: "true",
      RD_ENTRY_PROMOTION_REPORT_SHA256: "a".repeat(64),
      RD_ENTRY_PROMOTION_SOURCE_COMMIT: "b".repeat(40),
      RD_ENTRY_PROMOTION_PINE_SHA256: "c".repeat(64),
    } as Env;
    const response = await handleRequest(
      new Request("https://edge.example/health/live"),
      env,
    );
    expect(await response.json()).toMatchObject({
      canonical_paper: "DISABLED",
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
cd apps/observation-edge
npx vitest run test/rd-entry-domain.test.ts
```

Expected: FAIL because `../src/rd-entry-domain` does not exist and health has no
`canonical_paper`.

- [ ] **Step 3: Create the exact domain types**

Create `apps/observation-edge/src/rd-entry-domain.ts` with these exported constants and types:

```ts
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
```

- [ ] **Step 4: Extend environment typing and add the fail-closed flag**

Create `apps/observation-edge/src/generated/rd-entry-promotion-binding.ts`
with the checked-in shadow value:

```ts
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
```

The rollout plan owns the deterministic generator that replaces `null` only in
a reviewed promotion commit. Do not hand-edit this file and do not accept a
runtime-provided replacement object.

Add to `Env` in `apps/observation-edge/src/types.ts`:

```ts
readonly RD_ENTRY_CANONICAL_PAPER_ENABLED?: string;
readonly RD_ENTRY_PROMOTION_REPORT_SHA256?: string;
readonly RD_ENTRY_PROMOTION_SOURCE_COMMIT?: string;
readonly RD_ENTRY_PROMOTION_PINE_SHA256?: string;
readonly CF_VERSION_METADATA?: {
  readonly id: string;
  readonly tag: string;
  readonly timestamp: string;
};
```

Add to `apps/observation-edge/src/index.ts`:

```ts
import { RD_ENTRY_PROMOTION_BINDING } from
  "./generated/rd-entry-promotion-binding";

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const GIT_COMMIT_HEX = /^[0-9a-f]{40}$/u;

export interface EntryCodeIdentity {
  readonly rule_contract_version: string;
  readonly strategy_version: string;
  readonly detector_code_hash: string;
  readonly settings_hash: string;
}

function canonicalPaperSelectionConfigured(
  env: Env,
  identity: EntryCodeIdentity,
): boolean {
  const approved = RD_ENTRY_PROMOTION_BINDING;
  return (
    approved !== null &&
    env.RD_ENTRY_CANONICAL_PAPER_ENABLED === "true" &&
    SHA256_HEX.test(approved.report_sha256) &&
    GIT_COMMIT_HEX.test(approved.source_commit) &&
    SHA256_HEX.test(approved.pine_artifact_sha256) &&
    approved.rule_contract_version.length > 0 &&
    approved.producer_strategy_version.length > 0 &&
    SHA256_HEX.test(approved.detector_code_hash) &&
    SHA256_HEX.test(approved.settings_hash) &&
    SHA256_HEX.test(approved.build_metadata_digest) &&
    env.RD_ENTRY_PROMOTION_REPORT_SHA256 === approved.report_sha256 &&
    env.RD_ENTRY_PROMOTION_SOURCE_COMMIT === approved.source_commit &&
    env.RD_ENTRY_PROMOTION_PINE_SHA256 === approved.pine_artifact_sha256 &&
    env.CF_VERSION_METADATA?.tag === approved.build_metadata_digest &&
    identity.rule_contract_version === approved.rule_contract_version &&
    identity.strategy_version ===
      approved.producer_strategy_version &&
    identity.detector_code_hash === approved.detector_code_hash &&
    identity.settings_hash === approved.settings_hash
  );
}
```

`/health/live` has no receipt identity to authorize and therefore reports the
deployment binding state separately:

```ts
canonical_paper:
  RD_ENTRY_PROMOTION_BINDING !== null &&
  env.RD_ENTRY_CANONICAL_PAPER_ENABLED === "true" &&
  env.CF_VERSION_METADATA?.tag ===
    RD_ENTRY_PROMOTION_BINDING.build_metadata_digest
    ? "ARMED_IDENTITY_REQUIRED"
    : "DISABLED",
deployment_version: {
  id: env.CF_VERSION_METADATA?.id ?? null,
  tag: env.CF_VERSION_METADATA?.tag ?? null,
},
```

Add the deployed default to `apps/observation-edge/wrangler.jsonc`:

```json
{
  "RD_ENTRY_CANONICAL_PAPER_ENABLED": "false"
}
```

Configure the Workers version metadata binding as `CF_VERSION_METADATA`. Do
not add placeholder values for
`RD_ENTRY_PROMOTION_REPORT_SHA256`, `RD_ENTRY_PROMOTION_SOURCE_COMMIT`, or
`RD_ENTRY_PROMOTION_PINE_SHA256`; their absence is part of the default
fail-closed state. Add table-driven tests proving that uppercase, wrong-length,
non-hex, individually missing, well-formed-but-different, wrong version tag,
wrong contract/producer version, wrong detector hash, or wrong settings hash all
remain disabled. In a test-only generated binding fixture, prove the exact
eight committed constants plus exact environment values, version tag, and
batch identity are required. Also prove a
request accepted before a deployment change cannot become eligible when its
stored contract/producer/detector/settings identity differs from the new
embedded binding.

Update the existing liveness expectations in `worker.test.ts` to include
`canonical_paper: "DISABLED"` and a strict credential-free
`deployment_version` object. In deployed and canary reads both fields must be
nonempty; local tests may use explicit nulls.

- [ ] **Step 5: Run tests and typecheck for GREEN**

Run:

```bash
cd apps/observation-edge
npx vitest run test/rd-entry-domain.test.ts test/worker.test.ts
npm run typecheck
```

Expected: both Vitest files pass and TypeScript reports no errors.

- [ ] **Step 6: Commit the closed domain and feature gate**

```bash
git add apps/observation-edge/src/rd-entry-domain.ts \
  apps/observation-edge/src/generated/rd-entry-promotion-binding.ts \
  apps/observation-edge/src/types.ts \
  apps/observation-edge/src/index.ts \
  apps/observation-edge/wrangler.jsonc \
  apps/observation-edge/test/rd-entry-domain.test.ts \
  apps/observation-edge/test/worker.test.ts
git commit -m "feat: define feature-gated RD entry v2 edge domain"
```

---

### Task 2: Mirror the Python matcher and arbitration vectors in TypeScript

**Files:**
- Create: `apps/observation-edge/src/rd-entry-policy.ts`
- Create: `apps/observation-edge/src/rd-entry-source-catalog.ts`
- Create: `apps/observation-edge/src/rd-entry-matcher.ts`
- Create: `apps/observation-edge/src/rd-entry-arbitrator.ts`
- Create: `scripts/build_rd_entry_edge_catalog.py`
- Create: `apps/observation-edge/test/rd-entry-parity.test.ts`
- Consume: `contracts/vectors/rd-entry-arbitration-v2.json`

**Interfaces:**
- Consumes: `EntryMatchRequest` and domain result types from Task 1.
- Produces: `evaluateEntryMatch(request) -> Promise<EntryMatchResult>`.
- Produces: `arbitrateEntryCandidates(request) -> Promise<EntrySelection>`.
- Produces:
  `evaluateEntryStream(events, setupInvalidated, revision, evaluatedAtEpoch)
  -> Promise<EntryEvaluation>`.

- [ ] **Step 1: Write the failing vector parity harness**

Create `apps/observation-edge/test/rd-entry-parity.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { evaluateEntryStream } from "../src/rd-entry-arbitrator";
import type {
  EntryEvaluation,
  EntryMatchRequest,
  HTFFlipProofTranscript,
} from "../src/rd-entry-domain";
import { SOURCE_CLAIMS } from "../src/rd-entry-policy";

interface OracleVectorCase {
  readonly case_id: string;
  readonly setup_id: string;
  readonly symbol: string;
  readonly feed: string;
  readonly calculation_start_epoch: number;
  readonly emission_start_epoch: number;
  readonly emission_end_epoch: number;
  readonly pine_supported: boolean;
  readonly edge_input: {
    readonly setup_id: string;
    readonly events: readonly {
      readonly event_id: string;
      readonly match_request: EntryMatchRequest;
    }[];
    readonly setup_invalidated: boolean;
    readonly policy_version: "rd-entry-arbitration-v2";
    readonly revision: number;
    readonly evaluated_at_epoch: number;
  };
  readonly pine_edge_input: OracleVectorCase["edge_input"];
  readonly expected: EntryEvaluation & {
    readonly htf_transcripts: readonly HTFFlipProofTranscript[];
  };
  readonly pine_expected: OracleVectorCase["expected"];
}

const document = JSON.parse(
  readFileSync(
    new URL(
      "../../../contracts/vectors/rd-entry-arbitration-v2.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { readonly schema_version: "2.0"; readonly cases: readonly OracleVectorCase[] };

function finalTranscripts(
  events: OracleVectorCase["edge_input"]["events"],
): readonly HTFFlipProofTranscript[] {
  const latest = new Map<number, HTFFlipProofTranscript>();
  const ordered = [...events].sort(
    (left, right) =>
      left.match_request.confirmed_bar.close_epoch -
        right.match_request.confirmed_bar.close_epoch ||
      left.event_id.localeCompare(right.event_id),
  );
  for (const event of ordered) {
    for (const proof of event.match_request.htf_proofs) {
      const transcript = proof.transcript;
      const previous = latest.get(transcript.context_minutes);
      if (previous !== undefined) {
        const previousKey = [
          previous.htf_open_epoch,
          previous.scan_cutoff_epoch,
        ] as const;
        const nextKey = [
          transcript.htf_open_epoch,
          transcript.scan_cutoff_epoch,
        ] as const;
        const comparison =
          nextKey[0] - previousKey[0] || nextKey[1] - previousKey[1];
        if (comparison < 0) throw new TypeError("HTF transcript moved backward");
        if (
          comparison === 0 &&
          JSON.stringify(previous) !== JSON.stringify(transcript)
        ) {
          throw new TypeError("HTF transcript conflicts at one boundary");
        }
      }
      latest.set(transcript.context_minutes, transcript);
    }
  }
  return [...latest.values()].sort(
    (left, right) => left.context_minutes - right.context_minutes,
  );
}

function containsRawChildren(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRawChildren);
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.hasOwn(record, "children") ||
    Object.hasOwn(record, "htf_scan_requests") ||
    Object.values(record).some(containsRawChildren)
  );
}

describe("RD entry TypeScript/Python parity", () => {
  it("contains the complete reviewed vector set", () => {
    expect(document.schema_version).toBe("2.0");
    expect(document.cases).toHaveLength(24);
  });

  for (const vector of document.cases) {
    it(vector.case_id, async () => {
      expect(containsRawChildren(vector.edge_input)).toBe(false);
      expect(containsRawChildren(vector.pine_edge_input)).toBe(false);
      expect(
        vector.pine_edge_input.events.every(
          (event) =>
            event.match_request.setup.common_fidelity === "UNRESOLVED",
        ),
      ).toBe(true);
      const { htf_transcripts, ...expectedEvaluation } = vector.expected;
      const actual = await evaluateEntryStream(
        vector.edge_input.events,
        vector.edge_input.setup_invalidated,
        vector.edge_input.revision,
        vector.edge_input.evaluated_at_epoch,
      );
      expect(actual).toEqual(expectedEvaluation);
      expect(finalTranscripts(vector.edge_input.events)).toEqual(
        htf_transcripts,
      );
    });
  }

  it("uses the exact source-claim tuples frozen by contract v2", () => {
    const contract = JSON.parse(
      readFileSync(
        new URL(
          "../../../config/phase0/rd-strategy-rule-contract-v2.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      readonly rules_by_id: Readonly<Record<
        string,
        { readonly source_claim_ids: readonly string[] }
      >>;
    };
    expect(SOURCE_CLAIMS.DIR_CLOSE).toEqual(
      contract.rules_by_id.ENTRY_DIR_CLOSE?.source_claim_ids,
    );
    expect(SOURCE_CLAIMS.HTF_FLIP).toEqual(
      contract.rules_by_id.ENTRY_HTF_FLIP?.source_claim_ids,
    );
    expect(SOURCE_CLAIMS.LEGACY_BREAK_CANDLE).toEqual(
      contract.rules_by_id.ENTRY_BREAK_CANDLE_NORMALIZATION?.source_claim_ids,
    );
    expect(SOURCE_CLAIMS.LEGACY_REJECTION_RESPECT).toEqual(
      contract.rules_by_id.ENTRY_REJECTION_RESPECT_DISABLED?.source_claim_ids,
    );
    expect(SOURCE_CLAIMS.NEXT_CANDLE_WICK).toEqual(
      contract.rules_by_id.ENTRY_NEXT_CANDLE_WICK_HANDLING?.source_claim_ids,
    );
    expect(SOURCE_CLAIMS.HTF_BOUNDARY).toEqual(
      contract.rules_by_id.ENTRY_HTF_BOUNDARY_CAUTION?.source_claim_ids,
    );
  });
});
```

The prerequisite Plan 1 vector document must have exactly the root keys
`schema_version` and `cases`, `schema_version` must equal `"2.0"`, and `cases`
must contain exactly the 24 reviewed cases as `OracleVectorCase`. Reject an
event whose `match_request.setup.setup_id` differs from
`edge_input.setup_id`, an empty event
stream, or a `policy_version` other than `rd-entry-arbitration-v2`. Reconcile a
different producer shape in Plan 1 before implementing this consumer; never
silently translate a second vector contract. Assert recursively that
`edge_input` contains no `children` or `htf_scan_requests` key: the builder
must have replaced raw child arrays with bounded `htf_proofs`.
Treat `setup_id`, `symbol`, `feed`, `calculation_start_epoch`,
`emission_start_epoch`, `emission_end_epoch`, and `pine_supported` as strict
preserved replay metadata: require those exact fields and types, require the
top-level and `edge_input` setup IDs to agree, and reject an unknown or missing
metadata field. They are deliberately ignored by `evaluateEntryStream()` and
must survive JSON parsing unchanged so the edge parity harness does not erase
the Bar Replay contract that Plan 3 consumes. Add a metadata-only mutation test
proving the matcher result is unchanged, plus malformed-metadata tests proving
the harness fails before evaluation.

Require each case to contain both reviewed oracle views from Plan 1:
`edge_input`/`expected` and `pine_edge_input`/`pine_expected`.
`pine_edge_input` must differ from `edge_input` only at common-fidelity paths
that are replaced with `UNRESOLVED`; every Pine setup fact must be
`UNRESOLVED`. The TypeScript authority test evaluates only
`edge_input`/`expected`. It validates but otherwise ignores the Pine view, which
Plan 3 owns; it must never substitute `pine_expected` for an authoritative edge
expectation.

- [ ] **Step 2: Run parity and verify RED**

Run:

```bash
cd apps/observation-edge
npx vitest run test/rd-entry-parity.test.ts
```

Expected: FAIL because `rd-entry-arbitrator.ts` does not exist.

- [ ] **Step 3: Freeze server-owned source claims and hash helpers**

Create `apps/observation-edge/src/rd-entry-policy.ts`:

```ts
export const ENTRY_POLICY_VERSION = "rd-entry-arbitration-v2" as const;

export const SOURCE_CLAIMS = {
  DIR_CLOSE: [
    "standard-close-2024-03",
    "closure-or-flip-2025-03",
    "directional-close-2025-08",
    "directional-close-required-2026-06",
    "model-continuation-2026-07",
  ],
  HTF_FLIP: [
    "htf-flip-2024-03",
    "htf-context-set-2025-08",
    "htf-flip-definition-2025-08",
    "pure-flip-narrowing-2026-05",
    "model-continuation-2026-07",
  ],
  LEGACY_BREAK_CANDLE: [
    "gold-break-exception-2025-03",
    "discretionary-break-2025-11",
    "reject-non-htf-break-2026-05",
    "break-normalized-to-flip-2026-06",
  ],
  LEGACY_REJECTION_RESPECT: [
    "closure-or-flip-2025-03",
    "directional-close-2025-08",
    "directional-close-required-2026-06",
  ],
  NEXT_CANDLE_WICK: [
    "next-candle-wick-2025-05",
    "prompt-close-2025-05",
    "close-fallback-2025-11",
  ],
  HTF_BOUNDARY: ["htf-boundary-caution-2025-08"],
} as const;

function canonical(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (typeof value !== "object") {
    throw new TypeError("canonical JSON accepts JSON values only");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

export async function canonicalSha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
```

Generate the runtime source catalog from the reviewed contract instead of
copying video metadata into TypeScript. Create
`scripts/build_rd_entry_edge_catalog.py` with `--input`, `--output`, and
`--check`. It must:

1. parse the root object and require contract `2.0.0`;
2. join every sorted `claims_by_id` item to its `sources_by_id[source_id]`;
3. reject unknown source/target IDs and any channel other than the frozen
   official channel;
4. emit a TypeScript `SOURCE_CLAIM_CATALOG` array.

Implement the script completely:

```python
from __future__ import annotations

import argparse
import json
from pathlib import Path


def build(source: Path) -> str:
    root = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(root, dict) or root.get("contract_version") != "2.0.0":
        raise ValueError("expected RD contract 2.0.0")
    sources = root.get("sources_by_id")
    claims = root.get("claims_by_id")
    if not isinstance(sources, dict) or not isinstance(claims, dict):
        raise ValueError("source and claim maps are required")
    rows: list[dict[str, object]] = []
    for claim_id in sorted(claims):
        claim = claims[claim_id]
        if not isinstance(claim, dict):
            raise ValueError(f"invalid claim: {claim_id}")
        source_id = claim.get("source_id")
        source_record = sources.get(source_id) if isinstance(source_id, str) else None
        if not isinstance(source_record, dict):
            raise ValueError(f"unknown claim source: {claim_id}")
        if (
            source_record.get("channel_id") != "UC54xbL96tU58iez3YbTVTAg"
            or source_record.get("channel_handle") != "@RD_Forex"
        ):
            raise ValueError(f"non-official source: {claim_id}")
        target = claim.get("target_claim_id")
        if target is not None and target not in claims:
            raise ValueError(f"unknown claim target: {claim_id}")
        rows.append({
            "claim_id": claim_id,
            "source_id": source_id,
            "youtube_video_id": source_record["youtube_video_id"],
            "published_date": source_record["published_date"],
            "title_snapshot": source_record["title_snapshot"],
            "channel_id": source_record["channel_id"],
            "channel_handle": source_record["channel_handle"],
            "timestamp_start_seconds": claim["timestamp_start_seconds"],
            "timestamp_end_seconds": claim["timestamp_end_seconds"],
            "relationship": claim["relationship"],
            "target_claim_id": target,
            "summary": claim["summary"],
        })
    encoded = json.dumps(
        rows,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return f"export const SOURCE_CLAIM_CATALOG = {encoded} as const;\\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = build(args.input)
    if args.check:
        if not args.output.is_file():
            raise SystemExit(f"missing generated file: {args.output}")
        if args.output.read_text(encoding="utf-8") != expected:
            raise SystemExit(f"generated file is stale: {args.output}")
        return 0
    args.output.write_text(expected, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Each generated object has the exact keys
`claim_id,source_id,youtube_video_id,published_date,title_snapshot,channel_id,
channel_handle,timestamp_start_seconds,timestamp_end_seconds,relationship,
target_claim_id,summary`. `--check` compares the exact bytes and exits nonzero
without writing. Run:

```bash
uv run python scripts/build_rd_entry_edge_catalog.py \
  --input config/phase0/rd-strategy-rule-contract-v2.json \
  --output apps/observation-edge/src/rd-entry-source-catalog.ts
uv run python scripts/build_rd_entry_edge_catalog.py \
  --input config/phase0/rd-strategy-rule-contract-v2.json \
  --output apps/observation-edge/src/rd-entry-source-catalog.ts \
  --check
```

Extend the source-claim parity test to compare every generated catalog field
against the contract, not only the rule claim-ID tuples. Task 5 imports this
catalog for D1 inserts; no producer-supplied video metadata is accepted.

- [ ] **Step 4: Validate bounded HTF proof transcripts and match independently**

Create `apps/observation-edge/src/rd-entry-matcher.ts` with these public types and
functions:

```ts
import type {
  AmbiguityCode,
  CandidateFidelity,
  EntryCandidate,
  EntryCandidateEvidence,
  EntryHandlingObservation,
  EntryMatchRequest,
  EntryModelV2,
  HTFFlipProof,
  OrderedCandle,
} from "./rd-entry-domain";
import { canonicalSha256, SOURCE_CLAIMS } from "./rd-entry-policy";

export interface EntryMatchResult {
  readonly candidates: readonly EntryCandidate[];
  readonly evidence: readonly EntryCandidateEvidence[];
  readonly handling: readonly EntryHandlingObservation[];
}

function validOhlc(bar: OrderedCandle): boolean {
  return (
    bar.open_epoch >= 0 &&
    bar.close_epoch > bar.open_epoch &&
    bar.high_ticks >= Math.max(bar.open_ticks, bar.close_ticks, bar.low_ticks) &&
    bar.low_ticks <= Math.min(bar.open_ticks, bar.close_ticks, bar.high_ticks)
  );
}

export async function validateHtfFlipProof(
  setup: EntryMatchRequest["setup"],
  proof: HTFFlipProof,
  htfOpenTicks: number,
): Promise<HTFFlipProof> {
  const contact = proof.contact_child;
  const recross = proof.recross_child;
  const context = proof.htf_context_minutes[0];
  const expected =
    (proof.coverage_end_epoch - proof.coverage_start_epoch) /
    proof.proof_resolution_seconds;
  const contactOverlaps =
    contact !== null &&
    contact.low_ticks <= setup.zone_top_ticks &&
    contact.high_ticks >= setup.zone_bottom_ticks;
  const recrosses =
    recross !== null &&
    (setup.direction === "LONG"
      ? recross.high_ticks > htfOpenTicks
      : recross.low_ticks < htfOpenTicks);
  const sameChild =
    contact !== null &&
    recross !== null &&
    JSON.stringify(contact) === JSON.stringify(recross);
  const opensInsideZone =
    contact !== null &&
    contact.open_ticks >= setup.zone_bottom_ticks &&
    contact.open_ticks <= setup.zone_top_ticks;
  const complete =
    context !== undefined &&
    proof.htf_context_minutes.length === 1 &&
    proof.event_anchor_epoch === proof.coverage_start_epoch &&
    proof.coverage_end_epoch === proof.transcript.coverage_end_epoch &&
    proof.transcript.coverage_end_epoch === proof.transcript.scan_cutoff_epoch &&
    proof.coverage_end_epoch > proof.coverage_start_epoch &&
    proof.coverage_end_epoch <= proof.event_anchor_epoch + context * 60 &&
    proof.proof_resolution_seconds === 60 &&
    Number.isInteger(expected) &&
    proof.coverage_expected_child_count === expected &&
    proof.coverage_observed_child_count === expected &&
    !proof.coverage_gap_detected &&
    proof.full_lifecycle_ordered;

  if (
    (contact !== null && !validOhlc(contact)) ||
    (recross !== null && !validOhlc(recross)) ||
    (contact !== null &&
      (contact.open_epoch < proof.coverage_start_epoch ||
        contact.close_epoch > proof.coverage_end_epoch)) ||
    (recross !== null &&
      (recross.open_epoch < proof.coverage_start_epoch ||
        recross.close_epoch > proof.coverage_end_epoch)) ||
    (contact !== null && recross !== null &&
      contact.open_epoch > recross.open_epoch) ||
    (sameChild && !proof.ambiguity_codes.includes(
      "SHADOW_SAME_CHILD_BAR_ORDER",
    ) && !opensInsideZone) ||
    proof.matched !== (contactOverlaps && recrosses) ||
    (proof.matched &&
      (proof.trigger_epoch !== recross?.close_epoch ||
        proof.trigger_ticks !== htfOpenTicks))
  ) {
    throw new TypeError("invalid bounded HTF proof transcript");
  }

  const exact =
    complete &&
    proof.matched &&
    !proof.destination_seen_before_contact &&
    (!sameChild || opensInsideZone);
  if (
    (proof.fidelity === "EXACT") !== exact ||
    (exact && proof.ambiguity_codes.length !== 0) ||
    proof.transcript_sha256 !== await canonicalSha256(proof.transcript)
  ) {
    throw new TypeError("HTF proof fidelity contradicts transcript");
  }
  return proof;
}
```

The wire layer supplies the HTF opening price as the third argument while
expanding the bounded transcript. Demand recross is
`high_ticks > htf_open_ticks`; supply recross is
`low_ticks < htf_open_ticks`, and a matched proof stores that opening price as
`trigger_ticks`. Do not use a close-price predicate.
Before returning, require every redundant `proof.transcript` field to equal
the corresponding flattened proof/setup value (context, anchor/open ticks,
cutoff, resolution, coverage/counts/gap, lifecycle, destination flag,
contact/recross candle, and same-child result). This makes the Python vector,
wire expansion, and matcher consume one canonical transcript rather than two
independent representations. Recompute
`proof.transcript_sha256 === canonicalSha256(proof.transcript)` before
matching. In particular, require
`proof.transcript.coverage_end_epoch ===
proof.transcript.scan_cutoff_epoch` and the flattened
`proof.coverage_end_epoch` to equal both. Add a direct matcher test that changes
only transcript coverage end while preserving cutoff and recomputes the
transcript hash; it must still be rejected rather than accepted as a
self-consistent but differently bounded proof.

Implement `evaluateEntryMatch()` to mirror the Plan 1 vector order:

1. return no candidate for an `INVALIDATED` terminal event; also return no
   active model if engagement is null or `invalidated_before_entry` is true;
2. evaluate `DIR_CLOSE`, generic break, and rejection independently;
3. validate all bounded 15/30/60 proofs oldest-first;
4. combine proofs only when both `htf_open_epoch` and recross child
   `trigger_epoch` match into one `HTF_FLIP`;
5. when generic break and HTF proof share the opening boundary and recross,
   emit one `HTF_FLIP` with state `NORMALIZED` and
   `normalized_from = LEGACY_BREAK_CANDLE`; keep the candidate source claims
   equal to the five-claim HTF tuple and append the four legacy-break claims
   only to its evidence;
6. retain a generic break without HTF proof and rejection/respect as rejected
   legacy candidates; a pure flip is `MATCHED` with `normalized_from = null`;
7. use canonical SHA-256 identity dictionaries from Plan 1;
8. emit same-event handling separately with `CLOSE_CONFIRMATION` or
   `INTRABAR_FLIP`; accumulated stream evaluation, not the single-event
   matcher, derives `NEXT_CANDLE_WICK`.

Reject `trigger_ordinal < 1`, `INITIAL` with an ordinal other than `1`, or
`RE_ENTRY` with an ordinal below `2`. Every candidate and same-event handling
row derives its ordinal/attempt directly from the request; no matcher helper
hardcodes `1` or `INITIAL`. All events in one `evaluateEntryStream()` call must
have the same attempt kind and ordinal because the setup ID denotes exactly one
attempt.

Freeze event anchors exactly:

- `DIR_CLOSE`, `LEGACY_BREAK_CANDLE`, and `LEGACY_REJECTION_RESPECT` use
  `confirmed_bar.open_epoch`; their evidence trigger epoch is
  `confirmed_bar.close_epoch`.
- `HTF_FLIP` uses `htf_open_epoch`; its evidence trigger epoch is the recross
  child close.
- Realtime and replay evidence describing the same semantic anchor and ordinal
  therefore share one candidate ID.

Use this exact candidate identity dictionary:

```ts
const candidateId = await canonicalSha256({
  direction,
  event_anchor_epoch: eventAnchorEpoch,
  model,
  setup_id: request.setup.setup_id,
  trigger_ordinal: triggerOrdinal,
});
```

Use this exact evidence identity dictionary:

```ts
const proofPayloadSha256 = await canonicalSha256({
  ambiguity_codes: ambiguityCodes,
  candidate_id: candidateId,
  coverage_end_epoch: coverageEndEpoch,
  coverage_start_epoch: coverageStartEpoch,
  failed_rule_ids: failedRuleIds,
  fidelity,
  htf_context_minutes: htfContextMinutes,
  observed_trigger_epoch: triggerEpoch,
  observed_trigger_ticks: triggerTicks,
  passed_rule_ids: passedRuleIds,
  proof_plane: proofPlane,
  proof_resolution_seconds: proofResolutionSeconds,
  source_claim_ids: sourceClaimIds,
});

const evidenceId = await canonicalSha256({
  candidate_id: candidateId,
  coverage_end_epoch: coverageEndEpoch,
  coverage_start_epoch: coverageStartEpoch,
  observed_trigger_epoch: triggerEpoch,
  payload_sha256: proofPayloadSha256,
  proof_plane: proofPlane,
  proof_resolution_seconds: proofResolutionSeconds,
});
```

Store `proofPayloadSha256` as
`EntryCandidateEvidence.payload_sha256`. It is the SHA-256 of expanded,
credential-free proof fields above, never the receipt payload hash, chunk hash,
assembled-batch hash, producer input, or
`HTFFlipProof.transcript_sha256` transcript hash. Always recompute the evidence
mapping hash before `evidence_id`; never copy the transcript hash.
`receipt_id` remains the transport
provenance link. Add a vector test proving that the same proof transported in
different chunks has the same proof hash and `evidence_id`, while changing
`observed_trigger_ticks`, an ambiguity, or a source claim changes both.

Use this exact handling identity dictionary:

```ts
const handlingId = await canonicalSha256({
  attempt_kind: attemptKind,
  candidate_id: candidateId,
  evidence_id: evidenceId,
  fidelity,
  handling_mode: handlingMode,
  observed_epoch: observedEpoch,
  observed_ticks: observedTicks,
  source_claim_ids: [...sourceClaimIds],
});
```

- [ ] **Step 5: Implement deterministic arbitration**

Create `apps/observation-edge/src/rd-entry-arbitrator.ts`:

```ts
import type {
  EntryEvaluation,
  EntryMatchRequest,
  EntryModelV2,
  EntrySelection,
  SetupAttemptTerminalReason,
  SetupEntryFacts,
} from "./rd-entry-domain";
import { evaluateEntryMatch } from "./rd-entry-matcher";
import { canonicalSha256, ENTRY_POLICY_VERSION } from "./rd-entry-policy";

export interface EntryArbitrationRequest {
  readonly setup_id: string;
  readonly setup_invalidated: boolean;
  readonly revision: number;
  readonly candidates: EntryEvaluation["candidates"];
  readonly evidence: EntryEvaluation["evidence"];
  readonly evaluated_at_epoch: number;
}

function compareCanonicalExactEvidence(
  left: EntryEvaluation["evidence"][number],
  right: EntryEvaluation["evidence"][number],
): number {
  if (
    left.observed_trigger_epoch === null ||
    right.observed_trigger_epoch === null
  ) {
    throw new TypeError("exact canonical evidence lacks a trigger");
  }
  return (
    left.observed_trigger_epoch - right.observed_trigger_epoch ||
    left.proof_resolution_seconds - right.proof_resolution_seconds ||
    right.htf_context_minutes.length - left.htf_context_minutes.length ||
    left.coverage_end_epoch - right.coverage_end_epoch ||
    left.evidence_id.localeCompare(right.evidence_id)
  );
}

export async function arbitrateEntryCandidates(
  request: EntryArbitrationRequest,
): Promise<EntrySelection> {
  const replayObservedProof = request.evidence.filter(
    (item) =>
      item.proof_plane !== "REALTIME_TICK" &&
      item.observed_trigger_epoch !== null,
  );
  const evidenceByCandidate = new Map<
    string,
    EntryEvaluation["evidence"][number]
  >();
  const nonExactTriggerByCandidate = new Map<string, number>();
  for (const item of replayObservedProof) {
    const exactEligible =
      item.fidelity === "EXACT" && item.ambiguity_codes.length === 0;
    if (exactEligible) {
      const previous = evidenceByCandidate.get(item.candidate_id);
      if (
        previous === undefined ||
        compareCanonicalExactEvidence(item, previous) < 0
      ) {
        evidenceByCandidate.set(item.candidate_id, item);
      }
    } else {
      const epoch = item.observed_trigger_epoch!;
      const previous = nonExactTriggerByCandidate.get(item.candidate_id);
      if (previous === undefined || epoch < previous) {
        nonExactTriggerByCandidate.set(item.candidate_id, epoch);
      }
    }
  }
  const active = request.candidates.filter(
    (item) =>
      (item.model === "DIR_CLOSE" || item.model === "HTF_FLIP") &&
      item.state !== "REJECTED",
  );
  const exact = active
    .filter((item) => evidenceByCandidate.has(item.candidate_id))
    .sort((left, right) => {
      const leftEpoch =
        evidenceByCandidate.get(left.candidate_id)?.observed_trigger_epoch ?? 0;
      const rightEpoch =
        evidenceByCandidate.get(right.candidate_id)?.observed_trigger_epoch ?? 0;
      return (
        leftEpoch - rightEpoch ||
        left.model.localeCompare(right.model) ||
        left.candidate_id.localeCompare(right.candidate_id)
      );
    });

  const decision = selectCanonicalDecision(
    request.setup_invalidated,
    active,
    exact,
    evidenceByCandidate,
    nonExactTriggerByCandidate,
  );
  const candidateIdsConsidered = active
    .map((item) => item.candidate_id)
    .sort();
  const identity = {
    action: decision.action,
    candidate_ids_considered: candidateIdsConsidered,
    canonical_candidate_id: decision.candidate?.candidate_id ?? null,
    canonical_evidence_id: decision.evidence?.evidence_id ?? null,
    fidelity: decision.evidence?.fidelity ?? null,
    policy_version: ENTRY_POLICY_VERSION,
    reason: decision.reason,
    revision: request.revision,
    setup_id: request.setup_id,
  };
  return {
    selection_id: await canonicalSha256(identity),
    setup_id: request.setup_id,
    policy_version: ENTRY_POLICY_VERSION,
    revision: request.revision,
    candidate_ids_considered: candidateIdsConsidered,
    canonical_candidate_id: identity.canonical_candidate_id,
    canonical_evidence_id: identity.canonical_evidence_id,
    canonical_model: decision.candidate?.model ?? null,
    reason: decision.reason,
    fidelity: decision.evidence?.fidelity ?? null,
    action: decision.action,
    evaluated_at_epoch: request.evaluated_at_epoch,
  };
}

function mergeImmutable<T>(
  target: Map<string, T>,
  items: readonly T[],
  id: (item: T) => string,
): void {
  for (const item of items) {
    const key = id(item);
    const previous = target.get(key);
    if (
      previous !== undefined &&
      JSON.stringify(previous) !== JSON.stringify(item)
    ) {
      throw new TypeError(`immutable identity conflict: ${key}`);
    }
    target.set(key, item);
  }
}

export interface EntryStreamEvent {
  readonly event_id: string;
  readonly match_request: EntryMatchRequest;
}

type TerminalFact = {
  readonly reason: SetupAttemptTerminalReason;
  readonly epoch: number;
};

const ACTIVE_MODELS = new Set<EntryModelV2>(["DIR_CLOSE", "HTF_FLIP"]);

function activeModels(
  values: ReadonlyMap<
    EntryModelV2,
    EntryEvaluation["candidates"][number]
  >,
): Set<EntryModelV2> {
  return new Set([...values.keys()].filter((item) => ACTIVE_MODELS.has(item)));
}

function mergeTerminalFact(
  current: TerminalFact | null,
  setup: SetupEntryFacts,
  confirmedEpoch: number,
  before: ReadonlySet<EntryModelV2>,
  after: ReadonlySet<EntryModelV2>,
): TerminalFact | null {
  const completedBothNow =
    before.size < 2 && after.has("DIR_CLOSE") && after.has("HTF_FLIP");
  if (setup.terminal_reason === null) {
    if (
      setup.terminal_epoch !== null ||
      setup.invalidated_before_entry ||
      completedBothNow
    ) {
      throw new TypeError("open event contradicts terminal state");
    }
    return current;
  }
  if (setup.terminal_epoch !== confirmedEpoch) {
    throw new TypeError("terminal epoch is not the confirmed event epoch");
  }
  const presented = {
    reason: setup.terminal_reason,
    epoch: setup.terminal_epoch,
  } as const;
  if (current !== null) {
    if (
      current.reason === presented.reason &&
      current.epoch === presented.epoch
    ) return current;
    throw new TypeError("terminal setup fact changed");
  }
  if (
    completedBothNow &&
    presented.reason !== "BOTH_ACTIVE_MODELS_OBSERVED"
  ) {
    throw new TypeError("both-model transition has the wrong terminal");
  }
  if (presented.reason === "INVALIDATED") {
    if (
      before.size !== after.size ||
      [...before].some((item) => !after.has(item)) ||
      setup.invalidated_before_entry !== (before.size === 0)
    ) {
      throw new TypeError("invalidation contradicts prior candidates");
    }
  } else if (setup.invalidated_before_entry) {
    throw new TypeError("non-invalidation terminal is pre-entry invalidated");
  }
  if (
    presented.reason === "BOTH_ACTIVE_MODELS_OBSERVED" &&
    !completedBothNow
  ) {
    throw new TypeError("BOTH terminal is not the completion event");
  }
  return presented;
}

export async function evaluateEntryStream(
  events: readonly EntryStreamEvent[],
  setupInvalidated: boolean,
  revision: number,
  evaluatedAtEpoch: number,
): Promise<EntryEvaluation> {
  if (events.length === 0) throw new TypeError("entry stream is empty");
  const eventsById = new Map<string, EntryStreamEvent>();
  mergeImmutable(eventsById, events, (item) => item.event_id);
  const ordered = [...eventsById.values()].sort(
    (left, right) =>
      left.match_request.confirmed_bar.close_epoch -
        right.match_request.confirmed_bar.close_epoch ||
      left.event_id.localeCompare(right.event_id),
  );
  const setupId = ordered[0]!.match_request.setup.setup_id;
  if (
    ordered.some(
      (item) => item.match_request.setup.setup_id !== setupId,
    )
  ) {
    throw new TypeError("entry stream mixes setup IDs");
  }
  const candidates = new Map<string, EntryEvaluation["candidates"][number]>();
  const evidence = new Map<string, EntryEvaluation["evidence"][number]>();
  const handling = new Map<string, EntryEvaluation["handling"][number]>();
  const firstCandidateByModel = new Map<
    EntryModelV2,
    EntryEvaluation["candidates"][number]
  >();
  let terminalFact: TerminalFact | null = null;
  let terminalWickGraceFrom: EntryMatchRequest | null = null;
  let handlingOnlyGraceConsumed = false;
  for (const event of ordered) {
    const request = event.match_request;
    if (terminalFact !== null) {
      if (
        terminalWickGraceFrom === null ||
        handlingOnlyGraceConsumed ||
        request.setup.terminal_reason !== terminalFact.reason ||
        request.setup.terminal_epoch !== terminalFact.epoch ||
        canonicalStringify(request.setup) !==
          canonicalStringify(terminalWickGraceFrom.setup) ||
        request.attempt_kind !== terminalWickGraceFrom.attempt_kind ||
        request.trigger_ordinal !== terminalWickGraceFrom.trigger_ordinal ||
        request.htf_proofs.length !== 0 ||
        request.generic_break_detected ||
        request.rejection_respect_detected
      ) {
        throw new TypeError("new authority event follows terminal setup fact");
      }
      handlingOnlyGraceConsumed = true;
      continue;
    }
    const before = activeModels(firstCandidateByModel);
    const match = await evaluateEntryMatch(request);
    const acceptedCandidateIds = new Set<string>();
    for (const candidate of [...match.candidates].sort(
      (left, right) =>
        left.model.localeCompare(right.model) ||
        left.candidate_id.localeCompare(right.candidate_id),
    )) {
      const first = firstCandidateByModel.get(candidate.model);
      if (
        first !== undefined &&
        canonicalStringify(first) !== canonicalStringify(candidate)
      ) {
        continue;
      }
      if (first === undefined) {
        firstCandidateByModel.set(candidate.model, candidate);
      }
      acceptedCandidateIds.add(candidate.candidate_id);
      mergeImmutable(candidates, [candidate], (item) => item.candidate_id);
    }
    mergeImmutable(
      evidence,
      match.evidence.filter((item) =>
        acceptedCandidateIds.has(item.candidate_id),
      ),
      (item) => item.evidence_id,
    );
    mergeImmutable(
      handling,
      match.handling.filter((item) =>
        acceptedCandidateIds.has(item.candidate_id),
      ),
      (item) => item.handling_id,
    );
    const after = activeModels(firstCandidateByModel);
    terminalFact = mergeTerminalFact(
      terminalFact,
      request.setup,
      request.confirmed_bar.close_epoch,
      before,
      after,
    );
    if (
      terminalFact?.reason === "BOTH_ACTIVE_MODELS_OBSERVED" &&
      !before.has("DIR_CLOSE") &&
      after.has("DIR_CLOSE")
    ) {
      terminalWickGraceFrom = request;
    }
  }
  const wickHandling = await deriveNextCandleWickHandling(
    ordered,
    firstCandidateByModel.get("DIR_CLOSE") ?? null,
    evidence,
  );
  if (wickHandling !== null) {
    mergeImmutable(handling, [wickHandling], (item) => item.handling_id);
  }
  const candidateValues = [...candidates.values()].sort(
    (left, right) => left.candidate_id.localeCompare(right.candidate_id),
  );
  const evidenceValues = [...evidence.values()].sort(
    (left, right) => left.evidence_id.localeCompare(right.evidence_id),
  );
  const handlingValues = [...handling.values()].sort(
    (left, right) => left.handling_id.localeCompare(right.handling_id),
  );
  const accumulatedInvalidated =
    terminalFact?.reason === "INVALIDATED" &&
    activeModels(firstCandidateByModel).size === 0;
  if (setupInvalidated !== accumulatedInvalidated) {
    throw new TypeError("setup invalidation disagrees with terminal facts");
  }
  const selection = await arbitrateEntryCandidates({
    setup_id: setupId,
    setup_invalidated: accumulatedInvalidated,
    revision,
    candidates: candidateValues,
    evidence: evidenceValues,
    evaluated_at_epoch: evaluatedAtEpoch,
  });
  return {
    candidates: candidateValues,
    evidence: evidenceValues,
    handling: handlingValues,
    selection,
  };
}
```

Before the loop, require one attempt-scoped setup ID, attempt kind, and trigger
ordinal across all requests. After sorting, a terminal fact is the last event
that may enter the matcher, candidate map, evidence map, or terminal
transition. Only when that transition is
`BOTH_ACTIVE_MODELS_OBSERVED` and the event introduced `DIR_CLOSE`, infer one
following request as handling-only. Require it to repeat the exact
setup/terminal/attempt facts and carry no HTF or legacy trigger input; never
pass it to `evaluateEntryMatch()` or arbitration. The wick helper accepts it
only when its bar is the contiguous next five-minute bar. A non-contiguous
first following event consumes the grace without handling, and no second grace
event is valid. No marker is added to `EntryMatchRequest`; its byte shape stays
identical to Plan 1.

Define `selectCanonicalDecision()` as a private exhaustive function returning:

```ts
type Decision = {
  readonly candidate: EntryEvaluation["candidates"][number] | null;
  readonly evidence: EntryEvaluation["evidence"][number] | null;
  readonly action: EntrySelection["action"];
  readonly reason: EntrySelection["reason"];
};
```

Implement it exactly, with `exact` already sorted by trigger epoch, model, and
candidate ID:

```ts
function selectCanonicalDecision(
  invalidated: boolean,
  active: EntryEvaluation["candidates"],
  exact: EntryEvaluation["candidates"],
  evidenceByCandidate: ReadonlyMap<
    string,
    EntryEvaluation["evidence"][number]
  >,
  nonExactTriggerByCandidate: ReadonlyMap<string, number>,
): Decision {
  const none = (
    action: "NONE" | "SHADOW_ONLY",
    reason: EntrySelection["reason"],
  ): Decision => ({ candidate: null, evidence: null, action, reason });
  if (invalidated) return none("NONE", "SETUP_INVALIDATED");
  if (active.length === 0) return none("NONE", "NO_CANDIDATE");
  if (exact.length === 0) {
    return none("SHADOW_ONLY", "NO_EXACT_CANDIDATE");
  }

  const exactClose = exact.find((item) => item.model === "DIR_CLOSE");
  const exactCloseEvidence =
    exactClose === undefined
      ? undefined
      : evidenceByCandidate.get(exactClose.candidate_id);
  const hasEarlierNonExactFlip =
    exactCloseEvidence !== undefined &&
    exactCloseEvidence.observed_trigger_epoch !== null &&
    active.some((item) => {
      const trigger = nonExactTriggerByCandidate.get(item.candidate_id);
      return (
        item.model === "HTF_FLIP" &&
        !evidenceByCandidate.has(item.candidate_id) &&
        trigger !== undefined &&
        trigger < exactCloseEvidence.observed_trigger_epoch!
      );
    });
  if (exactClose !== undefined && hasEarlierNonExactFlip) {
    return {
      candidate: exactClose,
      evidence: exactCloseEvidence!,
      action: "PAPER_ELIGIBLE",
      reason: "FALLBACK_TO_CONFIRMED_CLOSE",
    };
  }
  if (exact.length === 1) {
    return {
      candidate: exact[0]!,
      evidence: evidenceByCandidate.get(exact[0]!.candidate_id)!,
      action: "PAPER_ELIGIBLE",
      reason: "ONLY_EXACT_TRIGGER",
    };
  }

  const firstEvidence = evidenceByCandidate.get(exact[0]!.candidate_id)!;
  const secondEvidence = evidenceByCandidate.get(exact[1]!.candidate_id)!;
  if (
    firstEvidence.observed_trigger_epoch ===
      secondEvidence.observed_trigger_epoch &&
    exact[0]!.model !== exact[1]!.model
  ) {
    return none("SHADOW_ONLY", "UNRESOLVED_SOURCE_PRIORITY");
  }
  return {
    candidate: exact[0]!,
    evidence: firstEvidence,
    action: "PAPER_ELIGIBLE",
    reason: "EARLIEST_EXACT_TRIGGER",
  };
}
```

This order implements `SETUP_INVALIDATED`, `NO_CANDIDATE`,
`NO_EXACT_CANDIDATE`, exact-close fallback from a non-exact flip,
`ONLY_EXACT_TRIGGER`, equal-time `UNRESOLVED_SOURCE_PRIORITY`, then
`EARLIEST_EXACT_TRIGGER`. Exact evidence is eligible only when it has a
non-null trigger, no ambiguity, and a replayable proof plane. Group by
candidate before arbitration and rank by trigger epoch ascending, resolution
ascending, HTF-context count descending, coverage end ascending, then evidence
ID ascending. Add direct tests for every branch, reverse the two-evidence input
order and require the same canonical evidence ID, and prove that only a
strictly earlier replay-observed non-exact flip produces
`FALLBACK_TO_CONFIRMED_CLOSE`. Its evidence may be ambiguity-coded
`UNRESOLVED`—including same-child ordering or a boundary gap—provided its proof
plane is not `REALTIME_TICK` and its observed trigger is non-null. A
same-time/later flip, realtime-only evidence, or missing-coverage proof with no
candidate/trigger leaves `ONLY_EXACT_TRIGGER`. Keep these direct cases in
addition to the 24 vector cases.

Add direct stream tests for two directional-close bars and two distinct flip
events. The first semantic candidate ID for each model wins; an identical
same-ID replay is idempotent and may append new immutable evidence for that
candidate. A later candidate for an already-observed model is accepted only
when its entire canonical candidate object is exactly equal to the first one.
Suppress a non-identical later candidate plus all dependent evidence/handling
even if a same-boundary recross happens to reuse the same `candidate_id`;
`mergeImmutable()` must never turn that first-model-wins case into a conflict.
A genuinely different payload for the same immutable `event_id` remains an
`EVENT_STREAM_CONFLICT`. This rule applies per setup attempt across batch
boundaries, not merely inside one wire bundle.

Derive `NEXT_CANDLE_WICK` deterministically in `evaluateEntryStream()` after
events have been deduplicated and ordered. Remember the first accepted
`DIR_CLOSE` candidate, the exact evidence created with it, and the close epoch
of that event. Inspect only the confirmed five-minute bar whose
`open_epoch` equals that stored close epoch and whose `close_epoch` is exactly
`open_epoch + 300`; a later bar can never substitute for a missing immediate
next bar. Emit one handling observation only when:

- for `LONG`,
  `next_bar.low_ticks < min(next_bar.open_ticks, next_bar.close_ticks)`;
- for `SHORT`,
  `next_bar.high_ticks > max(next_bar.open_ticks, next_bar.close_ticks)`.

The handling row references the original directional-close candidate and
evidence, uses `handling_mode="NEXT_CANDLE_WICK"`, propagates the
`attempt_kind` from the request that created that candidate,
uses `observed_epoch=next_bar.close_epoch`, and
`observed_ticks=next_bar.low_ticks` for long or
`next_bar.high_ticks` for short. Its fidelity is always
`DISCRETIONARY`, and its source claims are exactly
`SOURCE_CLAIMS.NEXT_CANDLE_WICK`:
`next-candle-wick-2025-05`, `prompt-close-2025-05`, and
`close-fallback-2025-11`. Build its immutable handling ID with the ordinary
Plan 1 handling-identity dictionary. This observation creates no candidate or
evidence, never changes the first-candidate map or terminal transition, and is
excluded from arbitration inputs.

When `DIR_CLOSE` is the event that completes
`BOTH_ACTIVE_MODELS_OBSERVED`, keep that terminal event as the last authority
event and infer the one handling-only post-terminal grace request above.
`INVALIDATED`, `RETENTION_EVICTED`, and a BOTH terminal that introduced only
`HTF_FLIP` have no post-terminal grace. This prevents terminality from
suppressing the immediate-next-bar observation without reopening the attempt.
Persist the grace proof input and derived handling row, but do not change the
immutable terminal row, candidate/evidence set, or canonical selection.

Add direct long and short stream tests, an equality-at-body-extreme no-wick
test, a body-only counter-move no-wick test, a missing-immediate-bar test, and
an out-of-order arrival test. Add a `DIR_CLOSE`-completes-both test proving
exactly one contiguous handling-only post-terminal bar may add the wick, while
a second bar or a grace bar with changed terminal facts is rejected. Add an
isolated `RE_ENTRY,trigger_ordinal=2` domain case and prove its wick handling
keeps `RE_ENTRY`. In every test,
assert candidates, evidence, and selection are byte-identical before and after
adding the next-bar observation; only `handling` may gain the deterministic
row. The frozen `next-candle-wick-handling` vector must exercise the same
derivation rather than carrying a precomputed backend handling row.

- [ ] **Step 6: Run the 24 vectors and edge checks for GREEN**

Run:

```bash
cd apps/observation-edge
npx vitest run test/rd-entry-parity.test.ts test/rd-entry-domain.test.ts
npm run lint
npm run typecheck
cd ../..
uv run python scripts/build_rd_entry_edge_catalog.py \
  --input config/phase0/rd-strategy-rule-contract-v2.json \
  --output apps/observation-edge/src/rd-entry-source-catalog.ts \
  --check
```

Expected: all 24 vector cases pass, including multiple candidates, same-child
ambiguity, missing coverage, normalization, handling, and re-entry.

- [ ] **Step 7: Commit the TypeScript oracle**

```bash
git add apps/observation-edge/src/rd-entry-policy.ts \
  apps/observation-edge/src/rd-entry-source-catalog.ts \
  apps/observation-edge/src/rd-entry-matcher.ts \
  apps/observation-edge/src/rd-entry-arbitrator.ts \
  apps/observation-edge/test/rd-entry-parity.test.ts \
  scripts/build_rd_entry_edge_catalog.py
git commit -m "feat: mirror RD entry arbitration vectors at the edge"
```

---

### Task 3: Add strict compact schema 2.0 wire validation

**Files:**
- Create: `apps/observation-edge/src/rd-entry-wire.ts`
- Create: `apps/observation-edge/test/rd-entry-wire.test.ts`
- Modify: `apps/observation-edge/src/types.ts:9`
- Modify: `apps/observation-edge/src/validation.ts:888`

**Interfaces:**
- Consumes: strict JSON primitives from `strict-json.ts` and Task 1 domain types.
- Produces: `validateEntryV2Payload(value: StrictJsonValue) -> ValidatedEntryV2Payload`.
- Produces: a discriminated `ValidatedObservation` whose v2 branch has `entryBatches` and no `paperCommands`.

- [ ] **Step 1: Write failing valid, malformed, and compact-wire tests**

Create `apps/observation-edge/test/rd-entry-wire.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseStrictJson } from "../src/strict-json";
import {
  EntryV2ValidationError,
  validateEntryV2Payload,
} from "../src/rd-entry-wire";

const digest = "a".repeat(64);

function payload(): Record<string, unknown> {
  return {
    schema_version: "2.0",
    strategy_id: "rd_liquidity_sd_5m_v1",
    strategy_version: "2.0.0-contract2",
    rule_contract_version: "2.0.0",
    execution_mode: "OBSERVATION_ONLY",
    producer_instance_id: "pine-v3-lab",
    sequence: 1,
    idempotency_key: "pine-v3-lab:1:incremental:1721808300:0",
    symbol: "EURUSD",
    ticker_id: "OANDA:EURUSD",
    feed: "OANDA",
    timeframe: "5",
    tick_size: "0.00001",
    bar_open_epoch: 1721808000,
    bar_close_epoch: 1721808300,
    detector_code_hash: digest,
    settings_hash: "b".repeat(64),
    kind: "incremental",
    chunk_index: 0,
    chunk_count: 1,
    eb: [{
      s: "setup-1",
      d: "LONG",
      f: {
        zb: 90,
        zt: 100,
        ge: 1721808010,
        iv: false,
        cf: "EXACT",
        ak: "INITIAL",
        et: true,
        tr: null,
        te: null,
        ng: null,
        b: [{
          oe: 1721808000,
          ce: 1721808300,
          o: 99,
          h: 105,
          l: 95,
          c: 103,
          gb: false,
          rr: false,
        }],
        x: [],
      },
      c: [],
      e: [],
      h: [],
      q: null,
    }],
  };
}

function facts(value: Record<string, unknown>): Record<string, unknown> {
  return (
    (value.eb as Record<string, unknown>[])[0]!.f as
      Record<string, unknown>
  );
}

function transcript(
  cutoffEpoch: number,
  coverageStartEpoch = 1721807100,
): Record<string, unknown> {
  const childCount = (cutoffEpoch - coverageStartEpoch) / 60;
  return {
    m: 15,
    ae: coverageStartEpoch,
    ao: 100,
    cu: cutoffEpoch,
    rs: 60,
    cs: coverageStartEpoch,
    ce: cutoffEpoch,
    ec: childCount,
    oc: childCount,
    gp: false,
    lo: true,
    db: false,
    cc: null,
    rc: null,
    sb: false,
  };
}

describe("schema 2.0 compact wire", () => {
  it("expands compact facts and contains no paper command surface", () => {
    const value = validateEntryV2Payload(
      parseStrictJson(JSON.stringify(payload())),
    );
    expect(value.entryBatches[0]?.events[0]?.setup.setup_id).toBe("setup-1");
    expect(value.canonicalPayload).not.toHaveProperty("paper_commands");
  });

  it.each([
    ["extra key", (value: Record<string, unknown>) => { value.order = true; }],
    ["wrong strategy", (value: Record<string, unknown>) => {
      value.strategy_version = "2.0.0";
    }],
    ["bad chunk", (value: Record<string, unknown>) => { value.chunk_index = 1; }],
    ["bad kind", (value: Record<string, unknown>) => { value.kind = "delta"; }],
    ["zero sequence", (value: Record<string, unknown>) => { value.sequence = 0; }],
    ["zero detector hash", (value: Record<string, unknown>) => {
      value.detector_code_hash = "0".repeat(64);
    }],
    ["zero settings hash", (value: Record<string, unknown>) => {
      value.settings_hash = "0".repeat(64);
    }],
    ["calibrated raw fact", (value: Record<string, unknown>) => {
      facts(value).cf = "CALIBRATED";
    }],
    ["discretionary raw fact", (value: Record<string, unknown>) => {
      facts(value).cf = "DISCRETIONARY";
    }],
    ["paper field", (value: Record<string, unknown>) => {
      value.paper_commands = [];
    }],
  ])("rejects %s", (_name, mutate) => {
    const value = payload();
    mutate(value);
    expect(() =>
      validateEntryV2Payload(parseStrictJson(JSON.stringify(value))),
    ).toThrow(EntryV2ValidationError);
  });

  it.each(["snapshot", "incremental"] as const)(
    "accepts the closed %s batch kind",
    (kind) => {
      const value = payload();
      value.kind = kind;
      value.idempotency_key = `pine-v3-lab:1:${kind}:1721808300:0`;
      expect(() =>
        validateEntryV2Payload(parseStrictJson(JSON.stringify(value))),
      ).not.toThrow();
    },
  );

  it("attaches one transcript only to its emitted containing bar", () => {
    const value = payload();
    const raw = facts(value);
    raw.b = [
      {
        oe: 1721807700,
        ce: 1721808000,
        o: 98,
        h: 102,
        l: 96,
        c: 99,
        gb: false,
        rr: false,
      },
      ...(raw.b as Record<string, unknown>[]),
    ];
    raw.x = [transcript(1721808000)];
    const parsed = validateEntryV2Payload(
      parseStrictJson(JSON.stringify(value)),
    );
    expect(parsed.entryBatches[0]!.retainedContext).toHaveLength(1);
    expect(parsed.entryBatches[0]!.retainedContext[0]!.htf_proofs).toHaveLength(1);
    expect(parsed.entryBatches[0]!.events).toHaveLength(1);
    expect(parsed.entryBatches[0]!.events[0]!.htf_proofs).toHaveLength(0);
  });

  it("rejects a transcript whose cutoff is outside every emitted bar", () => {
    const value = payload();
    facts(value).x = [transcript(1721807940)];
    expect(() =>
      validateEntryV2Payload(parseStrictJson(JSON.stringify(value))),
    ).toThrow("HTF_TRANSCRIPT_WITHOUT_EMITTED_BAR");
  });

  it("rejects a transcript whose coverage end differs from its cutoff", () => {
    const value = payload();
    facts(value).x = [transcript(1721808300)];
    (facts(value).x as Record<string, unknown>[])[0]!.ce = 1721808240;
    expect(() =>
      validateEntryV2Payload(parseStrictJson(JSON.stringify(value))),
    ).toThrow("HTF_TRANSCRIPT_COVERAGE_CUTOFF_MISMATCH");
  });

  it("rejects every producer candidate ordinal except one", () => {
    const value = payload();
    const bundle = (value.eb as Record<string, unknown>[])[0]!;
    bundle.c = [{
      i: 0,
      m: "DIR_CLOSE",
      st: "MATCHED",
      a: 1721808000,
      o: 2,
      n: null,
      sc: SOURCE_CLAIMS.DIR_CLOSE,
    }];
    expect(() =>
      validateEntryV2Payload(parseStrictJson(JSON.stringify(value))),
    ).toThrow("ENTRY_DIAGNOSTIC_ORDINAL");
  });
});
```

- [ ] **Step 2: Run wire tests and verify RED**

Run:

```bash
cd apps/observation-edge
npx vitest run test/rd-entry-wire.test.ts
```

Expected: FAIL because `rd-entry-wire.ts` does not exist.

- [ ] **Step 3: Implement exact compact tuple expansion**

Define the exact Pine raw-proof wire in `rd-entry-wire.ts`. Objects reject
unknown keys:

```ts
type ConfirmedBarWire = {
  readonly oe: number;
  readonly ce: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly gb: boolean;
  readonly rr: boolean;
};

type TranscriptCandleWire = {
  readonly oe: number;
  readonly ce: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
};

type HtfTranscriptWire = {
  readonly m: 15 | 30 | 60;
  readonly ae: number;
  readonly ao: number;
  readonly cu: number;
  readonly rs: 60;
  readonly cs: number;
  readonly ce: number;
  readonly ec: number;
  readonly oc: number;
  readonly gp: boolean;
  readonly lo: boolean;
  readonly db: boolean;
  readonly cc: TranscriptCandleWire | null;
  readonly rc: TranscriptCandleWire | null;
  readonly sb: boolean;
};

type SetupFactsWire = {
  readonly zb: number;
  readonly zt: number;
  readonly ge: number | null;
  readonly iv: boolean;
  readonly cf: "EXACT" | "UNRESOLVED";
  readonly ak: "INITIAL";
  readonly et: true;
  readonly tr:
    | "INVALIDATED"
    | "BOTH_ACTIVE_MODELS_OBSERVED"
    | "RETENTION_EVICTED"
    | null;
  readonly te: number | null;
  readonly b: readonly ConfirmedBarWire[];
  readonly x: readonly HtfTranscriptWire[];
  readonly ng: {
    readonly oe: number;
    readonly ce: number;
    readonly o: number;
    readonly h: number;
    readonly l: number;
    readonly c: number;
    readonly ak: "INITIAL";
  } | null;
};
```

`b` is bounded oldest-first replay context whose last item is the one current
event request. Expand the last `b` item into the sole
`ValidatedEntryWireBatch.events[]` item; expand earlier items only into
`retainedContext[]` for agreement checks against immutable events already
stored by the edge. An older `b` item never replays as a new request. Attach an
expanded transcript from `x` to the request whose confirmed
bar uniquely contains `cu` (`open_epoch < cu <= close_epoch`). The `x` array is
sorted by `m` and one cutoff may have at most one transcript per context. For
an open attempt, all projected requests have null terminal facts. When
`f.tr/f.te` is set, attach it to the unique retained/current bar whose close
equals `f.te`; any earlier request is open. If that terminal bar introduced
`DIR_CLOSE` while completing both active models, `f.ng` may carry the sole
following wick-grace bar. Require `ng.oe == f.te`, `ng.ce == ng.oe + 300`,
valid integer OHLC, `ng.ak == f.ak == INITIAL`, and no second/later grace.
Translate it into one internal `EntryStreamEvent` after the terminal event with
the repeated immutable setup/terminal facts, empty HTF/legacy inputs, and the
ordinary Plan 1 match-request shape. The current normal request receives
`attempt_kind=f.ak` and `trigger_ordinal=1`; no edge-only marker is added.
Reject non-null `ng` for any other terminal reason/transition.

Add table-driven decoder tests for valid BOTH/close grace, missing/extra `ng`
keys, wrong epoch/duration/attempt, invalid OHLC, `ng` on invalidation or
retention, BOTH completed by HTF only, and a second grace. Prove the derived
internal grace request serializes exactly like the corresponding Plan 1 oracle
event and adds only the expected handling row.

`f.et` is a literal eligibility proof: schema `2.0` accepts only `true`.
Plan 3 initializes it true only for a setup attempt born on a realtime bar
after the V3 producer instance starts, excludes false zones from snapshots and
incrementals, and retains a terminal setup for at most the one wick-grace bar.
This prevents a first snapshot from pretending that rolled-away pre-V3 proof
history is complete.

`x` never creates an event: reject
`HTF_TRANSCRIPT_WITHOUT_EMITTED_BAR` unless its cutoff is contained by exactly
one `b` bar, and never attach it opportunistically to the last bar. Pine may
drop an old transcript after that cutoff rolls outside its bounded `b` window;
Task 6 requires every `retainedContext` item and retained transcript to
byte-agree with the corresponding previously stored event, then recomputes
from storage plus only the sole current event. Missing prior storage is
`EVENT_STREAM_CONTEXT_MISSING`; disagreement is `EVENT_STREAM_CONFLICT`.

Define the producer diagnostic wire separately from proof input:

```ts
type ProducerCandidateWire = {
  readonly i: number;
  readonly m: EntryModelV2;
  readonly st: CandidateState;
  readonly a: number;
  readonly o: number;
  readonly n: EntryModelV2 | null;
  readonly sc: readonly string[];
};

type ProducerEvidenceWire = {
  readonly i: number;
  readonly ci: number;
  readonly t: number | null;
  readonly px: number | null;
  readonly h: readonly (15 | 30 | 60)[];
  readonly f: CandidateFidelity;
  readonly p: ProofPlane;
  readonly r: number;
  readonly cs: number;
  readonly ce: number;
  readonly ac: readonly AmbiguityCode[];
  readonly pr: readonly string[];
  readonly fr: readonly string[];
  readonly sc: readonly string[];
};

type ProducerHandlingWire = {
  readonly ci: number;
  readonly ei: number;
  readonly m: HandlingMode;
  readonly a: "INITIAL";
  readonly t: number;
  readonly px: number | null;
  readonly f: CandidateFidelity;
  readonly sc: readonly string[];
};

type ProducerSelectionWire = {
  readonly v: "PINE_DIAGNOSTIC_ONLY";
  readonly k: string | null;
  readonly m: EntryModelV2 | null;
  readonly a: number | null;
  readonly o: number | null;
  readonly r: SelectionReason;
  readonly f: CandidateFidelity | null;
  readonly x: "SHADOW_ONLY" | "NONE";
} | null;
```

Export normalized diagnostic types with the same fields, except replace every
local `ci` with the referenced semantic candidate tuple
`{model,event_anchor_epoch,trigger_ordinal}`. Also export:

```ts
export interface ProducerCandidateReference {
  readonly model: EntryModelV2;
  readonly state: CandidateState;
  readonly event_anchor_epoch: number;
  readonly trigger_ordinal: number;
  readonly normalized_from: EntryModelV2 | null;
  readonly source_claim_ids: readonly string[];
}

export interface ProducerEvidenceReference {
  readonly candidate: ProducerCandidateReference;
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
}

export interface ProducerHandlingReference {
  readonly candidate: ProducerCandidateReference;
  readonly evidence: ProducerEvidenceReference;
  readonly handling_mode: HandlingMode;
  readonly attempt_kind: "INITIAL";
  readonly observed_epoch: number;
  readonly observed_ticks: number | null;
  readonly fidelity: CandidateFidelity;
  readonly source_claim_ids: readonly string[];
}

export interface ProducerDiagnosticSelection {
  readonly version: "PINE_DIAGNOSTIC_ONLY";
  readonly semantic_key: string | null;
  readonly model: EntryModelV2 | null;
  readonly event_anchor_epoch: number | null;
  readonly trigger_ordinal: number | null;
  readonly reason: SelectionReason;
  readonly fidelity: CandidateFidelity | null;
  readonly action: "SHADOW_ONLY" | "NONE";
}

export interface ProducerDiagnostic {
  readonly candidates: readonly ProducerCandidateReference[];
  readonly evidence: readonly ProducerEvidenceReference[];
  readonly realtime_evidence: readonly ProducerEvidenceReference[];
  readonly handling: readonly ProducerHandlingReference[];
  readonly selection: ProducerDiagnosticSelection | null;
}

export interface EntryBatchSemanticIdentity {
  readonly producer_instance_id: string;
  readonly sequence: number;
  readonly kind: "snapshot" | "incremental";
  readonly bar_close_epoch: number;
}

export interface EntryBatchImmutableMetadata {
  readonly strategy_id: "rd_liquidity_sd_5m_v1";
  readonly strategy_version: "2.0.0-contract2";
  readonly rule_contract_version: "2.0.0";
  readonly execution_mode: "OBSERVATION_ONLY";
  readonly symbol: string;
  readonly ticker_id: string;
  readonly feed: string;
  readonly timeframe: "5";
  readonly tick_size: string;
  readonly bar_open_epoch: number;
  readonly detector_code_hash: string;
  readonly settings_hash: string;
}

export interface ValidatedEntryWireBatch {
  readonly setupId: string;
  readonly retainedContext: readonly EntryMatchRequest[];
  readonly events: readonly EntryMatchRequest[];
  readonly producerDiagnostic: ProducerDiagnostic;
}

export interface ValidatedEntryV2Payload {
  readonly canonicalPayload: Readonly<Record<string, CanonicalValue>>;
  readonly metadata: ReceiptMetadata;
  readonly batchIdentity: EntryBatchSemanticIdentity;
  readonly batchMetadata: EntryBatchImmutableMetadata;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly entryBatches: readonly ValidatedEntryWireBatch[];
}

export const ENTRY_V2_MAX_MESSAGE_CHARACTERS = 35_000;
export const MAX_ENTRY_CHUNKS = 12;
export const MAX_ENTRY_SETUPS_PER_BATCH = 256;
export const MAX_ENTRY_BARS_PER_SETUP = 4;
export const MAX_ENTRY_HTF_TRANSCRIPTS_PER_SETUP = 3;
export const MAX_ENTRY_CANDIDATES_PER_SETUP = 4;
export const MAX_ENTRY_EVIDENCE_PER_CANDIDATE = 4;
export const MAX_ENTRY_EVIDENCE_PER_SETUP = 16;
export const MAX_ENTRY_HANDLING_PER_SETUP = 4;
```

The exact setup bundle keys are `s,d,f,c,e,h,q`. `s` is the setup ID, `d` is
`LONG|SHORT`, `f` is raw proof input, and `c/e/h/q` are diagnostics only.
Pine cannot compute SHA-256. Reject `candidate_id`, `evidence_id`,
`handling_id`, `batch_id`, `payload_sha256`, `transcript_sha256`, or any extra
producer-supplied hash field. Resolve local candidate indexes only after
requiring `c[].i` to be
the unique dense range `0..c.length-1`. Require `e[].i` to be the unique dense
range `0..e.length-1`; every `e[].ci` and `h[].ci` resolves a candidate, every
`h[].ei` resolves evidence, and the evidence referenced by `ei` has the same
`ci` as its handling row. Every producer candidate `c[].o` is exactly `1` in
this `INITIAL`-only producer increment. When `q` selects a candidate, `q.o` is
also exactly `1` and matches that candidate; `0`, `2`, and every other ordinal
are validation errors rather than diagnostic mismatches.

`e[]` is the already-bounded diagnostic transport for both replay and
realtime producer observations; do not add realtime facts to authoritative
`f.b` or `f.x`. During normalization, partition every `e[]` row with
`p="REALTIME_TICK"` into `ProducerDiagnostic.realtime_evidence`, preserve at
most the existing 16-evidence-per-setup bound, and keep those rows out of
`ProducerDiagnostic.evidence` used by parity comparison. A realtime row may
refer only to a validated `c[]` semantic candidate and must include
  `SHADOW_REALTIME_ONLY_NOT_REPLAYABLE`, non-null trigger epoch/ticks, fidelity
  `UNRESOLVED`, resolution `0`, and
  `coverage_start_epoch=coverage_end_epoch=observed_trigger_epoch`; it may not
  be referenced by authoritative
handling or selection. This is diagnostic-only transport and can never create
an event, candidate, terminal fact, evidence row, backend selection input, or
batch completion condition.

Expand each HTF transcript deterministically:

```ts
async function expandTranscript(
  setup: SetupEntryFacts,
  value: HtfTranscriptWire,
): Promise<HTFFlipProof> {
  const contact = value.cc === null ? null : expandCandle(value.cc);
  const recross = value.rc === null ? null : expandCandle(value.rc);
  const sameChild =
    contact !== null &&
    recross !== null &&
    canonicalStringify(contact) === canonicalStringify(recross);
  const opensInsideZone =
    contact !== null &&
    contact.open_ticks >= setup.zone_bottom_ticks &&
    contact.open_ticks <= setup.zone_top_ticks;
  const coverageComplete =
    value.gp === false &&
    value.ec === value.oc;
  const contactOverlaps =
    contact !== null &&
    contact.low_ticks <= setup.zone_top_ticks &&
    contact.high_ticks >= setup.zone_bottom_ticks;
  const recrosses =
    recross !== null &&
    (setup.direction === "LONG"
      ? recross.high_ticks > value.ao
      : recross.low_ticks < value.ao);
  const matched =
    contactOverlaps &&
    recrosses &&
    contact!.open_epoch <= recross!.open_epoch;
  const ambiguity_codes: AmbiguityCode[] = [];
  if (!coverageComplete) {
    ambiguity_codes.push("SHADOW_MISSING_INTRABAR_COVERAGE");
  }
  if (sameChild && !opensInsideZone) {
    ambiguity_codes.push("SHADOW_SAME_CHILD_BAR_ORDER");
  }
  const fidelity =
    matched &&
    coverageComplete &&
    value.lo &&
    !value.db &&
    (!sameChild || opensInsideZone)
      ? "EXACT"
      : "UNRESOLVED";
  const transcript: HTFFlipProofTranscript = {
    context_minutes: value.m,
    htf_open_epoch: value.ae,
    htf_open_ticks: value.ao,
    scan_cutoff_epoch: value.cu,
    proof_resolution_seconds: value.rs,
    coverage_start_epoch: value.cs,
    coverage_end_epoch: value.ce,
    expected_child_count: value.ec,
    observed_child_count: value.oc,
    gap_present: value.gp,
    full_lifecycle_ordered: value.lo,
    destination_seen_before_contact: value.db,
    contact_candle: contact,
    recross_candle: recross,
    same_child: value.sb,
  };
  const proofWithoutHash = {
    matched,
    event_anchor_epoch: value.ae,
    trigger_epoch: matched ? recross!.close_epoch : null,
    trigger_ticks: matched ? value.ao : null,
    htf_context_minutes: [value.m] as const,
    fidelity,
    proof_plane: "LOWER_TIMEFRAME_REPLAY" as const,
    proof_resolution_seconds: value.rs,
    coverage_start_epoch: value.cs,
    coverage_end_epoch: value.ce,
    coverage_expected_child_count: value.ec,
    coverage_observed_child_count: value.oc,
    coverage_gap_detected: value.gp,
    contact_child: contact,
    recross_child: recross,
    destination_seen_before_contact: value.db,
    ambiguity_codes,
    full_lifecycle_ordered: value.lo,
    transcript,
  };
  return {
    ...proofWithoutHash,
    transcript_sha256: await canonicalSha256(transcript),
  };
}
```

`HTFFlipProof.transcript_sha256` is exactly the canonical transcript hash, not
an evidence or transport hash. Make `expandTranscript()` asynchronous because
SHA-256 uses Web Crypto. Before
calling it, reject any non-integer transcript count, invalid OHLC, candle
outside `[cs,ce]`, `cs !== ae`, `ce !== cu`, `cu - ae <= 0`,
`cu - ae > m * 60`, cutoff or coverage length not aligned to `rs`, cutoff that
is not contained by exactly one `b` bar,
`ec !== (ce-cs)/rs`, `oc < 0`, `oc > ec`, or
`gp !== (oc !== ec)`. Require `sb` exactly when non-null `cc/rc` share their
open/close epochs; when `sb=true`, the two full OHLC objects must be equal.
Reject distinct children unless `cc.ce <= rc.oe`, contact that does not overlap
the full zone, or recross that does not use the strict wick predicate. A
same-child transcript is exact only when the child opens inside the zone.
Reject a
producer fidelity or ambiguity claim in `c/e` that contradicts the
edge-expanded transcript. Add a direct/vector case where contact and recross
are present but `db=true`: `matched` remains true, fidelity is `UNRESOLVED`,
and the backend evidence includes failed rule `ENTRY_HTF_ZONE_SIDE_FIRST`.

Implement local strict helpers equivalent to `validation.ts`:
`asObject`, `field`, `exactKeys`, `asArray`, `safeInteger`, `sha256`,
`wireIdentifier`, `literal`, and closed-enum guards. Enforce all of:

- `kind` is exactly lowercase `"snapshot"` or `"incremental"` and both use the
  same schema;
- `sequence` is a safe integer in `1..9_007_199_254_740_991`; zero is invalid
  for schema `2.0`;
- `chunk_count` is `1..12` and `chunk_index` is
  `0..chunk_count-1`;
- `detector_code_hash` and `settings_hash` are lowercase 64-hex strings and
  neither may be the all-zero placeholder;
- `idempotency_key` is exactly
  `${producer_instance_id}:${sequence}:${kind}:${bar_close_epoch}:${chunk_index}`;
- `b.length` is `1..4`, bars are contiguous oldest-first 5-minute candles
  within one uninterrupted market session, and
  its last bar's open/close epochs equal the top-level bar open/close epochs;
- `x.length <= 3`, contexts are unique/sorted `15,30,60`, and
  `proof_resolution_seconds` is exactly `60`; every transcript cutoff belongs
  to exactly one confirmed bar emitted in that same `b` array. Reject an
  orphan transcript and never synthesize a confirmed-bar event from `x`;
- one completed batch contains at most `256` setup bundles; a setup has at most
  `4` candidates, `4` evidence rows per candidate, `16` evidence rows total,
  and `4` handling rows;
- every diagnostic `sc` claim ID is unique, in generated
  `SOURCE_CLAIM_CATALOG`, and consistent with the server-owned model/rule
  tuple; producer video metadata is never accepted;
- each setup appears once per completed batch, not merely once per chunk;
- `f.ak` and all diagnostic handling attempts are exactly `INITIAL`;
- `f.et` is exactly `true`; a false/pre-start setup is not transportable;
- every diagnostic candidate ordinal is exactly `1`, and any non-null
  diagnostic selection references that same ordinal;
- `tr` and `te` are jointly null or jointly set. `te` identifies exactly one
  `b[].ce`, and the terminal is the last `b` bar. The sole possible following
  handling-only bar is encoded separately as `ng`, never appended to `b`; it
  must satisfy the closed grace constraints above. An `INVALIDATED` terminal
  event itself adds no candidate. For that reason, `iv=true` exactly when no
  active-model candidate was accumulated before invalidation; if one model was
  already observed while awaiting the other, `tr="INVALIDATED"` is valid with
  `iv=false` and the earlier candidate remains. `BOTH_ACTIVE_MODELS_OBSERVED`
  is accepted provisionally and Task 6 must verify both authoritative active
  models after processing the terminal event. `RETENTION_EVICTED` applies
  after the current scan and is the only expiry signal. `te` equals the last
  confirmed `b[].ce`; when there is no handling-only grace it equals top-level
  `bar_close_epoch`; never infer
  expiry from wall-clock age;
- `q.k === q.m + ":" + q.a + ":" + q.o` when selected. For `x="NONE"`,
  `k/m/a/o/f` are jointly null; for `x="SHADOW_ONLY"` they are jointly
  non-null and refer to one `c` item;
- `execution_mode` is exactly `OBSERVATION_ONLY`;
- top-level keys are exactly those in the valid fixture;
- canonical payload storage contains expanded named proof facts and diagnostics,
  never the envelope credential.

Add `validateEntryV2BodySize(body: Uint8Array)` and call it in
`postObservation()` after strict UTF-8 decoding but before JSON parsing or D1.
It rejects `text.length >= 35_000` with status `413` and code
`ENTRY_V2_MESSAGE_TOO_LARGE`. Unit-test a valid envelope padded only with legal
trailing JSON whitespace to exactly `34,999` characters (passes the size gate)
and `35,000` (fails before D1).

Derive, but do not yet hash:

```ts
const batchIdentity: EntryBatchSemanticIdentity = {
  producer_instance_id: producerInstanceId,
  sequence,
  kind,
  bar_close_epoch: barCloseEpoch,
};
const batchMetadata: EntryBatchImmutableMetadata = {
  strategy_id: strategyId,
  strategy_version: strategyVersion,
  rule_contract_version: ruleContractVersion,
  execution_mode: executionMode,
  symbol,
  ticker_id: tickerId,
  feed,
  timeframe,
  tick_size: tickSize,
  bar_open_epoch: barOpenEpoch,
  detector_code_hash: detectorCodeHash,
  settings_hash: settingsHash,
};
```

Every chunk repeats that semantic identity, immutable metadata, and
`chunk_count`; only
`chunk_index`, its semantic-plus-index idempotency key, and setup slice differ.
Task 6 requires byte-identical metadata across all chunks and computes the
authoritative batch SHA-256 from the semantic identity.

- [ ] **Step 4: Dispatch v2 without weakening legacy validation**

Change `ValidatedObservation` in `types.ts` to:

```ts
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
    };
```

In `validateObservationEnvelope()`, read `payload.schema_version` after strict
envelope parsing:

```ts
if (field(payloadObject, "schema_version") === "2.0") {
  const value = validateEntryV2Payload(field(envelope, "payload"));
  return {
    version: "entry-v2",
    credential,
    ...value,
    paperCommands: [],
  };
}
const legacy = validatePayload(field(envelope, "payload"));
return {
  version: "legacy",
  credential,
  ...legacy,
};
```

Do not alter `validatePayload()`, `validateCommon()`, `validateRuleEvidence()`,
or `extractSetupEvidence()`.

- [ ] **Step 5: Run dual-version validation for GREEN**

Run:

```bash
cd apps/observation-edge
npx vitest run test/rd-entry-wire.test.ts test/worker.test.ts
npm run typecheck
```

Expected: compact v2 cases pass and every existing legacy worker test remains
green.

- [ ] **Step 6: Commit strict wire validation**

```bash
git add apps/observation-edge/src/rd-entry-wire.ts \
  apps/observation-edge/src/types.ts \
  apps/observation-edge/src/validation.ts \
  apps/observation-edge/test/rd-entry-wire.test.ts
git commit -m "feat: validate compact RD entry schema 2.0"
```

---

### Task 4: Admit schema 2.0 receipts without changing legacy rows

**Files:**
- Create: `apps/observation-edge/migrations/0022_observation_receipts_entry_v2.sql`
- Modify: `apps/observation-edge/src/types.ts:3`
- Modify: `apps/observation-edge/test/worker.test.ts:968`

**Interfaces:**
- Consumes: existing `observation_receipts` and both existing foreign-key consumers.
- Produces: one receipt table accepting the four exact schema/strategy pairs.
- Preserves: existing receipt IDs, payload hashes, indexes, and foreign-key references.

- [ ] **Step 1: Write the failing migration contract test**

Add to the `deployment contract` block in `worker.test.ts`:

```ts
it("admits entry schema 2.0 while copying every legacy receipt", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const migration = readFileSync(
    `${root}/migrations/0022_observation_receipts_entry_v2.sql`,
    "utf8",
  ).toLowerCase();

  expect(migration).toContain("pragma defer_foreign_keys = on");
  expect(migration).toContain(
    "schema_version in ('1.0', '1.1', '1.2', '2.0')",
  );
  expect(migration).toContain(
    "(schema_version = '2.0' and strategy_version = '2.0.0-contract2')",
  );
  expect(migration).toContain(
    "(schema_version = '2.0' and sequence >= 1)",
  );
  expect(migration).toContain(
    "(schema_version in ('1.0', '1.1', '1.2') and sequence >= 0)",
  );
  expect(migration).toContain("insert into observation_receipts_entry_v2");
  expect(migration).toContain("from observation_receipts");
  expect(migration).toContain("pragma foreign_key_check");
  expect(migration).not.toMatch(
    /^\s*(credential|payload|raw_payload|canonical_payload)\s+text/gmu,
  );
});
```

- [ ] **Step 2: Run the migration test and verify RED**

Run:

```bash
cd apps/observation-edge
npx vitest run test/worker.test.ts -t "admits entry schema 2.0"
```

Expected: FAIL with `ENOENT` for migration `0022`.

- [ ] **Step 3: Create the complete receipt rebuild migration**

Create `0022_observation_receipts_entry_v2.sql`:

```sql
PRAGMA defer_foreign_keys = ON;

CREATE TABLE observation_receipts_entry_v2 (
    receipt_id TEXT PRIMARY KEY NOT NULL,
    received_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL,
    schema_version TEXT NOT NULL
        CHECK (schema_version IN ('1.0', '1.1', '1.2', '2.0')),
    strategy_id TEXT NOT NULL
        CHECK (strategy_id = 'rd_liquidity_sd_5m_v1'),
    strategy_version TEXT NOT NULL
        CHECK (
            (schema_version = '1.0' AND strategy_version = '1.0.0-phase1')
            OR
            (schema_version = '1.1' AND strategy_version = '1.1.0-paper1')
            OR
            (schema_version = '1.2' AND strategy_version = '1.2.0-contract1')
            OR
            (schema_version = '2.0' AND strategy_version = '2.0.0-contract2')
        ),
    producer_instance_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (
        (schema_version = '2.0' AND sequence >= 1)
        OR
        (schema_version IN ('1.0', '1.1', '1.2') AND sequence >= 0)
    ),
    symbol TEXT NOT NULL,
    ticker_id TEXT NOT NULL,
    feed TEXT NOT NULL,
    timeframe TEXT NOT NULL CHECK (timeframe = '5'),
    kind TEXT NOT NULL CHECK (kind IN ('incremental', 'snapshot')),
    CHECK (
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    )
) STRICT;

INSERT INTO observation_receipts_entry_v2 (
    receipt_id, received_at, idempotency_key, payload_sha256,
    schema_version, strategy_id, strategy_version, producer_instance_id,
    sequence, symbol, ticker_id, feed, timeframe, kind
)
SELECT
    receipt_id, received_at, idempotency_key, payload_sha256,
    schema_version, strategy_id, strategy_version, producer_instance_id,
    sequence, symbol, ticker_id, feed, timeframe, kind
FROM observation_receipts;

DROP TABLE observation_receipts;

ALTER TABLE observation_receipts_entry_v2
    RENAME TO observation_receipts;

CREATE INDEX idx_observation_receipts_received
    ON observation_receipts(received_at DESC, receipt_id DESC);

CREATE INDEX idx_observation_receipts_producer_sequence
    ON observation_receipts(producer_instance_id, sequence DESC);

PRAGMA foreign_key_check;
PRAGMA defer_foreign_keys = OFF;
```

- [ ] **Step 4: Extend receipt TypeScript literals**

Change:

```ts
export type ObservationSchemaVersion = "1.0" | "1.1" | "1.2" | "2.0";
export type StrategyVersion =
  | "1.0.0-phase1"
  | "1.1.0-paper1"
  | "1.2.0-contract1"
  | "2.0.0-contract2";
```

Keep the strategy ID and timeframe unchanged.

- [ ] **Step 5: Apply migrations locally and run GREEN**

Run:

```bash
cd apps/observation-edge
npm run db:migrate:local
npx vitest run test/worker.test.ts -t "deployment contract"
npm run typecheck
```

Expected: local D1 applies `0022`, all deployment-contract tests pass, and
TypeScript reports no errors.

Add an executable migration test that seeds schema `1.0`, `1.1`, and `1.2`
receipts with `sequence=0`, plus rows in each existing foreign-key consumer,
applies `0022`, and proves every receipt ID and foreign key survives. Prove a
new schema `2.0` sequence zero is rejected. Before deployment, run this
version-conditional read-only preflight and require zero:

```sql
SELECT COUNT(*)
FROM observation_receipts
WHERE sequence < 0
   OR (schema_version = '2.0' AND sequence < 1);
```

Legacy zero is valid historical metadata and is never renumbered; only a
negative legacy sequence or non-positive schema `2.0` sequence fails closed.

- [ ] **Step 6: Commit receipt compatibility**

```bash
git add apps/observation-edge/migrations/0022_observation_receipts_entry_v2.sql \
  apps/observation-edge/src/types.ts \
  apps/observation-edge/test/worker.test.ts
git commit -m "feat: admit RD entry schema 2.0 receipts"
```

---

### Task 5: Create immutable D1 entry projections and chunk assembly tables

**Files:**
- Create: `apps/observation-edge/migrations/0023_observation_entries.sql`
- Create: `apps/observation-edge/src/rd-entry-queries.ts`
- Modify: `apps/observation-edge/src/types.ts:151`
- Modify: `apps/observation-edge/test/worker.test.ts:994`

**Interfaces:**
- Consumes: schema `2.0` receipts from Task 4.
- Produces: immutable batch/chunk/completion, candidate, evidence, handling,
  producer diagnostic, authoritative selection, evaluation membership, parity,
  source-claim, terminal, and quarantine records.
- Produces: SQL constants consumed by the v2 store and read API.

- [ ] **Step 1: Write the failing strict-storage contract test**

Add to `worker.test.ts`:

```ts
it("defines immutable normalized entry storage and parity audit rows", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const migration = readFileSync(
    `${root}/migrations/0023_observation_entries.sql`,
    "utf8",
  ).toLowerCase();

  for (const table of [
    "observation_entry_batches",
    "observation_market_bar_heartbeats",
    "observation_entry_chunks",
    "observation_entry_batch_completions",
    "observation_entry_setup_events",
    "observation_entry_setup_terminals",
    "observation_entry_candidates",
    "observation_entry_candidate_evidence",
    "observation_entry_handling",
    "observation_entry_producer_diagnostics",
    "observation_entry_selections",
    "observation_entry_evaluation_members",
    "observation_entry_parity",
    "observation_entry_source_claims",
    "observation_entry_source_claim_relationships",
    "observation_entry_quarantine",
  ]) {
    expect(migration).toContain(`create table ${table}`);
  }
  expect(migration).toContain("paper_eligible");
  expect(migration).toContain("shadow_only");
  expect(migration).not.toMatch(/execute|broker|order_command/u);
  expect(migration).toContain("entry candidates are immutable");
  expect(migration).toContain("entry evidence is append-only");
  expect(migration).toContain("entry selections are immutable");
  expect(migration).toContain("pragma foreign_key_check");
});
```

- [ ] **Step 2: Run the storage test and verify RED**

Run:

```bash
cd apps/observation-edge
npx vitest run test/worker.test.ts -t "defines immutable normalized"
```

Expected: FAIL with `ENOENT` for migration `0023`.

- [ ] **Step 3: Create batch, chunk, completion, and source-authority tables**

Start `0023_observation_entries.sql` with:

```sql
CREATE TABLE observation_entry_batches (
    batch_id TEXT PRIMARY KEY NOT NULL,
    producer_instance_id TEXT NOT NULL,
    producer_sequence INTEGER NOT NULL CHECK (producer_sequence >= 1),
    kind TEXT NOT NULL CHECK (kind IN ('snapshot', 'incremental')),
    bar_close_epoch INTEGER NOT NULL CHECK (bar_close_epoch >= 0),
    strategy_id TEXT NOT NULL CHECK (strategy_id = 'rd_liquidity_sd_5m_v1'),
    strategy_version TEXT NOT NULL
        CHECK (strategy_version = '2.0.0-contract2'),
    rule_contract_version TEXT NOT NULL CHECK (rule_contract_version = '2.0.0'),
    execution_mode TEXT NOT NULL CHECK (execution_mode = 'OBSERVATION_ONLY'),
    symbol TEXT NOT NULL,
    ticker_id TEXT NOT NULL,
    feed TEXT NOT NULL,
    timeframe TEXT NOT NULL CHECK (timeframe = '5'),
    tick_size TEXT NOT NULL,
    bar_open_epoch INTEGER NOT NULL
        CHECK (bar_close_epoch = bar_open_epoch + 300),
    detector_code_hash TEXT NOT NULL CHECK (
        length(detector_code_hash) = 64
        AND detector_code_hash NOT GLOB '*[^0-9a-f]*'
        AND detector_code_hash <>
            '0000000000000000000000000000000000000000000000000000000000000000'
    ),
    settings_hash TEXT NOT NULL CHECK (
        length(settings_hash) = 64
        AND settings_hash NOT GLOB '*[^0-9a-f]*'
        AND settings_hash <>
            '0000000000000000000000000000000000000000000000000000000000000000'
    ),
    chunk_count INTEGER NOT NULL CHECK (chunk_count BETWEEN 1 AND 12),
    first_receipt_id TEXT NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    first_seen_at TEXT NOT NULL,
    CHECK (
        length(batch_id) = 64
        AND batch_id NOT GLOB '*[^0-9a-f]*'
    ),
    UNIQUE (producer_instance_id, producer_sequence),
    UNIQUE (producer_instance_id, bar_close_epoch)
) STRICT;

CREATE TABLE observation_market_bar_heartbeats (
    receipt_id TEXT PRIMARY KEY NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    batch_id TEXT
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    schema_version TEXT NOT NULL CHECK (schema_version IN ('1.2', '2.0')),
    producer_role TEXT NOT NULL
        CHECK (producer_role IN ('LEGACY_REFERENCE', 'ENTRY_V3_CANARY')),
    producer_instance_id TEXT NOT NULL,
    producer_sequence INTEGER NOT NULL CHECK (
        (schema_version = '1.2' AND producer_sequence >= 0)
        OR (schema_version = '2.0' AND producer_sequence >= 1)
    ),
    strategy_version TEXT NOT NULL CHECK (
        (schema_version = '1.2' AND strategy_version = '1.2.0-contract1')
        OR
        (schema_version = '2.0' AND strategy_version = '2.0.0-contract2')
    ),
    symbol TEXT NOT NULL,
    ticker_id TEXT NOT NULL,
    feed TEXT NOT NULL,
    timeframe TEXT NOT NULL CHECK (timeframe = '5'),
    bar_open_epoch INTEGER NOT NULL CHECK (bar_open_epoch >= 0),
    bar_close_epoch INTEGER NOT NULL
        CHECK (bar_close_epoch = bar_open_epoch + 300),
    detector_code_hash TEXT CHECK (
        detector_code_hash IS NULL
        OR (
            length(detector_code_hash) = 64
            AND detector_code_hash NOT GLOB '*[^0-9a-f]*'
        )
    ),
    settings_hash TEXT CHECK (
        settings_hash IS NULL
        OR (
            length(settings_hash) = 64
            AND settings_hash NOT GLOB '*[^0-9a-f]*'
        )
    ),
    recorded_at TEXT NOT NULL,
    CHECK (
        (
            schema_version = '1.2'
            AND producer_role = 'LEGACY_REFERENCE'
            AND batch_id IS NULL
        )
        OR
        (
            schema_version = '2.0'
            AND producer_role = 'ENTRY_V3_CANARY'
            AND batch_id IS NOT NULL
            AND detector_code_hash IS NOT NULL
            AND settings_hash IS NOT NULL
        )
    )
) STRICT;

CREATE TABLE observation_entry_chunks (
    batch_id TEXT NOT NULL
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    chunk_index INTEGER NOT NULL CHECK (chunk_index BETWEEN 0 AND 11),
    chunk_count INTEGER NOT NULL CHECK (chunk_count BETWEEN 1 AND 12),
    receipt_id TEXT NOT NULL UNIQUE
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    payload_sha256 TEXT NOT NULL,
    validated_payload_json TEXT NOT NULL
        CHECK (
            json_valid(validated_payload_json)
            AND json_type(validated_payload_json) = 'object'
        ),
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (batch_id, chunk_index),
    CHECK (chunk_index < chunk_count),
    CHECK (
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    )
) STRICT;

CREATE TABLE observation_entry_batch_completions (
    completion_id TEXT PRIMARY KEY NOT NULL,
    batch_id TEXT NOT NULL UNIQUE
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    assembled_payload_sha256 TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    CHECK (
        length(completion_id) = 64
        AND completion_id NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (
        length(assembled_payload_sha256) = 64
        AND assembled_payload_sha256 NOT GLOB '*[^0-9a-f]*'
    )
) STRICT;

CREATE TABLE observation_entry_setup_events (
    event_id TEXT PRIMARY KEY NOT NULL,
    setup_id TEXT NOT NULL,
    batch_id TEXT NOT NULL
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    receipt_id TEXT NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    confirmed_bar_close_epoch INTEGER NOT NULL
        CHECK (confirmed_bar_close_epoch >= 0),
    proof_input_sha256 TEXT NOT NULL,
    proof_input_json TEXT NOT NULL CHECK (
        json_valid(proof_input_json)
        AND json_type(proof_input_json) = 'object'
    ),
    recorded_at TEXT NOT NULL,
    UNIQUE (setup_id, confirmed_bar_close_epoch),
    CHECK (
        length(event_id) = 64
        AND event_id NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (
        length(proof_input_sha256) = 64
        AND proof_input_sha256 NOT GLOB '*[^0-9a-f]*'
    )
) STRICT;

CREATE TABLE observation_entry_setup_terminals (
    setup_id TEXT PRIMARY KEY NOT NULL,
    terminal_reason TEXT NOT NULL CHECK (
        terminal_reason IN (
            'INVALIDATED',
            'BOTH_ACTIVE_MODELS_OBSERVED',
            'RETENTION_EVICTED'
        )
    ),
    terminal_epoch INTEGER NOT NULL CHECK (terminal_epoch >= 0),
    first_batch_id TEXT NOT NULL
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    first_receipt_id TEXT NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    recorded_at TEXT NOT NULL
) STRICT;

CREATE TABLE observation_entry_source_claims (
    claim_id TEXT PRIMARY KEY NOT NULL,
    contract_version TEXT NOT NULL CHECK (contract_version = '2.0.0'),
    source_id TEXT NOT NULL,
    youtube_video_id TEXT NOT NULL,
    published_date TEXT NOT NULL,
    title_snapshot TEXT NOT NULL,
    channel_id TEXT NOT NULL CHECK (channel_id = 'UC54xbL96tU58iez3YbTVTAg'),
    channel_handle TEXT NOT NULL CHECK (channel_handle = '@RD_Forex'),
    timestamp_start_seconds INTEGER NOT NULL CHECK (timestamp_start_seconds >= 0),
    timestamp_end_seconds INTEGER NOT NULL
        CHECK (timestamp_end_seconds > timestamp_start_seconds),
    relationship TEXT NOT NULL
        CHECK (relationship IN ('SUPPORTS', 'NARROWS', 'SUPERSEDES')),
    summary TEXT NOT NULL
) STRICT;

CREATE TABLE observation_entry_source_claim_relationships (
    claim_id TEXT PRIMARY KEY NOT NULL
        REFERENCES observation_entry_source_claims(claim_id) ON DELETE RESTRICT,
    target_claim_id TEXT NOT NULL
        REFERENCES observation_entry_source_claims(claim_id) ON DELETE RESTRICT,
    CHECK (claim_id <> target_claim_id)
) STRICT;
```

The Task 6 store inserts the exact `claims_by_id` and `sources_by_id` records
from `config/phase0/rd-strategy-rule-contract-v2.json` through generated
`SOURCE_CLAIM_CATALOG`; producers may only reference those IDs.
`observation_market_bar_heartbeats` is a generic, server-owned projection
populated immediately after authentication for both compatible producers:

- accepted schema `1.2` V2 observations become `LEGACY_REFERENCE`;
- accepted schema `2.0` V3 chunks become `ENTRY_V3_CANARY`.

The client never supplies `producer_role`. For legacy schema `1.2`, use the
existing validated confirmed-five-minute bar fields, require millisecond
timestamps to be exactly divisible by `1000`, and normalize them to epoch
seconds before insert. For V3, use the already validated epoch-second fields.
Add a test proving a legacy V2 and V3 observation of the same market bar
normalize to the same `{symbol,ticker_id,feed,timeframe,bar_open_epoch,
bar_close_epoch}` schedule key. The reference row retains receipt, schema,
strategy, producer, and optional code-hash provenance, but its detector,
settings, strategy version, and producer ID are never required to equal V3.
Compatibility is only exact market identity plus the server-derived allowlisted
`LEGACY_REFERENCE` role. This projection is independent of batch completion,
setup presence, diagnostics, and arbitration; duplicate V3 chunks for one
semantic batch share a bar epoch and are deduplicated by semantic batch in
continuity queries.

- [ ] **Step 4: Add normalized candidate, evidence, handling, and selection tables**

Append:

```sql
CREATE TABLE observation_entry_candidates (
    candidate_id TEXT PRIMARY KEY NOT NULL,
    setup_id TEXT NOT NULL,
    model TEXT NOT NULL CHECK (
        model IN (
            'DIR_CLOSE', 'HTF_FLIP',
            'LEGACY_BREAK_CANDLE', 'LEGACY_REJECTION_RESPECT'
        )
    ),
    state TEXT NOT NULL
        CHECK (state IN ('MATCHED', 'BLOCKED', 'REJECTED', 'NORMALIZED')),
    event_anchor_epoch INTEGER NOT NULL CHECK (event_anchor_epoch >= 0),
    trigger_ordinal INTEGER NOT NULL CHECK (trigger_ordinal >= 1),
    direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
    source_claim_ids_json TEXT NOT NULL CHECK (
        json_valid(source_claim_ids_json)
        AND json_type(source_claim_ids_json) = 'array'
        AND json_array_length(source_claim_ids_json) BETWEEN 1 AND 16
    ),
    normalized_from TEXT CHECK (
        normalized_from IS NULL
        OR normalized_from IN (
            'LEGACY_BREAK_CANDLE', 'LEGACY_REJECTION_RESPECT'
        )
    ),
    identity_sha256 TEXT NOT NULL UNIQUE,
    first_receipt_id TEXT NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    observed_at_epoch INTEGER NOT NULL CHECK (observed_at_epoch >= 0),
    CHECK (
        length(candidate_id) = 64
        AND candidate_id NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (candidate_id = identity_sha256)
) STRICT;

CREATE TABLE observation_entry_candidate_evidence (
    evidence_id TEXT PRIMARY KEY NOT NULL,
    candidate_id TEXT NOT NULL
        REFERENCES observation_entry_candidates(candidate_id) ON DELETE RESTRICT,
    receipt_id TEXT NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    observed_trigger_epoch INTEGER
        CHECK (observed_trigger_epoch IS NULL OR observed_trigger_epoch >= 0),
    observed_trigger_ticks INTEGER,
    htf_context_minutes_json TEXT NOT NULL CHECK (
        json_valid(htf_context_minutes_json)
        AND json_type(htf_context_minutes_json) = 'array'
        AND json_array_length(htf_context_minutes_json) BETWEEN 0 AND 3
    ),
    fidelity TEXT NOT NULL CHECK (
        fidelity IN ('EXACT', 'CALIBRATED', 'DISCRETIONARY', 'UNRESOLVED')
    ),
    proof_plane TEXT NOT NULL CHECK (
        proof_plane IN (
            'CONFIRMED_5M', 'LOWER_TIMEFRAME_REPLAY',
            'EXTERNAL_ARCHIVED_TICK'
        )
    ),
    proof_resolution_seconds INTEGER NOT NULL
        CHECK (proof_resolution_seconds > 0),
    coverage_start_epoch INTEGER NOT NULL CHECK (coverage_start_epoch >= 0),
    coverage_end_epoch INTEGER NOT NULL
        CHECK (coverage_end_epoch > coverage_start_epoch),
    ambiguity_codes_json TEXT NOT NULL CHECK (
        json_valid(ambiguity_codes_json)
        AND json_type(ambiguity_codes_json) = 'array'
    ),
    passed_rule_ids_json TEXT NOT NULL CHECK (
        json_valid(passed_rule_ids_json)
        AND json_type(passed_rule_ids_json) = 'array'
    ),
    failed_rule_ids_json TEXT NOT NULL CHECK (
        json_valid(failed_rule_ids_json)
        AND json_type(failed_rule_ids_json) = 'array'
    ),
    source_claim_ids_json TEXT NOT NULL CHECK (
        json_valid(source_claim_ids_json)
        AND json_type(source_claim_ids_json) = 'array'
        AND json_array_length(source_claim_ids_json) BETWEEN 1 AND 16
    ),
    payload_sha256 TEXT NOT NULL,
    identity_sha256 TEXT NOT NULL UNIQUE,
    observed_at_epoch INTEGER NOT NULL CHECK (observed_at_epoch >= 0),
    CHECK (
        length(evidence_id) = 64
        AND evidence_id NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (evidence_id = identity_sha256),
    CHECK (
        (observed_trigger_epoch IS NULL) =
        (observed_trigger_ticks IS NULL)
    )
) STRICT;

CREATE TABLE observation_entry_handling (
    handling_id TEXT PRIMARY KEY NOT NULL,
    candidate_id TEXT NOT NULL
        REFERENCES observation_entry_candidates(candidate_id) ON DELETE RESTRICT,
    evidence_id TEXT NOT NULL
        REFERENCES observation_entry_candidate_evidence(evidence_id)
        ON DELETE RESTRICT,
    receipt_id TEXT NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    handling_mode TEXT NOT NULL CHECK (
        handling_mode IN (
            'CLOSE_CONFIRMATION', 'INTRABAR_FLIP',
            'NEXT_CANDLE_WICK', 'AGGRESSIVE'
        )
    ),
    attempt_kind TEXT NOT NULL CHECK (attempt_kind IN ('INITIAL', 'RE_ENTRY')),
    observed_epoch INTEGER NOT NULL CHECK (observed_epoch >= 0),
    observed_ticks INTEGER,
    fidelity TEXT NOT NULL CHECK (
        fidelity IN ('EXACT', 'CALIBRATED', 'DISCRETIONARY', 'UNRESOLVED')
    ),
    source_claim_ids_json TEXT NOT NULL CHECK (
        json_valid(source_claim_ids_json)
        AND json_type(source_claim_ids_json) = 'array'
        AND json_array_length(source_claim_ids_json) BETWEEN 1 AND 16
    ),
    identity_sha256 TEXT NOT NULL UNIQUE,
    CHECK (
        length(handling_id) = 64
        AND handling_id NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (handling_id = identity_sha256)
) STRICT;

CREATE TABLE observation_entry_producer_diagnostics (
    diagnostic_id TEXT PRIMARY KEY NOT NULL,
    batch_id TEXT NOT NULL
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    setup_id TEXT NOT NULL,
    candidate_refs_json TEXT NOT NULL CHECK (json_valid(candidate_refs_json)),
    evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
    realtime_evidence_refs_json TEXT NOT NULL CHECK (
        json_valid(realtime_evidence_refs_json)
        AND json_type(realtime_evidence_refs_json) = 'array'
        AND json_array_length(realtime_evidence_refs_json) BETWEEN 0 AND 16
    ),
    handling_refs_json TEXT NOT NULL CHECK (json_valid(handling_refs_json)),
    diagnostic_selection_json TEXT CHECK (
        diagnostic_selection_json IS NULL
        OR json_valid(diagnostic_selection_json)
    ),
    observed_at TEXT NOT NULL
) STRICT;

CREATE TABLE observation_entry_selections (
    selection_id TEXT PRIMARY KEY NOT NULL,
    batch_id TEXT NOT NULL
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    setup_id TEXT NOT NULL,
    policy_version TEXT NOT NULL
        CHECK (policy_version = 'rd-entry-arbitration-v2'),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    candidate_ids_considered_json TEXT NOT NULL CHECK (
        json_valid(candidate_ids_considered_json)
        AND json_type(candidate_ids_considered_json) = 'array'
    ),
    canonical_candidate_id TEXT
        REFERENCES observation_entry_candidates(candidate_id) ON DELETE RESTRICT,
    canonical_evidence_id TEXT
        REFERENCES observation_entry_candidate_evidence(evidence_id)
        ON DELETE RESTRICT,
    canonical_model TEXT CHECK (
        canonical_model IS NULL
        OR canonical_model IN ('DIR_CLOSE', 'HTF_FLIP')
    ),
    reason TEXT NOT NULL CHECK (
        reason IN (
            'ONLY_EXACT_TRIGGER', 'EARLIEST_EXACT_TRIGGER',
            'FALLBACK_TO_CONFIRMED_CLOSE', 'NO_EXACT_CANDIDATE',
            'UNRESOLVED_SOURCE_PRIORITY', 'SETUP_INVALIDATED', 'NO_CANDIDATE'
        )
    ),
    fidelity TEXT CHECK (
        fidelity IS NULL
        OR fidelity IN ('EXACT', 'CALIBRATED', 'DISCRETIONARY', 'UNRESOLVED')
    ),
    policy_action TEXT NOT NULL CHECK (
        policy_action IN ('OBSERVE', 'PAPER_ELIGIBLE', 'SHADOW_ONLY', 'NONE')
    ),
    action TEXT NOT NULL CHECK (
        action IN ('OBSERVE', 'PAPER_ELIGIBLE', 'SHADOW_ONLY', 'NONE')
    ),
    effective_action_reason TEXT CHECK (
        effective_action_reason IS NULL
        OR effective_action_reason = 'PROMOTION_IDENTITY_MISMATCH'
    ),
    evaluated_at_epoch INTEGER NOT NULL CHECK (evaluated_at_epoch >= 0),
    UNIQUE (setup_id, policy_version, revision),
    CHECK (
        length(selection_id) = 64
        AND selection_id NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (
        (canonical_candidate_id IS NULL) =
        (canonical_evidence_id IS NULL)
        AND (canonical_candidate_id IS NULL) =
            (canonical_model IS NULL)
    )
) STRICT;

CREATE TABLE observation_entry_evaluation_members (
    selection_id TEXT NOT NULL
        REFERENCES observation_entry_selections(selection_id)
        ON DELETE RESTRICT,
    object_kind TEXT NOT NULL
        CHECK (object_kind IN ('CANDIDATE', 'EVIDENCE', 'HANDLING')),
    object_id TEXT NOT NULL,
    PRIMARY KEY (selection_id, object_kind, object_id)
) STRICT;

CREATE TABLE observation_entry_parity (
    parity_id TEXT PRIMARY KEY NOT NULL,
    batch_id TEXT NOT NULL
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    setup_id TEXT NOT NULL,
    producer_diagnostic_id TEXT NOT NULL
        REFERENCES observation_entry_producer_diagnostics(diagnostic_id)
        ON DELETE RESTRICT,
    selection_id TEXT NOT NULL
        REFERENCES observation_entry_selections(selection_id) ON DELETE RESTRICT,
    parity_status TEXT NOT NULL
        CHECK (parity_status IN ('MATCH', 'MISMATCH', 'NOT_PROVIDED')),
    mismatch_reason TEXT CHECK (
        mismatch_reason IS NULL
        OR mismatch_reason IN (
            'CANDIDATE_KEYS', 'EVIDENCE_DESCRIPTORS',
            'HANDLING_DESCRIPTORS', 'SELECTED_CANDIDATE',
            'REASON', 'FIDELITY', 'DIAGNOSTIC_ACTION', 'MULTIPLE'
        )
    ),
    compared_at TEXT NOT NULL,
    CHECK (
        (parity_status = 'MATCH' AND mismatch_reason IS NULL)
        OR (parity_status = 'NOT_PROVIDED' AND mismatch_reason IS NULL)
        OR (parity_status = 'MISMATCH' AND mismatch_reason IS NOT NULL)
    )
) STRICT;

CREATE TABLE observation_entry_quarantine (
    quarantine_id TEXT PRIMARY KEY NOT NULL,
    receipt_id TEXT
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    batch_id TEXT,
    producer_instance_id TEXT,
    producer_sequence INTEGER
        CHECK (producer_sequence IS NULL OR producer_sequence >= 1),
    presented_bar_close_epoch INTEGER
        CHECK (
            presented_bar_close_epoch IS NULL
            OR presented_bar_close_epoch >= 0
        ),
    object_kind TEXT NOT NULL CHECK (
        object_kind IN (
            'BATCH', 'CHUNK', 'SETUP_EVENT', 'SETUP_TERMINAL',
            'CANDIDATE', 'EVIDENCE', 'HANDLING'
        )
    ),
    object_id TEXT NOT NULL,
    existing_sha256 TEXT,
    presented_sha256 TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (
        reason IN (
            'IMMUTABLE_ID_CONFLICT', 'INCONSISTENT_CHUNK_COUNT',
            'INCONSISTENT_BATCH_METADATA',
            'DUPLICATE_SETUP_ACROSS_CHUNKS', 'BATCH_SETUP_LIMIT',
            'INCOMPLETE_BATCH', 'EVENT_STREAM_CONTEXT_MISSING',
            'EVENT_STREAM_CONFLICT', 'TERMINAL_FACT_CONFLICT',
            'SEQUENCE_CONFLICT', 'BAR_CLOSE_CONFLICT',
            'SEQUENCE_TIME_CONFLICT', 'PRODUCER_IDENTITY_CONFLICT'
        )
    ),
    quarantined_at TEXT NOT NULL,
    CHECK (
        reason NOT IN (
            'SEQUENCE_CONFLICT', 'BAR_CLOSE_CONFLICT',
            'SEQUENCE_TIME_CONFLICT', 'PRODUCER_IDENTITY_CONFLICT'
        )
        OR (
            producer_instance_id IS NOT NULL
            AND producer_sequence IS NOT NULL
            AND presented_bar_close_epoch IS NOT NULL
        )
    )
) STRICT;
```

`observation_entry_candidate_evidence` is authoritative replay/archive proof
storage and therefore cannot contain `REALTIME_TICK`; realtime rows live only
inside `observation_entry_producer_diagnostics.realtime_evidence_refs_json`.
The migration contract test must assert the authoritative table's closed proof
plane set omits realtime, while the diagnostic JSON validator requires
realtime coverage start/end to equal the trigger epoch and resolution `0`.

- [ ] **Step 5: Add indexes and immutable triggers**

Append:

```sql
CREATE INDEX idx_entry_chunks_batch
    ON observation_entry_chunks(batch_id, chunk_index);
CREATE INDEX idx_market_bar_heartbeat_schedule
    ON observation_market_bar_heartbeats(
        producer_role, symbol, ticker_id, feed, timeframe, bar_close_epoch
    );
CREATE INDEX idx_entry_batches_producer_sequence
    ON observation_entry_batches(producer_instance_id, producer_sequence);
CREATE INDEX idx_entry_candidates_setup
    ON observation_entry_candidates(setup_id, observed_at_epoch DESC);
CREATE INDEX idx_entry_candidates_model
    ON observation_entry_candidates(model, observed_at_epoch DESC);
CREATE INDEX idx_entry_evidence_candidate
    ON observation_entry_candidate_evidence(candidate_id, observed_at_epoch DESC);
CREATE INDEX idx_entry_evidence_fidelity
    ON observation_entry_candidate_evidence(fidelity, observed_at_epoch DESC);
CREATE INDEX idx_entry_selections_setup_revision
    ON observation_entry_selections(setup_id, revision DESC);
CREATE INDEX idx_entry_selections_reason
    ON observation_entry_selections(reason, evaluated_at_epoch DESC);
CREATE INDEX idx_entry_parity_status
    ON observation_entry_parity(parity_status, compared_at DESC);
CREATE INDEX idx_entry_evaluation_members_selection
    ON observation_entry_evaluation_members(selection_id, object_kind);
CREATE INDEX idx_entry_terminals_epoch
    ON observation_entry_setup_terminals(terminal_epoch, setup_id);
CREATE INDEX idx_entry_setup_events_stream
    ON observation_entry_setup_events(
        setup_id, confirmed_bar_close_epoch, event_id
    );

CREATE TRIGGER observation_entry_candidates_no_update
BEFORE UPDATE ON observation_entry_candidates
BEGIN
    SELECT RAISE(ABORT, 'entry candidates are immutable');
END;
CREATE TRIGGER observation_entry_candidates_no_delete
BEFORE DELETE ON observation_entry_candidates
BEGIN
    SELECT RAISE(ABORT, 'entry candidates are append-only');
END;
CREATE TRIGGER observation_entry_evidence_no_update
BEFORE UPDATE ON observation_entry_candidate_evidence
BEGIN
    SELECT RAISE(ABORT, 'entry evidence is immutable');
END;
CREATE TRIGGER observation_entry_evidence_no_delete
BEFORE DELETE ON observation_entry_candidate_evidence
BEGIN
    SELECT RAISE(ABORT, 'entry evidence is append-only');
END;
CREATE TRIGGER observation_entry_handling_no_update
BEFORE UPDATE ON observation_entry_handling
BEGIN
    SELECT RAISE(ABORT, 'entry handling is immutable');
END;
CREATE TRIGGER observation_entry_handling_no_delete
BEFORE DELETE ON observation_entry_handling
BEGIN
    SELECT RAISE(ABORT, 'entry handling is append-only');
END;
CREATE TRIGGER observation_entry_selections_no_update
BEFORE UPDATE ON observation_entry_selections
BEGIN
    SELECT RAISE(ABORT, 'entry selections are immutable');
END;
CREATE TRIGGER observation_entry_selections_no_delete
BEFORE DELETE ON observation_entry_selections
BEGIN
    SELECT RAISE(ABORT, 'entry selections are append-only');
END;

PRAGMA foreign_key_check;
```

Add no-update/no-delete triggers named
`observation_entry_batches_no_update/_no_delete`,
`observation_market_bar_heartbeats_no_update/_no_delete`,
`observation_entry_chunks_no_update/_no_delete`,
`observation_entry_completions_no_update/_no_delete`,
`observation_entry_setup_events_no_update/_no_delete`,
`observation_entry_terminals_no_update/_no_delete`,
`observation_entry_diagnostics_no_update/_no_delete`,
`observation_entry_evaluation_members_no_update/_no_delete`,
`observation_entry_parity_no_update/_no_delete`,
`observation_entry_source_claims_no_update/_no_delete`,
`observation_entry_source_relationships_no_update/_no_delete`, and
`observation_entry_quarantine_no_update/_no_delete`. Each update trigger is
`BEFORE UPDATE` and raises `'<table> rows are immutable'`; each delete trigger
is `BEFORE DELETE` and raises `'<table> rows are append-only'`. Verify every
name exists in the migration-contract test. The terminal table has no update
path: an open setup has no row, its first valid terminal fact inserts one row,
and every later occurrence must either repeat the identical reason/epoch or
quarantine the conflict.

- [ ] **Step 6: Define storage row types and SQL constants**

In `types.ts`, add snake-case `StoredEntryCandidate`,
`StoredEntryCandidateEvidence`, `StoredEntryHandling`,
`StoredProducerDiagnostic`, `StoredEntrySelection`, `StoredEntryParity`, and
`StoredEntrySourceClaim` interfaces matching every SQL column. Add
`StoredEntrySetupEvent`, `StoredEntrySetupTerminal`, and
`StoredEntryEvaluationMember` matching the columns above. Add
`StoredMarketBarHeartbeat` with every column from
`observation_market_bar_heartbeats`; this schedule projection is never
converted into an `EntryMatchRequest`.

Create `rd-entry-queries.ts` exporting:

```ts
export const INSERT_ENTRY_BATCH_SQL = `
INSERT INTO observation_entry_batches (
  batch_id, producer_instance_id, producer_sequence, kind, bar_close_epoch,
  strategy_id, strategy_version, rule_contract_version, execution_mode,
  symbol, ticker_id, feed, timeframe, tick_size, bar_open_epoch,
  detector_code_hash, settings_hash, chunk_count, first_receipt_id, first_seen_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
export const SELECT_ENTRY_BATCH_SQL = `
SELECT batch_id, producer_instance_id, producer_sequence, kind, bar_close_epoch,
  strategy_id, strategy_version, rule_contract_version, execution_mode,
  symbol, ticker_id, feed, timeframe, tick_size, bar_open_epoch,
  detector_code_hash, settings_hash, chunk_count, first_receipt_id, first_seen_at
FROM observation_entry_batches
WHERE batch_id = ?
LIMIT 1
`;
export const SELECT_ENTRY_BATCH_BY_SEQUENCE_SQL = `
SELECT batch_id, producer_instance_id, producer_sequence, kind, bar_close_epoch,
  strategy_id, strategy_version, rule_contract_version, execution_mode,
  symbol, ticker_id, feed, timeframe, tick_size, bar_open_epoch,
  detector_code_hash, settings_hash, chunk_count, first_receipt_id, first_seen_at
FROM observation_entry_batches
WHERE producer_instance_id = ? AND producer_sequence = ?
LIMIT 1
`;
export const SELECT_ENTRY_BATCH_BY_CLOSE_SQL = `
SELECT batch_id, producer_instance_id, producer_sequence, kind, bar_close_epoch,
  strategy_id, strategy_version, rule_contract_version, execution_mode,
  symbol, ticker_id, feed, timeframe, tick_size, bar_open_epoch,
  detector_code_hash, settings_hash, chunk_count, first_receipt_id, first_seen_at
FROM observation_entry_batches
WHERE producer_instance_id = ? AND bar_close_epoch = ?
LIMIT 1
`;
export const SELECT_ENTRY_SEQUENCE_NEIGHBORS_SQL = `
SELECT producer_sequence, bar_close_epoch, strategy_id, strategy_version,
  rule_contract_version, symbol, ticker_id, feed, timeframe, tick_size,
  detector_code_hash, settings_hash
FROM observation_entry_batches
WHERE producer_instance_id = ?
  AND (
    producer_sequence = (
      SELECT MAX(producer_sequence) FROM observation_entry_batches
      WHERE producer_instance_id = ? AND producer_sequence < ?
    )
    OR producer_sequence = (
      SELECT MIN(producer_sequence) FROM observation_entry_batches
      WHERE producer_instance_id = ? AND producer_sequence > ?
    )
  )
ORDER BY producer_sequence
`;
export const INSERT_MARKET_BAR_HEARTBEAT_SQL = `
INSERT INTO observation_market_bar_heartbeats (
  receipt_id, batch_id, schema_version, producer_role,
  producer_instance_id, producer_sequence, strategy_version,
  symbol, ticker_id, feed, timeframe, bar_open_epoch,
  bar_close_epoch, detector_code_hash, settings_hash, recorded_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
export const INSERT_ENTRY_CHUNK_SQL = `
INSERT INTO observation_entry_chunks (
  batch_id, chunk_index, chunk_count, receipt_id, payload_sha256,
  validated_payload_json, recorded_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`;
export const LIST_ENTRY_CHUNKS_SQL = `
SELECT batch_id, chunk_index, chunk_count, receipt_id, payload_sha256,
  validated_payload_json, recorded_at
FROM observation_entry_chunks
WHERE batch_id = ?
ORDER BY chunk_index
`;
export const INSERT_ENTRY_COMPLETION_SQL = `
INSERT INTO observation_entry_batch_completions (
  completion_id, batch_id, assembled_payload_sha256, completed_at
) VALUES (?, ?, ?, ?)
`;
export const SELECT_ENTRY_SETUP_EVENTS_SQL = `
SELECT event_id, setup_id, batch_id, receipt_id, confirmed_bar_close_epoch,
  proof_input_sha256, proof_input_json, recorded_at
FROM observation_entry_setup_events
WHERE setup_id = ?
ORDER BY confirmed_bar_close_epoch, event_id
`;
export const INSERT_ENTRY_SETUP_EVENT_SQL = `
INSERT INTO observation_entry_setup_events (
  event_id, setup_id, batch_id, receipt_id, confirmed_bar_close_epoch,
  proof_input_sha256, proof_input_json, recorded_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;
export const SELECT_ENTRY_TERMINAL_SQL = `
SELECT setup_id, terminal_reason, terminal_epoch, first_batch_id,
  first_receipt_id, recorded_at
FROM observation_entry_setup_terminals
WHERE setup_id = ?
LIMIT 1
`;
export const INSERT_ENTRY_TERMINAL_SQL = `
INSERT INTO observation_entry_setup_terminals (
  setup_id, terminal_reason, terminal_epoch, first_batch_id,
  first_receipt_id, recorded_at
) VALUES (?, ?, ?, ?, ?, ?)
`;
export const SELECT_ENTRY_COMPLETION_SQL = `
SELECT completion_id, batch_id, assembled_payload_sha256, completed_at
FROM observation_entry_batch_completions
WHERE batch_id = ?
LIMIT 1
`;
export const SELECT_ENTRY_IDENTITIES_SQL = `
SELECT 'candidate' AS object_kind, candidate_id AS object_id, identity_sha256
FROM observation_entry_candidates
WHERE candidate_id IN (SELECT value FROM json_each(?))
UNION ALL
SELECT 'evidence', evidence_id, identity_sha256
FROM observation_entry_candidate_evidence
WHERE evidence_id IN (SELECT value FROM json_each(?))
UNION ALL
SELECT 'handling', handling_id, identity_sha256
FROM observation_entry_handling
WHERE handling_id IN (SELECT value FROM json_each(?))
`;
export const INSERT_ENTRY_CANDIDATES_SQL = `
INSERT OR IGNORE INTO observation_entry_candidates (
  candidate_id, setup_id, model, state, event_anchor_epoch, trigger_ordinal,
  direction, source_claim_ids_json, normalized_from, identity_sha256,
  first_receipt_id, observed_at_epoch
)
SELECT
  json_extract(value, '$.candidate_id'),
  json_extract(value, '$.setup_id'),
  json_extract(value, '$.model'),
  json_extract(value, '$.state'),
  json_extract(value, '$.event_anchor_epoch'),
  json_extract(value, '$.trigger_ordinal'),
  json_extract(value, '$.direction'),
  json_extract(value, '$.source_claim_ids_json'),
  json_extract(value, '$.normalized_from'),
  json_extract(value, '$.identity_sha256'),
  ?,
  json_extract(value, '$.observed_at_epoch')
FROM json_each(?)
`;
export const INSERT_ENTRY_EVIDENCE_SQL = `
INSERT OR IGNORE INTO observation_entry_candidate_evidence (
  evidence_id, candidate_id, receipt_id, observed_trigger_epoch,
  observed_trigger_ticks, htf_context_minutes_json, fidelity, proof_plane,
  proof_resolution_seconds, coverage_start_epoch, coverage_end_epoch,
  ambiguity_codes_json, passed_rule_ids_json, failed_rule_ids_json,
  source_claim_ids_json, payload_sha256, identity_sha256, observed_at_epoch
)
SELECT
  json_extract(value, '$.evidence_id'),
  json_extract(value, '$.candidate_id'),
  ?,
  json_extract(value, '$.observed_trigger_epoch'),
  json_extract(value, '$.observed_trigger_ticks'),
  json_extract(value, '$.htf_context_minutes_json'),
  json_extract(value, '$.fidelity'),
  json_extract(value, '$.proof_plane'),
  json_extract(value, '$.proof_resolution_seconds'),
  json_extract(value, '$.coverage_start_epoch'),
  json_extract(value, '$.coverage_end_epoch'),
  json_extract(value, '$.ambiguity_codes_json'),
  json_extract(value, '$.passed_rule_ids_json'),
  json_extract(value, '$.failed_rule_ids_json'),
  json_extract(value, '$.source_claim_ids_json'),
  json_extract(value, '$.payload_sha256'),
  json_extract(value, '$.identity_sha256'),
  json_extract(value, '$.observed_at_epoch')
FROM json_each(?)
`;
export const INSERT_ENTRY_HANDLING_SQL = `
INSERT OR IGNORE INTO observation_entry_handling (
  handling_id, candidate_id, evidence_id, receipt_id, handling_mode,
  attempt_kind, observed_epoch, observed_ticks, fidelity,
  source_claim_ids_json, identity_sha256
)
SELECT
  json_extract(value, '$.handling_id'),
  json_extract(value, '$.candidate_id'),
  json_extract(value, '$.evidence_id'),
  ?,
  json_extract(value, '$.handling_mode'),
  json_extract(value, '$.attempt_kind'),
  json_extract(value, '$.observed_epoch'),
  json_extract(value, '$.observed_ticks'),
  json_extract(value, '$.fidelity'),
  json_extract(value, '$.source_claim_ids_json'),
  json_extract(value, '$.identity_sha256')
FROM json_each(?)
`;
export const INSERT_PRODUCER_DIAGNOSTIC_SQL = `
INSERT INTO observation_entry_producer_diagnostics (
  diagnostic_id, batch_id, setup_id, candidate_refs_json,
  evidence_refs_json, realtime_evidence_refs_json, handling_refs_json,
  diagnostic_selection_json, observed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
export const INSERT_ENTRY_SELECTION_SQL = `
INSERT INTO observation_entry_selections (
  selection_id, batch_id, setup_id, policy_version, revision,
  candidate_ids_considered_json, canonical_candidate_id,
  canonical_evidence_id, canonical_model, reason, fidelity,
  policy_action, action, effective_action_reason, evaluated_at_epoch
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
export const INSERT_ENTRY_EVALUATION_MEMBERS_SQL = `
INSERT INTO observation_entry_evaluation_members (
  selection_id, object_kind, object_id
)
SELECT
  json_extract(value, '$.selection_id'),
  json_extract(value, '$.object_kind'),
  json_extract(value, '$.object_id')
FROM json_each(?)
`;
export const INSERT_ENTRY_PARITY_SQL = `
INSERT INTO observation_entry_parity (
  parity_id, batch_id, setup_id, producer_diagnostic_id, selection_id,
  parity_status, mismatch_reason, compared_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;
export const INSERT_ENTRY_QUARANTINE_SQL = `
INSERT INTO observation_entry_quarantine (
  quarantine_id, receipt_id, batch_id, producer_instance_id,
  producer_sequence, presented_bar_close_epoch, object_kind, object_id,
  existing_sha256, presented_sha256, reason, quarantined_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
export const INSERT_ENTRY_SOURCE_CLAIM_SQL = `
INSERT OR IGNORE INTO observation_entry_source_claims (
  claim_id, contract_version, source_id, youtube_video_id, published_date,
  title_snapshot, channel_id, channel_handle, timestamp_start_seconds,
  timestamp_end_seconds, relationship, summary
) VALUES (?, '2.0.0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
export const INSERT_ENTRY_SOURCE_RELATIONSHIP_SQL = `
INSERT OR IGNORE INTO observation_entry_source_claim_relationships (
  claim_id, target_claim_id
) VALUES (?, ?)
`;
```

- [ ] **Step 7: Apply migration and run storage GREEN**

Run:

```bash
cd apps/observation-edge
npm run db:migrate:local
npx vitest run test/worker.test.ts -t "immutable normalized"
npm run typecheck
```

Expected: D1 applies `0023`, the storage-contract test passes, and all SQL row
types compile.

- [ ] **Step 8: Commit immutable storage**

```bash
git add apps/observation-edge/migrations/0023_observation_entries.sql \
  apps/observation-edge/src/rd-entry-queries.ts \
  apps/observation-edge/src/types.ts \
  apps/observation-edge/test/worker.test.ts
git commit -m "feat: add immutable RD entry D1 projections"
```

---

### Task 6: Assemble chunks, recompute authority, enforce parity, and persist atomically

**Files:**
- Create: `apps/observation-edge/src/rd-entry-parity.ts`
- Create: `apps/observation-edge/src/rd-entry-store.ts`
- Create: `apps/observation-edge/test/rd-entry-store.test.ts`
- Modify: `apps/observation-edge/src/index.ts:991`
- Modify: `apps/observation-edge/test/worker.test.ts:1`

**Interfaces:**
- Consumes: `ValidatedEntryV2Payload`, `evaluateEntryStream()`, and Task 5 SQL.
- Produces: `compareProducerDiagnostic()`, `assembleValidatedChunks()`, and
  `appendEntryV2Observation()`.
- Produces: separate `producerDiagnosticSelection`, authoritative `selection`,
  `parityStatus`, and `parityMismatchReason` for each setup.
- Guarantees: any parity state other than `MATCH`, or a disabled canonical
  paper-selection configuration, forces effective authoritative action
  `SHADOW_ONLY`; no v2 row reaches paper automation.

- [ ] **Step 1: Write failing pure parity and assembly tests**

Create `apps/observation-edge/test/rd-entry-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  compareProducerDiagnostic,
  effectiveSelection,
} from "../src/rd-entry-parity";
import { assembleValidatedChunks } from "../src/rd-entry-store";

describe("entry producer/backend parity", () => {
  it("keeps producer diagnostics separate when they match", () => {
    const result = compareProducerDiagnostic(backendEvaluation(), producerMatch());
    expect(result).toEqual({ status: "MATCH", mismatchReason: null });
  });

  it("forces mismatch to shadow without rewriting the policy result", () => {
    const policy = backendEvaluation().selection;
    const parity = compareProducerDiagnostic(
      backendEvaluation(),
      {
        ...producerMatch(),
        selection: {
          ...producerMatch().selection!,
          semantic_key: "DIR_CLOSE:1721808600:1",
          model: "DIR_CLOSE",
          event_anchor_epoch: 1721808600,
          trigger_ordinal: 1,
        },
      },
    );
    expect(parity).toEqual({
      status: "MISMATCH",
      mismatchReason: "SELECTED_CANDIDATE",
    });
    expect(effectiveSelection(policy, parity, false)).toMatchObject({
      policy_action: policy.action,
      action: "SHADOW_ONLY",
    });
  });
});

describe("entry chunk assembly", () => {
  it("sorts a complete out-of-order batch", () => {
    const result = assembleValidatedChunks([
      chunk({ chunkIndex: 1, chunkCount: 2, setupId: "setup-b" }),
      chunk({ chunkIndex: 0, chunkCount: 2, setupId: "setup-a" }),
    ]);
    expect(result.status).toBe("COMPLETE");
    expect(result.setups.map((item) => item.setupId)).toEqual([
      "setup-a",
      "setup-b",
    ]);
    expect(result.setups.map((item) => [item.origin.chunkIndex, item.origin.receiptId]))
      .toEqual([[0, "receipt-0"], [1, "receipt-1"]]);
  });

  it("rejects duplicate setups across chunks", () => {
    expect(() =>
      assembleValidatedChunks([
        chunk({ chunkIndex: 0, chunkCount: 2, setupId: "setup-a" }),
        chunk({ chunkIndex: 1, chunkCount: 2, setupId: "setup-a" }),
      ]),
    ).toThrow("DUPLICATE_SETUP_ACROSS_CHUNKS");
  });
});
```

Define complete local builders in the test using the Task 1 interfaces and fixed
64-character hashes; do not import production fixtures from `worker.test.ts`.

- [ ] **Step 2: Run the store tests and verify RED**

Run:

```bash
cd apps/observation-edge
npx vitest run test/rd-entry-store.test.ts
```

Expected: FAIL because `rd-entry-parity.ts` and `rd-entry-store.ts` do not exist.

- [ ] **Step 3: Implement producer/backend comparison and effective action**

Create `rd-entry-parity.ts`:

```ts
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
  return [value.model, value.event_anchor_epoch, value.trigger_ordinal].join(":");
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

function producerCandidateDescriptor(value: ProducerCandidateReference): string {
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
  if (!sameKeys(
    backend.candidates.map(backendCandidateDescriptor),
    producer.candidates.map(producerCandidateDescriptor),
  )) failures.push("CANDIDATE_KEYS");
  if (!sameKeys(
    backend.evidence.map((item) =>
      backendEvidenceDescriptor(item, backend),
    ),
    producer.evidence.map(producerEvidenceDescriptor),
  )) failures.push("EVIDENCE_DESCRIPTORS");
  if (!sameKeys(
    backend.handling.map(
      (item) => [
        backendCandidateKey(
          backend.candidates.find(
            (candidate) => candidate.candidate_id === item.candidate_id,
          )!,
        ),
        item.handling_mode,
        item.attempt_kind,
        item.observed_epoch,
        item.observed_ticks,
        backendEvidenceDescriptor(
          backend.evidence.find(
            (evidence) => evidence.evidence_id === item.evidence_id,
          )!,
          backend,
        ),
        item.fidelity,
        item.source_claim_ids.join(","),
      ].join(":"),
    ),
    producer.handling.map(
      (item) => [
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
  )) failures.push("HANDLING_DESCRIPTORS");
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
  ) failures.push("SELECTED_CANDIDATE");
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
    effective_action_reason: promotionIdentityMismatch
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
```

Compute `promotionIdentityMismatch` only when the deployment has a non-null
embedded promotion binding and is otherwise armed, but the current batch's
`detector_code_hash` or `settings_hash` differs from the embedded approved
identity. A disabled/unpromoted deployment remains ordinary shadow with a null
effective-action reason. Add runtime tests for exact source-controlled binding,
environment evidence values, `CF_VERSION_METADATA.tag`, detector hash, and
settings hash. A mismatch must preserve `policy_action`, set effective
`action="SHADOW_ONLY"`, and set
`effective_action_reason="PROMOTION_IDENTITY_MISMATCH"`; it may never borrow a
matching identity from another receipt in the window.

If diagnostic `q` is null and candidate/evidence/handling references match,
return `NOT_PROVIDED`. If `q` is null and another diagnostic reference differs,
return `MISMATCH`. `producer.realtime_evidence` is intentionally absent from
all comparison sets above: validate and retain it for audit, but it can neither
create a parity mismatch nor make a missing authoritative replay proof appear
to match.

- [ ] **Step 4: Implement deterministic chunk assembly**

In `rd-entry-store.ts`, define:

```ts
export interface StoredValidatedChunk {
  readonly batchId: string;
  readonly batchIdentity: EntryBatchSemanticIdentity;
  readonly batchMetadata: EntryBatchImmutableMetadata;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly payloadSha256: string;
  readonly receiptId: string;
  readonly entryBatches: readonly ValidatedEntryWireBatch[];
}

export interface AssembledValidatedSetup extends ValidatedEntryWireBatch {
  readonly origin: {
    readonly receiptId: string;
    readonly chunkIndex: number;
  };
}

export type ChunkAssembly =
  | {
      readonly status: "INCOMPLETE";
      readonly missingIndexes: readonly number[];
      readonly setups: readonly [];
    }
  | {
      readonly status: "COMPLETE";
      readonly missingIndexes: readonly [];
      readonly setups: readonly AssembledValidatedSetup[];
      readonly assembledPayloadSha256: string;
    };
```

Implement:

```ts
export async function assembleValidatedChunks(
  chunks: readonly StoredValidatedChunk[],
): Promise<ChunkAssembly> {
  const ordered = [...chunks].sort(
    (left, right) => left.chunkIndex - right.chunkIndex,
  );
  const count = ordered[0]?.chunkCount ?? 0;
  if (
    count < 1 ||
    ordered.some(
      (item) =>
        item.chunkCount !== count ||
        item.batchId !== ordered[0]?.batchId ||
        canonicalBatchIdentity(item.batchIdentity) !==
          canonicalBatchIdentity(ordered[0]!.batchIdentity) ||
        canonicalStringify(item.batchMetadata) !==
          canonicalStringify(ordered[0]!.batchMetadata),
    )
  ) {
    throw new EntryStoreConflict("INCONSISTENT_CHUNK_COUNT");
  }
  const byIndex = new Map(ordered.map((item) => [item.chunkIndex, item]));
  const missingIndexes = Array.from(
    { length: count },
    (_value, index) => index,
  ).filter((index) => !byIndex.has(index));
  if (missingIndexes.length > 0) {
    return { status: "INCOMPLETE", missingIndexes, setups: [] };
  }
  const setups = ordered.flatMap((item) =>
    item.entryBatches.map((setup) => ({
      ...setup,
      origin: {
        receiptId: item.receiptId,
        chunkIndex: item.chunkIndex,
      },
    })),
  );
  if (setups.length > MAX_ENTRY_SETUPS_PER_BATCH) {
    throw new EntryStoreConflict("BATCH_SETUP_LIMIT");
  }
  const setupIds = setups.map((item) => item.setupId);
  if (new Set(setupIds).size !== setupIds.length) {
    throw new EntryStoreConflict("DUPLICATE_SETUP_ACROSS_CHUNKS");
  }
  const assembledPayloadSha256 = await canonicalSha256(
    ordered.map((item) => ({
      chunk_index: item.chunkIndex,
      payload_sha256: item.payloadSha256,
    })),
  );
  return {
    status: "COMPLETE",
    missingIndexes: [],
    setups,
    assembledPayloadSha256,
  };
}
```

An immutable metadata mismatch uses
`INCONSISTENT_BATCH_METADATA`, distinct from a count mismatch. Add two-chunk
tests that vary only symbol, ticker ID, feed, tick size, detector hash, or
settings hash and require rejection. Prove candidate/evidence/handling and
setup-event inserts use each `AssembledValidatedSetup.origin.receiptId`, not
the first receipt in the batch; an out-of-order two-chunk batch must preserve
both receipt IDs through D1 and the read API.

- [ ] **Step 5: Define the D1 append result and immutable preflight**

Export:

```ts
export type EntryAppendResult =
  | {
      readonly status: "ACCEPTED";
      readonly record: StoredReceipt;
      readonly inserted: boolean;
      readonly assemblyStatus: "INCOMPLETE" | "COMPLETE";
      readonly batchId: string;
      readonly missingChunkIndexes: readonly number[];
      readonly evaluations: readonly {
        readonly producerDiagnosticSelection:
          ProducerDiagnosticSelection | null;
        readonly selection: EffectiveEntrySelection;
        readonly parityStatus: ParityStatus;
        readonly parityMismatchReason: ParityMismatchReason | null;
      }[];
    }
  | {
      readonly status: "CONFLICT";
      readonly conflictCode:
        | "SEQUENCE_CONFLICT"
        | "BAR_CLOSE_CONFLICT"
        | "SEQUENCE_TIME_CONFLICT"
        | "PRODUCER_IDENTITY_CONFLICT";
      readonly quarantineId: string;
      readonly batchId: string;
      readonly record: null;
    };

export async function appendEntryV2Observation(
  env: Env,
  observation: Extract<ValidatedObservation, { version: "entry-v2" }>,
  payloadSha256: string,
): Promise<EntryAppendResult>;
```

Before any candidate/evidence/handling insert:

1. query existing receipt by idempotency key and enforce the existing payload
   hash conflict rule;
2. compute the authoritative batch ID with
   `canonicalSha256(observation.batchIdentity)` and never accept a producer
   batch hash;
3. query by both `(producer_instance_id, sequence)` and
   `(producer_instance_id, bar_close_epoch)` before querying by batch ID.
   Exactly one semantic batch may own a positive sequence. If a row exists,
   require its full `{kind,bar_close_epoch}` semantic identity and batch ID to
   match; otherwise record `SEQUENCE_CONFLICT` and insert no receipt, chunk,
   heartbeat row, completion, or evaluation. Exactly one batch may own a close
   epoch for one producer; a different sequence/kind at that close is
   `BAR_CLOSE_CONFLICT`. The batch table's two UNIQUE constraints backstop both
   checks;
4. load the nearest stored predecessor and successor by numeric sequence.
   Require `predecessor.bar_close_epoch < presented.bar_close_epoch <
   successor.bar_close_epoch` for whichever neighbors exist. Arrival order is
   irrelevant: sequence 12 may arrive before 11, but sequence chronology and
   close chronology must agree. A violation is `SEQUENCE_TIME_CONFLICT`.
   Also require all rows under one producer instance to retain the exact
   strategy/rule/market/timeframe/tick-size/detector/settings metadata; a
   restart or code/settings change requires a new producer instance and
   otherwise yields `PRODUCER_IDENTITY_CONFLICT`;
5. query batch and chunk metadata and compare the complete immutable
   `EntryBatchImmutableMetadata`, chunk count, and chunk payload hash;
6. load all existing chunks and include the current expanded sanitized chunk;
7. return `INCOMPLETE` after atomically inserting receipt, batch, market-bar
   schedule row, and chunk when
   indexes are missing;
8. for every setup in a complete batch, load its immutable prior
   `observation_entry_setup_events`. Each setup has exactly one current
   `events[]` request. Require every `retainedContext[]` projection to find a
   stored event at the same setup/close and to agree with its canonical proof
   facts; missing context is `EVENT_STREAM_CONTEXT_MISSING` and changed context
   is `EVENT_STREAM_CONFLICT`. Never append retained context as a new event;
9. canonicalize the sole current event and de-duplicate it by
   `(setup_id, confirmed_bar.close_epoch)`. Quarantine
   `EVENT_STREAM_CONFLICT` if an existing semantic event has a
   different proof-input SHA-256; otherwise combine prior and current events
   oldest-first and recompute with `evaluateEntryStream()`. A snapshot is
   stateful transport, not a replacement of this stored stream: a transcript
   whose cutoff has rolled outside the new `f.b` window survives only through
   its already-stored event. Do not derive or synthesize a new 5-minute event
   from a current `f.x`;
10. validate a new explicit terminal fact against the accumulated backend
   state, and compare it with any existing immutable terminal row;
11. query `SELECT_ENTRY_IDENTITIES_SQL` and require every repeated identity hash
   to match;
12. compare any existing source-claim/source-relationship row with the
    generated `SOURCE_CLAIM_CATALOG`; an `INSERT OR IGNORE` may never conceal
    different official metadata;
13. insert a quarantine row and no selection when an event, terminal, source,
    or
    immutable result ID conflicts.

Serialize only this credential-free chunk document:

```ts
const sanitizedChunk = {
  batch_identity: observation.batchIdentity,
  batch_metadata: observation.batchMetadata,
  chunk_index: observation.chunkIndex,
  chunk_count: observation.chunkCount,
  entry_batches: observation.entryBatches,
};
```

For a pre-receipt conflict, compute `quarantineId` from the canonical presented
identity plus conflict code, insert the quarantine row with `receipt_id=NULL`,
and return the `CONFLICT` branch. Repeating the identical conflicting request
returns the same quarantine ID without a second row. The handler returns a
deterministic `409` conflict document and never calls `receipt(...)` for this
branch.

- [ ] **Step 6: Persist complete evaluations and parity in one D1 batch**

For each completed setup, compute each proof-input hash and event ID without
transport fields:

```ts
const currentEvents = await Promise.all(entry.events.map(async (input) => {
  const proofInputSha256 = await canonicalSha256(input);
  return {
    eventId: await canonicalSha256({
      confirmed_bar_close_epoch: input.confirmed_bar.close_epoch,
      proof_input_sha256: proofInputSha256,
      setup_id: entry.setupId,
    }),
    input,
    proofInputSha256,
    receiptId: entry.origin.receiptId,
    chunkIndex: entry.origin.chunkIndex,
  };
}));
validateRetainedContextAgainstStoredEvents(
  entry.retainedContext,
  storedEventsBySetup.get(entry.setupId) ?? [],
);
const stream = mergeStoredAndCurrentEvents(
  storedEventsBySetup.get(entry.setupId) ?? [],
  currentEvents,
);
const accumulatedInvalidated = accumulatedTerminalState(stream) ===
  "INVALIDATED_BEFORE_ANY_ACTIVE_MODEL";
const backend = await evaluateEntryStream(
  stream.map((item) => ({
    event_id: item.eventId,
    match_request: item.input,
  })),
  accumulatedInvalidated,
  nextRevisionBySetup.get(entry.setupId)!,
  stream.at(-1)!.input.confirmed_bar.close_epoch,
);
const parity = compareProducerDiagnostic(
  backend,
  entry.producerDiagnostic,
);
const authoritative = effectiveSelection(
  backend.selection,
  parity,
  canonicalPaperSelectionConfigured(env, observation.batchMetadata),
  promotionDeploymentArmed(env) &&
    !promotionCodeIdentityMatches(observation.batchMetadata),
);
```

`payloadSha256` passed to `appendEntryV2Observation()` remains receipt
provenance only. It must not enter an event, proof, candidate, evidence,
handling, selection, or parity identity.

Use `entry.origin.receiptId` for every newly derived setup event, candidate,
evidence, and handling insert from that setup. Never replace it with the
batch's first receipt ID. A grace-derived `NEXT_CANDLE_WICK` uses the receipt
that carried the grace bar. Previously stored immutable objects retain their
original provenance.

Validate the final event's terminal pair before persistence:

- null `terminal_reason/terminal_epoch` means the attempt is still open and
  inserts no terminal row;
- `terminal_epoch` must equal the terminal event's confirmed-bar close epoch;
- `INVALIDATED` makes the terminal event candidate-free. Count active-model
  candidates accumulated strictly before it: zero requires
  `invalidated_before_entry=true`; one requires `false`; two is invalid because
  the frozen terminal reason must then be
  `BOTH_ACTIVE_MODELS_OBSERVED`;
- `BOTH_ACTIVE_MODELS_OBSERVED` is required on the exact event that transitions
  the accumulated authoritative set from fewer than two active models to both
  `DIR_CLOSE` and `HTF_FLIP`; a nonterminal event that completes both, a
  delayed BOTH terminal, or another terminal reason on that event is invalid.
  It requires `invalidated_before_entry=false`;
- `RETENTION_EVICTED` is applied after matching the current event, requires
  `invalidated_before_entry=false`, and is the sole expiry representation;
- once `observation_entry_setup_terminals` contains a setup, only an identical
  replay of the already-stored terminal event plus the one inferred grace
  request is valid when the terminal event introduced `DIR_CLOSE` while
  completing both models. The grace must repeat the terminal/setup/attempt
  facts, creates no authority fact, and can derive only `NEXT_CANDLE_WICK`.
  Any second/new authority event, trigger-bearing grace, or changed/null
  terminal pair quarantines `TERMINAL_FACT_CONFLICT`. A noncontiguous first
  grace is accepted only to consume the domain grace and derives no handling.
  The terminal remains the last matcher/authority event. Never infer a
  terminal from receipt age, missing snapshots, or wall clock.

Before any selection/evaluation-member insert, validate in memory and again
after loading repeated identities:

- every evidence row references a candidate in the same attempt;
- every handling row's evidence belongs to its referenced candidate;
- `candidate_ids_considered` contains the canonical candidate;
- canonical evidence belongs to that canonical candidate;
- `canonical_model` equals the canonical candidate model;
- every evaluation member belongs to the exact accumulated selection revision.

An ownership mismatch is an immutable conflict; do not persist a partial
selection.

Build one `env.DB.batch()` containing:

- receipt insert when this request is new;
- first batch insert when this is the first chunk;
- one immutable market-bar receipt row for the current accepted chunk;
- current chunk insert;
- de-duplicated setup-event inserts;
- a setup-terminal insert only for a newly terminal attempt;
- source-claim and source-relationship `INSERT OR IGNORE` statements;
- candidate, evidence, and handling inserts;
- one producer diagnostic row per setup;
- one authoritative selection row per setup, with both `policy_action` and
  effective `action`;
- evaluation-member rows linking that selection revision to every candidate,
  evidence, and handling object in its accumulated backend result;
- one parity row per setup;
- one batch completion row.

Use `MAX(revision) + 1` per setup from a fixed SQL query before the batch.
On a uniqueness race, reload revisions and re-attempt this complete batch once.
After the batch, re-query all repeated identity rows and fail closed if a race
introduced a different hash.

Add D1 tests that submit sequences `3`, `1`, then `2` for one producer and
prove all three are accepted and query in numeric order. Submit a second
semantic identity at sequence `2` with a changed kind or close epoch and prove
it creates exactly one `SEQUENCE_CONFLICT` quarantine record and no second
batch/receipt. Submit the same sequence under a different
`producer_instance_id` and prove it is a separate continuity chain rather than
a conflict.

- [ ] **Step 7: Route authenticated schema 2.0 to shadow-safe persistence**

In `postObservation()` after authentication and canonical payload hashing:

```ts
if (observation.version === "entry-v2") {
  const result = await appendEntryV2Observation(
    env,
    observation,
    payloadSha256,
  );
  if (result.status === "CONFLICT") {
    return jsonResponse({
      error: {
        code: result.conflictCode,
        quarantine_id: result.quarantineId,
        batch_id: result.batchId,
      },
      execution: "DISABLED",
    }, 409);
  }
  return jsonResponse(
    {
      ...receipt(
        result.record,
        result.inserted ? "RECEIVED" : "DUPLICATE",
      ),
      assembly: {
        batch_id: result.batchId,
        status: result.assemblyStatus,
        missing_chunk_indexes: result.missingChunkIndexes,
      },
      evaluation_count: result.evaluations.length,
      parity: {
        matches: result.evaluations.filter(
          (item) => item.parityStatus === "MATCH",
        ).length,
        mismatches: result.evaluations.filter(
          (item) => item.parityStatus === "MISMATCH",
        ).length,
        not_provided: result.evaluations.filter(
          (item) => item.parityStatus === "NOT_PROVIDED",
        ).length,
      },
      canonical_paper_enabled:
        canonicalPaperSelectionConfigured(env, observation.batchMetadata),
      execution: "DISABLED",
    },
    result.inserted ? 202 : 200,
  );
}
```

For the legacy branch below this block, preserve its response and receipt
semantics but add the compatible schema `1.2` `LEGACY_REFERENCE` heartbeat row
to the existing receipt transaction. Schema `1.0`/`1.1` and incompatible
payloads do not enter the heartbeat projection. The V3 append transaction
inserts its `ENTRY_V3_CANARY` heartbeat. A D1 test posts legacy V2 and V3
payloads for the same confirmed bar and proves both provenance rows normalize
to one compatible schedule epoch.

- [ ] **Step 8: Add Worker integration cases**

Extend `FakeD1` in `worker.test.ts` with maps for batches, chunks, setup events,
terminals, candidates, evidence, handling, diagnostics, selections, parity,
completions, and quarantine. Add tests proving:

```ts
it("accepts v2 in shadow while canonical paper defaults false", async () => {
  const response = await handleRequest(postBody(entryV2Payload()), await environment());
  expect(response.status).toBe(202);
  expect(await body(response)).toMatchObject({
    canonical_paper_enabled: false,
    execution: "DISABLED",
  });
});

it("persists one complete multi-candidate evaluation atomically", async () => {
  const database = new FakeD1();
  const response = await handleRequest(
    postBody(entryV2Payload()),
    await environment(database),
  );
  expect(response.status).toBe(202);
  expect(await body(response)).toMatchObject({
    assembly: { status: "COMPLETE" },
    evaluation_count: 1,
    execution: "DISABLED",
  });
  expect(database.candidates.size).toBeGreaterThan(1);
  expect(database.selections).toHaveLength(1);
  expect(database.selections[0]?.action).toBe("SHADOW_ONLY");
  expect(database.paperTradeIntents).toHaveLength(0);
});

it("stores a mismatch separately and forces authoritative shadow", async () => {
  const database = new FakeD1();
  const value = entryV2Payload();
  producerDiagnostic(value).q = {
    v: "PINE_DIAGNOSTIC_ONLY",
    k: "DIR_CLOSE:1721808300:9",
    m: "DIR_CLOSE",
    a: 1721808300,
    o: 9,
    r: "ONLY_EXACT_TRIGGER",
    f: "EXACT",
    x: "SHADOW_ONLY",
  };
  await handleRequest(
    postBody(value),
    await environment(database),
  );
  expect(database.producerDiagnostics).toHaveLength(1);
  expect(database.parity[0]).toMatchObject({
    parity_status: "MISMATCH",
    mismatch_reason: "SELECTED_CANDIDATE",
  });
  expect(database.selections[0]).toMatchObject({
    policy_action: "PAPER_ELIGIBLE",
    action: "SHADOW_ONLY",
  });
});
```

Also cover two chunks arriving out of order, identical chunk retry, inconsistent
chunk count, duplicate setup across chunks, immutable candidate hash conflict,
rollback, and a flip event followed by a later exact close across two completed
batches creating selection revision `2`. Add cases proving:

- both lowercase `snapshot` and `incremental` complete and persist using the
  same schema;
- an initial batch stores a flip transcript, then a mid-setup snapshot whose
  bounded `b/x` omits that old transcript still recomputes from the stored
  prior event; if Pine's current diagnostic omits the resulting accumulated
  fact, parity is `MISMATCH` and the effective action remains `SHADOW_ONLY`.
  Assert the snapshot contributes only its last `b` current event; every older
  `b` projection must agree with stored history and no transcript-only
  synthetic event is created. A first-live snapshot containing an eligible
  setup but lacking its required prior stored context is quarantined;
- chunk counts `1` and `12` pass while `13` fails before D1;
- two close bars and two distinct flip events retain only the first semantic
  candidate per model, while same-ID replay may append evidence;
- terminal invalidation before any candidate persists `iv=true`; terminal
  invalidation after one model persists `iv=false` without erasing that model;
- `BOTH_ACTIVE_MODELS_OBSERVED` fails unless both authoritative active models
  exist, terminal mutation quarantines, and explicit `RETENTION_EVICTED`
  is accepted without wall-clock inference;
- `q=null` persists `NOT_PROVIDED` and forces shadow;
- setting only `RD_ENTRY_CANONICAL_PAPER_ENABLED=true` still forces shadow;
  policy `PAPER_ELIGIBLE` remains effective only when parity is `MATCH` and all
  three valid promotion evidence bindings, exact generated detector/settings
  binding, and exact Workers version-metadata tag are also present.

Also prove one semantic batch per producer close, strict sequence/close
chronology under out-of-order arrival, immutable metadata equality across
chunks, idempotent deterministic conflict responses with `record:null`,
receipt/chunk provenance for each setup in a two-chunk assembly, request
attempt/ordinal invariants, and one post-terminal wick grace with terminal
authority unchanged.

- [ ] **Step 9: Run persistence and legacy regression tests for GREEN**

Run:

```bash
cd apps/observation-edge
npx vitest run test/rd-entry-store.test.ts test/worker.test.ts
npm run typecheck
npm run build
```

Expected: all chunk, parity, idempotency, rollback, and legacy cases pass;
Wrangler dry-run builds successfully.

- [ ] **Step 10: Commit feature-gated v2 persistence**

```bash
git add apps/observation-edge/src/rd-entry-parity.ts \
  apps/observation-edge/src/rd-entry-store.ts \
  apps/observation-edge/src/index.ts \
  apps/observation-edge/test/rd-entry-store.test.ts \
  apps/observation-edge/test/worker.test.ts
git commit -m "feat: persist authoritative RD entry evaluations"
```

---

### Task 7: Expose a bounded nested entry-evaluation query API

**Files:**
- Modify: `apps/observation-edge/src/rd-entry-queries.ts`
- Create: `apps/observation-edge/src/rd-entry-read-model.ts`
- Create: `apps/observation-edge/test/rd-entry-api.test.ts`
- Modify: `apps/observation-edge/src/index.ts:1192`
- Modify: `apps/observation-edge/src/index.ts:2700`

**Interfaces:**
- Consumes: completed normalized D1 rows from Tasks 5 and 6.
- Produces: `GET /api/v1/observation-entry-evaluations`.
- Supports: `limit=1..200`, `setup_id`, `symbol`, `model`, `fidelity`,
  `reason`, `parity_status`, `since`, `until`, and opaque `cursor`.
- Returns: producer diagnostic selection separately from authoritative
  selection, parity status/mismatch reason, validated proof input, receipt
  time, cursor pagination, and a full-filter-window canary aggregate.

- [ ] **Step 1: Write failing route, filter, and response-shape tests**

Create `apps/observation-edge/test/rd-entry-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { handleRequest } from "../src/index";
import { environmentWithEntryEvaluation } from "./entry-api-fixture";

describe("entry evaluation read API", () => {
  it("returns nested authority and diagnostic projections separately", async () => {
    const response = await handleRequest(
      new Request(
        "https://edge.example/api/v1/observation-entry-evaluations?limit=200&since=2026-07-22T00%3A00%3A00Z&until=2026-07-23T00%3A00%3A00Z",
      ),
      await environmentWithEntryEvaluation(),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      mode: "OBSERVATION_ONLY",
      execution: "DISABLED",
      canonical_paper_enabled: false,
      count: 1,
      page: { has_more: false, next_cursor: null },
      canary: {
        source_window_status: "FINAL",
        completion_grace_seconds: 900,
        receipt_count: 2,
        total_batches: 2,
        complete_batches: 2,
        incomplete_batches: 0,
        in_flight_batches: 0,
        quarantined_objects: 0,
        immutable_conflicts: 0,
        sequence_gap_count: 0,
        sequence_conflict_count: 0,
        heartbeat_schedule_match_count: 2,
        heartbeat_schedule_mismatch_count: 0,
        heartbeat_reference_bar_count: 2,
        unknown_source_claims: 0,
        completed_attempts: 1,
        parity_match: 1,
        parity_mismatch: 1,
        parity_not_provided: 0,
      },
    });
    const item = (body.items as Record<string, unknown>[])[0]!;
    expect(item).toHaveProperty("producer_diagnostic");
    expect(item).toHaveProperty("producer_diagnostic_selection");
    expect(item).toHaveProperty("selection");
    expect(item).toHaveProperty("proof_inputs");
    expect(item).toHaveProperty("receipt_received_at");
    expect((item.proof_inputs as unknown[])).toHaveLength(2);
    expect(item).toMatchObject({
      parity_status: "MISMATCH",
      parity_mismatch_reason: "SELECTED_CANDIDATE",
    });
  });

  it("accepts the 200-row canary bound and rejects 201", async () => {
    const env = await environmentWithEntryEvaluation();
    expect((await handleRequest(
      new Request(
        "https://edge.example/api/v1/observation-entry-evaluations?limit=200",
      ),
      env,
    )).status).toBe(200);
    expect((await handleRequest(
      new Request(
        "https://edge.example/api/v1/observation-entry-evaluations?limit=201",
      ),
      env,
    )).status).toBe(422);
  });

  it("returns an opaque cursor and keeps canary totals window-wide", async () => {
    const env = await environmentWithEntryEvaluation({ evaluationCount: 3 });
    const first = await handleRequest(
      new Request(
        "https://edge.example/api/v1/observation-entry-evaluations?limit=2&since=2026-07-22T00%3A00%3A00Z&until=2026-07-23T00%3A00%3A00Z",
      ),
      env,
    );
    const firstBody = await first.json() as {
      page: { has_more: boolean; next_cursor: string };
      canary: { completed_attempts: number };
    };
    expect(firstBody.page.has_more).toBe(true);
    expect(firstBody.page.next_cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(firstBody.canary.completed_attempts).toBe(3);
  });
});
```

Create `entry-api-fixture.ts` beside the test with two completed batches for one
setup: an exact flip event followed by a later exact close. Include two
candidates, their evidence/handling, matching first-batch diagnostics,
mismatching second-batch diagnostics, a terminal
`BOTH_ACTIVE_MODELS_OBSERVED` row, the latest shadow-forced authoritative
selection, and official claim rows. The read model must return both
credential-free proof inputs oldest-first even though it returns only the
latest selection revision.

- [ ] **Step 2: Run the API tests and verify RED**

Run:

```bash
cd apps/observation-edge
npx vitest run test/rd-entry-api.test.ts
```

Expected: FAIL because the route returns `404`.

- [ ] **Step 3: Add strict duplicate-safe filter parsing**

In `rd-entry-read-model.ts`, export:

```ts
export interface EntryEvaluationFilters {
  readonly limit: number;
  readonly setupId: string | null;
  readonly symbol: string | null;
  readonly model: EntryModelV2 | null;
  readonly fidelity: CandidateFidelity | null;
  readonly reason: SelectionReason | null;
  readonly parityStatus: ParityStatus | null;
  readonly since: string | null;
  readonly until: string | null;
  readonly cursor: {
    readonly evaluatedAtEpoch: number;
    readonly setupId: string;
  } | null;
}

export function parseEntryEvaluationFilters(url: URL): EntryEvaluationFilters;
```

For each key, call `url.searchParams.getAll(key)` and reject more than one
value. Validate `limit` as an integer `1..200`, identifiers with the existing
wire profile, every enum through a closed `Set`, and `since`/`until` as real UTC
`Z` timestamps with `since < until`. Require them to be jointly absent or
jointly present; a promotion-capable canary always uses a closed
`[since,until)` pair. Encode a cursor as base64url canonical JSON
`{"evaluated_at_epoch":<integer>,"setup_id":"<wire id>"}`; reject padding,
noncanonical encodings, extra keys, and invalid values. Reject any query key
other than the ten declared keys.

- [ ] **Step 4: Add fixed SQL read projections**

Export from `rd-entry-queries.ts`:

```ts
export const LIST_ENTRY_EVALUATION_KEYS_SQL = `
WITH window_batches AS (
  SELECT batch.batch_id
  FROM observation_entry_batches AS batch
  JOIN observation_receipts AS receipt
    ON receipt.receipt_id = batch.first_receipt_id
  WHERE (? IS NULL OR receipt.received_at >= ?)
    AND (? IS NULL OR receipt.received_at < ?)
),
eligible_batches AS (
  SELECT window_batches.batch_id
  FROM window_batches
  JOIN observation_entry_batch_completions AS completion
    ON completion.batch_id = window_batches.batch_id
  WHERE (? IS NULL OR completion.completed_at <= ?)
)
SELECT
  selection.setup_id,
  selection.batch_id,
  receipt.symbol,
  selection.revision,
  selection.evaluated_at_epoch
FROM observation_entry_selections AS selection
JOIN observation_entry_batches AS batch
  ON batch.batch_id = selection.batch_id
JOIN observation_receipts AS receipt
  ON receipt.receipt_id = batch.first_receipt_id
JOIN observation_entry_parity AS parity
  ON parity.selection_id = selection.selection_id
WHERE selection.batch_id IN (SELECT batch_id FROM eligible_batches)
AND NOT EXISTS (
  SELECT 1
  FROM observation_entry_selections AS newer
  WHERE newer.setup_id = selection.setup_id
    AND newer.policy_version = selection.policy_version
    AND newer.revision > selection.revision
    AND newer.batch_id IN (SELECT batch_id FROM eligible_batches)
)
AND (? IS NULL OR selection.setup_id = ?)
AND (? IS NULL OR receipt.symbol = ?)
AND (? IS NULL OR selection.reason = ?)
AND (? IS NULL OR parity.parity_status = ?)
AND (
  ? IS NULL
  OR selection.evaluated_at_epoch < ?
  OR (
    selection.evaluated_at_epoch = ?
    AND selection.setup_id > ?
  )
)
AND (
  ? IS NULL OR EXISTS (
    SELECT 1 FROM observation_entry_candidates AS candidate
    WHERE candidate.candidate_id IN (
      SELECT value FROM json_each(selection.candidate_ids_considered_json)
    )
      AND candidate.model = ?
  )
)
AND (
  ? IS NULL OR EXISTS (
    SELECT 1
    FROM observation_entry_candidates AS candidate
    JOIN observation_entry_candidate_evidence AS evidence
      ON evidence.candidate_id = candidate.candidate_id
    WHERE candidate.candidate_id IN (
      SELECT value FROM json_each(selection.candidate_ids_considered_json)
    )
      AND evidence.fidelity = ?
  )
)
ORDER BY selection.evaluated_at_epoch DESC, selection.setup_id
LIMIT ?
`;

export const LIST_ENTRY_PROOF_INPUTS_SQL = `
WITH selection_cutoffs AS (
  SELECT
    json_extract(value, '$.setup_id') AS setup_id,
    json_extract(value, '$.evaluated_at_epoch') AS evaluated_at_epoch
  FROM json_each(?)
)
SELECT
  event.event_id,
  event.setup_id,
  event.batch_id,
  event.receipt_id,
  receipt.received_at AS receipt_received_at,
  event.confirmed_bar_close_epoch,
  event.proof_input_sha256,
  event.proof_input_json
FROM observation_entry_setup_events AS event
JOIN selection_cutoffs AS cutoff
  ON cutoff.setup_id = event.setup_id
JOIN observation_receipts AS receipt
  ON receipt.receipt_id = event.receipt_id
WHERE event.confirmed_bar_close_epoch <= cutoff.evaluated_at_epoch
  AND (? IS NULL OR event.recorded_at <= ?)
ORDER BY
  event.setup_id,
  event.confirmed_bar_close_epoch,
  event.event_id
`;
```

Add fixed `json_each(?)` queries for candidates, evidence, handling, selections,
diagnostics, parity, and source claims keyed by the returned setup IDs. The
source-claim query left-joins
`observation_entry_source_claim_relationships` and returns nullable
`target_claim_id` with every generated catalog field. Use
`LIST_ENTRY_PROOF_INPUTS_SQL` for the replay stream. Do not
concatenate user values into SQL. Bind `limit + 1`, remove the extra row, set
`has_more`, and encode the last returned `(evaluated_at_epoch, setup_id)` as
`next_cursor`.

The nested selection/diagnostic/parity queries bind the exact IDs returned by
`LIST_ENTRY_EVALUATION_KEYS_SQL`; they must not run a new global “latest
revision” lookup that could observe a post-deadline row. Load candidate,
evidence, and handling IDs only through
`observation_entry_evaluation_members` for that exact selection ID. This
retains rejected legacy diagnostics and accumulated pre-window context while
excluding objects introduced by a later revision.
Proof-input lookup is intentionally different: bind canonical JSON objects
`{setup_id,evaluated_at_epoch}` from the exact returned selection keys. For
each setup it returns the complete chronological event history only through
that selection's evaluated epoch and no later than the capture deadline,
including replay context whose receipt predates `since`. A post-selection
event can never leak into `proof_inputs` merely because it arrived before the
capture deadline.

Add `SELECT_ENTRY_CANARY_SUMMARY_SQL`, using the same filters except cursor and
limit, to return:

```sql
WITH window_batches AS (
  SELECT batch.batch_id
  FROM observation_entry_batches AS batch
  JOIN observation_receipts AS first_receipt
    ON first_receipt.receipt_id = batch.first_receipt_id
  WHERE (? IS NULL OR first_receipt.received_at >= ?)
    AND (? IS NULL OR first_receipt.received_at < ?)
)
SELECT
  COUNT(DISTINCT CASE
    WHEN ? IS NULL OR receipt.received_at <= ?
    THEN receipt.receipt_id END) AS receipt_count,
  COUNT(DISTINCT CASE
    WHEN ? IS NULL OR receipt.received_at <= ?
    THEN strftime('%Y-%m-%d', receipt.received_at) END
  ) AS distinct_receipt_dates,
  COUNT(DISTINCT batch.batch_id) AS total_batches,
  COUNT(DISTINCT CASE
    WHEN completion.completed_at IS NOT NULL
      AND (? IS NULL OR completion.completed_at <= ?)
    THEN completion.batch_id END) AS complete_batches,
  COUNT(DISTINCT CASE
    WHEN ? IS NULL OR quarantine.quarantined_at <= ?
    THEN quarantine.quarantine_id END) AS quarantined_objects,
  COUNT(DISTINCT CASE
    WHEN quarantine.reason IN (
      'IMMUTABLE_ID_CONFLICT',
      'EVENT_STREAM_CONFLICT',
      'TERMINAL_FACT_CONFLICT'
    )
      AND (? IS NULL OR quarantine.quarantined_at <= ?)
    THEN quarantine.quarantine_id END) AS immutable_conflicts,
  COUNT(DISTINCT CASE
    WHEN terminal.terminal_epoch IS NOT NULL
      AND (? IS NULL OR terminal.recorded_at <= ?)
    THEN terminal.setup_id END) AS completed_attempts,
  MIN(CASE WHEN ? IS NULL OR receipt.received_at <= ?
    THEN receipt.received_at END) AS first_received_at,
  MAX(CASE WHEN ? IS NULL OR receipt.received_at <= ?
    THEN receipt.received_at END) AS last_received_at
FROM window_batches
JOIN observation_entry_batches AS batch
  ON batch.batch_id = window_batches.batch_id
LEFT JOIN observation_entry_chunks AS chunk
  ON chunk.batch_id = batch.batch_id
LEFT JOIN observation_receipts AS receipt
  ON receipt.receipt_id = chunk.receipt_id
LEFT JOIN observation_entry_batch_completions AS completion
  ON completion.batch_id = batch.batch_id
LEFT JOIN observation_entry_quarantine AS quarantine
  ON quarantine.batch_id = batch.batch_id
LEFT JOIN observation_entry_setup_terminals AS terminal
  ON terminal.first_batch_id = batch.batch_id
```

Use separate fixed queries over the same window for parity status counts,
unknown claim references, and distinct producer/strategy/detector/settings
identities. Unknown claim references are the union of candidate, evidence, and
handling `source_claim_ids_json` values left-joined to
`observation_entry_source_claims`, reached through the cohort selections'
evaluation-member rows so later revisions cannot contaminate the count.
`distinct_receipt_dates` is the count of distinct UTC calendar dates across
all chunk receipts for cohort batches that were received no later than the
capture deadline; it is independent of pagination and setup/model filters.

Add a fixed `LIST_ENTRY_CONTINUITY_ROWS_SQL` that returns, without user-built
SQL, the cohort's semantic batches ordered by
`producer_instance_id, producer_sequence, bar_close_epoch`. For a bounded
window it also returns at most one anchor row per producer: the greatest
positive sequence whose first receipt precedes `since` and whose
strategy/detector/settings and symbol/ticker/feed/timeframe identity matches
the producer's first in-window row. Mark anchors explicitly and never include
them in batch, receipt, identity, or evaluation totals. A second fixed query
returns `SEQUENCE_CONFLICT` quarantine rows presented no later than the capture
deadline, including their producer instance, positive sequence, and bar close.

Add a separate fixed `LIST_MARKET_BAR_HEARTBEATS_SQL`. It returns
capture-deadline-bounded rows from `observation_market_bar_heartbeats` for:

- `ENTRY_V3_CANARY` rows whose market-bar close lies in `[since,until)`, plus
  the first row needed to establish each active producer interval;
- `LEGACY_REFERENCE` rows with the same
  `{symbol,ticker_id,feed,timeframe}` market identity and bar close in
  `[since,until)`.

Return receipt ID, schema/version, server-owned role, producer instance and
sequence, market identity, bar epochs, optional detector/settings hashes, and
recorded time. Validate each reference row's role/schema/version provenance
independently before using it. Do not require a reference detector, settings,
strategy version, or producer instance to equal V3, and do not let V3 serve as
its own reference.

Compute continuity in TypeScript, not with receipt arrival order:

1. partition strictly by `producer_instance_id`; never bridge a restart or
   compare two producer IDs;
2. sort each partition by positive sequence, tolerate arbitrary arrival order,
   and count `max(0, next_sequence - previous_sequence - 1)` as
   `sequence_gap_count`;
3. when a bounded partition has a compatible pre-window anchor, use it only
   for the leading comparison. Without an anchor, the first in-window sequence
   establishes the chain and creates no synthetic leading gap. Never infer a
   trailing gap after the last in-window row;
4. count every in-scope `SEQUENCE_CONFLICT` quarantine row as
   `sequence_conflict_count`, even though the conflicting receipt/batch was
   correctly refused;
5. partition V3 rows by exact
   `{producer_instance_id,strategy_version,detector_code_hash,settings_hash,
   symbol,ticker_id,feed,timeframe}`. Receipt order is irrelevant. An instance
   starts at its first V3 market bar and may not change code or market identity.
   For the same code/market identity, the first bar of a later producer instance
   is an explicit restart boundary and ends the immediately preceding instance
   interval exclusively. Equal/overlapping restart starts are a fail-closed
   schedule mismatch. The final instance stays active through the last
   compatible legacy reference bar before `until`; this is what detects a
   missing final tail rather than stopping comparison at the last V3 row;
6. within each active interval, take distinct `LEGACY_REFERENCE` close epochs
   with exact market identity. Do not synthesize `+300` epochs. For every
   producer-interval/reference-epoch comparison, increment
   `heartbeat_schedule_match_count` when that exact V3 producer has a semantic
   batch at the epoch, otherwise increment
   `heartbeat_schedule_mismatch_count`;
7. define `heartbeat_reference_bar_count` as the total number of those
   producer-interval/reference-epoch comparisons (not merely distinct market
   epochs), and assert the non-vacuous equation
   `heartbeat_schedule_match_count + heartbeat_schedule_mismatch_count ===
   heartbeat_reference_bar_count`. Return sorted unique
   `heartbeat_reference_provenance` identities so the report can prove every
   reference came from accepted schema `1.2` V2 rows.

Never manufacture expected bars by adding 300 seconds. Weekend, holiday,
session, and feed gaps are legitimate precisely when no compatible accepted
legacy-reference heartbeat exists for that epoch, so they add no mismatch.
Empty V3 batches remain observed heartbeats and count even when they have zero
setup bundles. A bounded promotion capture requires
`heartbeat_reference_bar_count > 0`; zero reference coverage is not success.
If there is no compatible independent V2 reference, schedule delivery is
unproven even when sequence continuity is clean.

Freeze source-window handling in `rd-entry-read-model.ts`:

```ts
export const ENTRY_BATCH_COMPLETION_GRACE_SECONDS = 900;

export async function readEntryEvaluations(
  db: D1Database,
  filters: EntryEvaluationFilters,
  now: Date = new Date(),
): Promise<EntryEvaluationReadResult>;
```

- A bounded cohort contains batches whose first receipt is in
  `[since,until)`.
- Its capture deadline is exactly `until + 900 seconds`.
- A completion, terminal, setup event, parity row, or chunk receipt contributes
  only when recorded no later than that deadline; later arrivals do not rewrite
  the closed capture.
- Before the current clock reaches the deadline, report
  `source_window_status="OPEN_GRACE"`, put unresolved cohort batches in
  `in_flight_batches`, and set `incomplete_batches=0`.
- At or after the deadline, report `source_window_status="FINAL"`, set
  `in_flight_batches=0`, and set
  `incomplete_batches=total_batches-complete_batches`. Every such incomplete
  batch is a rollout hard failure.
- With no `since/until`, report `source_window_status="UNBOUNDED"`; this is
  useful for the console but is never promotion evidence.

Batch completion metrics always include the entire time/symbol cohort so a
model or parity filter cannot hide an incomplete batch. Setup/evaluation,
terminal, parity, candidate, fidelity, reason, and source-claim counts honor
their corresponding non-pagination filters. Return the normalized filter
object in `canary.applied_filters`; Plan 4 must use only `since`, `until`, and
pagination and must reject a non-final capture.

- [ ] **Step 5: Assemble and validate the nested read model**

Define:

```ts
export interface ObservationEntryEvaluation {
  readonly setup_id: string;
  readonly batch_id: string;
  readonly symbol: string;
  readonly receipt_received_at: string;
  readonly proof_inputs: readonly {
    readonly event_id: string;
    readonly batch_id: string;
    readonly receipt_id: string;
    readonly receipt_received_at: string;
    readonly proof_input_sha256: string;
    readonly match_request: EntryMatchRequest;
  }[];
  readonly candidates: readonly EntryCandidate[];
  readonly evidence: readonly EntryCandidateEvidence[];
  readonly handling: readonly EntryHandlingObservation[];
  readonly producer_diagnostic: ProducerDiagnostic;
  readonly producer_diagnostic_selection: ProducerDiagnosticSelection | null;
  readonly selection: EffectiveEntrySelection;
  readonly parity_status: ParityStatus;
  readonly parity_mismatch_reason: ParityMismatchReason | null;
  readonly source_claims: readonly {
    readonly claim_id: string;
    readonly youtube_video_id: string;
    readonly published_date: string;
    readonly title_snapshot: string;
    readonly timestamp_start_seconds: number;
    readonly timestamp_end_seconds: number;
    readonly relationship: "SUPPORTS" | "NARROWS" | "SUPERSEDES";
    readonly target_claim_id: string | null;
  }[];
}
```

Parse every stored JSON column, reject malformed arrays, require unique IDs,
require evidence/handling references to exist in the same evaluation, require
canonical IDs to be jointly null or present, and verify all claim IDs and
nullable target claim IDs resolve.
Any bad D1 row throws `StorageUnavailableError`; no partial item is returned.
Parse the complete diagnostic candidate/evidence/realtime-evidence/handling
arrays from their stored JSON columns, validate their semantic references, and require
`producer_diagnostic_selection` to equal
`producer_diagnostic.selection`; this gives rollout both the Pine diagnostic
and the separately rendered selection without permitting drift.
Require every `producer_diagnostic.realtime_evidence` item to have
`proof_plane="REALTIME_TICK"`, the realtime ambiguity/fidelity/resolution
invariants from Task 3, and a candidate reference present in the same
diagnostic. Return the bounded array for audit, but never join it to
authoritative evidence IDs, evaluation members, terminal state, arbitration,
or canary parity counts.

For authoritative ownership, require every evidence candidate ID to resolve to
a candidate in this exact evaluation, every handling evidence to belong to the
handling candidate, the canonical candidate to appear in
`candidate_ids_considered`, canonical evidence to belong to that candidate,
and `canonical_model` to equal that candidate's model. A structurally valid
foreign key to a different candidate is still a malformed read model and fails
the whole response.
Recover `proof_inputs` from `observation_entry_setup_events.proof_input_json`,
never from receipt/chunk hashes. Verify each row by recomputing
`proof_input_sha256` and `event_id`; require one setup ID, strictly increasing
confirmed-bar close epochs, unique event IDs, and receipt/batch provenance in
storage no later than the capture deadline. Do not require replay-context
receipts to fall inside `[since,until)`; they may predate `since`. Return every
event for that setup in chronological order. Require one attempt kind and
trigger ordinal throughout. A terminal request must be the last authority
request; only one inferred grace request may follow when the BOTH terminal
introduced `DIR_CLOSE`, and it must repeat the frozen
terminal/setup/attempt facts. A flip in one completed batch followed by a close
in another must yield two proof inputs so the Python oracle can reproduce the
accumulated latest selection. The `event_id + match_request` pair is byte-shape
compatible with `edge_input.events[]` in the oracle vector.

Define the response aggregate:

```ts
export interface EntryCanaryAggregate {
  readonly source_window_status: "UNBOUNDED" | "OPEN_GRACE" | "FINAL";
  readonly window_since: string | null;
  readonly window_until: string | null;
  readonly capture_deadline: string | null;
  readonly completion_grace_seconds: 900;
  readonly deployment_version_id: string;
  readonly deployment_version_tag: string;
  readonly first_received_at: string | null;
  readonly last_received_at: string | null;
  readonly receipt_count: number;
  readonly distinct_receipt_dates: number;
  readonly total_batches: number;
  readonly complete_batches: number;
  readonly incomplete_batches: number;
  readonly in_flight_batches: number;
  readonly quarantined_objects: number;
  readonly immutable_conflicts: number;
  readonly sequence_gap_count: number;
  readonly sequence_conflict_count: number;
  readonly heartbeat_schedule_match_count: number;
  readonly heartbeat_schedule_mismatch_count: number;
  readonly heartbeat_reference_bar_count: number;
  readonly heartbeat_reference_provenance: readonly {
    readonly schema_version: "1.2";
    readonly strategy_version: "1.2.0-contract1";
    readonly producer_role: "LEGACY_REFERENCE";
    readonly producer_instance_id: string;
    readonly symbol: string;
    readonly ticker_id: string;
    readonly feed: string;
    readonly timeframe: "5";
  }[];
  readonly unknown_source_claims: number;
  readonly completed_attempts: number;
  readonly parity_match: number;
  readonly parity_mismatch: number;
  readonly parity_not_provided: number;
  readonly applied_filters: {
    readonly setup_id: string | null;
    readonly symbol: string | null;
    readonly model: EntryModelV2 | null;
    readonly fidelity: CandidateFidelity | null;
    readonly reason: SelectionReason | null;
    readonly parity_status: ParityStatus | null;
  };
  readonly identities: readonly {
    readonly producer_instance_id: string;
    readonly strategy_id: "rd_liquidity_sd_5m_v1";
    readonly strategy_version: "2.0.0-contract2";
    readonly detector_code_hash: string;
    readonly settings_hash: string;
  }[];
}
```

Return `identities` as sorted unique full tuples. Multiple rows that differ
only by `producer_instance_id` are expected across Pine restarts. Promotion
consumers project away `producer_instance_id` and require exactly one shared
`strategy_id/strategy_version/detector_code_hash/settings_hash` code identity;
different producer instance IDs alone do not split that identity.
`completed_attempts` is the distinct setup count from immutable
`observation_entry_setup_terminals`, never a count of selection IDs or
revisions. Open attempts do not count. `parity_match`,
`parity_mismatch`, and `parity_not_provided` count every evaluation in the
closed cohort, not only the latest displayed revision. Promotion requires
`parity_not_provided=0` and every evaluation to be `MATCH`; a missing Pine
diagnostic is not silently omitted.
All five continuity counts are full-cohort, capture-deadline metrics and ignore
setup/model/fidelity/parity pagination filters. Promotion consumes them
fail-closed: sequence gaps, sequence conflicts, heartbeat mismatches, zero
reference coverage, or a broken match/mismatch/reference equation are never
hidden by an otherwise complete setup evaluation.
Populate the deployment fields directly from `CF_VERSION_METADATA` on every
page, require nonempty values outside local tests, and include them in the
canonically repeated canary object. A paginated capture fails if either value
changes between pages.

- [ ] **Step 6: Add the GET handler and preserve legacy routes**

Add:

```ts
async function listEntryEvaluations(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!ingressConfigured(env)) {
    return errorResponse(503, "INGRESS_DISABLED", "TradingView observation ingress is disabled");
  }
  let filters: EntryEvaluationFilters;
  try {
    filters = parseEntryEvaluationFilters(new URL(request.url));
  } catch {
    return errorResponse(422, "INVALID_ENTRY_FILTER", "Entry evaluation filters are invalid");
  }
  try {
    const result = await readEntryEvaluations(env.DB, filters);
    return jsonResponse({
      mode: "OBSERVATION_ONLY",
      execution: "DISABLED",
      canonical_paper_enabled:
        canonicalPaperSelectionConfigured(env),
      items: result.items,
      count: result.items.length,
      page: {
        has_more: result.hasMore,
        next_cursor: result.nextCursor,
      },
      canary: result.canary,
    });
  } catch {
    return errorResponse(
      503,
      "ENTRY_EVALUATIONS_UNAVAILABLE",
      "Entry evaluation storage is unavailable",
    );
  }
}
```

Register only:

```ts
if (url.pathname === "/api/v1/observation-entry-evaluations") {
  return request.method === "GET"
    ? listEntryEvaluations(request, env)
    : errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
}
```

- [ ] **Step 7: Run API, Worker, and bound tests for GREEN**

Run:

```bash
cd apps/observation-edge
npx vitest run test/rd-entry-api.test.ts test/worker.test.ts
npm run lint
npm run typecheck
```

Expected: nested projections and every filter pass, `limit=200` passes,
`limit=201` fails with `422`, cursor pages do not overlap, canary totals remain
constant across pages, and the two-event replay stream survives pagination.
Use a fake clock to prove a bounded window is `OPEN_GRACE` one second before
`until+900`, becomes `FINAL` at the deadline, and then classifies unresolved
batches as incomplete. Prove late completion does not rewrite the closed
capture, a pre-`since` flip proof is retained as replay context for an
in-window close, a post-deadline selection revision cannot hide the as-of
selection, terminal rows—not selections—determine `completed_attempts`,
incomplete/quarantined batches remain visible, `NOT_PROVIDED` is counted as a
promotion blocker, and all legacy routes retain prior results. Insert receipts
on two UTC dates and assert `distinct_receipt_dates=2` on every cursor page.
Use two producer instance IDs with the same strategy/version/detector/settings
tuple and assert both identities are returned while their projected code
identity remains singular. For one producer, insert sequences `7`, `5`, and
`6` out of receipt order and prove `sequence_gap_count=0`; omit `6` and prove
the count is `1`. Prove the first in-window sequence creates no leading gap
without a compatible pre-window anchor, then add an anchor and prove only the
missing boundary sequences are counted. Never compare the two producer IDs.
Add compatible legacy-reference heartbeat rows spanning a weekend and prove absent
wall-clock five-minute epochs are legitimate, while an independently observed
compatible market bar missing from one active producer increments
`heartbeat_schedule_mismatch_count`. Prove a missing final V3 tail is detected
through the last pre-`until` reference bar, a new producer instance establishes
an exclusive restart boundary, reference detector/settings/version differences
do not break market compatibility, V3 cannot reference itself, and
`match + mismatch = reference > 0`. Add a changed semantic identity at an existing sequence
and prove `sequence_conflict_count=1`. Include one bounded realtime diagnostic
row and prove it is returned as `producer_diagnostic.realtime_evidence` while
authoritative evidence, parity, terminals, and selection are unchanged.

- [ ] **Step 8: Commit the query API**

```bash
git add apps/observation-edge/src/rd-entry-queries.ts \
  apps/observation-edge/src/rd-entry-read-model.ts \
  apps/observation-edge/src/index.ts \
  apps/observation-edge/test/rd-entry-api.test.ts \
  apps/observation-edge/test/entry-api-fixture.ts
git commit -m "feat: expose RD entry evaluation audit API"
```

---

### Task 8: Add a strict fail-closed console API client

**Files:**
- Modify: `apps/operations-console/src/lib/api.ts:1`
- Create: `apps/operations-console/tests/entry-evaluations-api.test.ts`

**Interfaces:**
- Consumes: `GET /api/v1/observation-entry-evaluations?limit=200`.
- Produces: `EntryEvaluationsSnapshot` and
  `loadEntryEvaluations(signal?: AbortSignal)`.
- Guarantees: malformed nested references, executable actions, or mislabeled
  proof fail to `ERROR`.

- [ ] **Step 1: Write failing client parsing tests**

Create `entry-evaluations-api.test.ts` with a complete two-candidate API
document:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadEntryEvaluations } from "../src/lib/api";

const h = (character: string) => character.repeat(64);
const DIR_CLOSE_SOURCE_CLAIMS = [
  "standard-close-2024-03",
  "closure-or-flip-2025-03",
  "directional-close-2025-08",
  "directional-close-required-2026-06",
  "model-continuation-2026-07",
] as const;
const HTF_FLIP_SOURCE_CLAIMS = [
  "htf-flip-2024-03",
  "htf-context-set-2025-08",
  "htf-flip-definition-2025-08",
  "pure-flip-narrowing-2026-05",
  "model-continuation-2026-07",
] as const;
const NEXT_CANDLE_WICK_SOURCE_CLAIMS = [
  "next-candle-wick-2025-05",
  "prompt-close-2025-05",
  "close-fallback-2025-11",
] as const;
const SOURCE_CLAIM_RECORDS = [
  {
    claim_id: "standard-close-2024-03",
    youtube_video_id: "kxh_3__oAqg",
    published_date: "2024-03-25",
    title_snapshot:
      "FULL course for LIQUIDITY supply and demand best NEW trading strategy 2026",
    timestamp_start_seconds: 794,
    timestamp_end_seconds: 876,
    relationship: "SUPPORTS",
  },
  {
    claim_id: "closure-or-flip-2025-03",
    youtube_video_id: "Gr0njSOtC10",
    published_date: "2025-03-20",
    title_snapshot: "First 5m livestream (1 win 1 loss) 1:2.5r trade on gj",
    timestamp_start_seconds: 3106,
    timestamp_end_seconds: 3149,
    relationship: "NARROWS",
  },
  {
    claim_id: "directional-close-2025-08",
    youtube_video_id: "E5EBc1MtiXQ",
    published_date: "2025-08-17",
    title_snapshot:
      "The Trading Strategy That Changed My Life - RD Concepts Full Guide",
    timestamp_start_seconds: 999,
    timestamp_end_seconds: 1094,
    relationship: "NARROWS",
  },
  {
    claim_id: "directional-close-required-2026-06",
    youtube_video_id: "zglv2r9xXnE",
    published_date: "2026-06-11",
    title_snapshot: "Liquidity supply & demand live trading - 5m timeframe",
    timestamp_start_seconds: 655,
    timestamp_end_seconds: 665,
    relationship: "NARROWS",
  },
  {
    claim_id: "model-continuation-2026-07",
    youtube_video_id: "T86aLDxzlbM",
    published_date: "2026-07-15",
    title_snapshot: "180% in 2 weeks - Full Futures Strategy Backtest Breakdown",
    timestamp_start_seconds: 247,
    timestamp_end_seconds: 2550,
    relationship: "SUPPORTS",
  },
  {
    claim_id: "htf-flip-2024-03",
    youtube_video_id: "kxh_3__oAqg",
    published_date: "2024-03-25",
    title_snapshot:
      "FULL course for LIQUIDITY supply and demand best NEW trading strategy 2026",
    timestamp_start_seconds: 892,
    timestamp_end_seconds: 1005,
    relationship: "SUPPORTS",
  },
  {
    claim_id: "htf-context-set-2025-08",
    youtube_video_id: "E5EBc1MtiXQ",
    published_date: "2025-08-17",
    title_snapshot:
      "The Trading Strategy That Changed My Life - RD Concepts Full Guide",
    timestamp_start_seconds: 1189,
    timestamp_end_seconds: 1198,
    relationship: "NARROWS",
  },
  {
    claim_id: "htf-flip-definition-2025-08",
    youtube_video_id: "E5EBc1MtiXQ",
    published_date: "2025-08-17",
    title_snapshot:
      "The Trading Strategy That Changed My Life - RD Concepts Full Guide",
    timestamp_start_seconds: 1270,
    timestamp_end_seconds: 1345,
    relationship: "NARROWS",
  },
  {
    claim_id: "pure-flip-narrowing-2026-05",
    youtube_video_id: "lo_7HDQK9WM",
    published_date: "2026-05-21",
    title_snapshot: "liquidity supply & demand live trading - 1:4 on NC",
    timestamp_start_seconds: 3647,
    timestamp_end_seconds: 3984,
    relationship: "NARROWS",
  },
  {
    claim_id: "next-candle-wick-2025-05",
    youtube_video_id: "f3X9T69y24c",
    published_date: "2025-05-20",
    title_snapshot: "How To Trade The 5m Timeframe (it's not the same)",
    timestamp_start_seconds: 40,
    timestamp_end_seconds: 97,
    relationship: "SUPPORTS",
  },
  {
    claim_id: "prompt-close-2025-05",
    youtube_video_id: "f3X9T69y24c",
    published_date: "2025-05-20",
    title_snapshot: "How To Trade The 5m Timeframe (it's not the same)",
    timestamp_start_seconds: 211,
    timestamp_end_seconds: 223,
    relationship: "SUPPORTS",
  },
  {
    claim_id: "close-fallback-2025-11",
    youtube_video_id: "UqYlKtPjKvY",
    published_date: "2025-11-20",
    title_snapshot:
      "The Strategy That Just Makes Sense - 6 Simple 1:4 Trades In 1 Week",
    timestamp_start_seconds: 362,
    timestamp_end_seconds: 430,
    relationship: "SUPPORTS",
  },
] as const;

In the implemented fixture, add required nullable `target_claim_id` to every
source-claim record using the exact generated catalog relationship; do not
infer it from the human-readable relationship enum.

function report(overrides: Record<string, unknown> = {}) {
  return {
    mode: "OBSERVATION_ONLY",
    execution: "DISABLED",
    canonical_paper_enabled: false,
    count: 1,
    page: { has_more: false, next_cursor: null },
    canary: {
      source_window_status: "UNBOUNDED",
      window_since: null,
      window_until: null,
      capture_deadline: null,
      completion_grace_seconds: 900,
      first_received_at: "2026-07-24T12:00:00Z",
      last_received_at: "2026-07-24T12:00:00Z",
      receipt_count: 1,
      distinct_receipt_dates: 1,
      total_batches: 1,
      complete_batches: 1,
      incomplete_batches: 0,
      in_flight_batches: 0,
      quarantined_objects: 0,
      immutable_conflicts: 0,
      sequence_gap_count: 0,
      sequence_conflict_count: 0,
      heartbeat_schedule_match_count: 1,
      heartbeat_schedule_mismatch_count: 0,
      heartbeat_reference_bar_count: 1,
      heartbeat_reference_provenance: [{
        schema_version: "1.2",
        strategy_version: "1.2.0-contract1",
        producer_role: "LEGACY_REFERENCE",
        producer_instance_id: "pine-v2-reference",
        symbol: "EURUSD",
        ticker_id: "OANDA:EURUSD",
        feed: "OANDA",
        timeframe: "5",
      }],
      unknown_source_claims: 0,
      completed_attempts: 1,
      parity_match: 1,
      parity_mismatch: 0,
      parity_not_provided: 0,
      applied_filters: {
        setup_id: null,
        symbol: null,
        model: null,
        fidelity: null,
        reason: null,
        parity_status: null,
      },
      identities: [{
        producer_instance_id: "pine-v3-lab",
        strategy_id: "rd_liquidity_sd_5m_v1",
        strategy_version: "2.0.0-contract2",
        detector_code_hash: h("1"),
        settings_hash: h("2"),
      }],
    },
    items: [{
      setup_id: "setup-1",
      batch_id: h("b"),
      symbol: "EURUSD",
      receipt_received_at: "2026-07-24T12:00:00Z",
      proof_inputs: [
        {
          event_id: h("7"),
          batch_id: h("b"),
          receipt_id: h("8"),
          receipt_received_at: "2026-07-24T12:00:00Z",
          proof_input_sha256: h("a"),
          match_request: {
            setup: {
              setup_id: "setup-1",
              direction: "LONG",
              zone_top_ticks: 100,
              zone_bottom_ticks: 90,
              zone_engaged_epoch: 1721808010,
              invalidated_before_entry: false,
              common_fidelity: "EXACT",
              terminal_reason: null,
              terminal_epoch: null,
            },
            confirmed_bar: {
              open_epoch: 1721808000,
              close_epoch: 1721808300,
              open_ticks: 99,
              high_ticks: 105,
              low_ticks: 95,
              close_ticks: 103,
            },
            htf_proofs: [],
            generic_break_detected: false,
            rejection_respect_detected: false,
            attempt_kind: "INITIAL",
          },
        },
        {
          event_id: h("2"),
          batch_id: h("b"),
          receipt_id: h("3"),
          receipt_received_at: "2026-07-24T12:05:00Z",
          proof_input_sha256: h("1"),
          match_request: {
          setup: {
            setup_id: "setup-1",
            direction: "LONG",
            zone_top_ticks: 100,
            zone_bottom_ticks: 90,
            zone_engaged_epoch: 1721808010,
            invalidated_before_entry: false,
            common_fidelity: "EXACT",
            terminal_reason: null,
            terminal_epoch: null,
          },
          confirmed_bar: {
            open_epoch: 1721808300,
            close_epoch: 1721808600,
            open_ticks: 103,
            high_ticks: 104,
            low_ticks: 101,
            close_ticks: 102,
          },
          htf_proofs: [],
          generic_break_detected: false,
          rejection_respect_detected: false,
          attempt_kind: "INITIAL",
        },
        },
      ],
      candidates: [
        {
          candidate_id: h("c"),
          setup_id: "setup-1",
          model: "HTF_FLIP",
          state: "MATCHED",
          event_anchor_epoch: 1721808000,
          trigger_ordinal: 1,
          direction: "LONG",
          source_claim_ids: [...HTF_FLIP_SOURCE_CLAIMS],
          normalized_from: null,
          observed_at_epoch: 1721808060,
        },
        {
          candidate_id: h("d"),
          setup_id: "setup-1",
          model: "DIR_CLOSE",
          state: "MATCHED",
          event_anchor_epoch: 1721808000,
          trigger_ordinal: 1,
          direction: "LONG",
          source_claim_ids: [...DIR_CLOSE_SOURCE_CLAIMS],
          normalized_from: null,
          observed_at_epoch: 1721808300,
        },
      ],
      evidence: [
        {
          evidence_id: h("e"),
          candidate_id: h("c"),
          observed_trigger_epoch: 1721808060,
          observed_trigger_ticks: 100,
          htf_context_minutes: [15, 30],
          fidelity: "EXACT",
          proof_plane: "LOWER_TIMEFRAME_REPLAY",
          proof_resolution_seconds: 60,
          coverage_start_epoch: 1721808000,
          coverage_end_epoch: 1721808300,
          ambiguity_codes: [],
          passed_rule_ids: ["ENTRY_HTF_FLIP"],
          failed_rule_ids: [],
          source_claim_ids: [...HTF_FLIP_SOURCE_CLAIMS],
          payload_sha256: h("a"),
          observed_at_epoch: 1721808060,
        },
        {
          evidence_id: h("6"),
          candidate_id: h("d"),
          observed_trigger_epoch: 1721808300,
          observed_trigger_ticks: 103,
          htf_context_minutes: [],
          fidelity: "EXACT",
          proof_plane: "CONFIRMED_5M",
          proof_resolution_seconds: 300,
          coverage_start_epoch: 1721808000,
          coverage_end_epoch: 1721808300,
          ambiguity_codes: [],
          passed_rule_ids: ["ENTRY_DIR_CLOSE"],
          failed_rule_ids: [],
          source_claim_ids: [...DIR_CLOSE_SOURCE_CLAIMS],
          payload_sha256: h("5"),
          observed_at_epoch: 1721808300,
        },
      ],
      handling: [
        {
          handling_id: h("f"),
          candidate_id: h("c"),
          evidence_id: h("e"),
          handling_mode: "INTRABAR_FLIP",
          attempt_kind: "INITIAL",
          observed_epoch: 1721808060,
          observed_ticks: 100,
          fidelity: "EXACT",
          source_claim_ids: [...HTF_FLIP_SOURCE_CLAIMS],
        },
        {
          handling_id: h("5"),
          candidate_id: h("d"),
          evidence_id: h("6"),
          handling_mode: "CLOSE_CONFIRMATION",
          attempt_kind: "INITIAL",
          observed_epoch: 1721808300,
          observed_ticks: 103,
          fidelity: "EXACT",
          source_claim_ids: [...DIR_CLOSE_SOURCE_CLAIMS],
        },
        {
          handling_id: h("4"),
          candidate_id: h("d"),
          evidence_id: h("6"),
          handling_mode: "NEXT_CANDLE_WICK",
          attempt_kind: "INITIAL",
          observed_epoch: 1721808600,
          observed_ticks: 101,
          fidelity: "DISCRETIONARY",
          source_claim_ids: [...NEXT_CANDLE_WICK_SOURCE_CLAIMS],
        },
      ],
      producer_diagnostic: {
        candidates: [
          {
            model: "HTF_FLIP",
            state: "MATCHED",
            event_anchor_epoch: 1721808000,
            trigger_ordinal: 1,
            normalized_from: null,
            source_claim_ids: [...HTF_FLIP_SOURCE_CLAIMS],
          },
          {
            model: "DIR_CLOSE",
            state: "MATCHED",
            event_anchor_epoch: 1721808000,
            trigger_ordinal: 1,
            normalized_from: null,
            source_claim_ids: [...DIR_CLOSE_SOURCE_CLAIMS],
          },
        ],
        evidence: [
          {
            candidate: {
              model: "HTF_FLIP",
              state: "MATCHED",
              event_anchor_epoch: 1721808000,
              trigger_ordinal: 1,
              normalized_from: null,
              source_claim_ids: [...HTF_FLIP_SOURCE_CLAIMS],
            },
            observed_trigger_epoch: 1721808060,
            observed_trigger_ticks: 100,
            htf_context_minutes: [15, 30],
            fidelity: "EXACT",
            proof_plane: "LOWER_TIMEFRAME_REPLAY",
            proof_resolution_seconds: 60,
            coverage_start_epoch: 1721808000,
            coverage_end_epoch: 1721808300,
            ambiguity_codes: [],
            passed_rule_ids: ["ENTRY_HTF_FLIP"],
            failed_rule_ids: [],
            source_claim_ids: [...HTF_FLIP_SOURCE_CLAIMS],
          },
          {
            candidate: {
              model: "DIR_CLOSE",
              state: "MATCHED",
              event_anchor_epoch: 1721808000,
              trigger_ordinal: 1,
              normalized_from: null,
              source_claim_ids: [...DIR_CLOSE_SOURCE_CLAIMS],
            },
            observed_trigger_epoch: 1721808300,
            observed_trigger_ticks: 103,
            htf_context_minutes: [],
            fidelity: "EXACT",
            proof_plane: "CONFIRMED_5M",
            proof_resolution_seconds: 300,
            coverage_start_epoch: 1721808000,
            coverage_end_epoch: 1721808300,
            ambiguity_codes: [],
            passed_rule_ids: ["ENTRY_DIR_CLOSE"],
            failed_rule_ids: [],
            source_claim_ids: [...DIR_CLOSE_SOURCE_CLAIMS],
          },
        ],
        realtime_evidence: [{
          candidate: {
            model: "HTF_FLIP",
            state: "MATCHED",
            event_anchor_epoch: 1721808000,
            trigger_ordinal: 1,
            normalized_from: null,
            source_claim_ids: [...HTF_FLIP_SOURCE_CLAIMS],
          },
          observed_trigger_epoch: 1721808042,
          observed_trigger_ticks: 100,
          htf_context_minutes: [15],
          fidelity: "UNRESOLVED",
          proof_plane: "REALTIME_TICK",
          proof_resolution_seconds: 0,
          coverage_start_epoch: 1721808042,
          coverage_end_epoch: 1721808042,
          ambiguity_codes: ["SHADOW_REALTIME_ONLY_NOT_REPLAYABLE"],
          passed_rule_ids: [],
          failed_rule_ids: ["ENTRY_HTF_FLIP"],
          source_claim_ids: [...HTF_FLIP_SOURCE_CLAIMS],
        }],
        handling: [
          {
          candidate: {
            model: "HTF_FLIP",
            state: "MATCHED",
            event_anchor_epoch: 1721808000,
            trigger_ordinal: 1,
            normalized_from: null,
            source_claim_ids: [...HTF_FLIP_SOURCE_CLAIMS],
          },
          evidence: {
            candidate: {
              model: "HTF_FLIP",
              state: "MATCHED",
              event_anchor_epoch: 1721808000,
              trigger_ordinal: 1,
              normalized_from: null,
              source_claim_ids: [...HTF_FLIP_SOURCE_CLAIMS],
            },
            observed_trigger_epoch: 1721808060,
            observed_trigger_ticks: 100,
            htf_context_minutes: [15, 30],
            fidelity: "EXACT",
            proof_plane: "LOWER_TIMEFRAME_REPLAY",
            proof_resolution_seconds: 60,
            coverage_start_epoch: 1721808000,
            coverage_end_epoch: 1721808300,
            ambiguity_codes: [],
            passed_rule_ids: ["ENTRY_HTF_FLIP"],
            failed_rule_ids: [],
            source_claim_ids: [...HTF_FLIP_SOURCE_CLAIMS],
          },
          handling_mode: "INTRABAR_FLIP",
          attempt_kind: "INITIAL",
          observed_epoch: 1721808060,
          observed_ticks: 100,
          fidelity: "EXACT",
          source_claim_ids: [...HTF_FLIP_SOURCE_CLAIMS],
          },
          {
            candidate: {
              model: "DIR_CLOSE",
              state: "MATCHED",
              event_anchor_epoch: 1721808000,
              trigger_ordinal: 1,
              normalized_from: null,
              source_claim_ids: [...DIR_CLOSE_SOURCE_CLAIMS],
            },
            evidence: {
              candidate: {
                model: "DIR_CLOSE",
                state: "MATCHED",
                event_anchor_epoch: 1721808000,
                trigger_ordinal: 1,
                normalized_from: null,
                source_claim_ids: [...DIR_CLOSE_SOURCE_CLAIMS],
              },
              observed_trigger_epoch: 1721808300,
              observed_trigger_ticks: 103,
              htf_context_minutes: [],
              fidelity: "EXACT",
              proof_plane: "CONFIRMED_5M",
              proof_resolution_seconds: 300,
              coverage_start_epoch: 1721808000,
              coverage_end_epoch: 1721808300,
              ambiguity_codes: [],
              passed_rule_ids: ["ENTRY_DIR_CLOSE"],
              failed_rule_ids: [],
              source_claim_ids: [...DIR_CLOSE_SOURCE_CLAIMS],
            },
            handling_mode: "CLOSE_CONFIRMATION",
            attempt_kind: "INITIAL",
            observed_epoch: 1721808300,
            observed_ticks: 103,
            fidelity: "EXACT",
            source_claim_ids: [...DIR_CLOSE_SOURCE_CLAIMS],
          },
          {
            candidate: {
              model: "DIR_CLOSE",
              state: "MATCHED",
              event_anchor_epoch: 1721808000,
              trigger_ordinal: 1,
              normalized_from: null,
              source_claim_ids: [...DIR_CLOSE_SOURCE_CLAIMS],
            },
            evidence: {
              candidate: {
                model: "DIR_CLOSE",
                state: "MATCHED",
                event_anchor_epoch: 1721808000,
                trigger_ordinal: 1,
                normalized_from: null,
                source_claim_ids: [...DIR_CLOSE_SOURCE_CLAIMS],
              },
              observed_trigger_epoch: 1721808300,
              observed_trigger_ticks: 103,
              htf_context_minutes: [],
              fidelity: "EXACT",
              proof_plane: "CONFIRMED_5M",
              proof_resolution_seconds: 300,
              coverage_start_epoch: 1721808000,
              coverage_end_epoch: 1721808300,
              ambiguity_codes: [],
              passed_rule_ids: ["ENTRY_DIR_CLOSE"],
              failed_rule_ids: [],
              source_claim_ids: [...DIR_CLOSE_SOURCE_CLAIMS],
            },
            handling_mode: "NEXT_CANDLE_WICK",
            attempt_kind: "INITIAL",
            observed_epoch: 1721808600,
            observed_ticks: 101,
            fidelity: "DISCRETIONARY",
            source_claim_ids: [...NEXT_CANDLE_WICK_SOURCE_CLAIMS],
          },
        ],
        selection: {
          version: "PINE_DIAGNOSTIC_ONLY",
          semantic_key: "HTF_FLIP:1721808000:1",
          model: "HTF_FLIP",
          event_anchor_epoch: 1721808000,
          trigger_ordinal: 1,
          reason: "EARLIEST_EXACT_TRIGGER",
          fidelity: "EXACT",
          action: "SHADOW_ONLY",
        },
      },
      producer_diagnostic_selection: {
        version: "PINE_DIAGNOSTIC_ONLY",
        semantic_key: "HTF_FLIP:1721808000:1",
        model: "HTF_FLIP",
        event_anchor_epoch: 1721808000,
        trigger_ordinal: 1,
        reason: "EARLIEST_EXACT_TRIGGER",
        fidelity: "EXACT",
        action: "SHADOW_ONLY",
      },
      selection: {
        selection_id: h("9"),
        setup_id: "setup-1",
        policy_version: "rd-entry-arbitration-v2",
        revision: 1,
        candidate_ids_considered: [h("c"), h("d")],
        canonical_candidate_id: h("c"),
        canonical_evidence_id: h("e"),
        canonical_model: "HTF_FLIP",
        reason: "EARLIEST_EXACT_TRIGGER",
        fidelity: "EXACT",
        policy_action: "PAPER_ELIGIBLE",
        action: "SHADOW_ONLY",
        effective_action_reason: null,
        evaluated_at_epoch: 1721808300,
      },
      parity_status: "MATCH",
      parity_mismatch_reason: null,
      source_claims: [...SOURCE_CLAIM_RECORDS],
    }],
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("loadEntryEvaluations", () => {
  it("loads 200 bounded evaluations and preserves diagnostic separation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(report()), { status: 200 }),
    ));
    const result = await loadEntryEvaluations();
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/observation-entry-evaluations?limit=200",
      expect.any(Object),
    );
    expect(result.state).toBe("RECEIVED");
    expect(result.items[0]?.selection.action).toBe("SHADOW_ONLY");
    expect(result.items[0]?.producerDiagnosticSelection).toBeDefined();
    expect(result.items[0]?.producerDiagnostic.realtimeEvidence).toHaveLength(1);
    expect(new Set(result.items[0]?.sourceClaims.map((claim) => claim.claimId)))
      .toEqual(new Set(SOURCE_CLAIM_RECORDS.map((claim) => claim.claim_id)));
  });

  it.each([
    report({ execution: "ENABLED" }),
    report({ count: 2 }),
    report({ items: [] }),
  ])("fails closed on malformed reports", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }),
    ));
    await expect(loadEntryEvaluations()).resolves.toMatchObject({
      state: "ERROR",
      items: [],
    });
  });
});
```

- [ ] **Step 2: Run client tests and verify RED**

Run:

```bash
cd apps/operations-console
npx vitest run tests/entry-evaluations-api.test.ts
```

Expected: FAIL because `loadEntryEvaluations` is not exported.

- [ ] **Step 3: Define camel-case console types**

Add to `api.ts`:

```ts
export type EntryEvaluation = {
  setupId: string;
  batchId: string;
  symbol: string;
  receiptReceivedAt: string;
  proofInputs: EntryProofInputView[];
  candidates: EntryCandidateView[];
  evidence: EntryEvidenceView[];
  handling: EntryHandlingView[];
  producerDiagnostic: ProducerDiagnosticAuditView;
  producerDiagnosticSelection: ProducerDiagnosticView | null;
  selection: EntrySelectionView;
  parityStatus: "MATCH" | "MISMATCH" | "NOT_PROVIDED";
  parityMismatchReason:
    | "CANDIDATE_KEYS"
    | "EVIDENCE_DESCRIPTORS"
    | "HANDLING_DESCRIPTORS"
    | "SELECTED_CANDIDATE"
    | "REASON"
    | "FIDELITY"
    | "DIAGNOSTIC_ACTION"
    | "MULTIPLE"
    | null;
  sourceClaims: EntrySourceClaimView[];
};

export type EntryEvaluationsSnapshot = {
  state: "LOADING" | "ERROR" | "EMPTY" | "BLOCKED" | "RECEIVED";
  canonicalPaperEnabled: boolean | null;
  count: number;
  items: EntryEvaluation[];
  page: {
    hasMore: boolean;
    nextCursor: string | null;
  } | null;
  canary: EntryCanaryView | null;
  message: string;
};
```

Define `EntryCandidateView`, `EntryEvidenceView`, `EntryHandlingView`,
`ProducerDiagnosticView`, `EntrySelectionView`, `EntrySourceClaimView`,
`ProducerDiagnosticAuditView`, `EntryProofInputView`, and `EntryCanaryView`
with the exact camel-case
equivalents from the fixture. `EntryProofInputView.matchRequest` is the full Task 1
`EntryMatchRequest` shape, including bounded HTF transcript and terminal
fields; do not type or parse it as `unknown`. Keep IDs in these audit types;
unlike receipt cards, they are required to correlate evidence.
`EntrySelectionView` includes
`effectiveActionReason: "PROMOTION_IDENTITY_MISMATCH" | null`, and
`EntrySourceClaimView` includes `targetClaimId: string | null`.

- [ ] **Step 4: Implement strict nested parsing**

Add parser functions:

```ts
function parseEntryCandidate(value: unknown): EntryCandidateView;
function parseEntryEvidence(value: unknown): EntryEvidenceView;
function parseEntryHandling(value: unknown): EntryHandlingView;
function parseProducerDiagnostic(value: unknown): ProducerDiagnosticView;
function parseProducerDiagnosticAudit(
  value: unknown,
): ProducerDiagnosticAuditView;
function parseEntrySelection(value: unknown): EntrySelectionView;
function parseEntrySourceClaim(value: unknown): EntrySourceClaimView;
function parseEntryProofInput(value: unknown): EntryProofInputView;
function parseEntryCanary(value: unknown): EntryCanaryView;
function parseEntryPage(value: unknown): {
  hasMore: boolean;
  nextCursor: string | null;
};
function parseEntryEvaluation(
  value: unknown,
  canonicalPaperEnabled: boolean,
): EntryEvaluation;
```

Use closed `Set` values matching Task 1. Validate lowercase 64-hex IDs,
nonnegative safe-integer epochs, sorted unique HTF contexts, UTC publication
dates, and YouTube IDs. Parse proof inputs with exact-key checks, verify setup
IDs, event ordering, event/proof hash formats, OHLC, terminal nullable pairs, and the
bounded HTF transcript invariants from Task 3. Parse the full page and canary;
require nonnegative counts, `complete + incomplete + in_flight = total`,
`completionGraceSeconds === 900`, a final window to have zero in-flight
batches, every identity hash to be nonzero lowercase 64-hex, and
`heartbeatScheduleMatchCount + heartbeatScheduleMismatchCount ===
heartbeatReferenceBarCount`. Parse the reference provenance array with exact
keys and require every row to be server role `LEGACY_REFERENCE`, schema `1.2`,
strategy `1.2.0-contract1`, and compatible market identity. A final bounded
canary with zero reference bars is fail-closed.
Require `producerDiagnostic.selection` to deep-equal
`producerDiagnosticSelection`, and validate every semantic candidate/evidence/
handling reference before trusting the stored parity label.

After parsing one evaluation, enforce:

```ts
const candidateIds = new Set(candidates.map((item) => item.candidateId));
const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
const candidateById = new Map(
  candidates.map((item) => [item.candidateId, item]),
);
const evidenceById = new Map(
  evidence.map((item) => [item.evidenceId, item]),
);
const canonicalCandidate =
  selection.canonicalCandidateId === null
    ? null
    : candidateById.get(selection.canonicalCandidateId);
const canonicalEvidence =
  selection.canonicalEvidenceId === null
    ? null
    : evidenceById.get(selection.canonicalEvidenceId);
if (
  evidence.some((item) => !candidateIds.has(item.candidateId)) ||
  handling.some(
    (item) =>
      !candidateIds.has(item.candidateId) ||
      !evidenceIds.has(item.evidenceId) ||
      evidenceById.get(item.evidenceId)?.candidateId !== item.candidateId,
  ) ||
  (selection.canonicalCandidateId !== null &&
    (
      canonicalCandidate === undefined ||
      !selection.candidateIdsConsidered.includes(
        selection.canonicalCandidateId,
      )
    )) ||
  (selection.canonicalEvidenceId !== null &&
    (
      canonicalEvidence === undefined ||
      canonicalEvidence.candidateId !== selection.canonicalCandidateId
    )) ||
  (canonicalCandidate !== null &&
    canonicalCandidate !== undefined &&
    canonicalCandidate.model !== selection.canonicalModel)
) {
  throw new InvalidApiPayload("entry evaluation references are inconsistent");
}
if (
  selection.action === "PAPER_ELIGIBLE" &&
  (
    selection.fidelity !== "EXACT" ||
    parityStatus !== "MATCH" ||
    !canonicalPaperEnabled
  )
) {
  throw new InvalidApiPayload("paper eligibility is not safely gated");
}
if (
  selection.effectiveActionReason === "PROMOTION_IDENTITY_MISMATCH" &&
  (
    selection.action !== "SHADOW_ONLY" ||
    selection.policyAction !== "PAPER_ELIGIBLE"
  )
) {
  throw new InvalidApiPayload("promotion identity reason is inconsistent");
}
```

- [ ] **Step 5: Implement the fail-closed loader**

```ts
export async function loadEntryEvaluations(
  signal?: AbortSignal,
): Promise<EntryEvaluationsSnapshot> {
  try {
    const response = await fetchBounded(
      "/api/v1/observation-entry-evaluations?limit=200",
      signal,
    );
    if (response.status === 503) {
      return {
        state: "BLOCKED",
        canonicalPaperEnabled: false,
        count: 0,
        items: [],
        page: null,
        canary: null,
        message: "Entry evaluation storage is blocked.",
      };
    }
    if (response.status !== 200) throw new Error("unexpected entry response");
    const body = await parseStrictResponse(response);
    if (
      !isRecord(body) ||
      body.mode !== "OBSERVATION_ONLY" ||
      body.execution !== "DISABLED" ||
      typeof body.canonical_paper_enabled !== "boolean" ||
      !safeInteger(body.count, 0, 200) ||
      !Array.isArray(body.items) ||
      !isRecord(body.page) ||
      !isRecord(body.canary)
    ) {
      throw new InvalidApiPayload("entry evaluation report is malformed");
    }
    const items = body.items.map((value) =>
      parseEntryEvaluation(value, body.canonical_paper_enabled),
    );
    const page = parseEntryPage(body.page);
    const canary = parseEntryCanary(body.canary);
    if (items.length !== body.count) {
      throw new InvalidApiPayload("entry evaluation count is inconsistent");
    }
    return {
      state: items.length === 0 ? "EMPTY" : "RECEIVED",
      canonicalPaperEnabled: body.canonical_paper_enabled,
      count: items.length,
      items,
      page,
      canary,
      message:
        items.length === 0
          ? "No completed multi-entry evaluations are available."
          : "Backend-authoritative entry evaluations are available for review.",
    };
  } catch {
    return {
      state: "ERROR",
      canonicalPaperEnabled: null,
      count: 0,
      items: [],
      page: null,
      canary: null,
      message: "Entry evaluations are unavailable or malformed.",
    };
  }
}
```

- [ ] **Step 6: Run client GREEN and all API tests**

Run:

```bash
cd apps/operations-console
npx vitest run tests/entry-evaluations-api.test.ts \
  tests/observation-receipts-api.test.ts \
  tests/api.test.ts
npm run typecheck
```

Expected: all client tests pass and legacy receipt parsing is unchanged.

- [ ] **Step 7: Commit the strict console client**

```bash
git add apps/operations-console/src/lib/api.ts \
  apps/operations-console/tests/entry-evaluations-api.test.ts
git commit -m "feat: load RD entry evaluations fail closed"
```

---

### Task 9: Render candidate evidence, backend selection, and parity in the console

**Files:**
- Create: `apps/operations-console/src/components/EntryEvaluations.tsx`
- Create: `apps/operations-console/tests/entry-evaluations.test.tsx`
- Modify: `apps/operations-console/src/components/FoundationDashboard.tsx:3`
- Modify: `apps/operations-console/src/app/styles.css:241`
- Modify: `apps/operations-console/tests/dashboard.test.tsx:1`

**Interfaces:**
- Consumes: `EntryEvaluationsSnapshot` from Task 8.
- Produces: `EntryEvaluationsPanel`.
- Preserves: the 30-second abortable poll and receipt/paper panels.

- [ ] **Step 1: Write failing accessible rendering tests**

Create `entry-evaluations.test.tsx`:

```tsx
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  EntryEvaluationsPanel,
  LOADING_ENTRY_EVALUATIONS,
} from "../src/components/EntryEvaluations";
import { evaluationSnapshot } from "./entry-evaluation-view-fixture";

afterEach(cleanup);

describe("EntryEvaluationsPanel", () => {
  it("renders loading as fail-closed", () => {
    render(<EntryEvaluationsPanel snapshot={LOADING_ENTRY_EVALUATIONS} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Canonical paper disabled")).toBeInTheDocument();
  });

  it("renders all candidates and distinguishes producer from authority", () => {
    render(<EntryEvaluationsPanel snapshot={evaluationSnapshot()} />);
    const setup = screen.getByRole("article", { name: "EURUSD setup setup-1" });
    expect(within(setup).getByText("HTF_FLIP")).toBeInTheDocument();
    expect(within(setup).getByText("DIR_CLOSE")).toBeInTheDocument();
    expect(within(setup).getByText("Backend selection")).toBeInTheDocument();
    expect(within(setup).getByText("Producer diagnostic")).toBeInTheDocument();
    expect(within(setup).getByText("SHADOW_ONLY")).toBeInTheDocument();
  });

  it("announces parity mismatch and never renders an action control", () => {
    render(<EntryEvaluationsPanel snapshot={evaluationSnapshot("MISMATCH")} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "SELECTED_CANDIDATE",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders delivery failures and realtime diagnostics separately", () => {
    const snapshot = evaluationSnapshot();
    const blocked = {
      ...snapshot,
      canary: { ...snapshot.canary!, sequenceGapCount: 1 },
    };
    render(<EntryEvaluationsPanel snapshot={blocked} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Delivery evidence is incomplete",
    );
    const realtime = screen.getByRole("region", {
      name: "Realtime observations — diagnostic only",
    });
    expect(within(realtime).getByText(
      "Realtime observation — not archived proof",
    )).toBeInTheDocument();
    expect(within(realtime).queryByText("Authoritative proof")).not
      .toBeInTheDocument();
  });
});
```

Create `entry-evaluation-view-fixture.ts` with the parsed camel-case equivalent
of the complete API fixture from Task 8.

- [ ] **Step 2: Run component tests and verify RED**

Run:

```bash
cd apps/operations-console
npx vitest run tests/entry-evaluations.test.tsx
```

Expected: FAIL because `EntryEvaluations.tsx` does not exist.

- [ ] **Step 3: Implement loading and state notices**

Create `EntryEvaluations.tsx`:

```tsx
import type {
  EntryEvaluation,
  EntryEvaluationsSnapshot,
} from "../lib/api";

export const LOADING_ENTRY_EVALUATIONS: EntryEvaluationsSnapshot = {
  state: "LOADING",
  canonicalPaperEnabled: false,
  count: 0,
  items: [],
  page: null,
  canary: null,
  message: "Checking backend-authoritative entry evaluations.",
};

function EvaluationNotice({ snapshot }: {
  snapshot: EntryEvaluationsSnapshot;
}) {
  const label = {
    LOADING: "Verifying entry evidence",
    ERROR: "Entry evidence unavailable",
    EMPTY: "No completed evaluations",
    BLOCKED: "Entry evaluation blocked",
    RECEIVED: "Entry evaluations recorded",
  }[snapshot.state];
  return (
    <div
      className={`entry-notice entry-notice-${snapshot.state.toLowerCase()}`}
      role={snapshot.state === "ERROR" ? "alert" : "status"}
      aria-live={snapshot.state === "ERROR" ? "assertive" : "polite"}
      aria-busy={snapshot.state === "LOADING"}
    >
      <strong>{label}</strong>
      <p>{snapshot.message}</p>
      <span>
        {snapshot.canonicalPaperEnabled
          ? "Canonical paper enabled"
          : "Canonical paper disabled"}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Implement evaluation and candidate cards**

Render one `<article aria-label={`${symbol} setup ${setupId}`}>` per evaluation.
Inside it, render:

```tsx
<header className="entry-evaluation-header">
  <div>
    <p>{evaluation.symbol}</p>
    <h3>{evaluation.setupId}</h3>
  </div>
  <span className={`parity parity-${evaluation.parityStatus.toLowerCase()}`}>
    {evaluation.parityStatus}
  </span>
</header>

<div className="entry-selection-grid">
  <section aria-label="Backend selection">
    <h4>Backend selection</h4>
    <strong>{evaluation.selection.action}</strong>
    <p>{evaluation.selection.reason}</p>
    <p>Policy action: {evaluation.selection.policyAction}</p>
  </section>
  <section aria-label="Producer diagnostic">
    <h4>Producer diagnostic</h4>
    <p>
      {evaluation.producerDiagnosticSelection === null ||
      evaluation.producerDiagnosticSelection.semanticKey === null
        ? "No producer candidate"
        : `${evaluation.producerDiagnosticSelection.model} @ ${evaluation.producerDiagnosticSelection.eventAnchorEpoch}`}
    </p>
    <p>{evaluation.producerDiagnosticSelection?.reason ?? "No producer reason"}</p>
  </section>
</div>
```

For every candidate, render model/state/direction, trigger epoch, normalized
origin, associated evidence fidelity/proof plane/resolution/HTF contexts,
handling mode/attempt/fidelity, ambiguity codes, and official source links:

```tsx
<a
  href={`https://www.youtube.com/watch?v=${claim.youtubeVideoId}&t=${claim.timestampStartSeconds}s`}
  rel="noreferrer"
  target="_blank"
>
  {claim.titleSnapshot} · {claim.timestampStartSeconds}s
</a>
```

Render `evaluation.producerDiagnostic.realtimeEvidence` in its own
`<section role="region" aria-label="Realtime observations — diagnostic only">`
after the producer diagnostic. Never merge those rows into the authoritative
candidate evidence list, candidate cards, selection proof, or source-proof
count. Label each `REALTIME_TICK` row as
`Realtime observation — not archived proof`. Label
resolution-limited replay as `${proofResolutionSeconds}s child-candle proof`;
never use the phrase `tick exact` for it.

If parity is `MISMATCH`, render:

```tsx
<p className="parity-warning" role="alert">
  Backend/producer mismatch: {evaluation.parityMismatchReason}. Effective
  selection remains shadow-only.
</p>
```

The component contains no button, form, mutation callback, or credential input.

Above the evaluation list, render a fail-closed delivery banner with
`role="alert"` and text `Delivery evidence is incomplete` when the canary is
final and any of these is true:

- `incompleteBatches > 0`;
- `sequenceGapCount > 0`;
- `sequenceConflictCount > 0`;
- `heartbeatScheduleMismatchCount > 0`;
- `heartbeatReferenceBarCount === 0`;
- `heartbeatScheduleMatchCount + heartbeatScheduleMismatchCount !==
  heartbeatReferenceBarCount`.

List the nonzero causes and keep canonical paper labeled disabled. During
`OPEN_GRACE`, render a polite `Delivery capture still in grace` status instead
of claiming completeness. This banner is independent of per-setup parity, so
an empty evaluation page cannot hide transport failure.

- [ ] **Step 5: Add the panel to the existing poll**

In `FoundationDashboard.tsx`, add state initialized to
`LOADING_ENTRY_EVALUATIONS`. Change the poll to:

```ts
const [nextHealth, nextReceipts, nextEvaluations] = await Promise.all([
  loadApiHealth(controller.signal),
  loadObservationReceipts(controller.signal),
  loadEntryEvaluations(controller.signal),
]);
```

After the active/aborted guard, call `setEvaluations(nextEvaluations)`. Render
`<EntryEvaluationsPanel snapshot={evaluations} />` between receipts and paper
simulation. Preserve the existing timer and cleanup exactly.

- [ ] **Step 6: Add responsive audit styles**

Add concrete classes for:

- `.entry-evaluation-section`, `.entry-evaluation-list`,
  `.entry-evaluation-card`;
- `.entry-evaluation-header`, `.entry-selection-grid`;
- `.entry-candidate-list`, `.entry-candidate-card`;
- `.candidate-state-*`, `.fidelity-*`, `.parity-*`;
- `.parity-warning`, `.entry-proof-grid`, `.entry-source-list`.

Use the existing CSS variables, 1px ledger borders, and uppercase metadata
style. At `max-width: 760px`, set both grids to `grid-template-columns: 1fr`.
Do not introduce a CSS framework or dependency.

- [ ] **Step 7: Update dashboard polling tests**

Mock `loadEntryEvaluations` in `dashboard.test.tsx`. Assert first poll, manual
timer refresh, abort cleanup, and retained fail-closed error rendering call it
the same number of times as health and receipts.

- [ ] **Step 8: Run component and dashboard GREEN**

Run:

```bash
cd apps/operations-console
npx vitest run tests/entry-evaluations.test.tsx \
  tests/dashboard.test.tsx \
  tests/observation-receipts.test.tsx
npm run lint
npm run typecheck
npm run build
```

Expected: all tests pass, lint/typecheck are clean, and Next static export
builds.

- [ ] **Step 9: Commit the audit panel**

```bash
git add apps/operations-console/src/components/EntryEvaluations.tsx \
  apps/operations-console/src/components/FoundationDashboard.tsx \
  apps/operations-console/src/app/styles.css \
  apps/operations-console/tests/entry-evaluations.test.tsx \
  apps/operations-console/tests/entry-evaluation-view-fixture.ts \
  apps/operations-console/tests/dashboard.test.tsx
git commit -m "feat: show RD entry arbitration audit trail"
```

---

### Task 10: Expand safety scanning, document routes, and run the full proof

**Files:**
- Modify: `scripts/static_boundary_check.py:10`
- Modify: `apps/observation-edge/README.md`
- Modify: `docs/development.md`
- Modify: `Makefile:35`
- Test: `tests/static/test_boundaries.py`

**Interfaces:**
- Consumes: every edge and console task.
- Produces: one repository-wide verification gate proving dual-version
  compatibility, generated-vector parity, migration safety, and no execution
  surface.

- [ ] **Step 1: Write the failing edge-boundary coverage test**

Add to `tests/static/test_boundaries.py`:

```python
from scripts.static_boundary_check import RUNTIME_ROOTS


def test_boundary_scan_includes_cloudflare_edge() -> None:
    assert Path("apps/observation-edge/src") in RUNTIME_ROOTS
```

- [ ] **Step 2: Run the boundary test and verify RED**

Run:

```bash
uv run pytest tests/static/test_boundaries.py::test_boundary_scan_includes_cloudflare_edge -v
```

Expected: FAIL because the edge source root is absent.

- [ ] **Step 3: Include Worker runtime in the forbidden-command scan**

Change:

```python
RUNTIME_ROOTS = (
    Path("src/prop_trading"),
    Path("apps/operations-console/src"),
    Path("apps/observation-edge/src"),
)
```

Do not weaken any existing forbidden identifier or configuration check.

- [ ] **Step 4: Document exact flags, routes, and safety semantics**

In `apps/observation-edge/README.md` and `docs/development.md`, document:

```text
RD_ENTRY_CANONICAL_PAPER_ENABLED=false
RD_ENTRY_PROMOTION_REPORT_SHA256=<absent by default>
RD_ENTRY_PROMOTION_SOURCE_COMMIT=<absent by default>
RD_ENTRY_PROMOTION_PINE_SHA256=<absent by default>
CF_VERSION_METADATA=<Workers version metadata binding; tag is checked>
POST /api/v1/tradingview/observations
GET /api/v1/observation-entry-evaluations?limit=200
```

State that authenticated schema `2.0` is accepted for shadow observation under
the existing ingress gate. Explain that the flag alone cannot enable effective
paper eligibility: all three promotion evidence bindings must exactly equal
the checked-in generated promotion binding, the current batch detector/settings
hashes must equal its approved identity, and the Workers version metadata tag
must equal its build-metadata digest. In shadow, the generated binding is
exactly `null`.
Producer selection is diagnostic only; mismatch or `NOT_PROVIDED` forces
`SHADOW_ONLY`; no v2 evaluation emits `paper_commands`. Document the closed
lowercase batch kinds, 12-chunk cap, 35,000-character exclusive bound,
900-second closed-window completion grace, and terminal-attempt semantics.

- [ ] **Step 5: Add focused parity to `edge-checks`**

Before the full edge test command in `Makefile`, add:

```make
	cd $(EDGE) && npx vitest run test/rd-entry-parity.test.ts
```

Keep the existing lint, typecheck, full test, and Wrangler build commands.

- [ ] **Step 6: Run targeted edge and console proofs**

Run:

```bash
cd apps/observation-edge
npm run lint
npm run typecheck
npm test
npm run build
cd ../operations-console
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: every command passes.

- [ ] **Step 7: Run repository safety and generated-vector proofs**

Run from the repository root:

```bash
uv run python scripts/build_rd_entry_oracle_vectors.py \
  --fixtures tests/fixtures/rd_entry_arbitration_cases_v2.json \
  --output contracts/vectors/rd-entry-arbitration-v2.json \
  --check
uv run python scripts/build_rd_entry_edge_catalog.py \
  --input config/phase0/rd-strategy-rule-contract-v2.json \
  --output apps/observation-edge/src/rd-entry-source-catalog.ts \
  --check
test "$(grep -c 'RD_ENTRY_PROMOTION_BINDING.*= null' \
  apps/observation-edge/src/generated/rd-entry-promotion-binding.ts)" -eq 1
uv run pytest tests/static/test_boundaries.py -v
uv run python scripts/static_boundary_check.py --root .
make edge-checks
```

Expected: vector check exits zero, boundary tests pass, static scan reports no
broker command surface, and `edge-checks` passes.

- [ ] **Step 8: Run the complete observation proof**

Run:

```bash
make verify-observation
```

Expected final line:

```text
OBSERVATION VERIFICATION PASSED — ingress records metadata and no execution surface exists
```

- [ ] **Step 9: Commit verification and documentation**

```bash
git add scripts/static_boundary_check.py \
  tests/static/test_boundaries.py \
  apps/observation-edge/README.md \
  docs/development.md Makefile
git commit -m "test: verify RD entry edge and console safety"
```

---

## Completion evidence

Before handing this plan to the Pine parity plan, record:

```bash
git log --oneline -10
git status --short
```

Expected: ten task commits are visible and `git status --short` is empty.
The deployment flag remains:

```text
RD_ENTRY_CANONICAL_PAPER_ENABLED=false
```

Authenticated schema `2.0` data may now run in shadow observation. Enabling
canonical paper eligibility belongs only to the later shadow-rollout plan after
historical and forward parity gates pass and it binds the committed promotion
report SHA-256, 40-hex source commit, and Pine artifact SHA-256.
The later promotion commit must also bind the exact detector code hash,
settings hash, and Workers build-metadata digest; environment strings alone
can never authorize a different deployed source identity.
