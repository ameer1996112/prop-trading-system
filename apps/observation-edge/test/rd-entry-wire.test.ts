import { describe, expect, it } from "vitest";

import { evaluateEntryStream } from "../src/rd-entry-arbitrator";
import {
  canonicalStringifyRdEntry,
  type EntryMatchRequest,
} from "../src/rd-entry-domain";
import { canonicalSha256, SOURCE_CLAIMS } from "../src/rd-entry-policy";
import {
  ENTRY_V2_MAX_MESSAGE_CHARACTERS,
  EntryV2ValidationError,
  MAX_ENTRY_BARS_PER_SETUP,
  MAX_ENTRY_CANDIDATES_PER_SETUP,
  MAX_ENTRY_CHUNKS,
  MAX_ENTRY_EVIDENCE_PER_CANDIDATE,
  MAX_ENTRY_EVIDENCE_PER_SETUP,
  MAX_ENTRY_HANDLING_PER_SETUP,
  MAX_ENTRY_SETUPS_PER_BATCH,
  validateEntryV2BodySize,
  validateEntryV2Payload,
} from "../src/rd-entry-wire";
import { parseStrictJson } from "../src/strict-json";

const digest = "a".repeat(64);
const encoder = new TextEncoder();

function strict(value: unknown) {
  return parseStrictJson(encoder.encode(JSON.stringify(value)));
}

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
    bar_open_epoch: 1_721_808_000,
    bar_close_epoch: 1_721_808_300,
    detector_code_hash: digest,
    settings_hash: "b".repeat(64),
    kind: "incremental",
    chunk_index: 0,
    chunk_count: 1,
    eb: [
      {
        s: "setup-1",
        d: "LONG",
        f: {
          zb: 90,
          zt: 100,
          ge: 1_721_808_010,
          iv: false,
          cf: "EXACT",
          ak: "INITIAL",
          et: true,
          tr: null,
          te: null,
          ng: null,
          b: [
            {
              oe: 1_721_808_000,
              ce: 1_721_808_300,
              o: 99,
              h: 105,
              l: 95,
              c: 103,
              gb: false,
              rr: false,
            },
          ],
          x: [],
        },
        c: [],
        e: [],
        h: [],
        q: null,
      },
    ],
  };
}

function bundles(value: Record<string, unknown>): Record<string, unknown>[] {
  return value.eb as Record<string, unknown>[];
}

function bundle(
  value: Record<string, unknown>,
  index = 0,
): Record<string, unknown> {
  return bundles(value)[index]!;
}

function facts(
  value: Record<string, unknown>,
  index = 0,
): Record<string, unknown> {
  return bundle(value, index).f as Record<string, unknown>;
}

function bars(
  value: Record<string, unknown>,
  index = 0,
): Record<string, unknown>[] {
  return facts(value, index).b as Record<string, unknown>[];
}

function transcript(
  cutoffEpoch: number,
  coverageStartEpoch = cutoffEpoch - 900,
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

function matchedTranscript(
  cutoffEpoch = 1_721_808_000,
): Record<string, unknown> {
  return {
    ...transcript(cutoffEpoch),
    cc: {
      oe: 1_721_807_700,
      ce: 1_721_807_760,
      o: 95,
      h: 98,
      l: 89,
      c: 96,
    },
    rc: {
      oe: 1_721_807_760,
      ce: 1_721_807_820,
      o: 96,
      h: 101,
      l: 94,
      c: 100,
    },
  };
}

function addPreviousBar(value: Record<string, unknown>): void {
  facts(value).ge = 1_721_807_700;
  facts(value).b = [
    {
      oe: 1_721_807_700,
      ce: 1_721_808_000,
      o: 98,
      h: 102,
      l: 96,
      c: 99,
      gb: false,
      rr: false,
    },
    ...bars(value),
  ];
}

function addConfirmedDiagnostic(value: Record<string, unknown>): void {
  const setupBundle = bundle(value);
  setupBundle.c = [
    {
      i: 0,
      m: "DIR_CLOSE",
      st: "MATCHED",
      a: 1_721_808_000,
      o: 1,
      n: null,
      sc: [...SOURCE_CLAIMS.DIR_CLOSE],
    },
  ];
  setupBundle.e = [
    {
      i: 0,
      ci: 0,
      t: 1_721_808_300,
      px: 103,
      h: [],
      f: "EXACT",
      p: "CONFIRMED_5M",
      r: 300,
      cs: 1_721_808_000,
      ce: 1_721_808_300,
      ac: [],
      pr: ["ENTRY_DIR_CLOSE"],
      fr: [],
      sc: [...SOURCE_CLAIMS.DIR_CLOSE],
    },
  ];
  setupBundle.h = [
    {
      ci: 0,
      ei: 0,
      m: "CLOSE_CONFIRMATION",
      a: "INITIAL",
      t: 1_721_808_300,
      px: 103,
      f: "EXACT",
      sc: [...SOURCE_CLAIMS.DIR_CLOSE],
    },
  ];
  setupBundle.q = {
    v: "PINE_DIAGNOSTIC_ONLY",
    k: "DIR_CLOSE:1721808000:1",
    m: "DIR_CLOSE",
    a: 1_721_808_000,
    o: 1,
    r: "ONLY_EXACT_TRIGGER",
    f: "EXACT",
    x: "SHADOW_ONLY",
  };
}

function addRealtimeDiagnostic(value: Record<string, unknown>): void {
  addConfirmedDiagnostic(value);
  const setupBundle = bundle(value);
  setupBundle.e = [
    ...(setupBundle.e as Record<string, unknown>[]),
    {
      i: 1,
      ci: 0,
      t: 1_721_808_250,
      px: 101,
      h: [],
      f: "UNRESOLVED",
      p: "REALTIME_TICK",
      r: 0,
      cs: 1_721_808_250,
      ce: 1_721_808_250,
      ac: ["SHADOW_REALTIME_ONLY_NOT_REPLAYABLE"],
      pr: [],
      fr: ["ENTRY_DIR_CLOSE"],
      sc: [...SOURCE_CLAIMS.DIR_CLOSE],
    },
  ];
}

function addBlockedRealtimeDirCloseDiagnostic(
  value: Record<string, unknown>,
): void {
  const setupBundle = bundle(value);
  setupBundle.c = [
    {
      i: 0,
      m: "DIR_CLOSE",
      st: "BLOCKED",
      a: 1_721_808_000,
      o: 1,
      n: null,
      sc: [...SOURCE_CLAIMS.DIR_CLOSE],
    },
  ];
  setupBundle.e = [
    {
      i: 0,
      ci: 0,
      t: 1_721_808_250,
      px: 101,
      h: [],
      f: "UNRESOLVED",
      p: "REALTIME_TICK",
      r: 0,
      cs: 1_721_808_250,
      ce: 1_721_808_250,
      ac: ["SHADOW_REALTIME_ONLY_NOT_REPLAYABLE"],
      pr: [],
      fr: ["ENTRY_DIR_CLOSE"],
      sc: [...SOURCE_CLAIMS.DIR_CLOSE],
    },
  ];
  setupBundle.h = [];
  setupBundle.q = null;
}

function addUnbackedHtfDiagnostic(value: Record<string, unknown>): void {
  const setupBundle = bundle(value);
  setupBundle.c = [
    {
      i: 0,
      m: "HTF_FLIP",
      st: "BLOCKED",
      a: 1_721_807_100,
      o: 1,
      n: null,
      sc: [...SOURCE_CLAIMS.HTF_FLIP],
    },
  ];
  setupBundle.e = [
    {
      i: 0,
      ci: 0,
      t: null,
      px: null,
      h: [15],
      f: "UNRESOLVED",
      p: "LOWER_TIMEFRAME_REPLAY",
      r: 60,
      cs: 1_721_807_100,
      ce: 1_721_808_000,
      ac: [],
      pr: [],
      fr: ["ENTRY_HTF_FLIP"],
      sc: [...SOURCE_CLAIMS.HTF_FLIP],
    },
  ];
  setupBundle.h = [];
  setupBundle.q = null;
}

function addTerminalGrace(value: Record<string, unknown>): void {
  addPreviousBar(value);
  facts(value).x = [matchedTranscript()];
  facts(value).tr = "BOTH_ACTIVE_MODELS_OBSERVED";
  facts(value).te = 1_721_808_300;
  facts(value).ng = {
    oe: 1_721_808_300,
    ce: 1_721_808_600,
    o: 103,
    h: 104,
    l: 98,
    c: 102,
    ak: "INITIAL",
  };
}

describe("schema 2.0 compact wire", () => {
  it("expands compact facts and contains no paper command surface", async () => {
    const value = await validateEntryV2Payload(strict(payload()));

    expect(value.entryBatches[0]?.events[0]?.setup.setup_id).toBe("setup-1");
    expect(value.entryBatches[0]?.events[0]).toMatchObject({
      setup: {
        direction: "LONG",
        zone_bottom_ticks: 90,
        zone_top_ticks: 100,
        common_fidelity: "EXACT",
      },
      confirmed_bar: {
        open_epoch: 1_721_808_000,
        close_epoch: 1_721_808_300,
        open_ticks: 99,
        high_ticks: 105,
        low_ticks: 95,
        close_ticks: 103,
      },
      attempt_kind: "INITIAL",
      trigger_ordinal: 1,
    });
    expect(value.entryBatches[0]?.retainedContext).toEqual([]);
    expect(value.entryBatches[0]?.producerDiagnostic).toEqual({
      candidates: [],
      evidence: [],
      realtime_evidence: [],
      handling: [],
      selection: null,
    });
    expect(value.canonicalPayload).not.toHaveProperty("paper_commands");
    expect(value.canonicalPayload).not.toHaveProperty("credential");
    expect(value.metadata).toMatchObject({
      schemaVersion: "2.0",
      strategyVersion: "2.0.0-contract2",
      sequence: 1,
      kind: "incremental",
    });
    expect(value.batchIdentity).toEqual({
      producer_instance_id: "pine-v3-lab",
      sequence: 1,
      kind: "incremental",
      bar_close_epoch: 1_721_808_300,
    });
  });

  it.each([
    ["extra key", (value: Record<string, unknown>) => { value.order = true; }],
    ["wrong strategy", (value: Record<string, unknown>) => {
      value.strategy_version = "2.0.0";
    }],
    ["bad chunk", (value: Record<string, unknown>) => {
      value.chunk_index = 1;
    }],
    ["bad kind", (value: Record<string, unknown>) => {
      value.kind = "delta";
    }],
    ["zero sequence", (value: Record<string, unknown>) => {
      value.sequence = 0;
    }],
    ["fractional sequence", (value: Record<string, unknown>) => {
      value.sequence = 1.5;
    }],
    ["idempotency mismatch", (value: Record<string, unknown>) => {
      value.idempotency_key = "pine-v3-lab:2:incremental:1721808300:0";
    }],
    ["corrupt producer identifier", (value: Record<string, unknown>) => {
      value.producer_instance_id = "pine\\v3";
      value.idempotency_key = "pine\\v3:1:incremental:1721808300:0";
    }],
    ["zero detector hash", (value: Record<string, unknown>) => {
      value.detector_code_hash = "0".repeat(64);
    }],
    ["uppercase detector hash", (value: Record<string, unknown>) => {
      value.detector_code_hash = "A".repeat(64);
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
    ["re-entry attempt", (value: Record<string, unknown>) => {
      facts(value).ak = "RE_ENTRY";
    }],
    ["ineligible pre-start setup", (value: Record<string, unknown>) => {
      facts(value).et = false;
    }],
    ["paper field", (value: Record<string, unknown>) => {
      value.paper_commands = [];
    }],
    ["producer candidate hash", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      (bundle(value).c as Record<string, unknown>[])[0]!.candidate_id = digest;
    }],
    ["producer transcript hash", (value: Record<string, unknown>) => {
      facts(value).x = [transcript(1_721_808_300)];
      (facts(value).x as Record<string, unknown>[])[0]!.transcript_sha256 =
        digest;
    }],
  ])("rejects %s", async (_name, mutate) => {
    const value = payload();
    mutate(value);
    await expect(validateEntryV2Payload(strict(value))).rejects.toBeInstanceOf(
      EntryV2ValidationError,
    );
  });

  it("rejects an unsafe integer token before wire expansion", async () => {
    const value = payload();
    value.sequence = 9_007_199_254_740_992;
    await expect(async () => validateEntryV2Payload(strict(value))).rejects
      .toThrow("unsafe JSON integer");
  });

  it.each(["snapshot", "incremental"] as const)(
    "accepts the closed %s batch kind",
    async (kind) => {
      const value = payload();
      value.kind = kind;
      value.idempotency_key =
        `pine-v3-lab:1:${kind}:1721808300:0`;
      await expect(validateEntryV2Payload(strict(value))).resolves.toBeDefined();
    },
  );

  it("attaches one transcript only to its emitted containing bar", async () => {
    const value = payload();
    addPreviousBar(value);
    facts(value).ge = 1_721_808_010;
    facts(value).x = [transcript(1_721_808_000)];

    const parsed = await validateEntryV2Payload(strict(value));

    expect(parsed.entryBatches[0]!.retainedContext).toHaveLength(1);
    expect(
      parsed.entryBatches[0]!.retainedContext[0]!.setup.zone_engaged_epoch,
    ).toBe(1_721_808_010);
    expect(parsed.entryBatches[0]!.retainedContext[0]!.htf_proofs).toHaveLength(
      1,
    );
    expect(parsed.entryBatches[0]!.events).toHaveLength(1);
    expect(parsed.entryBatches[0]!.events[0]!.htf_proofs).toHaveLength(0);
  });

  it.each([
    [
      "orphan cutoff",
      (value: Record<string, unknown>) => {
        facts(value).x = [transcript(1_721_807_940)];
      },
      "HTF_TRANSCRIPT_WITHOUT_EMITTED_BAR",
    ],
    [
      "coverage/cutoff mismatch",
      (value: Record<string, unknown>) => {
        facts(value).x = [transcript(1_721_808_300)];
        (facts(value).x as Record<string, unknown>[])[0]!.ce = 1_721_808_240;
      },
      "HTF_TRANSCRIPT_COVERAGE_CUTOFF_MISMATCH",
    ],
    [
      "non-Pine replay resolution",
      (value: Record<string, unknown>) => {
        facts(value).x = [transcript(1_721_808_300)];
        (facts(value).x as Record<string, unknown>[])[0]!.rs = 30;
      },
      "ENTRY_HTF_PROOF_RESOLUTION",
    ],
    [
      "unsorted context",
      (value: Record<string, unknown>) => {
        const shorter = transcript(1_721_808_300);
        shorter.m = 30;
        const longer = transcript(1_721_808_300);
        longer.m = 15;
        facts(value).x = [shorter, longer];
      },
      "ENTRY_HTF_CONTEXT_ORDER",
    ],
    [
      "contradictory gap",
      (value: Record<string, unknown>) => {
        const proof = transcript(1_721_808_300);
        proof.oc = 19;
        facts(value).x = [proof];
      },
      "ENTRY_HTF_COVERAGE_GAP",
    ],
  ])("rejects transcript %s", async (_name, mutate, code) => {
    const value = payload();
    mutate(value);
    await expect(validateEntryV2Payload(strict(value))).rejects.toThrow(code);
  });

  it("keeps a matched transcript unresolved when destination was seen first", async () => {
    const value = payload();
    addPreviousBar(value);
    const proof = matchedTranscript();
    proof.db = true;
    facts(value).x = [proof];

    const parsed = await validateEntryV2Payload(strict(value));
    const expanded =
      parsed.entryBatches[0]!.retainedContext[0]!.htf_proofs[0]!;

    expect(expanded).toMatchObject({
      matched: true,
      fidelity: "UNRESOLVED",
      destination_seen_before_contact: true,
    });

    const evaluation = await evaluateEntryStream(
      [
        {
          event_id: "destination-first",
          match_request: parsed.entryBatches[0]!.retainedContext[0]!,
        },
      ],
      false,
      1,
      1_721_808_000,
    );
    expect(evaluation.evidence[0]?.failed_rule_ids).toContain(
      "ENTRY_HTF_ZONE_SIDE_FIRST",
    );
  });
});

describe("schema 2.0 exact bounds and chronology", () => {
  const limitCases: readonly [
    string,
    number,
    (value: Record<string, unknown>, count: number) => void,
  ][] = [
    ["chunks", MAX_ENTRY_CHUNKS + 1, (value, count) => {
      value.chunk_count = count;
    }],
    ["bars", MAX_ENTRY_BARS_PER_SETUP + 1, (value, count) => {
      const original = bars(value)[0]!;
      facts(value).b = Array.from({ length: count }, (_unused, index) => ({
        ...original,
        oe: 1_721_808_000 - (count - index - 1) * 300,
        ce: 1_721_808_300 - (count - index - 1) * 300,
      }));
    }],
    ["setups", MAX_ENTRY_SETUPS_PER_BATCH + 1, (value, count) => {
      const original = bundle(value);
      value.eb = Array.from({ length: count }, (_unused, index) => ({
        ...structuredClone(original),
        s: `setup-${index}`,
      }));
    }],
    ["candidates", MAX_ENTRY_CANDIDATES_PER_SETUP + 1, (value, count) => {
      addConfirmedDiagnostic(value);
      const original = (bundle(value).c as Record<string, unknown>[])[0]!;
      bundle(value).c = Array.from({ length: count }, (_unused, index) => ({
        ...original,
        i: index,
        a: 1_721_808_000 + index,
      }));
      bundle(value).e = [];
      bundle(value).h = [];
      bundle(value).q = null;
    }],
    ["handling", MAX_ENTRY_HANDLING_PER_SETUP + 1, (value, count) => {
      addConfirmedDiagnostic(value);
      const original = (bundle(value).h as Record<string, unknown>[])[0]!;
      bundle(value).h = Array.from({ length: count }, () => ({
        ...original,
      }));
      bundle(value).q = null;
    }],
  ];

  it.each(limitCases)("rejects more than the maximum %s", async (
    _name,
    count,
    mutate,
  ) => {
    const value = payload();
    mutate(value, count);
    await expect(validateEntryV2Payload(strict(value))).rejects.toBeInstanceOf(
      EntryV2ValidationError,
    );
  });

  it("accepts the exact setup, bar, candidate, evidence, and handling maxima", async () => {
    const value = payload();
    const originalBar = bars(value)[0]!;
    facts(value).b = Array.from(
      { length: MAX_ENTRY_BARS_PER_SETUP },
      (_unused, index) => ({
        ...originalBar,
        oe:
          1_721_808_000 -
          (MAX_ENTRY_BARS_PER_SETUP - index - 1) * 300,
        ce:
          1_721_808_300 -
          (MAX_ENTRY_BARS_PER_SETUP - index - 1) * 300,
        o: 99,
        h: 100,
        l: 95,
        c: 99,
      }),
    );
    const originalBundle = bundle(value);
    value.eb = Array.from(
      { length: MAX_ENTRY_SETUPS_PER_BATCH },
      (_unused, index) => ({
        ...structuredClone(originalBundle),
        s: `setup-${index}`,
      }),
    );

    await expect(validateEntryV2Payload(strict(value))).resolves.toBeDefined();
  });

  it("rejects a gap, overlap, reverse order, and a top-level bar mismatch", async () => {
    const mutations: ((value: Record<string, unknown>) => void)[] = [
      (value) => {
        addPreviousBar(value);
        bars(value)[1]!.oe = 1_721_808_060;
      },
      (value) => {
        addPreviousBar(value);
        bars(value)[1]!.oe = 1_721_807_940;
      },
      (value) => {
        addPreviousBar(value);
        facts(value).b = [...bars(value)].reverse();
      },
      (value) => {
        value.bar_open_epoch = 1_721_807_700;
      },
    ];
    for (const mutate of mutations) {
      const value = payload();
      mutate(value);
      await expect(validateEntryV2Payload(strict(value))).rejects.toBeInstanceOf(
        EntryV2ValidationError,
      );
    }
  });

  it("rejects more than four evidence rows for one candidate and sixteen total", async () => {
    const perCandidate = payload();
    addConfirmedDiagnostic(perCandidate);
    const evidence = (bundle(perCandidate).e as Record<string, unknown>[])[0]!;
    bundle(perCandidate).e = Array.from(
      { length: MAX_ENTRY_EVIDENCE_PER_CANDIDATE + 1 },
      (_unused, index) => ({
        ...evidence,
        i: index,
        cs: 1_721_808_000 - index * 300,
        ce: 1_721_808_300 - index * 300,
        t: 1_721_808_300 - index * 300,
      }),
    );
    bundle(perCandidate).h = [];
    bundle(perCandidate).q = null;
    await expect(
      validateEntryV2Payload(strict(perCandidate)),
    ).rejects.toBeInstanceOf(EntryV2ValidationError);

    const total = payload();
    const setupBundle = bundle(total);
    setupBundle.c = Array.from(
      { length: MAX_ENTRY_CANDIDATES_PER_SETUP },
      (_unused, index) => ({
        i: index,
        m: "DIR_CLOSE",
        st: "MATCHED",
        a: 1_721_807_000 + index,
        o: 1,
        n: null,
        sc: [...SOURCE_CLAIMS.DIR_CLOSE],
      }),
    );
    setupBundle.e = Array.from(
      { length: MAX_ENTRY_EVIDENCE_PER_SETUP + 1 },
      (_unused, index) => ({
        i: index,
        ci: index % MAX_ENTRY_CANDIDATES_PER_SETUP,
        t: 1_721_808_300,
        px: 103,
        h: [],
        f: "EXACT",
        p: "CONFIRMED_5M",
        r: 300,
        cs: 1_721_808_000,
        ce: 1_721_808_300,
        ac: [],
        pr: ["ENTRY_DIR_CLOSE"],
        fr: [],
        sc: [...SOURCE_CLAIMS.DIR_CLOSE],
      }),
    );
    setupBundle.h = [];
    await expect(validateEntryV2Payload(strict(total))).rejects.toBeInstanceOf(
      EntryV2ValidationError,
    );
  });
});

describe("schema 2.0 producer diagnostics", () => {
  it("normalizes dense local references to semantic candidate tuples", async () => {
    const value = payload();
    addConfirmedDiagnostic(value);

    const parsed = await validateEntryV2Payload(strict(value));
    const diagnostic = parsed.entryBatches[0]!.producerDiagnostic;

    expect(diagnostic.candidates[0]).toEqual({
      model: "DIR_CLOSE",
      state: "MATCHED",
      event_anchor_epoch: 1_721_808_000,
      trigger_ordinal: 1,
      normalized_from: null,
      source_claim_ids: SOURCE_CLAIMS.DIR_CLOSE,
    });
    expect(diagnostic.evidence[0]!.candidate).toBe(
      diagnostic.candidates[0],
    );
    expect(diagnostic.handling[0]!.candidate).toBe(
      diagnostic.candidates[0],
    );
    expect(diagnostic.handling[0]!.evidence).toBe(
      diagnostic.evidence[0],
    );
    expect(diagnostic.selection).toEqual({
      version: "PINE_DIAGNOSTIC_ONLY",
      semantic_key: "DIR_CLOSE:1721808000:1",
      model: "DIR_CLOSE",
      event_anchor_epoch: 1_721_808_000,
      trigger_ordinal: 1,
      reason: "ONLY_EXACT_TRIGGER",
      fidelity: "EXACT",
      action: "SHADOW_ONLY",
    });
  });

  it.each([
    ["non-dense candidate", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      (bundle(value).c as Record<string, unknown>[])[0]!.i = 1;
    }],
    ["duplicate candidate index", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      const candidate = (bundle(value).c as Record<string, unknown>[])[0]!;
      bundle(value).c = [candidate, { ...candidate }];
    }],
    ["non-dense evidence", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      (bundle(value).e as Record<string, unknown>[])[0]!.i = 2;
    }],
    ["duplicate semantic evidence", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      const evidence = (bundle(value).e as Record<string, unknown>[])[0]!;
      bundle(value).e = [evidence, { ...evidence, i: 1 }];
      bundle(value).h = [];
      bundle(value).q = null;
    }],
    ["missing candidate", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      (bundle(value).e as Record<string, unknown>[])[0]!.ci = 1;
    }],
    ["handling/evidence candidate mismatch", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      const candidate = (bundle(value).c as Record<string, unknown>[])[0]!;
      bundle(value).c = [
        candidate,
        {
          ...candidate,
          i: 1,
          a: 1_721_807_700,
        },
      ];
      (bundle(value).h as Record<string, unknown>[])[0]!.ci = 1;
      bundle(value).q = null;
    }],
    ["duplicate semantic handling", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      const handling = (bundle(value).h as Record<string, unknown>[])[0]!;
      bundle(value).h = [handling, { ...handling }];
      bundle(value).q = null;
    }],
    ["unknown claim", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      (bundle(value).c as Record<string, unknown>[])[0]!.sc = [
        "youtube:invented",
      ];
    }],
    ["wrong model claim tuple", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      (bundle(value).c as Record<string, unknown>[])[0]!.sc = [
        ...SOURCE_CLAIMS.HTF_FLIP,
      ];
    }],
    ["duplicate source claim", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      const claims = (bundle(value).c as Record<string, unknown>[])[0]!
        .sc as string[];
      claims.push(claims[0]!);
    }],
    ["ordinal zero", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      (bundle(value).c as Record<string, unknown>[])[0]!.o = 0;
    }],
    ["ordinal two", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      (bundle(value).c as Record<string, unknown>[])[0]!.o = 2;
    }],
    ["selection ordinal two", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      (bundle(value).q as Record<string, unknown>).o = 2;
      (bundle(value).q as Record<string, unknown>).k =
        "DIR_CLOSE:1721808000:2";
    }],
    ["selection key mismatch", (value: Record<string, unknown>) => {
      addConfirmedDiagnostic(value);
      (bundle(value).q as Record<string, unknown>).k = "setup-1";
    }],
  ])("rejects %s", async (_name, mutate) => {
    const value = payload();
    mutate(value);
    await expect(validateEntryV2Payload(strict(value))).rejects.toBeInstanceOf(
      EntryV2ValidationError,
    );
  });

  it("segregates realtime evidence and never lets it supply a selection", async () => {
    const value = payload();
    addRealtimeDiagnostic(value);

    const parsed = await validateEntryV2Payload(strict(value));
    const diagnostic = parsed.entryBatches[0]!.producerDiagnostic;

    expect(diagnostic.evidence).toHaveLength(1);
    expect(diagnostic.realtime_evidence).toHaveLength(1);
    expect(diagnostic.realtime_evidence[0]).toMatchObject({
      fidelity: "UNRESOLVED",
      proof_plane: "REALTIME_TICK",
      proof_resolution_seconds: 0,
      ambiguity_codes: ["SHADOW_REALTIME_ONLY_NOT_REPLAYABLE"],
    });

    const realtimeOnly = payload();
    addRealtimeDiagnostic(realtimeOnly);
    bundle(realtimeOnly).e = [
      (bundle(realtimeOnly).e as Record<string, unknown>[])[1]!,
    ];
    (bundle(realtimeOnly).e as Record<string, unknown>[])[0]!.i = 0;
    bundle(realtimeOnly).h = [];
    await expect(
      validateEntryV2Payload(strict(realtimeOnly)),
    ).rejects.toThrow("ENTRY_REALTIME_SELECTION_REFERENCE");
  });

  it("never lets realtime diagnostics create backend candidates or evidence", async () => {
    const value = payload();
    bars(value)[0]!.h = 100;
    bars(value)[0]!.c = 99;
    addRealtimeDiagnostic(value);
    bundle(value).e = [
      (bundle(value).e as Record<string, unknown>[])[1]!,
    ];
    (bundle(value).e as Record<string, unknown>[])[0]!.i = 0;
    bundle(value).h = [];
    bundle(value).q = null;

    const parsed = await validateEntryV2Payload(strict(value));
    const producer = parsed.entryBatches[0]!.producerDiagnostic;
    const backend = await evaluateEntryStream(
      [
        {
          event_id: "realtime-does-not-create",
          match_request: parsed.entryBatches[0]!.events[0]!,
        },
      ],
      false,
      1,
      1_721_808_300,
    );

    expect(producer.candidates).toHaveLength(1);
    expect(producer.realtime_evidence).toHaveLength(1);
    expect(backend.candidates).toEqual([]);
    expect(backend.evidence).toEqual([]);
    expect(backend.handling).toEqual([]);
    expect(backend.selection).toMatchObject({
      canonical_candidate_id: null,
      canonical_evidence_id: null,
      action: "NONE",
      reason: "NO_CANDIDATE",
    });
  });

  it("requires the server-owned HTF source-claim tuple order", async () => {
    const value = payload();
    addUnbackedHtfDiagnostic(value);
    const evidence = (bundle(value).e as Record<string, unknown>[])[0]!;
    evidence.sc = [...SOURCE_CLAIMS.HTF_FLIP].reverse();

    await expect(validateEntryV2Payload(strict(value))).rejects.toThrow(
      "ENTRY_DIAGNOSTIC_SOURCE_CLAIMS",
    );
  });

  it("rejects duplicate evidence hidden behind source-claim permutations", async () => {
    const value = payload();
    addUnbackedHtfDiagnostic(value);
    const evidence = (bundle(value).e as Record<string, unknown>[])[0]!;
    bundle(value).e = [
      evidence,
      {
        ...evidence,
        i: 1,
        sc: [...SOURCE_CLAIMS.HTF_FLIP].reverse(),
      },
    ];

    await expect(validateEntryV2Payload(strict(value))).rejects.toBeInstanceOf(
      EntryV2ValidationError,
    );
  });

  it("requires the canonical HTF failed-rule tuple order", async () => {
    const value = payload();
    addUnbackedHtfDiagnostic(value);
    const evidence = (bundle(value).e as Record<string, unknown>[])[0]!;
    evidence.fr = [
      "ENTRY_HTF_ZONE_SIDE_FIRST",
      "ENTRY_HTF_FLIP",
    ];

    await expect(validateEntryV2Payload(strict(value))).rejects.toThrow(
      "ENTRY_DIAGNOSTIC_HTF_EVIDENCE",
    );
  });

  it("rejects duplicate evidence hidden behind failed-rule permutations", async () => {
    const value = payload();
    addUnbackedHtfDiagnostic(value);
    const evidence = (bundle(value).e as Record<string, unknown>[])[0]!;
    bundle(value).e = [
      {
        ...evidence,
        fr: ["ENTRY_HTF_FLIP", "ENTRY_HTF_ZONE_SIDE_FIRST"],
      },
      {
        ...evidence,
        i: 1,
        fr: ["ENTRY_HTF_ZONE_SIDE_FIRST", "ENTRY_HTF_FLIP"],
      },
    ];

    await expect(validateEntryV2Payload(strict(value))).rejects.toBeInstanceOf(
      EntryV2ValidationError,
    );
  });

  it.each([
    ["missing ambiguity", (row: Record<string, unknown>) => { row.ac = []; }],
    ["nullable epoch", (row: Record<string, unknown>) => { row.t = null; }],
    ["nullable ticks", (row: Record<string, unknown>) => { row.px = null; }],
    ["exact fidelity", (row: Record<string, unknown>) => { row.f = "EXACT"; }],
    ["replay resolution", (row: Record<string, unknown>) => { row.r = 60; }],
    ["coverage interval", (row: Record<string, unknown>) => {
      row.cs = 1_721_808_200;
    }],
  ])("rejects realtime evidence with %s", async (_name, mutate) => {
    const value = payload();
    addRealtimeDiagnostic(value);
    const row = (bundle(value).e as Record<string, unknown>[])[1]!;
    mutate(row);
    await expect(validateEntryV2Payload(strict(value))).rejects.toBeInstanceOf(
      EntryV2ValidationError,
    );
  });
});

describe("schema 2.0 terminal grace", () => {
  it("derives exactly one Plan 1-shaped handling-only grace event", async () => {
    const value = payload();
    addTerminalGrace(value);

    const parsed = await validateEntryV2Payload(strict(value));
    const entry = parsed.entryBatches[0]!;
    const terminal = entry.events[0]!;
    const grace = entry.events[1]!;
    const expectedGrace: EntryMatchRequest = {
      setup: terminal.setup,
      confirmed_bar: {
        open_epoch: 1_721_808_300,
        close_epoch: 1_721_808_600,
        open_ticks: 103,
        high_ticks: 104,
        low_ticks: 98,
        close_ticks: 102,
      },
      htf_proofs: [],
      generic_break_detected: false,
      rejection_respect_detected: false,
      attempt_kind: "INITIAL",
      trigger_ordinal: 1,
    };

    expect(canonicalStringifyRdEntry(grace)).toBe(
      canonicalStringifyRdEntry(expectedGrace),
    );

    const normalEvents = [...entry.retainedContext, terminal];
    const before = await evaluateEntryStream(
      await Promise.all(
        normalEvents.map(async (match_request) => ({
          event_id: await canonicalSha256(match_request),
          match_request,
        })),
      ),
      false,
      1,
      1_721_808_300,
    );
    const after = await evaluateEntryStream(
      await Promise.all(
        [...normalEvents, grace].map(async (match_request) => ({
          event_id: await canonicalSha256(match_request),
          match_request,
        })),
      ),
      false,
      1,
      1_721_808_600,
    );
    expect(after.candidates).toEqual(before.candidates);
    expect(after.evidence).toEqual(before.evidence);
    expect(after.selection).toMatchObject({
      canonical_candidate_id: before.selection.canonical_candidate_id,
      canonical_evidence_id: before.selection.canonical_evidence_id,
      canonical_model: before.selection.canonical_model,
      reason: before.selection.reason,
      fidelity: before.selection.fidelity,
      action: before.selection.action,
    });
    expect(after.handling).toHaveLength(before.handling.length + 1);
    expect(after.handling).toContainEqual(
      expect.objectContaining({
        handling_mode: "NEXT_CANDLE_WICK",
        attempt_kind: "INITIAL",
        observed_epoch: 1_721_808_600,
        observed_ticks: 98,
      }),
    );
  });

  it("treats retained pre-engagement HTF as provisional non-authority", async () => {
    const value = payload();
    addTerminalGrace(value);
    facts(value).ge = 1_721_808_010;

    const parsed = await validateEntryV2Payload(strict(value));

    expect(parsed.entryBatches[0]!.retainedContext).toHaveLength(1);
    expect(parsed.entryBatches[0]!.events).toHaveLength(2);
  });

  it("treats local absence as provisional for either iv claim", async () => {
    const value = payload();
    facts(value).tr = "INVALIDATED";
    facts(value).te = 1_721_808_300;
    facts(value).iv = true;
    addBlockedRealtimeDirCloseDiagnostic(value);

    await expect(validateEntryV2Payload(strict(value))).resolves.toBeDefined();

    facts(value).iv = false;
    await expect(validateEntryV2Payload(strict(value))).resolves.toBeDefined();
  });

  it("rejects iv=true when local raw facts contain an active model", async () => {
    const value = payload();
    addPreviousBar(value);
    facts(value).x = [matchedTranscript()];
    facts(value).tr = "INVALIDATED";
    facts(value).te = 1_721_808_300;
    facts(value).iv = false;

    await expect(validateEntryV2Payload(strict(value))).resolves.toBeDefined();

    facts(value).iv = true;
    await expect(validateEntryV2Payload(strict(value))).rejects.toThrow(
      "ENTRY_INVALIDATED_FACT",
    );
  });

  it("allows rolled-out DIR_CLOSE history to provisionally explain iv=false", async () => {
    const value = payload();
    facts(value).ge = 1_721_807_100;
    facts(value).b = Array.from({ length: 4 }, (_unused, index) => ({
      oe: 1_721_807_100 + index * 300,
      ce: 1_721_807_400 + index * 300,
      o: 99,
      h: 100,
      l: 95,
      c: 99,
      gb: false,
      rr: false,
    }));
    facts(value).tr = "INVALIDATED";
    facts(value).te = 1_721_808_300;
    facts(value).iv = false;

    await expect(validateEntryV2Payload(strict(value))).resolves.toBeDefined();
  });

  it("allows rolled-out HTF history to provisionally explain BOTH/grace", async () => {
    const value = payload();
    facts(value).ge = 1_721_807_100;
    facts(value).b = Array.from({ length: 4 }, (_unused, index) => ({
      oe: 1_721_807_100 + index * 300,
      ce: 1_721_807_400 + index * 300,
      o: 99,
      h: index === 3 ? 105 : 100,
      l: 95,
      c: index === 3 ? 103 : 99,
      gb: false,
      rr: false,
    }));
    facts(value).tr = "BOTH_ACTIVE_MODELS_OBSERVED";
    facts(value).te = 1_721_808_300;
    facts(value).ng = {
      oe: 1_721_808_300,
      ce: 1_721_808_600,
      o: 103,
      h: 104,
      l: 98,
      c: 102,
      ak: "INITIAL",
    };

    const parsed = await validateEntryV2Payload(strict(value));

    expect(parsed.entryBatches[0]!.retainedContext).toHaveLength(3);
    expect(parsed.entryBatches[0]!.events).toHaveLength(2);
  });

  it("rejects same-event BOTH even without a grace bar", async () => {
    const value = payload();
    const currentProof = matchedTranscript(1_721_808_300);
    currentProof.cc = {
      oe: 1_721_808_000,
      ce: 1_721_808_060,
      o: 95,
      h: 98,
      l: 89,
      c: 96,
    };
    currentProof.rc = {
      oe: 1_721_808_060,
      ce: 1_721_808_120,
      o: 96,
      h: 101,
      l: 94,
      c: 100,
    };
    facts(value).x = [currentProof];
    facts(value).tr = "BOTH_ACTIVE_MODELS_OBSERVED";
    facts(value).te = 1_721_808_300;

    await expect(validateEntryV2Payload(strict(value))).rejects.toThrow(
      "ENTRY_TERMINAL_GRACE_TRANSITION",
    );
  });

  it.each([
    ["missing ng key", (value: Record<string, unknown>) => {
      addTerminalGrace(value);
      delete (facts(value).ng as Record<string, unknown>).ak;
    }],
    ["extra ng key", (value: Record<string, unknown>) => {
      addTerminalGrace(value);
      (facts(value).ng as Record<string, unknown>).again = true;
    }],
    ["wrong open", (value: Record<string, unknown>) => {
      addTerminalGrace(value);
      (facts(value).ng as Record<string, unknown>).oe = 1_721_808_301;
    }],
    ["wrong duration", (value: Record<string, unknown>) => {
      addTerminalGrace(value);
      (facts(value).ng as Record<string, unknown>).ce = 1_721_808_599;
    }],
    ["wrong attempt", (value: Record<string, unknown>) => {
      addTerminalGrace(value);
      (facts(value).ng as Record<string, unknown>).ak = "RE_ENTRY";
    }],
    ["invalid OHLC", (value: Record<string, unknown>) => {
      addTerminalGrace(value);
      (facts(value).ng as Record<string, unknown>).h = 100;
    }],
    ["grace on invalidation", (value: Record<string, unknown>) => {
      addTerminalGrace(value);
      facts(value).tr = "INVALIDATED";
    }],
    ["grace on retention", (value: Record<string, unknown>) => {
      addTerminalGrace(value);
      facts(value).tr = "RETENTION_EVICTED";
    }],
    ["same-event BOTH", (value: Record<string, unknown>) => {
      addTerminalGrace(value);
      facts(value).x = [matchedTranscript(1_721_808_300)];
    }],
    ["BOTH completed only by HTF", (value: Record<string, unknown>) => {
      addTerminalGrace(value);
      bars(value)[1]!.c = 99;
      bars(value)[1]!.h = 100;
    }],
    ["second grace represented as a confirmed bar", (value: Record<string, unknown>) => {
      addTerminalGrace(value);
      facts(value).b = [
        ...bars(value),
        {
          oe: 1_721_808_300,
          ce: 1_721_808_600,
          o: 103,
          h: 104,
          l: 98,
          c: 102,
          gb: false,
          rr: false,
        },
      ];
      value.bar_open_epoch = 1_721_808_300;
      value.bar_close_epoch = 1_721_808_600;
      value.idempotency_key =
        "pine-v3-lab:1:incremental:1721808600:0";
    }],
  ])("rejects %s", async (_name, mutate) => {
    const value = payload();
    mutate(value);
    await expect(validateEntryV2Payload(strict(value))).rejects.toBeInstanceOf(
      EntryV2ValidationError,
    );
  });
});

describe("schema 2.0 message size", () => {
  it("accepts 34,999 characters and rejects 35,000", () => {
    const envelope = JSON.stringify({
      credential: "edge-test-secret",
      payload: payload(),
    });
    const accepted = envelope.padEnd(
      ENTRY_V2_MAX_MESSAGE_CHARACTERS - 1,
      " ",
    );
    const rejected = envelope.padEnd(ENTRY_V2_MAX_MESSAGE_CHARACTERS, " ");

    expect(() => validateEntryV2BodySize(encoder.encode(accepted))).not.toThrow();
    expect(() => validateEntryV2BodySize(encoder.encode(rejected))).toThrow(
      "ENTRY_V2_MESSAGE_TOO_LARGE",
    );
  });

  it("counts decoded characters rather than UTF-8 bytes", () => {
    const prefix = "€".repeat(10);
    const value = `${prefix}${" ".repeat(
      ENTRY_V2_MAX_MESSAGE_CHARACTERS - prefix.length - 1,
    )}`;

    expect(encoder.encode(value).byteLength).toBeGreaterThan(
      ENTRY_V2_MAX_MESSAGE_CHARACTERS,
    );
    expect(() => validateEntryV2BodySize(encoder.encode(value))).not.toThrow();
  });
});
