#!/usr/bin/env node

import { writeFileSync } from "node:fs";

const identifier = { type: "string", minLength: 1, maxLength: 160, pattern: "^[!-\\[\\]-~]+$" };
const sha256 = {
  type: "string",
  pattern: "^[a-f0-9]{64}$",
  not: { const: "0".repeat(64) },
};
const nonnegativeSafeInteger = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const positiveSafeInteger = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const safeInteger = { type: "integer", minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER };
const direction = { enum: ["LONG", "SHORT"] };
const permission = { enum: ["ALLOWED", "DENIED", "UNKNOWN"] };
const terminalConnection = { enum: ["CONNECTED", "DISCONNECTED", "UNKNOWN"] };
const protectionState = { enum: ["REQUIRED", "VERIFIED", "MISSING_DEFINITE", "UNKNOWN", "BREACHED"] };

function ref(name) {
  return { $ref: `#/$defs/${name}` };
}

function nullable(value) {
  return { anyOf: [value, { type: "null" }] };
}

function array(items, maxItems, minItems = 0) {
  return { type: "array", minItems, maxItems, items };
}

function strictObject(required, properties, additions = {}) {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
    ...additions,
  };
}

const attributionRequired = ["attribution_state", "command_id", "broker_request_id"];
const attributionProperties = {
  attribution_state: { enum: ["ATTRIBUTED", "UNATTRIBUTED", "UNKNOWN"] },
  command_id: nullable(ref("identifier")),
  broker_request_id: nullable(ref("identifier")),
};
const attributionBranches = [
  {
    properties: {
      attribution_state: { const: "ATTRIBUTED" },
      command_id: ref("identifier"),
      broker_request_id: ref("identifier"),
    },
  },
  {
    properties: {
      attribution_state: { enum: ["UNATTRIBUTED", "UNKNOWN"] },
      command_id: { type: "null" },
      broker_request_id: { type: "null" },
    },
  },
];

const heartbeatFact = strictObject(
  [
    "terminal_connection_state",
    "account_trade_permission",
    "terminal_trade_permission",
    "algo_trading_permission",
    "broker_time_epoch",
    "windows_time_epoch",
  ],
  {
    terminal_connection_state: terminalConnection,
    account_trade_permission: permission,
    terminal_trade_permission: permission,
    algo_trading_permission: permission,
    broker_time_epoch: nullable(ref("nonnegativeSafeInteger")),
    windows_time_epoch: nullable(ref("nonnegativeSafeInteger")),
  },
);

const terminalStateFact = strictObject(
  [
    "terminal_build",
    "ea_sha256",
    "manifest_sha256",
    "account_fingerprint_sha256",
    "terminal_connection_state",
    "account_trade_permission",
    "terminal_trade_permission",
    "algo_trading_permission",
  ],
  {
    terminal_build: ref("positiveSafeInteger"),
    ea_sha256: ref("sha256"),
    manifest_sha256: ref("sha256"),
    account_fingerprint_sha256: ref("sha256"),
    terminal_connection_state: terminalConnection,
    account_trade_permission: permission,
    terminal_trade_permission: permission,
    algo_trading_permission: permission,
  },
);

const submitStateFact = strictObject(
  [
    "command_id",
    "lease_id",
    "reservation_id",
    "broker_request_id",
    "state",
    "requested_volume_steps",
    "filled_volume_steps",
    "residual_volume_steps",
    "broker_order_tickets",
    "acknowledgement_code",
  ],
  {
    command_id: ref("identifier"),
    lease_id: ref("identifier"),
    reservation_id: ref("identifier"),
    broker_request_id: ref("identifier"),
    state: { enum: ["JOURNALED", "SENT", "ACK_REJECTED", "ACK_ACCEPTED", "ACK_UNKNOWN"] },
    requested_volume_steps: ref("positiveSafeInteger"),
    filled_volume_steps: ref("nonnegativeSafeInteger"),
    residual_volume_steps: ref("nonnegativeSafeInteger"),
    broker_order_tickets: array(ref("positiveSafeInteger"), 32),
    acknowledgement_code: nullable(ref("identifier")),
  },
);

const orderStateFact = strictObject(
  [
    "order_ticket",
    ...attributionRequired,
    "state",
    "direction",
    "broker_symbol",
    "requested_volume_steps",
    "filled_volume_steps",
    "residual_volume_steps",
    "entry_price_ticks",
    "stop_ticks",
    "target_ticks",
  ],
  {
    order_ticket: ref("positiveSafeInteger"),
    ...attributionProperties,
    state: { enum: ["DISCOVERED", "PENDING", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED", "EXPIRED", "UNKNOWN"] },
    direction,
    broker_symbol: ref("identifier"),
    requested_volume_steps: ref("positiveSafeInteger"),
    filled_volume_steps: ref("nonnegativeSafeInteger"),
    residual_volume_steps: ref("nonnegativeSafeInteger"),
    entry_price_ticks: nullable(ref("safeInteger")),
    stop_ticks: nullable(ref("safeInteger")),
    target_ticks: nullable(ref("safeInteger")),
  },
  { oneOf: attributionBranches },
);

const dealStateFact = strictObject(
  [
    "deal_id",
    "order_ticket",
    "position_ticket",
    ...attributionRequired,
    "role",
    "direction",
    "volume_steps",
    "price_ticks",
    "commission_minor_units",
  ],
  {
    deal_id: ref("identifier"),
    order_ticket: nullable(ref("positiveSafeInteger")),
    position_ticket: nullable(ref("positiveSafeInteger")),
    ...attributionProperties,
    role: { enum: ["ENTRY", "EXIT"] },
    direction,
    volume_steps: ref("positiveSafeInteger"),
    price_ticks: ref("safeInteger"),
    commission_minor_units: ref("safeInteger"),
  },
  { oneOf: attributionBranches },
);

const positionStateFact = strictObject(
  [
    "position_ticket",
    ...attributionRequired,
    "state",
    "direction",
    "volume_steps",
    "weighted_fill_price_ticks",
    "deal_ids",
  ],
  {
    position_ticket: nullable(ref("positiveSafeInteger")),
    ...attributionProperties,
    state: { enum: ["ABSENT", "OPEN", "PARTIAL", "CLOSED"] },
    direction: nullable(direction),
    volume_steps: ref("nonnegativeSafeInteger"),
    weighted_fill_price_ticks: nullable(ref("safeInteger")),
    deal_ids: array(ref("identifier"), 64),
  },
  {
    allOf: [{ oneOf: attributionBranches }],
    oneOf: [
      { properties: { state: { const: "ABSENT" }, position_ticket: { type: "null" }, attribution_state: { enum: ["UNATTRIBUTED", "UNKNOWN"] }, command_id: { type: "null" }, broker_request_id: { type: "null" }, direction: { type: "null" }, volume_steps: { const: 0 }, weighted_fill_price_ticks: { type: "null" } } },
      { properties: { state: { enum: ["OPEN", "PARTIAL"] }, position_ticket: ref("positiveSafeInteger"), direction, volume_steps: ref("positiveSafeInteger"), weighted_fill_price_ticks: ref("safeInteger") } },
      { properties: { state: { const: "CLOSED" }, position_ticket: ref("positiveSafeInteger"), direction, volume_steps: { const: 0 }, weighted_fill_price_ticks: ref("safeInteger") } },
    ],
  },
);

const protectionStateFact = strictObject(
  [
    "position_ticket",
    ...attributionRequired,
    "state",
    "protected_volume_steps",
    "stop_ticks",
    "target_ticks",
  ],
  {
    position_ticket: ref("positiveSafeInteger"),
    ...attributionProperties,
    state: protectionState,
    protected_volume_steps: ref("nonnegativeSafeInteger"),
    stop_ticks: nullable(ref("safeInteger")),
    target_ticks: nullable(ref("safeInteger")),
  },
  {
    allOf: [{ oneOf: attributionBranches }],
    oneOf: [
      { properties: { state: { const: "VERIFIED" }, stop_ticks: ref("safeInteger"), target_ticks: ref("safeInteger") } },
      { properties: { state: { enum: ["REQUIRED", "MISSING_DEFINITE", "UNKNOWN", "BREACHED"] } } },
    ],
  },
);

const closeAttemptStateFact = strictObject(
  [
    "close_attempt_id",
    "position_ticket",
    ...attributionRequired,
    "state",
    "requested_volume_steps",
    "filled_volume_steps",
    "residual_volume_steps",
    "deal_ids",
  ],
  {
    close_attempt_id: ref("identifier"),
    position_ticket: ref("positiveSafeInteger"),
    ...attributionProperties,
    state: { enum: ["JOURNALED", "SENT", "ACK_UNKNOWN", "RECONCILED"] },
    requested_volume_steps: ref("positiveSafeInteger"),
    filled_volume_steps: ref("nonnegativeSafeInteger"),
    residual_volume_steps: ref("nonnegativeSafeInteger"),
    deal_ids: array(ref("identifier"), 64),
  },
  { oneOf: attributionBranches },
);

const unattributedExposureStateFact = strictObject(
  [
    "exposure_id",
    "exposure_kind",
    "broker_ticket",
    "broker_symbol",
    "direction",
    "volume_steps",
    "price_ticks",
    "pricing_state",
    "modeled_loss_minor_units",
    "protection_state",
    "state",
  ],
  {
    exposure_id: ref("identifier"),
    exposure_kind: { enum: ["ORDER", "POSITION"] },
    broker_ticket: ref("positiveSafeInteger"),
    broker_symbol: ref("identifier"),
    direction,
    volume_steps: ref("positiveSafeInteger"),
    price_ticks: nullable(ref("safeInteger")),
    pricing_state: { enum: ["PRICED", "UNPRICED"] },
    modeled_loss_minor_units: nullable(ref("nonnegativeSafeInteger")),
    protection_state: protectionState,
    state: { enum: ["DISCOVERED", "ATTRIBUTED", "CLOSED", "UNKNOWN"] },
  },
  {
    oneOf: [
      { properties: { pricing_state: { const: "PRICED" }, price_ticks: ref("safeInteger"), modeled_loss_minor_units: ref("nonnegativeSafeInteger") } },
      { properties: { pricing_state: { const: "UNPRICED" }, price_ticks: { type: "null" }, modeled_loss_minor_units: { type: "null" } } },
    ],
  },
);

const reconciliationStateFact = strictObject(
  [
    "watermark",
    "previous_watermark",
    "state",
    "reconciliation_sha256",
    "history_from_epoch",
    "history_to_epoch",
    "sweep_number",
    "consecutive_stable_sweeps",
    "order_tickets",
    "deal_ids",
    "position_tickets",
    "unattributed_exposure_ids",
  ],
  {
    watermark: ref("identifier"),
    previous_watermark: nullable(ref("identifier")),
    state: { enum: ["STABLE", "UNSTABLE", "GAP", "UNKNOWN"] },
    reconciliation_sha256: ref("sha256"),
    history_from_epoch: ref("nonnegativeSafeInteger"),
    history_to_epoch: ref("nonnegativeSafeInteger"),
    sweep_number: ref("positiveSafeInteger"),
    consecutive_stable_sweeps: ref("nonnegativeSafeInteger"),
    order_tickets: array(ref("positiveSafeInteger"), 512),
    deal_ids: array(ref("identifier"), 512),
    position_tickets: array(ref("positiveSafeInteger"), 512),
    unattributed_exposure_ids: array(ref("identifier"), 512),
  },
);

const eventKindToFact = {
  HEARTBEAT: "heartbeatFact",
  TERMINAL_STATE: "terminalStateFact",
  SUBMIT_STATE: "submitStateFact",
  ORDER_STATE: "orderStateFact",
  DEAL_STATE: "dealStateFact",
  POSITION_STATE: "positionStateFact",
  PROTECTION_STATE: "protectionStateFact",
  CLOSE_ATTEMPT_STATE: "closeAttemptStateFact",
  UNATTRIBUTED_EXPOSURE_STATE: "unattributedExposureStateFact",
  RECONCILIATION_STATE: "reconciliationStateFact",
};

const factDefinitions = {
  heartbeatFact,
  terminalStateFact,
  submitStateFact,
  orderStateFact,
  dealStateFact,
  positionStateFact,
  protectionStateFact,
  closeAttemptStateFact,
  unattributedExposureStateFact,
  reconciliationStateFact,
};

const agentEvent = strictObject(
  [
    "schema_version",
    "event_id",
    "installation_id",
    "account_id",
    "account_profile_sha256",
    "safety_epoch",
    "sequence",
    "observed_at_epoch",
    "kind",
    "body_sha256",
    "fact",
  ],
  {
    schema_version: { const: "AgentEventV1" },
    event_id: ref("identifier"),
    installation_id: ref("identifier"),
    account_id: ref("identifier"),
    account_profile_sha256: ref("sha256"),
    safety_epoch: ref("nonnegativeSafeInteger"),
    sequence: ref("positiveSafeInteger"),
    observed_at_epoch: ref("nonnegativeSafeInteger"),
    kind: { enum: Object.keys(eventKindToFact) },
    body_sha256: ref("sha256"),
    fact: { oneOf: Object.values(eventKindToFact).map((name) => ref(name)) },
  },
  {
    allOf: Object.entries(eventKindToFact).map(([kind, fact]) => ({
      if: { properties: { kind: { const: kind } } },
      then: { properties: { fact: ref(fact) } },
    })),
  },
);

const primitives = {
  identifier,
  sha256,
  nonnegativeSafeInteger,
  positiveSafeInteger,
  safeInteger,
};

const agentEventSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.invalid/prop-trading/agent-event-v1.schema.json",
  title: "AgentEventV1",
  ...agentEvent,
  $defs: { ...primitives, ...factDefinitions },
  description: "Append-only bounded agent facts preserve submit acknowledgement uncertainty, orders, multiple deals, position volume and weighted fill, protection, ambiguous close attempts, and reconciliation without collapsing broker state.",
};

const symbolState = strictObject(
  [
    "source_symbol",
    "broker_symbol",
    "synchronization_state",
    "selection_state",
    "capability_state",
    "symbol_capability_sha256",
    "trade_mode",
    "bid_ticks",
    "ask_ticks",
    "observed_at_epoch",
  ],
  {
    source_symbol: { enum: ["EURUSD", "GBPJPY", "USDJPY", "XAUUSD", "NAS100"] },
    broker_symbol: ref("identifier"),
    synchronization_state: { enum: ["SYNCHRONIZED", "UNSYNCHRONIZED", "UNKNOWN"] },
    selection_state: { enum: ["SELECTED", "NOT_SELECTED", "UNKNOWN"] },
    capability_state: { enum: ["CURRENT", "CHANGED", "UNKNOWN"] },
    symbol_capability_sha256: ref("sha256"),
    trade_mode: { enum: ["DISABLED", "LONG_ONLY", "SHORT_ONLY", "FULL", "CLOSE_ONLY", "UNKNOWN"] },
    bid_ticks: nullable(ref("safeInteger")),
    ask_ticks: nullable(ref("safeInteger")),
    observed_at_epoch: ref("nonnegativeSafeInteger"),
  },
);

const openOrderSnapshot = strictObject(
  [
    "order_ticket",
    ...attributionRequired,
    "state",
    "direction",
    "broker_symbol",
    "requested_volume_steps",
    "filled_volume_steps",
    "residual_volume_steps",
    "entry_price_ticks",
    "stop_ticks",
    "target_ticks",
    "protection_state",
  ],
  {
    order_ticket: ref("positiveSafeInteger"),
    ...attributionProperties,
    state: { enum: ["DISCOVERED", "PENDING", "PARTIALLY_FILLED", "UNKNOWN"] },
    direction,
    broker_symbol: ref("identifier"),
    requested_volume_steps: ref("positiveSafeInteger"),
    filled_volume_steps: ref("nonnegativeSafeInteger"),
    residual_volume_steps: ref("positiveSafeInteger"),
    entry_price_ticks: nullable(ref("safeInteger")),
    stop_ticks: nullable(ref("safeInteger")),
    target_ticks: nullable(ref("safeInteger")),
    protection_state: protectionState,
  },
  { oneOf: attributionBranches },
);

const positionSnapshot = strictObject(
  [
    "position_ticket",
    ...attributionRequired,
    "state",
    "direction",
    "broker_symbol",
    "volume_steps",
    "weighted_fill_price_ticks",
    "stop_ticks",
    "target_ticks",
    "protection_state",
    "deal_ids",
  ],
  {
    position_ticket: ref("positiveSafeInteger"),
    ...attributionProperties,
    state: { enum: ["OPEN", "PARTIAL"] },
    direction,
    broker_symbol: ref("identifier"),
    volume_steps: ref("positiveSafeInteger"),
    weighted_fill_price_ticks: ref("safeInteger"),
    stop_ticks: nullable(ref("safeInteger")),
    target_ticks: nullable(ref("safeInteger")),
    protection_state: protectionState,
    deal_ids: array(ref("identifier"), 64),
  },
  { oneOf: attributionBranches },
);

const reconciliationWatermark = strictObject(
  [
    "watermark",
    "state",
    "reconciliation_sha256",
    "history_through_epoch",
    "consecutive_stable_sweeps",
  ],
  {
    watermark: ref("identifier"),
    state: { enum: ["STABLE", "UNSTABLE", "GAP", "UNKNOWN"] },
    reconciliation_sha256: ref("sha256"),
    history_through_epoch: ref("nonnegativeSafeInteger"),
    consecutive_stable_sweeps: ref("nonnegativeSafeInteger"),
  },
);

const accountSnapshot = strictObject(
  [
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
  ],
  {
    terminal_build: ref("positiveSafeInteger"),
    ea_sha256: ref("sha256"),
    manifest_sha256: ref("sha256"),
    account_fingerprint_sha256: ref("sha256"),
    broker_time_epoch: nullable(ref("nonnegativeSafeInteger")),
    windows_time_epoch: nullable(ref("nonnegativeSafeInteger")),
    terminal_connection_state: terminalConnection,
    account_trade_permission: permission,
    terminal_trade_permission: permission,
    algo_trading_permission: permission,
    balance_minor_units: nullable(ref("safeInteger")),
    equity_minor_units: nullable(ref("safeInteger")),
    margin_minor_units: nullable(ref("nonnegativeSafeInteger")),
    free_margin_minor_units: nullable(ref("safeInteger")),
    margin_level_bps: nullable(ref("nonnegativeSafeInteger")),
    symbols: array(ref("symbolState"), 5, 1),
    open_orders: array(ref("openOrderSnapshot"), 128),
    positions: array(ref("positionSnapshot"), 128),
    reconciliation_watermark: ref("reconciliationWatermark"),
    observed_at_epoch: ref("nonnegativeSafeInteger"),
  },
);

const bar = strictObject(
  ["open_epoch", "close_epoch", "open_ticks", "high_ticks", "low_ticks", "close_ticks", "closed"],
  {
    open_epoch: ref("nonnegativeSafeInteger"),
    close_epoch: ref("nonnegativeSafeInteger"),
    open_ticks: ref("safeInteger"),
    high_ticks: ref("safeInteger"),
    low_ticks: ref("safeInteger"),
    close_ticks: ref("safeInteger"),
    closed: { const: true },
  },
);

const brokerBarEvidence = strictObject(
  [
    "schema_version",
    "evidence_id",
    "installation_id",
    "account_id",
    "account_profile_sha256",
    "source_symbol",
    "broker_symbol",
    "symbol_capability_sha256",
    "timeframe",
    "reconciliation_cursor",
    "reconciliation_sha256",
    "bars",
    "observed_at_epoch",
  ],
  {
    schema_version: { const: "BrokerBarEvidenceV1" },
    evidence_id: ref("identifier"),
    installation_id: ref("identifier"),
    account_id: ref("identifier"),
    account_profile_sha256: ref("sha256"),
    source_symbol: { enum: ["EURUSD", "GBPJPY", "USDJPY", "XAUUSD", "NAS100"] },
    broker_symbol: ref("identifier"),
    symbol_capability_sha256: ref("sha256"),
    timeframe: { enum: ["M5", "M1"] },
    reconciliation_cursor: ref("identifier"),
    reconciliation_sha256: ref("sha256"),
    bars: array(ref("bar"), 512, 1),
    observed_at_epoch: ref("nonnegativeSafeInteger"),
  },
);

const agentSyncRequestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.invalid/prop-trading/agent-sync-request-v1.schema.json",
  title: "AgentSyncRequestV1",
  ...strictObject(
    [
      "schema_version",
      "installation_id",
      "account_id",
      "account_profile_sha256",
      "safety_epoch",
      "request_sequence",
      "last_acknowledged_server_sequence",
      "nonce",
      "sent_at_epoch",
      "body_sha256",
      "account_snapshot",
      "events",
      "broker_bar_evidence",
    ],
    {
      schema_version: { const: "AgentSyncRequestV1" },
      installation_id: ref("identifier"),
      account_id: ref("identifier"),
      account_profile_sha256: ref("sha256"),
      safety_epoch: ref("nonnegativeSafeInteger"),
      request_sequence: ref("positiveSafeInteger"),
      last_acknowledged_server_sequence: ref("nonnegativeSafeInteger"),
      nonce: ref("identifier"),
      sent_at_epoch: ref("nonnegativeSafeInteger"),
      body_sha256: ref("sha256"),
      account_snapshot: ref("accountSnapshot"),
      events: array(ref("agentEvent"), 256),
      broker_bar_evidence: array(ref("brokerBarEvidence"), 8),
    },
  ),
  $defs: {
    ...primitives,
    ...factDefinitions,
    agentEvent,
    symbolState,
    openOrderSnapshot,
    positionSnapshot,
    reconciliationWatermark,
    accountSnapshot,
    bar,
    brokerBarEvidence,
  },
  description: "Credential-free bounded outbound sync containing explicit tri-state terminal inputs, complete open exposure/protection details, a stable reconciliation watermark, append-only broker folds, and authenticated bars. Runtime authorization must block on every unknown, stale, changed, unstable, or non-permitted snapshot value.",
};

const outputs = [
  [new URL("../contracts/schema/agent-event-v1.schema.json", import.meta.url), agentEventSchema],
  [new URL("../contracts/schema/agent-sync-request-v1.schema.json", import.meta.url), agentSyncRequestSchema],
];

for (const [path, value] of outputs) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
