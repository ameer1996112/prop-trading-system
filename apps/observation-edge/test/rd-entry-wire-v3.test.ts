import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  candidateIdV3,
  evidenceIdV3,
  evidencePayloadSha256V3,
  selectionIdV3,
  type EntryCandidateEvidenceV3,
  type EntrySelectionV3,
} from "../src/rd-entry-domain-v3";
import {
  ENTRY_V3_MAX_PAYLOAD_CHARACTERS,
  EntryV3ValidationError,
  validateEntryV3BodySize,
  validateEntryV3Payload,
} from "../src/rd-entry-wire-v3";
import { parseStrictJson } from "../src/strict-json";
import { validateObservationEnvelope } from "../src/validation";

const vectorDocument = JSON.parse(
  readFileSync(
    new URL(
      "../../../contracts/vectors/rd-entry-arbitration-v3.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  cases: Array<{
    case_id: string;
    input: Record<string, unknown>;
    expected: Record<string, unknown>;
  }>;
};
const digest = "a".repeat(64);
const reviewedHashes = {
  detector_code_hash: digest,
  settings_hash: "b".repeat(64),
} as const;
const requiredRuleIds = [
  "LIQ_ACTUAL_EXTREME_SWEPT",
  "LIQ_DISTANCE_INFLUENCES_ZONE",
  "LIQ_EVENT_ORDER",
  "LIQ_INTERNAL_REBREAK",
  "LIQ_NORMAL_TWO_OPPOSITE_CANDLES",
  "LIQ_ONE_CANDLE_EXCEPTION",
  "LIQ_OWN_EXTREME_SAME_LEG",
  "LIQ_REPLACEMENT_AFTER_STALE_MOVE",
  "LIQ_STRICT_OWN_EXTREME_BREAK",
  "TIMEFRAME_FIVE_MINUTE_ONLY",
  "ZONE_ACCURACY_BOUNDS",
  "ZONE_FRESH_UNTAPPED",
  "ZONE_ORIGIN_OPPOSITE_CANDLE",
  "ZONE_PRE_ENTRY_CLOSE_OUTSIDE",
] as const;

function strict(value: unknown) {
  return parseStrictJson(new TextEncoder().encode(JSON.stringify(value)));
}

function payload(): Record<string, unknown> {
  const vector = structuredClone(
    vectorDocument.cases.find(
      (item) => item.case_id === "strict_long_boc_only",
    )!,
  );
  const input = vector.input;
  const reference = (input.boc_proof as {
    reference_candle: Record<string, unknown>;
  }).reference_candle;
  return {
    schema_version: "3.0",
    strategy_id: "rd_liquidity_sd_5m_v1",
    strategy_version: "3.0.0-contract3",
    rule_contract_version: "3.0.0",
    execution_mode: "PAPER_ONLY",
    producer_instance_id: "pine-v3",
    producer_sequence: 1,
    event_id: "pine-v3:1",
    is_realtime: true,
    symbol: "EURUSD",
    ticker_id: "OANDA:EURUSD",
    feed: "OANDA",
    timeframe: "5",
    tick_size: "0.00001",
    detector_code_hash: digest,
    settings_hash: "b".repeat(64),
    observed_at_epoch: 2400,
    market_event: {
      epoch: 1801,
      sequence: 7,
      tick_price_ticks: 111,
      barstate_isconfirmed: false,
      confirmed_bar: null,
    },
    exit_events: [],
    setups: [
      {
        setup: {
          setup_id: input.setup_id,
          direction: input.direction,
          zone_top_ticks: input.zone_top_ticks,
          zone_bottom_ticks: input.zone_bottom_ticks,
          zone_engaged_epoch: input.zone_engaged_epoch,
          invalidated_before_entry: input.setup_invalidated,
          common_fidelity: input.common_fidelity,
          common_rule_results: requiredRuleIds.map((rule_id) => ({
            rule_id,
            passed: true,
          })),
        },
        candidates: vector.expected.candidates,
        evidence: vector.expected.evidence,
        selection_proposal: vector.expected.selection,
        trade_plan: {
          direction: "LONG",
          entry_ticks: 111,
          stop_ticks: 96,
          target_ticks: 141,
        },
      },
    ],
  };
}

function payloadFor(caseId: string): Record<string, unknown> {
  const vector = structuredClone(
    vectorDocument.cases.find((item) => item.case_id === caseId)!,
  );
  const input = vector.input;
  const expected = vector.expected as {
    candidates: Array<Record<string, unknown>>;
    evidence: Array<Record<string, unknown>>;
    selection: Record<string, unknown>;
  };
  const selection = expected.selection;
  const canonicalEvidence = expected.evidence.find(
    (item) => item.evidence_id === selection.canonical_evidence_id,
  ) ?? expected.evidence[0]!;
  const direction = input.direction as "LONG" | "SHORT";
  const entryTicks = canonicalEvidence.observed_trigger_ticks as number;
  const confirmedBar =
    selection.canonical_model === "DIR_CLOSE"
      ? ((input.opened_selection_seed as
          | { confirmed_bar: Record<string, unknown> }
          | null)?.confirmed_bar ??
        input.confirmed_bar)
      : null;
  const observedAtEpoch = Math.max(
    input.observed_at_epoch as number,
    selection.evaluated_at_epoch as number,
  );
  return {
    schema_version: "3.0",
    strategy_id: "rd_liquidity_sd_5m_v1",
    strategy_version: "3.0.0-contract3",
    rule_contract_version: "3.0.0",
    execution_mode: "PAPER_ONLY",
    producer_instance_id: "pine-v3",
    producer_sequence: canonicalEvidence.trigger_sequence,
    event_id: `pine-v3:${caseId}`,
    is_realtime: canonicalEvidence.proof_plane === "REALTIME_TICK",
    symbol: "EURUSD",
    ticker_id: "OANDA:EURUSD",
    feed: "OANDA",
    timeframe: "5",
    tick_size: "0.00001",
    detector_code_hash: reviewedHashes.detector_code_hash,
    settings_hash: reviewedHashes.settings_hash,
    observed_at_epoch: observedAtEpoch,
    market_event: {
      epoch: canonicalEvidence.observed_trigger_epoch,
      sequence: canonicalEvidence.trigger_sequence,
      tick_price_ticks: entryTicks,
      barstate_isconfirmed: confirmedBar !== null,
      confirmed_bar: confirmedBar,
    },
    exit_events: [],
    setups: [
      {
        setup: {
          setup_id: input.setup_id,
          direction,
          zone_top_ticks: input.zone_top_ticks,
          zone_bottom_ticks: input.zone_bottom_ticks,
          zone_engaged_epoch: input.zone_engaged_epoch,
          invalidated_before_entry: input.setup_invalidated,
          common_fidelity: input.common_fidelity,
          common_rule_results: requiredRuleIds.map((rule_id) => ({
            rule_id,
            passed: true,
          })),
        },
        candidates: expected.candidates,
        evidence: expected.evidence,
        selection_proposal: selection,
        trade_plan: {
          direction,
          entry_ticks: entryTicks,
          stop_ticks: direction === "LONG" ? entryTicks - 10 : entryTicks + 10,
          target_ticks: direction === "LONG" ? entryTicks + 20 : entryTicks - 20,
        },
      },
    ],
  };
}

function useEdgeDerivedReferences(value: Record<string, unknown>): void {
  const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
  const candidates = bundle.candidates as Array<Record<string, unknown>>;
  const evidence = bundle.evidence as Array<Record<string, unknown>>;
  const selection = bundle.selection_proposal as Record<string, unknown>;
  const modelByCandidateId = new Map(
    candidates.map((item) => [
      item.candidate_id as string,
      item.model as string,
    ]),
  );
  const modelByEvidenceId = new Map(
    evidence.map((item) => [
      item.evidence_id as string,
      modelByCandidateId.get(item.candidate_id as string)!,
    ]),
  );
  const canonicalCandidateModel =
    selection.canonical_candidate_id === null
      ? null
      : modelByCandidateId.get(selection.canonical_candidate_id as string)!;
  const canonicalEvidenceModel =
    selection.canonical_evidence_id === null
      ? null
      : modelByEvidenceId.get(selection.canonical_evidence_id as string)!;
  for (const candidate of candidates) {
    candidate.candidate_id = `EDGE_DERIVED:${candidate.model as string}`;
  }
  for (const item of evidence) {
    const model = modelByCandidateId.get(item.candidate_id as string);
    item.candidate_id = `EDGE_DERIVED:${model!}`;
    item.evidence_id = `EDGE_DERIVED:${model!}`;
    item.payload_sha256 = "EDGE_DERIVED";
  }
  selection.selection_id = "EDGE_DERIVED";
  selection.candidate_ids_considered = candidates
    .map((item) => item.candidate_id as string)
    .sort();
  selection.canonical_candidate_id =
    canonicalCandidateModel === null
      ? null
      : `EDGE_DERIVED:${canonicalCandidateModel}`;
  selection.canonical_evidence_id =
    canonicalEvidenceModel === null
      ? null
      : `EDGE_DERIVED:${canonicalEvidenceModel}`;
}

async function rehashEvidenceAndSelection(
  value: Record<string, unknown>,
  evidenceIndex: number,
): Promise<void> {
  const setup = (value.setups as Array<Record<string, unknown>>)[0]!;
  const evidence = (setup.evidence as Array<Record<string, unknown>>)[
    evidenceIndex
  ]!;
  const previousEvidenceId = evidence.evidence_id;
  const {
    evidence_id: _,
    payload_sha256: __,
    observed_at_epoch: ___,
    ...payloadFields
  } = evidence;
  evidence.payload_sha256 = await evidencePayloadSha256V3(
    payloadFields as unknown as Omit<
      EntryCandidateEvidenceV3,
      "evidence_id" | "payload_sha256" | "observed_at_epoch"
    >,
  );
  evidence.evidence_id = await evidenceIdV3(
    evidence as unknown as EntryCandidateEvidenceV3,
  );
  const selection = setup.selection_proposal as Record<string, unknown>;
  if (selection.canonical_evidence_id === previousEvidenceId) {
    selection.canonical_evidence_id = evidence.evidence_id;
  }
  selection.selection_id = await selectionIdV3(
    selection as unknown as EntrySelectionV3,
  );
}

async function rehashCandidateGraph(
  value: Record<string, unknown>,
  candidateIndex: number,
): Promise<void> {
  const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
  const candidates = bundle.candidates as Array<Record<string, unknown>>;
  const candidate = candidates[candidateIndex]!;
  const previousCandidateId = candidate.candidate_id;
  candidate.candidate_id = await candidateIdV3(
    candidate as unknown as Parameters<typeof candidateIdV3>[0],
  );
  const selection = bundle.selection_proposal as Record<string, unknown>;
  const considered = selection.candidate_ids_considered as string[];
  selection.candidate_ids_considered = considered
    .map((id) =>
      id === previousCandidateId ? (candidate.candidate_id as string) : id,
    )
    .sort();
  if (selection.canonical_candidate_id === previousCandidateId) {
    selection.canonical_candidate_id = candidate.candidate_id;
  }
  const evidence = bundle.evidence as Array<Record<string, unknown>>;
  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index]!;
    if (item.candidate_id !== previousCandidateId) continue;
    item.candidate_id = candidate.candidate_id;
    await rehashEvidenceAndSelection(value, index);
  }
  selection.selection_id = await selectionIdV3(
    selection as unknown as EntrySelectionV3,
  );
}

describe("RD entry v3 wire", () => {
  it("accepts an exact strict BOC bundle", async () => {
    const result = await validateEntryV3Payload(
      strict(payload()),
      reviewedHashes,
    );
    expect(result.entryBundles).toHaveLength(1);
    expect(result.entryBundles[0]!.evaluation.selection.action).toBe(
      "PAPER_ELIGIBLE",
    );
  });

  it("routes schema 3.0 through the entry-v3 observation union", async () => {
    const result = await validateObservationEnvelope(
      strict({ credential: "secret", payload: payload() }),
      undefined,
      reviewedHashes,
    );
    expect(result.version).toBe("entry-v3");
    if (result.version === "entry-v3") {
      expect(result.paperCommands).toEqual([]);
      expect(result.entryBundles[0]!.evaluation.selection.canonical_model).toBe(
        "BOC",
      );
    }
  });

  it.each([
    ["unknown top-level key", (value: Record<string, unknown>) => {
      value.broker = "forbidden";
    }],
    ["version mismatch", (value: Record<string, unknown>) => {
      value.strategy_version = "2.0.0-contract2";
    }],
    ["historical realtime evidence", (value: Record<string, unknown>) => {
      value.is_realtime = false;
    }],
    ["invalid stop direction", (value: Record<string, unknown>) => {
      const setup = (value.setups as Array<Record<string, unknown>>)[0]!;
      (setup.trade_plan as Record<string, unknown>).stop_ticks = 112;
    }],
    ["BOC without reference OHLC", (value: Record<string, unknown>) => {
      const setup = (value.setups as Array<Record<string, unknown>>)[0]!;
      const evidence = (setup.evidence as Array<Record<string, unknown>>)[0]!;
      evidence.reference_candle_high_ticks = null;
    }],
    ["duplicate candidate IDs", (value: Record<string, unknown>) => {
      const setup = (value.setups as Array<Record<string, unknown>>)[0]!;
      const candidates = setup.candidates as Array<Record<string, unknown>>;
      candidates.push(structuredClone(candidates[0]!));
    }],
  ])("rejects %s", async (_name, mutate) => {
    const value = payload();
    mutate(value);
    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it.each([
    ["detector", { detector_code_hash: "c".repeat(64) }],
    ["settings", { settings_hash: "c".repeat(64) }],
  ])("rejects a reviewed %s hash mismatch", async (_name, overrides) => {
    await expect(
      validateEntryV3Payload(strict(payload()), {
        ...reviewedHashes,
        ...overrides,
      }),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects a rehashed BOC that does not break the reference candle", async () => {
    const value = payload();
    const setup = (value.setups as Array<Record<string, unknown>>)[0]!;
    const evidence = (setup.evidence as Array<Record<string, unknown>>)[0]!;
    evidence.observed_trigger_ticks = evidence.reference_candle_high_ticks;
    (value.market_event as Record<string, unknown>).tick_price_ticks =
      evidence.reference_candle_high_ticks;
    (setup.trade_plan as Record<string, unknown>).entry_ticks =
      evidence.reference_candle_high_ticks;
    (setup.trade_plan as Record<string, unknown>).stop_ticks =
      (evidence.reference_candle_high_ticks as number) - 10;
    (setup.trade_plan as Record<string, unknown>).target_ticks =
      (evidence.reference_candle_high_ticks as number) + 20;
    await rehashEvidenceAndSelection(value, 0);

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects an exact directional close that does not clear the zone", async () => {
    const value = payloadFor("opened_selection_is_frozen");
    const setup = (
      (value.setups as Array<Record<string, unknown>>)[0]!.setup as Record<
        string,
        unknown
      >
    );
    const market = value.market_event as {
      confirmed_bar: { close_ticks: number };
    };
    setup.zone_top_ticks = market.confirmed_bar.close_ticks + 1;

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects an exact HTF flip whose contact is outside the setup zone", async () => {
    const value = payloadFor("flip_before_boc");
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const setup = bundle.setup as Record<string, unknown>;
    const flipEvidence = (
      bundle.evidence as Array<Record<string, unknown>>
    ).find((item) => item.htf_open_ticks !== null)!;
    const contact = flipEvidence.contact_candle as { high_ticks: number };
    setup.zone_bottom_ticks = contact.high_ticks + 1;
    setup.zone_top_ticks = contact.high_ticks + 10;

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects a rehashed BOC candidate whose event anchor differs from its reference", async () => {
    const value = payload();
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const candidate = (bundle.candidates as Array<Record<string, unknown>>)[0]!;
    candidate.event_anchor_epoch =
      (candidate.reference_candle_open_epoch as number) + 300;
    await rehashCandidateGraph(value, 0);

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects a fully rehashed BOC reference that is not five-minute aligned", async () => {
    const value = payload();
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const candidate = (bundle.candidates as Array<Record<string, unknown>>)[0]!;
    const evidence = (bundle.evidence as Array<Record<string, unknown>>)[0]!;
    candidate.event_anchor_epoch = 901;
    candidate.reference_candle_open_epoch = 901;
    evidence.reference_candle_open_epoch = 901;
    await rehashCandidateGraph(value, 0);

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects a rehashed directional-close anchor that differs from the confirmed bar", async () => {
    const value = payloadFor("opened_selection_is_frozen");
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const candidate = (bundle.candidates as Array<Record<string, unknown>>)[0]!;
    candidate.event_anchor_epoch =
      ((value.market_event as {
        confirmed_bar: { open_epoch: number };
      }).confirmed_bar.open_epoch as number) + 1;
    await rehashCandidateGraph(value, 0);

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it.each([
    ["boc tier", "boc_tier", "UNKNOWN_TIER"],
    ["ambiguity code", "ambiguity_codes", ["UNKNOWN_AMBIGUITY"]],
  ])("rejects an unknown %s", async (_name, field, replacement) => {
    const value = payload();
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const evidence = (bundle.evidence as Array<Record<string, unknown>>)[0]!;
    evidence[field] = replacement;
    if (field === "boc_tier") {
      (bundle.candidates as Array<Record<string, unknown>>)[0]!.boc_tier =
        replacement;
    }
    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("enforces the raw 35,000-character boundary", () => {
    expect(() =>
      validateEntryV3BodySize(
        new TextEncoder().encode(
          " ".repeat(ENTRY_V3_MAX_PAYLOAD_CHARACTERS - 1),
        ),
      ),
    ).not.toThrow();
    expect(() =>
      validateEntryV3BodySize(
        new TextEncoder().encode(" ".repeat(ENTRY_V3_MAX_PAYLOAD_CHARACTERS)),
      ),
    ).toThrow(EntryV3ValidationError);
  });

  it("rejects a whitespace-inflated raw schema-3 body", async () => {
    const compact = JSON.stringify({
      credential: "secret",
      payload: payload(),
    });
    const inflated = `${compact.slice(0, -1)}${" ".repeat(35_000)}}`;
    await expect(
      validateObservationEnvelope(
        parseStrictJson(new TextEncoder().encode(inflated)),
        new TextEncoder().encode(inflated),
        reviewedHashes,
      ),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("canonicalizes a Pine-shaped strict BOC bundle to the Python oracle", async () => {
    const value = payloadFor("strict_long_boc_only");
    useEdgeDerivedReferences(value);
    const result = await validateEntryV3Payload(
      strict(value),
      reviewedHashes,
    );
    const expected = vectorDocument.cases.find(
      (item) => item.case_id === "strict_long_boc_only",
    )!.expected;

    expect(result.entryBundles[0]!.evaluation).toEqual(expected);
    expect(JSON.stringify(result.canonicalPayload)).not.toContain(
      "EDGE_DERIVED",
    );
  });

  it("ignores a forged Pine selection and derives shadow semantics", async () => {
    const value = payloadFor("discretionary_boc_shadow");
    useEdgeDerivedReferences(value);
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    bundle.selection_proposal = {
      ...(bundle.selection_proposal as Record<string, unknown>),
      selection_id: "EDGE_DERIVED",
      canonical_candidate_id: "EDGE_DERIVED:BOC",
      canonical_evidence_id: "EDGE_DERIVED:BOC",
      canonical_model: "BOC",
      reason: "ONLY_EXACT_TRIGGER",
      fidelity: "EXACT",
      action: "PAPER_ELIGIBLE",
      co_triggered_models: [],
    };

    const result = await validateEntryV3Payload(
      strict(value),
      reviewedHashes,
    );
    expect(result.entryBundles[0]!.evaluation.selection).toMatchObject({
      canonical_candidate_id: null,
      canonical_evidence_id: null,
      canonical_model: null,
      reason: "NO_EXACT_CANDIDATE",
      fidelity: null,
      action: "SHADOW_ONLY",
    });
  });

  it("rejects an EDGE_DERIVED candidate-model collision", async () => {
    const value = payload();
    useEdgeDerivedReferences(value);
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const candidates = bundle.candidates as Array<Record<string, unknown>>;
    candidates.push(structuredClone(candidates[0]!));

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it.each([
    ["wrong model reference", "EDGE_DERIVED:HTF_FLIP"],
    ["malformed reference", "EDGE_DERIVED:BOC:EXTRA"],
  ])("rejects a Pine candidate with %s", async (_name, reference) => {
    const value = payload();
    useEdgeDerivedReferences(value);
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    (bundle.candidates as Array<Record<string, unknown>>)[0]!.candidate_id =
      reference;

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects mixed canonical and EDGE_DERIVED identity claims", async () => {
    const value = payload();
    const originalCandidateId = (
      (
        (value.setups as Array<Record<string, unknown>>)[0]!
          .candidates as Array<Record<string, unknown>>
      )[0]!.candidate_id
    );
    useEdgeDerivedReferences(value);
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    (bundle.candidates as Array<Record<string, unknown>>)[0]!.candidate_id =
      originalCandidateId;

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });
});
