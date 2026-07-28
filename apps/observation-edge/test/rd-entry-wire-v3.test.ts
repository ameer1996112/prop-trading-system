import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  EntryV3ValidationError,
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
      epoch: 2100,
      sequence: 7,
      tick_price_ticks: 111,
      barstate_isconfirmed: true,
      confirmed_bar: {
        ...reference,
        open_epoch: 1800,
        close_epoch: 2100,
        open_ticks: 105,
        high_ticks: 112,
        low_ticks: 101,
        close_ticks: 111,
      },
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

describe("RD entry v3 wire", () => {
  it("accepts an exact strict BOC bundle", async () => {
    const result = await validateEntryV3Payload(strict(payload()));
    expect(result.entryBundles).toHaveLength(1);
    expect(result.entryBundles[0]!.evaluation.selection.action).toBe(
      "PAPER_ELIGIBLE",
    );
  });

  it("routes schema 3.0 through the entry-v3 observation union", async () => {
    const result = await validateObservationEnvelope(
      strict({ credential: "secret", payload: payload() }),
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
    await expect(validateEntryV3Payload(strict(value))).rejects.toBeInstanceOf(
      EntryV3ValidationError,
    );
  });
});
