import { afterEach, describe, expect, it, vi } from "vitest";

import type { RdEntryPromotionBinding } from "../src/generated/rd-entry-promotion-binding";
import {
  ACTIVE_ENTRY_MODELS,
  ALL_ENTRY_MODELS,
  canonicalStringifyRdEntry,
  HTF_CONTEXT_MINUTES,
  RdEntryCanonicalizationError,
  rdEntryCanonicalValue,
  SELECTION_ACTIONS,
} from "../src/rd-entry-domain";
import type {
  EntryCandidate,
  EntryMatchRequest,
  OrderedCandle,
  SetupEntryFacts,
} from "../src/rd-entry-domain";
import {
  canonicalPaperSelectionConfigured,
  handleRequest,
} from "../src/index";
import type { Env } from "../src/types";

const APPROVED_BINDING: RdEntryPromotionBinding = {
  report_sha256: "a".repeat(64),
  source_commit: "b".repeat(40),
  pine_artifact_sha256: "c".repeat(64),
  rule_contract_version: "rd-entry-rule-contract-v2",
  producer_strategy_version: "2.0.0-rd-entry",
  detector_code_hash: "d".repeat(64),
  settings_hash: "e".repeat(64),
  build_metadata_digest: "f".repeat(64),
};

const APPROVED_ENV = {
  DB: {} as D1Database,
  RD_ENTRY_CANONICAL_PAPER_ENABLED: "true",
  RD_ENTRY_PROMOTION_REPORT_SHA256: APPROVED_BINDING.report_sha256,
  RD_ENTRY_PROMOTION_SOURCE_COMMIT: APPROVED_BINDING.source_commit,
  RD_ENTRY_PROMOTION_PINE_SHA256: APPROVED_BINDING.pine_artifact_sha256,
  CF_VERSION_METADATA: {
    id: "version-id",
    tag: APPROVED_BINDING.build_metadata_digest,
    timestamp: "2026-07-26T00:00:00.000Z",
  },
} satisfies Env;

const APPROVED_IDENTITY = {
  rule_contract_version: APPROVED_BINDING.rule_contract_version,
  strategy_version: APPROVED_BINDING.producer_strategy_version,
  detector_code_hash: APPROVED_BINDING.detector_code_hash,
  settings_hash: APPROVED_BINDING.settings_hash,
};

function exactEnvironmentFor(binding: RdEntryPromotionBinding): Env {
  return {
    ...APPROVED_ENV,
    RD_ENTRY_PROMOTION_REPORT_SHA256: binding.report_sha256,
    RD_ENTRY_PROMOTION_SOURCE_COMMIT: binding.source_commit,
    RD_ENTRY_PROMOTION_PINE_SHA256: binding.pine_artifact_sha256,
    CF_VERSION_METADATA: {
      ...APPROVED_ENV.CF_VERSION_METADATA,
      tag: binding.build_metadata_digest,
    },
  };
}

function exactIdentityFor(binding: RdEntryPromotionBinding) {
  return {
    rule_contract_version: binding.rule_contract_version,
    strategy_version: binding.producer_strategy_version,
    detector_code_hash: binding.detector_code_hash,
    settings_hash: binding.settings_hash,
  };
}

async function loadGate(binding: RdEntryPromotionBinding) {
  vi.resetModules();
  vi.doMock("../src/generated/rd-entry-promotion-binding", () => ({
    RD_ENTRY_PROMOTION_BINDING: binding,
  }));
  return import("../src/index");
}

afterEach(() => {
  vi.doUnmock("../src/generated/rd-entry-promotion-binding");
  vi.resetModules();
});

const ORDERED_CANDLE: OrderedCandle = {
  open_epoch: 100,
  close_epoch: 400,
  open_ticks: 10,
  high_ticks: 15,
  low_ticks: 8,
  close_ticks: 12,
};

const SETUP_FACTS: SetupEntryFacts = {
  setup_id: "setup-1",
  direction: "LONG",
  zone_top_ticks: 15,
  zone_bottom_ticks: 8,
  zone_engaged_epoch: 200,
  invalidated_before_entry: false,
  common_fidelity: "EXACT",
  terminal_reason: null,
  terminal_epoch: null,
};

const ENTRY_CANDIDATE: EntryCandidate = {
  candidate_id: "candidate-1",
  setup_id: "setup-1",
  model: "DIR_CLOSE",
  state: "MATCHED",
  event_anchor_epoch: 400,
  trigger_ordinal: 1,
  direction: "LONG",
  source_claim_ids: ["claim-2", "claim-1"],
  normalized_from: null,
  observed_at_epoch: 401,
};

const MATCH_REQUEST: EntryMatchRequest = {
  setup: SETUP_FACTS,
  confirmed_bar: ORDERED_CANDLE,
  htf_proofs: [],
  generic_break_detected: false,
  rejection_respect_detected: false,
  attempt_kind: "INITIAL",
  trigger_ordinal: 1,
};

function compileTimeCanonicalSourceCoverage(): void {
  rdEntryCanonicalValue(ORDERED_CANDLE);
  rdEntryCanonicalValue(SETUP_FACTS);
  rdEntryCanonicalValue(ENTRY_CANDIDATE);
  rdEntryCanonicalValue(MATCH_REQUEST);

  // @ts-expect-error Unsupported objects are not part of the RD entry domain.
  rdEntryCanonicalValue({ unsupported: undefined });
  // @ts-expect-error Runtime-only values cannot enter the typed canonical boundary.
  rdEntryCanonicalValue(new Date());
}

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
    expect(
      canonicalPaperSelectionConfigured(env, {
        rule_contract_version: "rd-entry-rule-contract-v2",
        strategy_version: "2.0.0-rd-entry",
        detector_code_hash: "d".repeat(64),
        settings_hash: "e".repeat(64),
      }),
    ).toBe(false);
  });
});

describe("RD entry canonical JSON boundary", () => {
  it("projects representative domain values without index-signature casts", () => {
    expect(canonicalStringifyRdEntry(ORDERED_CANDLE)).toBe(
      '{"close_epoch":400,"close_ticks":12,"high_ticks":15,"low_ticks":8,"open_epoch":100,"open_ticks":10}',
    );
    expect(canonicalStringifyRdEntry(SETUP_FACTS)).toBe(
      '{"common_fidelity":"EXACT","direction":"LONG","invalidated_before_entry":false,"setup_id":"setup-1","terminal_epoch":null,"terminal_reason":null,"zone_bottom_ticks":8,"zone_engaged_epoch":200,"zone_top_ticks":15}',
    );
    expect(canonicalStringifyRdEntry(ENTRY_CANDIDATE)).toBe(
      '{"candidate_id":"candidate-1","direction":"LONG","event_anchor_epoch":400,"model":"DIR_CLOSE","normalized_from":null,"observed_at_epoch":401,"setup_id":"setup-1","source_claim_ids":["claim-2","claim-1"],"state":"MATCHED","trigger_ordinal":1}',
    );
  });

  it("canonicalizes a nested match request deterministically", () => {
    const reorderedRequest: EntryMatchRequest = {
      trigger_ordinal: 1,
      attempt_kind: "INITIAL",
      rejection_respect_detected: false,
      generic_break_detected: false,
      htf_proofs: [],
      confirmed_bar: ORDERED_CANDLE,
      setup: SETUP_FACTS,
    };
    const expected =
      '{"attempt_kind":"INITIAL","confirmed_bar":{"close_epoch":400,"close_ticks":12,"high_ticks":15,"low_ticks":8,"open_epoch":100,"open_ticks":10},"generic_break_detected":false,"htf_proofs":[],"rejection_respect_detected":false,"setup":{"common_fidelity":"EXACT","direction":"LONG","invalidated_before_entry":false,"setup_id":"setup-1","terminal_epoch":null,"terminal_reason":null,"zone_bottom_ticks":8,"zone_engaged_epoch":200,"zone_top_ticks":15},"trigger_ordinal":1}';

    expect(canonicalStringifyRdEntry(MATCH_REQUEST)).toBe(expected);
    expect(canonicalStringifyRdEntry(reorderedRequest)).toBe(expected);
  });

  it.each([
    ["undefined", { ...SETUP_FACTS, terminal_epoch: undefined }],
    ["non-finite number", { ...ORDERED_CANDLE, high_ticks: Number.NaN }],
    ["bigint", { ...ORDERED_CANDLE, low_ticks: 8n }],
    ["non-plain object", new Date("2026-07-26T00:00:00.000Z")],
    ["function", { ...ENTRY_CANDIDATE, model: () => "DIR_CLOSE" }],
  ])("rejects unsupported nested %s values", (_, unsupported) => {
    expect(() =>
      rdEntryCanonicalValue(
        unsupported as unknown as Parameters<
          typeof rdEntryCanonicalValue
        >[0],
      ),
    ).toThrow(RdEntryCanonicalizationError);
  });
});

describe("canonical paper promotion binding", () => {
  it("requires the exact eight committed constants, environment values, version tag, and batch identity", async () => {
    const { canonicalPaperSelectionConfigured } =
      await loadGate(APPROVED_BINDING);

    expect(
      canonicalPaperSelectionConfigured(APPROVED_ENV, APPROVED_IDENTITY),
    ).toBe(true);
  });

  it.each([
    ["uppercase report hash", "report_sha256", "A".repeat(64)],
    ["wrong-length source commit", "source_commit", "b".repeat(39)],
    ["non-hex Pine hash", "pine_artifact_sha256", `${"c".repeat(63)}g`],
    ["wrong-length detector hash", "detector_code_hash", "d".repeat(63)],
    ["non-hex settings hash", "settings_hash", `${"e".repeat(63)}z`],
    [
      "uppercase build metadata digest",
      "build_metadata_digest",
      "F".repeat(64),
    ],
    ["empty rule contract version", "rule_contract_version", ""],
    ["empty producer strategy version", "producer_strategy_version", ""],
  ] satisfies readonly [
    string,
    keyof RdEntryPromotionBinding,
    string,
  ][])("rejects a committed binding with %s", async (_, field, value) => {
    const invalidBinding = {
      ...APPROVED_BINDING,
      [field]: value,
    };
    const { canonicalPaperSelectionConfigured: gateWithInvalidBinding } =
      await loadGate(invalidBinding);

    expect(
      gateWithInvalidBinding(
        exactEnvironmentFor(invalidBinding),
        exactIdentityFor(invalidBinding),
      ),
    ).toBe(false);
  });

  it.each([
    "RD_ENTRY_CANONICAL_PAPER_ENABLED",
    "RD_ENTRY_PROMOTION_REPORT_SHA256",
    "RD_ENTRY_PROMOTION_SOURCE_COMMIT",
    "RD_ENTRY_PROMOTION_PINE_SHA256",
    "CF_VERSION_METADATA",
    "CF_VERSION_METADATA.tag",
  ] as const)(
    "rejects an environment missing %s",
    async (field) => {
      const { canonicalPaperSelectionConfigured } =
        await loadGate(APPROVED_BINDING);
      const env: Record<string, unknown> = { ...APPROVED_ENV };
      if (field === "CF_VERSION_METADATA.tag") {
        const metadata: Record<string, unknown> = {
          ...APPROVED_ENV.CF_VERSION_METADATA,
        };
        delete metadata.tag;
        env.CF_VERSION_METADATA = metadata;
      } else {
        delete env[field];
      }

      expect(
        canonicalPaperSelectionConfigured(
          env as unknown as Env,
          APPROVED_IDENTITY,
        ),
      ).toBe(false);
    },
  );

  it.each([
    [
      "report hash",
      {
        RD_ENTRY_PROMOTION_REPORT_SHA256: "1".repeat(64),
      },
    ],
    [
      "source commit",
      {
        RD_ENTRY_PROMOTION_SOURCE_COMMIT: "2".repeat(40),
      },
    ],
    [
      "Pine artifact hash",
      {
        RD_ENTRY_PROMOTION_PINE_SHA256: "3".repeat(64),
      },
    ],
    [
      "deployment version tag",
      {
        CF_VERSION_METADATA: {
          ...APPROVED_ENV.CF_VERSION_METADATA,
          tag: "4".repeat(64),
        },
      },
    ],
  ])("rejects a well-formed but different %s", async (_, override) => {
    const { canonicalPaperSelectionConfigured } =
      await loadGate(APPROVED_BINDING);

    expect(
      canonicalPaperSelectionConfigured(
        { ...APPROVED_ENV, ...override } as Env,
        APPROVED_IDENTITY,
      ),
    ).toBe(false);
  });

  it.each([
    [
      "rule contract version",
      { rule_contract_version: "rd-entry-rule-contract-v1" },
    ],
    ["producer strategy version", { strategy_version: "1.2.0-contract1" }],
    ["detector code hash", { detector_code_hash: "1".repeat(64) }],
    ["settings hash", { settings_hash: "2".repeat(64) }],
  ])("rejects a batch with a different %s", async (_, override) => {
    const { canonicalPaperSelectionConfigured } =
      await loadGate(APPROVED_BINDING);

    expect(
      canonicalPaperSelectionConfigured(APPROVED_ENV, {
        ...APPROVED_IDENTITY,
        ...override,
      }),
    ).toBe(false);
  });

  it("does not re-authorize a stored batch identity after a deployment change", async () => {
    const { canonicalPaperSelectionConfigured } =
      await loadGate(APPROVED_BINDING);
    const previouslyAcceptedIdentity = {
      rule_contract_version: "rd-entry-rule-contract-v1",
      strategy_version: "1.2.0-contract1",
      detector_code_hash: "1".repeat(64),
      settings_hash: "2".repeat(64),
    };

    expect(
      canonicalPaperSelectionConfigured(
        APPROVED_ENV,
        previouslyAcceptedIdentity,
      ),
    ).toBe(false);
    expect(
      canonicalPaperSelectionConfigured(APPROVED_ENV, APPROVED_IDENTITY),
    ).toBe(true);
  });

  it("reports deployment identity separately without exposing promotion evidence", async () => {
    const { handleRequest: handleRequestWithApprovedBinding } =
      await loadGate(APPROVED_BINDING);
    const response = await handleRequestWithApprovedBinding(
      new Request("https://edge.example/health/live"),
      APPROVED_ENV,
    );

    expect(await response.json()).toEqual({
      status: "ALIVE",
      mode: "OBSERVATION_ONLY",
      paper_simulator: "DISABLED",
      canonical_paper: "ARMED_IDENTITY_REQUIRED",
      deployment_version: {
        id: "version-id",
        tag: APPROVED_BINDING.build_metadata_digest,
      },
      execution: "DISABLED",
    });
  });
});
