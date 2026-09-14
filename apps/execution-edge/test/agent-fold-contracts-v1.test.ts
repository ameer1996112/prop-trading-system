import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateJsonSchemaPayload } from "./support/broker-reconstruction-fixture";

const root = new URL("../../../", import.meta.url);
const D = (digit: string): string => digit.repeat(64);

function schema(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`contracts/schema/${file}`, root), "utf8")) as Record<string, unknown>;
}

type EventFixture = Readonly<{
  schema_version: "AgentEventV1";
  event_id: string;
  installation_id: string;
  account_id: string;
  account_profile_sha256: string;
  safety_epoch: number;
  sequence: number;
  observed_at_epoch: number;
  kind: string;
  body_sha256: string;
  fact: Record<string, unknown>;
}>;

function event(
  sequence: number,
  kind: string,
  fact: Record<string, unknown>,
): EventFixture {
  return {
    schema_version: "AgentEventV1",
    event_id: `event-${sequence}`,
    installation_id: "installation-1",
    account_id: "account-demo-1",
    account_profile_sha256: D("4"),
    safety_epoch: 7,
    sequence,
    observed_at_epoch: 1_787_472_000 + sequence,
    kind,
    body_sha256: D("d"),
    fact,
  };
}

const attribution = {
  attribution_state: "ATTRIBUTED",
  command_id: "command-1",
  broker_request_id: "request-1",
};

const events = [
  event(1, "HEARTBEAT", {
    terminal_connection_state: "CONNECTED",
    account_trade_permission: "DENIED",
    terminal_trade_permission: "DENIED",
    algo_trading_permission: "DENIED",
    broker_time_epoch: 1_787_472_001,
    windows_time_epoch: 1_787_472_001,
  }),
  event(2, "TERMINAL_STATE", {
    terminal_build: 4410,
    ea_sha256: D("a"),
    manifest_sha256: D("b"),
    account_fingerprint_sha256: D("8"),
    terminal_connection_state: "CONNECTED",
    account_trade_permission: "DENIED",
    terminal_trade_permission: "DENIED",
    algo_trading_permission: "DENIED",
  }),
  event(3, "SUBMIT_STATE", {
    command_id: "command-1",
    lease_id: "lease-1",
    reservation_id: "reservation-1",
    broker_request_id: "request-1",
    state: "JOURNALED",
    requested_volume_steps: 10,
    filled_volume_steps: 0,
    residual_volume_steps: 10,
    broker_order_tickets: [],
    acknowledgement_code: null,
  }),
  event(4, "SUBMIT_STATE", {
    command_id: "command-1",
    lease_id: "lease-1",
    reservation_id: "reservation-1",
    broker_request_id: "request-1",
    state: "ACK_UNKNOWN",
    requested_volume_steps: 10,
    filled_volume_steps: 0,
    residual_volume_steps: 10,
    broker_order_tickets: [7001],
    acknowledgement_code: null,
  }),
  event(5, "ORDER_STATE", {
    order_ticket: 7001,
    ...attribution,
    state: "PARTIALLY_FILLED",
    direction: "LONG",
    broker_symbol: "EURUSD",
    requested_volume_steps: 10,
    filled_volume_steps: 6,
    residual_volume_steps: 4,
    entry_price_ticks: 110000,
    stop_ticks: 109800,
    target_ticks: 110800,
  }),
  event(6, "DEAL_STATE", {
    deal_id: "deal-1",
    order_ticket: 7001,
    position_ticket: 8001,
    ...attribution,
    role: "ENTRY",
    direction: "LONG",
    volume_steps: 3,
    price_ticks: 109990,
    commission_minor_units: -25,
  }),
  event(7, "DEAL_STATE", {
    deal_id: "deal-2",
    order_ticket: 7001,
    position_ticket: 8001,
    ...attribution,
    role: "ENTRY",
    direction: "LONG",
    volume_steps: 3,
    price_ticks: 110010,
    commission_minor_units: -25,
  }),
  event(8, "POSITION_STATE", {
    position_ticket: 8001,
    ...attribution,
    state: "PARTIAL",
    direction: "LONG",
    volume_steps: 6,
    weighted_fill_price_ticks: 110000,
    deal_ids: ["deal-1", "deal-2"],
  }),
  event(9, "PROTECTION_STATE", {
    position_ticket: 8001,
    ...attribution,
    state: "VERIFIED",
    protected_volume_steps: 6,
    stop_ticks: 109800,
    target_ticks: 110800,
  }),
  event(10, "CLOSE_ATTEMPT_STATE", {
    close_attempt_id: "close-1",
    position_ticket: 8001,
    ...attribution,
    state: "ACK_UNKNOWN",
    requested_volume_steps: 6,
    filled_volume_steps: 0,
    residual_volume_steps: 6,
    deal_ids: [],
  }),
  event(11, "UNATTRIBUTED_EXPOSURE_STATE", {
    exposure_id: "foreign-position-1",
    exposure_kind: "POSITION",
    broker_ticket: 9001,
    broker_symbol: "GBPJPY",
    direction: "SHORT",
    volume_steps: 2,
    price_ticks: null,
    pricing_state: "UNPRICED",
    modeled_loss_minor_units: null,
    protection_state: "UNKNOWN",
    state: "DISCOVERED",
  }),
  event(12, "RECONCILIATION_STATE", {
    watermark: "history-through-1787472000",
    previous_watermark: "history-through-1787471700",
    state: "UNKNOWN",
    reconciliation_sha256: D("7"),
    history_from_epoch: 1_787_471_700,
    history_to_epoch: 1_787_472_000,
    sweep_number: 2,
    consecutive_stable_sweeps: 0,
    order_tickets: [7001],
    deal_ids: ["deal-1", "deal-2"],
    position_tickets: [8001],
    unattributed_exposure_ids: ["foreign-position-1"],
  }),
] as const;

const accountSnapshot = {
  terminal_build: 4410,
  ea_sha256: D("a"),
  manifest_sha256: D("b"),
  account_fingerprint_sha256: D("8"),
  broker_time_epoch: 1_787_472_001,
  windows_time_epoch: 1_787_472_001,
  terminal_connection_state: "CONNECTED",
  account_trade_permission: "DENIED",
  terminal_trade_permission: "DENIED",
  algo_trading_permission: "DENIED",
  balance_minor_units: 10_000_000,
  equity_minor_units: 9_999_500,
  margin_minor_units: 100_000,
  free_margin_minor_units: 9_899_500,
  margin_level_bps: 99_995,
  symbols: [{
    source_symbol: "EURUSD",
    broker_symbol: "EURUSD",
    synchronization_state: "SYNCHRONIZED",
    selection_state: "SELECTED",
    capability_state: "CURRENT",
    symbol_capability_sha256: D("5"),
    trade_mode: "FULL",
    bid_ticks: 109999,
    ask_ticks: 110001,
    observed_at_epoch: 1_787_472_001,
  }],
  open_orders: [{
    order_ticket: 7001,
    ...attribution,
    state: "PARTIALLY_FILLED",
    direction: "LONG",
    broker_symbol: "EURUSD",
    requested_volume_steps: 10,
    filled_volume_steps: 6,
    residual_volume_steps: 4,
    entry_price_ticks: 110000,
    stop_ticks: 109800,
    target_ticks: 110800,
    protection_state: "VERIFIED",
  }],
  positions: [{
    position_ticket: 8001,
    ...attribution,
    state: "PARTIAL",
    direction: "LONG",
    broker_symbol: "EURUSD",
    volume_steps: 6,
    weighted_fill_price_ticks: 110000,
    stop_ticks: 109800,
    target_ticks: 110800,
    protection_state: "VERIFIED",
    deal_ids: ["deal-1", "deal-2"],
  }],
  reconciliation_watermark: {
    watermark: "history-through-1787472000",
    state: "STABLE",
    reconciliation_sha256: D("7"),
    history_through_epoch: 1_787_472_000,
    consecutive_stable_sweeps: 2,
  },
  observed_at_epoch: 1_787_472_001,
};

const request = {
  schema_version: "AgentSyncRequestV1",
  installation_id: "installation-1",
  account_id: "account-demo-1",
  account_profile_sha256: D("4"),
  safety_epoch: 7,
  request_sequence: 2,
  last_acknowledged_server_sequence: 1,
  nonce: "nonce-2",
  sent_at_epoch: 1_787_472_002,
  body_sha256: D("c"),
  account_snapshot: accountSnapshot,
  events,
  broker_bar_evidence: [],
};

function without(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const clone = structuredClone(value);
  delete clone[key];
  return clone;
}

describe("append-only agent fold and pre-command snapshot contracts", () => {
  it("accepts every non-lossy fold fact standalone and embedded in one sync request", () => {
    const eventSchema = schema("agent-event-v1.schema.json");
    for (const item of events) {
      expect(validateJsonSchemaPayload(eventSchema, item), item.kind).toEqual([]);
    }
    expect(validateJsonSchemaPayload(schema("agent-sync-request-v1.schema.json"), request)).toEqual([]);
  });

  it("reconstructs submit, order, multiple-deal, position, protection, close, and reconciliation folds", () => {
    type FoldState = {
      submit: Record<string, unknown>[];
      orders: Map<unknown, Record<string, unknown>>;
      deals: Map<unknown, Record<string, unknown>>;
      positions: Map<unknown, Record<string, unknown>>;
      protections: Map<unknown, Record<string, unknown>>;
      closeAttempts: Map<unknown, Record<string, unknown>>;
      unattributed: Map<unknown, Record<string, unknown>>;
      reconciliations: Record<string, unknown>[];
    };
    const folded = events.reduce<FoldState>((state, item) => {
      const fact = item.fact;
      if (item.kind === "SUBMIT_STATE") state.submit.push(fact);
      if (item.kind === "ORDER_STATE") state.orders.set(fact.order_ticket, fact);
      if (item.kind === "DEAL_STATE") state.deals.set(fact.deal_id, fact);
      if (item.kind === "POSITION_STATE") state.positions.set(fact.position_ticket, fact);
      if (item.kind === "PROTECTION_STATE") state.protections.set(fact.position_ticket, fact);
      if (item.kind === "CLOSE_ATTEMPT_STATE") state.closeAttempts.set(fact.close_attempt_id, fact);
      if (item.kind === "UNATTRIBUTED_EXPOSURE_STATE") state.unattributed.set(fact.exposure_id, fact);
      if (item.kind === "RECONCILIATION_STATE") state.reconciliations.push(fact);
      return state;
    }, {
      submit: [],
      orders: new Map<unknown, Record<string, unknown>>(),
      deals: new Map<unknown, Record<string, unknown>>(),
      positions: new Map<unknown, Record<string, unknown>>(),
      protections: new Map<unknown, Record<string, unknown>>(),
      closeAttempts: new Map<unknown, Record<string, unknown>>(),
      unattributed: new Map<unknown, Record<string, unknown>>(),
      reconciliations: [],
    });

    expect(folded.submit.map((fact) => fact.state)).toEqual(["JOURNALED", "ACK_UNKNOWN"]);
    expect(folded.orders.get(7001)).toMatchObject({ requested_volume_steps: 10, filled_volume_steps: 6, residual_volume_steps: 4 });
    expect([...folded.deals.values()].map((fact) => fact.deal_id)).toEqual(["deal-1", "deal-2"]);
    expect(folded.positions.get(8001)).toMatchObject({ state: "PARTIAL", volume_steps: 6, weighted_fill_price_ticks: 110000 });
    expect(folded.protections.get(8001)).toMatchObject({ state: "VERIFIED", protected_volume_steps: 6 });
    expect(folded.closeAttempts.get("close-1")).toMatchObject({ state: "ACK_UNKNOWN", residual_volume_steps: 6 });
    expect(folded.unattributed.get("foreign-position-1")).toMatchObject({ pricing_state: "UNPRICED", protection_state: "UNKNOWN" });
    expect(folded.reconciliations.at(-1)).toMatchObject({ state: "UNKNOWN", consecutive_stable_sweeps: 0 });
  });

  it.each([
    "terminal_build",
    "ea_sha256",
    "manifest_sha256",
    "account_fingerprint_sha256",
    "broker_time_epoch",
    "windows_time_epoch",
    "terminal_connection_state",
    "account_trade_permission",
    "terminal_trade_permission",
    "algo_trading_permission",
    "balance_minor_units",
    "equity_minor_units",
    "margin_minor_units",
    "free_margin_minor_units",
    "margin_level_bps",
    "symbols",
    "open_orders",
    "positions",
    "reconciliation_watermark",
    "observed_at_epoch",
  ])("rejects a sync snapshot missing pre-command input %s", (key) => {
    const invalid = { ...request, account_snapshot: without(accountSnapshot, key) };
    expect(validateJsonSchemaPayload(schema("agent-sync-request-v1.schema.json"), invalid)).not.toEqual([]);
  });

  it.each([
    ["symbol capability", { ...accountSnapshot, symbols: [without(accountSnapshot.symbols[0]!, "symbol_capability_sha256")] }],
    ["order residual volume", { ...accountSnapshot, open_orders: [without(accountSnapshot.open_orders[0]!, "residual_volume_steps")] }],
    ["position weighted fill", { ...accountSnapshot, positions: [without(accountSnapshot.positions[0]!, "weighted_fill_price_ticks")] }],
    ["position protection", { ...accountSnapshot, positions: [without(accountSnapshot.positions[0]!, "protection_state")] }],
    ["reconciliation stability", { ...accountSnapshot, reconciliation_watermark: without(accountSnapshot.reconciliation_watermark, "consecutive_stable_sweeps") }],
  ] as const)("rejects missing nested snapshot input: %s", (_name, snapshot) => {
    expect(validateJsonSchemaPayload(schema("agent-sync-request-v1.schema.json"), {
      ...request,
      account_snapshot: snapshot,
    })).not.toEqual([]);
  });

  it.each([
    [events[0], "broker_time_epoch"],
    [events[1], "ea_sha256"],
    [events[2], "requested_volume_steps"],
    [events[4], "residual_volume_steps"],
    [events[5], "deal_id"],
    [events[7], "weighted_fill_price_ticks"],
    [events[8], "state"],
    [events[9], "state"],
    [events[10], "pricing_state"],
    [events[11], "watermark"],
  ] as const)("rejects %s without required fact field %s", (item, key) => {
    const invalidEvent = { ...item, fact: without(item.fact, key) };
    expect(validateJsonSchemaPayload(schema("agent-event-v1.schema.json"), invalidEvent)).not.toEqual([]);
    expect(validateJsonSchemaPayload(schema("agent-sync-request-v1.schema.json"), {
      ...request,
      events: [invalidEvent],
    })).not.toEqual([]);
  });

  it("keeps snapshots and facts bounded, strict, and credential-free", () => {
    const parsed = schema("agent-sync-request-v1.schema.json");
    for (const invalid of [
      { ...request, bearer_token: "secret" },
      { ...request, account_snapshot: { ...accountSnapshot, account_password: "secret" } },
      { ...request, account_snapshot: { ...accountSnapshot, symbols: Array(6).fill(accountSnapshot.symbols[0]) } },
      { ...request, account_snapshot: { ...accountSnapshot, open_orders: Array(129).fill(accountSnapshot.open_orders[0]) } },
      { ...request, account_snapshot: { ...accountSnapshot, positions: Array(129).fill(accountSnapshot.positions[0]) } },
      { ...request, events: Array(257).fill(events[0]) },
    ]) {
      expect(validateJsonSchemaPayload(parsed, invalid)).not.toEqual([]);
    }
  });
});
