import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  arbitrateEntryCandidates,
  evaluateEntryStream,
  type EntryArbitrationRequest,
  type EntryStreamEvent,
} from "../src/rd-entry-arbitrator";
import type {
  EntryCandidateEvidence,
  EntryEvaluation,
  EntryMatchRequest,
  HTFFlipProof,
  HTFFlipProofTranscript,
} from "../src/rd-entry-domain";
import {
  evaluateEntryMatch,
  validateHtfFlipProof,
  type EdgeEntryMatchRequest,
} from "../src/rd-entry-matcher";
import {
  canonicalSha256,
  SOURCE_CLAIMS,
} from "../src/rd-entry-policy";
import { SOURCE_CLAIM_CATALOG } from "../src/rd-entry-source-catalog";
import {
  parseRdEntryOracleVectorDocument,
  type RdEntryOracleVectorCase as OracleVectorCase,
} from "../src/rd-entry-vector-contract";

const VECTOR_BYTES = readFileSync(
  new URL(
    "../../../contracts/vectors/rd-entry-arbitration-v2.json",
    import.meta.url,
  ),
);
const document = await parseRdEntryOracleVectorDocument(VECTOR_BYTES);

async function mutateVectorDocument(
  caseId: string,
  mutate: (vector: Record<string, unknown>) => void,
): Promise<OracleVectorCase> {
  const raw = JSON.parse(VECTOR_BYTES.toString("utf8")) as {
    cases: Record<string, unknown>[];
  };
  const vector = raw.cases.find((item) => item.case_id === caseId);
  if (vector === undefined) throw new TypeError(`missing vector ${caseId}`);
  mutate(vector);
  const parsed = await parseRdEntryOracleVectorDocument(
    new TextEncoder().encode(JSON.stringify(raw)),
  );
  const result = parsed.cases.find((item) => item.case_id === caseId);
  if (result === undefined) throw new TypeError(`missing vector ${caseId}`);
  return result;
}

function caseById(caseId: string): OracleVectorCase {
  const vector = document.cases.find((item) => item.case_id === caseId);
  if (vector === undefined) throw new TypeError(`missing vector ${caseId}`);
  return vector;
}

function expectedEvaluation(vector: OracleVectorCase): EntryEvaluation {
  const { htf_transcripts: _, ...evaluation } = vector.expected;
  return evaluation;
}

async function evaluateInput(
  input: OracleVectorCase["edge_input"],
): Promise<EntryEvaluation> {
  return evaluateEntryStream(
    input.events,
    input.setup_invalidated,
    input.revision,
    input.evaluated_at_epoch,
  );
}

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
      const transcript = "matched" in proof ? proof.transcript : proof;
      const previous = latest.get(transcript.context_minutes);
      if (previous !== undefined) {
        const comparison =
          transcript.htf_open_epoch - previous.htf_open_epoch ||
          transcript.scan_cutoff_epoch - previous.scan_cutoff_epoch;
        if (comparison < 0) {
          throw new TypeError("HTF transcript moved backward");
        }
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

function requireTranscript(
  proof: HTFFlipProof | HTFFlipProofTranscript | undefined,
): HTFFlipProofTranscript {
  if (proof === undefined || "matched" in proof) {
    throw new TypeError("expected a compact HTF transcript fixture");
  }
  return proof;
}

async function rehashEvidence(
  base: EntryCandidateEvidence,
  overrides: Partial<EntryCandidateEvidence>,
): Promise<EntryCandidateEvidence> {
  const row = { ...base, ...overrides };
  const payload_sha256 = await canonicalSha256({
    ambiguity_codes: row.ambiguity_codes,
    candidate_id: row.candidate_id,
    coverage_end_epoch: row.coverage_end_epoch,
    coverage_start_epoch: row.coverage_start_epoch,
    failed_rule_ids: row.failed_rule_ids,
    fidelity: row.fidelity,
    htf_context_minutes: row.htf_context_minutes,
    observed_trigger_epoch: row.observed_trigger_epoch,
    observed_trigger_ticks: row.observed_trigger_ticks,
    passed_rule_ids: row.passed_rule_ids,
    proof_plane: row.proof_plane,
    proof_resolution_seconds: row.proof_resolution_seconds,
    source_claim_ids: row.source_claim_ids,
  });
  const evidence_id = await canonicalSha256({
    candidate_id: row.candidate_id,
    coverage_end_epoch: row.coverage_end_epoch,
    coverage_start_epoch: row.coverage_start_epoch,
    observed_trigger_epoch: row.observed_trigger_epoch,
    payload_sha256,
    proof_plane: row.proof_plane,
    proof_resolution_seconds: row.proof_resolution_seconds,
  });
  return { ...row, evidence_id, payload_sha256 };
}

function arbitrationRequest(
  vector: OracleVectorCase,
): EntryArbitrationRequest {
  return {
    setup_id: vector.edge_input.setup_id,
    setup_invalidated: vector.edge_input.setup_invalidated,
    revision: vector.edge_input.revision,
    candidates: vector.expected.candidates,
    evidence: vector.expected.evidence,
    evaluated_at_epoch: vector.edge_input.evaluated_at_epoch,
  };
}

function compactRequest(event: EntryStreamEvent): EdgeEntryMatchRequest {
  return event.match_request as EdgeEntryMatchRequest;
}

function shiftCandle(
  candle: NonNullable<HTFFlipProofTranscript["contact_candle"]>,
  seconds: number,
) {
  return {
    ...candle,
    open_epoch: candle.open_epoch + seconds,
    close_epoch: candle.close_epoch + seconds,
  };
}

function shiftTranscript(
  transcript: HTFFlipProofTranscript,
  seconds: number,
): HTFFlipProofTranscript {
  return {
    ...transcript,
    htf_open_epoch: transcript.htf_open_epoch + seconds,
    scan_cutoff_epoch: transcript.scan_cutoff_epoch + seconds,
    coverage_start_epoch: transcript.coverage_start_epoch + seconds,
    coverage_end_epoch: transcript.coverage_end_epoch + seconds,
    contact_candle:
      transcript.contact_candle === null
        ? null
        : shiftCandle(transcript.contact_candle, seconds),
    recross_candle:
      transcript.recross_candle === null
        ? null
        : shiftCandle(transcript.recross_candle, seconds),
  };
}

function shiftedEvent(
  event: EntryStreamEvent,
  eventId: string,
  seconds: number,
  transcript: HTFFlipProofTranscript,
): EntryStreamEvent {
  const request = compactRequest(event);
  return {
    event_id: eventId,
    match_request: {
      ...request,
      confirmed_bar: shiftCandle(request.confirmed_bar, seconds),
      htf_proofs: [transcript],
    },
  };
}

function nextBarEvent(
  event: EntryStreamEvent,
  eventId: string,
  bar: EntryMatchRequest["confirmed_bar"],
): EntryStreamEvent {
  const request = compactRequest(event);
  return {
    event_id: eventId,
    match_request: {
      ...request,
      confirmed_bar: bar,
      htf_proofs: [],
      generic_break_detected: false,
      rejection_respect_detected: false,
    },
  };
}

async function evaluateEventsAt(
  events: readonly EntryStreamEvent[],
  evaluatedAtEpoch: number,
  setupInvalidated = false,
): Promise<EntryEvaluation> {
  return evaluateEntryStream(
    events,
    setupInvalidated,
    7,
    evaluatedAtEpoch,
  );
}

function expectAuthorityStable(
  before: EntryEvaluation,
  after: EntryEvaluation,
): void {
  expect(after.candidates).toEqual(before.candidates);
  expect(after.evidence).toEqual(before.evidence);
  expect(after.selection).toEqual(before.selection);
}

describe("RD entry TypeScript/Python parity", () => {
  it("strictly loads the complete reviewed vector set", () => {
    expect(document.schema_id).toBe(
      "phase0.rd-entry-arbitration-vectors.v2",
    );
    expect(document.cases).toHaveLength(24);
  });

  for (const vector of document.cases) {
    it(vector.case_id, async () => {
      const actual = await evaluateInput(vector.edge_input);
      expect(actual).toEqual(expectedEvaluation(vector));
      expect(finalTranscripts(vector.edge_input.events)).toEqual(
        vector.expected.htf_transcripts,
      );
    });
  }

  it("preserves replay metadata without changing matcher output", async () => {
    const vector = caseById("htf-flip-15m");
    const mutated = await mutateVectorDocument(
      vector.case_id,
      (value) => {
        value.symbol = "METADATA_ONLY";
        value.feed = "REPLAY_FIXTURE";
      },
    );

    expect(await evaluateInput(mutated.edge_input)).toEqual(
      await evaluateInput(vector.edge_input),
    );
  });

  it.each([
    ["missing field", (value: Record<string, unknown>) => {
      delete value.symbol;
    }],
    ["unknown field", (value: Record<string, unknown>) => {
      value.unknown_metadata = "forbidden";
    }],
    ["wrong integer type", (value: Record<string, unknown>) => {
      value.calculation_start_epoch = "0";
    }],
    ["wrong boolean type", (value: Record<string, unknown>) => {
      value.pine_supported = 1;
    }],
  ])("rejects malformed replay metadata: %s", async (_, mutate) => {
    await expect(
      mutateVectorDocument("dir-close-engagement", mutate),
    ).rejects.toThrow(TypeError);
  });

  it("rejects a Pine view that changes a non-fidelity path", async () => {
    await expect(
      mutateVectorDocument("dir-close-engagement", (value) => {
        const pine = value.pine_edge_input as Record<string, unknown>;
        pine.revision = Number(pine.revision) + 1;
      }),
    ).rejects.toThrow(/Pine|pine/u);
  });
});

describe("first-model-wins accumulated stream semantics", () => {
  it("keeps the first of two directional-close candidates", async () => {
    const first =
      caseById("dir-close-engagement").edge_input.events[0]!;
    const firstClose = first.match_request.confirmed_bar.close_epoch;
    const second = nextBarEvent(first, "second-directional-close", {
      open_epoch: firstClose,
      close_epoch: firstClose + 300,
      open_ticks: 98,
      high_ticks: 103,
      low_ticks: 98,
      close_ticks: 102,
    });
    const before = await evaluateEventsAt([first], firstClose + 300);
    const after = await evaluateEventsAt(
      [first, second],
      firstClose + 300,
    );

    expectAuthorityStable(before, after);
    expect(after.handling).toEqual(before.handling);
    expect(after.candidates.filter((item) => item.model === "DIR_CLOSE"))
      .toHaveLength(1);
  });

  it("keeps the first of two distinct HTF flip candidates", async () => {
    const source = caseById("htf-flip-15m").edge_input.events[0]!;
    const request = compactRequest(source);
    const firstTranscript = requireTranscript(request.htf_proofs[0]);
    const secondTranscript = shiftTranscript(firstTranscript, 300);
    const second = shiftedEvent(
      source,
      "second-distinct-flip",
      300,
      secondTranscript,
    );
    const evaluatedAt = second.match_request.confirmed_bar.close_epoch;
    const before = await evaluateEventsAt([source], evaluatedAt);
    const after = await evaluateEventsAt([source, second], evaluatedAt);

    expectAuthorityStable(before, after);
    expect(after.handling).toEqual(before.handling);
    expect(after.candidates.filter((item) => item.model === "HTF_FLIP"))
      .toHaveLength(1);
  });

  it("suppresses dependent rows when a reused candidate ID changes its canonical object", async () => {
    const source = caseById("htf-flip-15m").edge_input.events[0]!;
    const request = compactRequest(source);
    const firstTranscript = requireTranscript(request.htf_proofs[0]);
    const laterPrefix: HTFFlipProofTranscript = {
      ...firstTranscript,
      scan_cutoff_epoch: firstTranscript.scan_cutoff_epoch + 300,
      coverage_end_epoch: firstTranscript.coverage_end_epoch + 300,
      expected_child_count: firstTranscript.expected_child_count + 5,
      observed_child_count: firstTranscript.observed_child_count + 5,
    };
    const second = shiftedEvent(
      source,
      "same-anchor-later-prefix",
      300,
      laterPrefix,
    );
    const evaluatedAt = second.match_request.confirmed_bar.close_epoch;
    const before = await evaluateEventsAt([source], evaluatedAt);
    const after = await evaluateEventsAt([source, second], evaluatedAt);

    expectAuthorityStable(before, after);
    expect(after.handling).toEqual(before.handling);
  });

  it("allows an identical first candidate to append immutable evidence", async () => {
    const source = caseById("htf-flip-15m").edge_input.events[0]!;
    const request = compactRequest(source);
    const firstTranscript = requireTranscript(request.htf_proofs[0]);
    const second = shiftedEvent(
      source,
      "same-candidate-new-context",
      300,
      firstTranscript,
    );
    const enriched: EntryStreamEvent = {
      ...second,
      match_request: {
        ...second.match_request,
        htf_proofs: [
          firstTranscript,
          { ...firstTranscript, context_minutes: 30 },
        ],
      },
    };
    const evaluatedAt = enriched.match_request.confirmed_bar.close_epoch;
    const before = await evaluateEventsAt([source], evaluatedAt);
    const after = await evaluateEventsAt([source, enriched], evaluatedAt);

    expect(after.candidates).toEqual(before.candidates);
    expect(after.evidence).toHaveLength(before.evidence.length + 1);
    expect(after.handling).toHaveLength(before.handling.length + 1);
  });

  it("deduplicates an identical event and rejects a changed payload under its ID", async () => {
    const source = caseById("dir-close-engagement").edge_input.events[0]!;
    const expected = await evaluateEventsAt(
      [source],
      source.match_request.confirmed_bar.close_epoch,
    );
    expect(
      await evaluateEventsAt(
        [source, structuredClone(source)],
        source.match_request.confirmed_bar.close_epoch,
      ),
    ).toEqual(expected);

    const conflict: EntryStreamEvent = {
      ...source,
      match_request: {
        ...source.match_request,
        confirmed_bar: {
          ...source.match_request.confirmed_bar,
          high_ticks: source.match_request.confirmed_bar.high_ticks + 1,
        },
      },
    };
    await expect(
      evaluateEventsAt(
        [source, conflict],
        source.match_request.confirmed_bar.close_epoch,
      ),
    ).rejects.toThrow(/event stream identity conflict/u);
  });

  it("rejects mixed attempt facts before matching", async () => {
    const vector = caseById("next-candle-wick-handling");
    const [first, second] = vector.edge_input.events;
    const mixed: EntryStreamEvent = {
      ...second!,
      match_request: {
        ...second!.match_request,
        attempt_kind: "RE_ENTRY",
        trigger_ordinal: 2,
      },
    };
    await expect(
      evaluateEventsAt(
        [first!, mixed],
        mixed.match_request.confirmed_bar.close_epoch,
      ),
    ).rejects.toThrow(/immutable setup or attempt/u);
  });
});

describe("NEXT_CANDLE_WICK diagnostic handling", () => {
  it("adds only long wick handling on the contiguous next bar", async () => {
    const vector = caseById("next-candle-wick-handling");
    const [closeEvent, wickEvent] = vector.edge_input.events;
    const evaluatedAt = wickEvent!.match_request.confirmed_bar.close_epoch;
    const before = await evaluateEventsAt([closeEvent!], evaluatedAt);
    const after = await evaluateEventsAt(
      [closeEvent!, wickEvent!],
      evaluatedAt,
    );

    expectAuthorityStable(before, after);
    expect(
      after.handling.filter(
        (item) => item.handling_mode === "NEXT_CANDLE_WICK",
      ),
    ).toHaveLength(1);
  });

  it("derives the same long wick from out-of-order arrivals", async () => {
    const vector = caseById("next-candle-wick-handling");
    const forward = await evaluateInput(vector.edge_input);
    const reverse = await evaluateEntryStream(
      [...vector.edge_input.events].reverse(),
      false,
      vector.edge_input.revision,
      vector.edge_input.evaluated_at_epoch,
    );
    expect(reverse).toEqual(forward);
  });

  it("derives a short upper wick without changing authority", async () => {
    const source = caseById("dir-close-engagement").edge_input.events[0]!;
    const request = compactRequest(source);
    const closeEvent: EntryStreamEvent = {
      ...source,
      event_id: "short-close",
      match_request: {
        ...request,
        setup: { ...request.setup, direction: "SHORT" },
        confirmed_bar: {
          ...request.confirmed_bar,
          open_ticks: 99,
          high_ticks: 100,
          low_ticks: 93,
          close_ticks: 94,
        },
      },
    };
    const closeEpoch = closeEvent.match_request.confirmed_bar.close_epoch;
    const wickEvent = nextBarEvent(closeEvent, "short-wick", {
      open_epoch: closeEpoch,
      close_epoch: closeEpoch + 300,
      open_ticks: 94,
      high_ticks: 97,
      low_ticks: 93,
      close_ticks: 95,
    });
    const before = await evaluateEventsAt(
      [closeEvent],
      closeEpoch + 300,
    );
    const after = await evaluateEventsAt(
      [closeEvent, wickEvent],
      closeEpoch + 300,
    );

    expectAuthorityStable(before, after);
    expect(
      after.handling.find(
        (item) => item.handling_mode === "NEXT_CANDLE_WICK",
      )?.observed_ticks,
    ).toBe(97);
  });

  it.each([
    [
      "equality at body extreme",
      { open_ticks: 102, high_ticks: 103, low_ticks: 101, close_ticks: 101 },
    ],
    [
      "body-only counter-move",
      { open_ticks: 103, high_ticks: 103, low_ticks: 100, close_ticks: 100 },
    ],
  ])("does not infer a wick from %s", async (_, prices) => {
    const closeEvent =
      caseById("next-candle-wick-handling").edge_input.events[0]!;
    const closeEpoch = closeEvent.match_request.confirmed_bar.close_epoch;
    const next = nextBarEvent(closeEvent, "no-wick", {
      open_epoch: closeEpoch,
      close_epoch: closeEpoch + 300,
      ...prices,
    });
    const before = await evaluateEventsAt(
      [closeEvent],
      closeEpoch + 300,
    );
    const after = await evaluateEventsAt(
      [closeEvent, next],
      closeEpoch + 300,
    );

    expectAuthorityStable(before, after);
    expect(after.handling).toEqual(before.handling);
  });

  it("does not substitute a later bar for a missing immediate bar", async () => {
    const closeEvent =
      caseById("next-candle-wick-handling").edge_input.events[0]!;
    const closeEpoch = closeEvent.match_request.confirmed_bar.close_epoch;
    const later = nextBarEvent(closeEvent, "later-wick", {
      open_epoch: closeEpoch + 300,
      close_epoch: closeEpoch + 600,
      open_ticks: 102,
      high_ticks: 103,
      low_ticks: 99,
      close_ticks: 101,
    });
    const before = await evaluateEventsAt(
      [closeEvent],
      closeEpoch + 600,
    );
    const after = await evaluateEventsAt(
      [closeEvent, later],
      closeEpoch + 600,
    );

    expectAuthorityStable(before, after);
    expect(after.handling).toEqual(before.handling);
  });

  it("keeps RE_ENTRY attempt metadata on its wick observation", async () => {
    const closeEvent =
      caseById("re-entry-attempt").edge_input.events[0]!;
    const closeEpoch = closeEvent.match_request.confirmed_bar.close_epoch;
    const wick = nextBarEvent(closeEvent, "re-entry-wick", {
      open_epoch: closeEpoch,
      close_epoch: closeEpoch + 300,
      open_ticks: 102,
      high_ticks: 103,
      low_ticks: 99,
      close_ticks: 101,
    });
    const before = await evaluateEventsAt(
      [closeEvent],
      closeEpoch + 300,
    );
    const after = await evaluateEventsAt(
      [closeEvent, wick],
      closeEpoch + 300,
    );

    expectAuthorityStable(before, after);
    expect(
      after.handling.find(
        (item) => item.handling_mode === "NEXT_CANDLE_WICK",
      )?.attempt_kind,
    ).toBe("RE_ENTRY");
  });
});

describe("immutable terminal and handling-only grace", () => {
  function terminalEvents(): readonly [EntryStreamEvent, EntryStreamEvent] {
    const events = [
      ...caseById("out-of-order-events-deterministic").edge_input.events,
    ].sort(
      (left, right) =>
        left.match_request.confirmed_bar.close_epoch -
        right.match_request.confirmed_bar.close_epoch,
    );
    return [events[0]!, events[1]!];
  }

  function graceEvent(
    terminal: EntryStreamEvent,
    eventId = "terminal-wick-grace",
  ): EntryStreamEvent {
    const closeEpoch = terminal.match_request.confirmed_bar.close_epoch;
    return nextBarEvent(terminal, eventId, {
      open_epoch: closeEpoch,
      close_epoch: closeEpoch + 300,
      open_ticks: 102,
      high_ticks: 103,
      low_ticks: 99,
      close_ticks: 101,
    });
  }

  it("allows exactly one contiguous handling-only bar after close completes both", async () => {
    const [flip, terminal] = terminalEvents();
    const grace = graceEvent(terminal);
    const evaluatedAt = grace.match_request.confirmed_bar.close_epoch;
    const before = await evaluateEventsAt([flip, terminal], evaluatedAt);
    const after = await evaluateEventsAt(
      [terminal, grace, flip],
      evaluatedAt,
    );

    expectAuthorityStable(before, after);
    expect(after.handling).toHaveLength(before.handling.length + 1);
    expect(
      after.handling.filter(
        (item) => item.handling_mode === "NEXT_CANDLE_WICK",
      ),
    ).toHaveLength(1);
  });

  it("rejects a second grace bar or changed terminal facts", async () => {
    const [flip, terminal] = terminalEvents();
    const grace = graceEvent(terminal);
    const second = graceEvent(grace, "second-post-terminal-bar");
    await expect(
      evaluateEventsAt(
        [flip, terminal, grace, second],
        second.match_request.confirmed_bar.close_epoch,
      ),
    ).rejects.toThrow(/terminal setup fact|authority event/u);

    const changed: EntryStreamEvent = {
      ...grace,
      match_request: {
        ...grace.match_request,
        setup: {
          ...grace.match_request.setup,
          terminal_epoch: null,
          terminal_reason: null,
        },
      },
    };
    await expect(
      evaluateEventsAt(
        [flip, terminal, changed],
        changed.match_request.confirmed_bar.close_epoch,
      ),
    ).rejects.toThrow(/post-terminal grace/u);
  });

  it("consumes a non-contiguous grace without deriving handling", async () => {
    const [flip, terminal] = terminalEvents();
    const contiguous = graceEvent(terminal);
    const closeEpoch = terminal.match_request.confirmed_bar.close_epoch;
    const nonContiguous = nextBarEvent(
      terminal,
      "non-contiguous-grace",
      {
        ...contiguous.match_request.confirmed_bar,
        open_epoch: closeEpoch + 300,
        close_epoch: closeEpoch + 600,
      },
    );
    const after = await evaluateEventsAt(
      [flip, terminal, nonContiguous],
      closeEpoch + 600,
    );
    expect(
      after.handling.some(
        (item) => item.handling_mode === "NEXT_CANDLE_WICK",
      ),
    ).toBe(false);
  });

  it("does not grant grace when the flip is the terminal model", async () => {
    const vector = caseById("exact-close-then-later-flip");
    const events = [...vector.edge_input.events].sort(
      (left, right) =>
        left.match_request.confirmed_bar.close_epoch -
        right.match_request.confirmed_bar.close_epoch,
    );
    const terminal = events[1]!;
    const postTerminal = graceEvent(terminal, "forbidden-flip-terminal-grace");
    await expect(
      evaluateEventsAt(
        [...events, postTerminal],
        postTerminal.match_request.confirmed_bar.close_epoch,
      ),
    ).rejects.toThrow(/authority event follows terminal/u);
  });

  it("does not grant grace when one event creates both active models", async () => {
    const source = caseById("htf-flip-15m").edge_input.events[0]!;
    const closeEpoch = source.match_request.confirmed_bar.close_epoch;
    const terminal: EntryStreamEvent = {
      ...source,
      event_id: "same-event-both-models",
      match_request: {
        ...source.match_request,
        setup: {
          ...source.match_request.setup,
          terminal_reason: "BOTH_ACTIVE_MODELS_OBSERVED",
          terminal_epoch: closeEpoch,
        },
        confirmed_bar: {
          ...source.match_request.confirmed_bar,
          open_ticks: 98,
          high_ticks: 102,
          low_ticks: 98,
          close_ticks: 101,
        },
      },
    };
    const authority = await evaluateEventsAt([terminal], closeEpoch);
    expect(
      new Set(authority.candidates.map((candidate) => candidate.model)),
    ).toEqual(new Set(["DIR_CLOSE", "HTF_FLIP"]));

    const postTerminal = graceEvent(
      terminal,
      "forbidden-same-event-both-grace",
    );
    await expect(
      evaluateEventsAt(
        [terminal, postTerminal],
        postTerminal.match_request.confirmed_bar.close_epoch,
      ),
    ).rejects.toThrow(/authority event follows terminal/u);
  });

  it("rejects malformed grace OHLC instead of reopening or silently accepting it", async () => {
    const [flip, terminal] = terminalEvents();
    const grace = graceEvent(terminal);
    const malformed: EntryStreamEvent = {
      ...grace,
      match_request: {
        ...grace.match_request,
        confirmed_bar: {
          ...grace.match_request.confirmed_bar,
          high_ticks: grace.match_request.confirmed_bar.low_ticks - 1,
        },
      },
    };
    await expect(
      evaluateEventsAt(
        [flip, terminal, malformed],
        malformed.match_request.confirmed_bar.close_epoch,
      ),
    ).rejects.toThrow(/OHLC|candle|confirmed_bar/u);
  });
});

describe("frozen RD source catalog", () => {
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

  it("joins every generated catalog field to the official frozen source", () => {
    const contract = JSON.parse(
      readFileSync(
        new URL(
          "../../../config/phase0/rd-strategy-rule-contract-v2.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      readonly claims_by_id: Readonly<Record<string, {
        readonly source_id: string;
        readonly timestamp_start_seconds: number;
        readonly timestamp_end_seconds: number;
        readonly relationship: string;
        readonly target_claim_id: string | null;
        readonly summary: string;
      }>>;
      readonly sources_by_id: Readonly<Record<string, {
        readonly youtube_video_id: string;
        readonly published_date: string;
        readonly title_snapshot: string;
        readonly channel_id: string;
        readonly channel_handle: string;
      }>>;
    };
    const expected = Object.keys(contract.claims_by_id)
      .sort()
      .map((claim_id) => {
        const claim = contract.claims_by_id[claim_id]!;
        const source = contract.sources_by_id[claim.source_id]!;
        return {
          channel_handle: source.channel_handle,
          channel_id: source.channel_id,
          claim_id,
          published_date: source.published_date,
          relationship: claim.relationship,
          source_id: claim.source_id,
          summary: claim.summary,
          target_claim_id: claim.target_claim_id,
          timestamp_end_seconds: claim.timestamp_end_seconds,
          timestamp_start_seconds: claim.timestamp_start_seconds,
          title_snapshot: source.title_snapshot,
          youtube_video_id: source.youtube_video_id,
        };
      });
    expect(SOURCE_CLAIM_CATALOG).toEqual(expected);
  });
});

describe("bounded HTF transcript validation and identity", () => {
  it("accepts exact 150-second proof resolution because it divides five minutes", async () => {
    const request = compactRequest(
      caseById("htf-flip-15m").edge_input.events[0]!,
    );
    const anchor = request.confirmed_bar.open_epoch;
    const transcript: HTFFlipProofTranscript = {
      context_minutes: 15,
      htf_open_epoch: anchor,
      htf_open_ticks: 100,
      scan_cutoff_epoch: anchor + 300,
      proof_resolution_seconds: 150,
      coverage_start_epoch: anchor,
      coverage_end_epoch: anchor + 300,
      expected_child_count: 2,
      observed_child_count: 2,
      gap_present: false,
      full_lifecycle_ordered: true,
      destination_seen_before_contact: false,
      contact_candle: {
        open_epoch: anchor,
        close_epoch: anchor + 150,
        open_ticks: 99,
        high_ticks: 99,
        low_ticks: 96,
        close_ticks: 97,
      },
      recross_candle: {
        open_epoch: anchor + 150,
        close_epoch: anchor + 300,
        open_ticks: 99,
        high_ticks: 101,
        low_ticks: 98,
        close_ticks: 100,
      },
      same_child: false,
    };

    const proof = await validateHtfFlipProof(request.setup, transcript);
    const match = await evaluateEntryMatch({
      ...request,
      htf_proofs: [transcript],
    });

    expect(proof.fidelity).toBe("EXACT");
    expect(proof.proof_resolution_seconds).toBe(150);
    expect(match.candidates.map((candidate) => candidate.model)).toContain(
      "HTF_FLIP",
    );
    expect(match.evidence[0]?.fidelity).toBe("EXACT");
    expect(match.evidence[0]?.proof_resolution_seconds).toBe(150);
  });

  it("rejects a differently bounded transcript even with its hash recomputed", async () => {
    const request = caseById("htf-flip-15m").edge_input.events[0]!
      .match_request as EdgeEntryMatchRequest;
    const transcript = requireTranscript(request.htf_proofs[0]);
    const proof = await validateHtfFlipProof(request.setup, transcript);
    const forgedTranscript = {
      ...proof.transcript,
      coverage_end_epoch: proof.transcript.coverage_end_epoch - 60,
    };
    const forged: HTFFlipProof = {
      ...proof,
      coverage_end_epoch: forgedTranscript.coverage_end_epoch,
      transcript: forgedTranscript,
      transcript_sha256: await canonicalSha256(forgedTranscript),
    };

    await expect(
      validateHtfFlipProof(
        request.setup,
        forged,
        proof.transcript.htf_open_ticks,
      ),
    ).rejects.toThrow(/transcript|coverage|bounded/u);
  });

  it("keeps semantic evidence stable across transport copies", async () => {
    const request = caseById("htf-flip-15m").edge_input.events[0]!
      .match_request as EdgeEntryMatchRequest;
    const first = await evaluateEntryMatch(request);
    const transportedCopy = await evaluateEntryMatch(
      structuredClone(request),
    );
    expect(transportedCopy.evidence).toEqual(first.evidence);

    const transcript = requireTranscript(request.htf_proofs[0]);
    const changed = {
      ...request,
      htf_proofs: [{
        ...transcript,
        htf_open_ticks: transcript.htf_open_ticks - 1,
      }],
    };
    const changedResult = await evaluateEntryMatch(changed);
    expect(changedResult.candidates[0]?.candidate_id).toBe(
      first.candidates[0]?.candidate_id,
    );
    expect(changedResult.evidence[0]?.payload_sha256).not.toBe(
      first.evidence[0]?.payload_sha256,
    );
    expect(changedResult.evidence[0]?.evidence_id).not.toBe(
      first.evidence[0]?.evidence_id,
    );

    const originalEvidence = first.evidence[0]!;
    for (const overrides of [
      {
        ambiguity_codes: [
          "SHADOW_MISSING_INTRABAR_COVERAGE",
        ] as const,
      },
      {
        source_claim_ids: [
          ...originalEvidence.source_claim_ids,
          "transport-independent-extra-claim",
        ],
      },
    ]) {
      const changedEvidence = await rehashEvidence(
        originalEvidence,
        overrides,
      );
      expect(changedEvidence.payload_sha256).not.toBe(
        originalEvidence.payload_sha256,
      );
      expect(changedEvidence.evidence_id).not.toBe(
        originalEvidence.evidence_id,
      );
    }
  });
});

describe("deterministic arbitration branches", () => {
  it.each([
    ["pre-entry-invalidation", "NONE", "SETUP_INVALIDATED"],
    ["generic-break-rejected", "NONE", "NO_CANDIDATE"],
    ["non-exact-only", "SHADOW_ONLY", "NO_EXACT_CANDIDATE"],
    [
      "shadow-flip-then-close-fallback",
      "PAPER_ELIGIBLE",
      "FALLBACK_TO_CONFIRMED_CLOSE",
    ],
    ["dir-close-engagement", "PAPER_ELIGIBLE", "ONLY_EXACT_TRIGGER"],
    [
      "exact-flip-then-close",
      "PAPER_ELIGIBLE",
      "EARLIEST_EXACT_TRIGGER",
    ],
  ])("%s reaches %s / %s", async (caseId, action, reason) => {
    const selection = await arbitrateEntryCandidates(
      arbitrationRequest(caseById(caseId)),
    );
    expect(selection.action).toBe(action);
    expect(selection.reason).toBe(reason);
  });

  it("shadows equal-time exact models without inventing source priority", async () => {
    const vector = caseById("exact-close-then-later-flip");
    const request = arbitrationRequest(vector);
    const closeEvidence = request.evidence.find((item) =>
      request.candidates.some(
        (candidate) =>
          candidate.candidate_id === item.candidate_id &&
          candidate.model === "DIR_CLOSE",
      ),
    )!;
    const flipEvidence = request.evidence.find((item) =>
      request.candidates.some(
        (candidate) =>
          candidate.candidate_id === item.candidate_id &&
          candidate.model === "HTF_FLIP",
      ),
    )!;
    const tiedFlip = await rehashEvidence(flipEvidence, {
      observed_trigger_epoch: closeEvidence.observed_trigger_epoch,
    });
    const selection = await arbitrateEntryCandidates({
      ...request,
      evidence: request.evidence.map((item) =>
        item.evidence_id === flipEvidence.evidence_id ? tiedFlip : item
      ),
    });
    expect(selection.action).toBe("SHADOW_ONLY");
    expect(selection.reason).toBe("UNRESOLVED_SOURCE_PRIORITY");
    expect(selection.canonical_candidate_id).toBeNull();
  });

  it("selects canonical evidence independently of evidence input order", async () => {
    const request = arbitrationRequest(
      caseById("dir-close-engagement"),
    );
    const original = request.evidence[0]!;
    const finer = await rehashEvidence(original, {
      proof_resolution_seconds: 60,
    });
    const forward = await arbitrateEntryCandidates({
      ...request,
      evidence: [original, finer],
    });
    const reverse = await arbitrateEntryCandidates({
      ...request,
      evidence: [finer, original],
    });
    expect(forward.canonical_evidence_id).toBe(finer.evidence_id);
    expect(reverse).toEqual(forward);
  });

  it("falls back only for a strictly earlier replay-observed non-exact flip", async () => {
    const earlier = arbitrationRequest(
      caseById("shadow-flip-then-close-fallback"),
    );
    expect((await arbitrateEntryCandidates(earlier)).reason).toBe(
      "FALLBACK_TO_CONFIRMED_CLOSE",
    );
    const flip = earlier.candidates.find(
      (item) => item.model === "HTF_FLIP",
    )!;
    const closeEvidence = earlier.evidence.find((item) =>
      earlier.candidates.some(
        (candidate) =>
          candidate.model === "DIR_CLOSE" &&
          candidate.candidate_id === item.candidate_id,
      ),
    )!;
    const flipEvidence = earlier.evidence.find(
      (item) => item.candidate_id === flip.candidate_id,
    )!;
    const realtime = await rehashEvidence(flipEvidence, {
      proof_plane: "REALTIME_TICK",
    });
    const withoutTrigger = await rehashEvidence(flipEvidence, {
      observed_trigger_epoch: null,
      observed_trigger_ticks: null,
    });
    for (const replacement of [realtime, withoutTrigger]) {
      const selection = await arbitrateEntryCandidates({
        ...earlier,
        evidence: earlier.evidence.map((item) =>
          item.candidate_id === flip.candidate_id ? replacement : item
        ),
      });
      expect(selection.reason).toBe("ONLY_EXACT_TRIGGER");
    }
    const boundaryGap = await rehashEvidence(flipEvidence, {
      ambiguity_codes: ["SHADOW_MISSING_INTRABAR_COVERAGE"],
      source_claim_ids: [
        ...flipEvidence.source_claim_ids,
        ...SOURCE_CLAIMS.HTF_BOUNDARY,
      ],
    });
    expect(
      (
        await arbitrateEntryCandidates({
          ...earlier,
          evidence: earlier.evidence.map((item) =>
            item.candidate_id === flip.candidate_id
              ? boundaryGap
              : item
          ),
        })
      ).reason,
    ).toBe("FALLBACK_TO_CONFIRMED_CLOSE");

    const later = arbitrationRequest(
      caseById("exact-close-then-later-flip"),
    );
    const laterFlip = later.candidates.find(
      (item) => item.model === "HTF_FLIP",
    )!;
    const laterFlipEvidence = later.evidence.find(
      (item) => item.candidate_id === laterFlip.candidate_id,
    )!;
    const laterCloseEvidence = later.evidence.find((item) =>
      later.candidates.some(
        (candidate) =>
          candidate.model === "DIR_CLOSE" &&
          candidate.candidate_id === item.candidate_id,
      ),
    )!;
    const sameTime = await rehashEvidence(laterFlipEvidence, {
      fidelity: "UNRESOLVED",
      observed_trigger_epoch: laterCloseEvidence.observed_trigger_epoch,
      observed_trigger_ticks: laterCloseEvidence.observed_trigger_ticks,
    });
    const nonExactLater = await rehashEvidence(laterFlipEvidence, {
      fidelity: "UNRESOLVED",
    });
    for (const replacement of [sameTime, nonExactLater]) {
      const selection = await arbitrateEntryCandidates({
        ...later,
        evidence: later.evidence.map((item) =>
          item.candidate_id === laterFlip.candidate_id
            ? replacement
            : item
        ),
      });
      expect(selection.reason).toBe("ONLY_EXACT_TRIGGER");
    }
  });

  it("rejects foreign or conflicting immutable evidence", async () => {
    const request = arbitrationRequest(
      caseById("dir-close-engagement"),
    );
    await expect(
      arbitrateEntryCandidates({
        ...request,
        evidence: [{
          ...request.evidence[0]!,
          candidate_id: "f".repeat(64),
        }],
      }),
    ).rejects.toThrow(/unknown candidate|identity/u);
    await expect(
      arbitrateEntryCandidates({
        ...request,
        evidence: [
          request.evidence[0]!,
          {
            ...request.evidence[0]!,
            observed_at_epoch:
              request.evidence[0]!.observed_at_epoch + 1,
          },
        ],
      }),
    ).rejects.toThrow(/conflict/u);
  });

  it("rejects a candidate observed after the arbitration epoch", async () => {
    const request = arbitrationRequest(
      caseById("dir-close-engagement"),
    );
    await expect(
      arbitrateEntryCandidates({
        ...request,
        candidates: request.candidates.map((candidate) => ({
          ...candidate,
          observed_at_epoch: request.evaluated_at_epoch + 1,
        })),
      }),
    ).rejects.toThrow(/candidate.*observed|evaluation epoch/u);
  });

  it("rejects evidence observed after the arbitration epoch", async () => {
    const request = arbitrationRequest(
      caseById("dir-close-engagement"),
    );
    await expect(
      arbitrateEntryCandidates({
        ...request,
        evidence: request.evidence.map((evidence) => ({
          ...evidence,
          observed_at_epoch: request.evaluated_at_epoch + 1,
        })),
      }),
    ).rejects.toThrow(/evidence.*observed|evaluation epoch/u);
  });

  it("rejects evidence whose coverage ends after it was observed", async () => {
    const request = arbitrationRequest(
      caseById("dir-close-engagement"),
    );
    await expect(
      arbitrateEntryCandidates({
        ...request,
        evidence: request.evidence.map((evidence) => ({
          ...evidence,
          observed_at_epoch: evidence.coverage_end_epoch - 1,
        })),
      }),
    ).rejects.toThrow(/coverage.*observed|causality/u);
  });

  it("rejects future evidence coverage even when its identity is recomputed", async () => {
    const request = arbitrationRequest(
      caseById("dir-close-engagement"),
    );
    const futureEvidence = await rehashEvidence(request.evidence[0]!, {
      coverage_end_epoch: request.evaluated_at_epoch + 1,
      observed_at_epoch: request.evaluated_at_epoch + 1,
    });
    await expect(
      arbitrateEntryCandidates({
        ...request,
        evidence: [futureEvidence],
      }),
    ).rejects.toThrow(/coverage|observed|evaluation epoch/u);
  });

  it("rejects values outside the closed candidate and evidence domains", async () => {
    const request = arbitrationRequest(
      caseById("dir-close-engagement"),
    );
    await expect(
      arbitrateEntryCandidates({
        ...request,
        candidates: [{
          ...request.candidates[0]!,
          model: "AGGRESSIVE" as EntryEvaluation["candidates"][number]["model"],
        }],
      }),
    ).rejects.toThrow(/model|candidate domain/u);
    await expect(
      arbitrateEntryCandidates({
        ...request,
        evidence: [{
          ...request.evidence[0]!,
          proof_plane:
            "PRODUCER_ASSERTED" as EntryCandidateEvidence["proof_plane"],
        }],
      }),
    ).rejects.toThrow(/proof plane|evidence domain/u);
  });
});
