import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateJsonSchemaPayload } from "./support/broker-reconstruction-fixture";

const root = new URL("../../../", import.meta.url);
const D = (digit: string): string => digit.repeat(64);
const unsafe = Number.MAX_SAFE_INTEGER + 1;

function schema(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`contracts/schema/${file}`, root), "utf8")) as Record<string, unknown>;
}

const profile = {
  schema_version: "AccountProfileV1",
  profile_id: "profile-demo-1",
  profile_digest_inputs: { version: "account-profile-inputs-v1", owner_scope_id: "owner-scope-1" },
  account_id: "account-demo-1",
  account_fingerprint_sha256: D("1"),
  environment: "DEMO",
  server_id: "FundingPips-Demo",
  currency: "USD",
  margin_mode: "HEDGING",
  balance_class: "CHALLENGE_100K",
  authority_ceiling: "DRY_RUN",
  symbol_map: { EURUSD: "EURUSD", GBPJPY: "GBPJPY", USDJPY: "USDJPY", XAUUSD: "XAUUSD", NAS100: "NAS100" },
  risk_limits: { daily_loss_bps: 500, overall_loss_bps: 1000, risk_per_trade_bps: 50, max_concurrent_ideas: 2 },
  not_before_epoch: 1_787_472_000,
  expires_at_epoch: 1_790_064_000,
};

const command = {
  schema_version: "TradeCommandV1", command_id: "command-1", lease_id: "lease-1", candidate_id: D("2"), candidate_body_sha256: D("e"), decision_sha256: D("3"),
  reconstruction_sha256: D("6"), prop_rule_pack_sha256: D("a"), news_calendar_pack_sha256: D("b"), execution_policy_sha256: D("c"),
  reservation_id: "reservation-1", account_id: "account-demo-1", installation_id: "installation-1", account_profile_sha256: D("4"), account_fingerprint_sha256: D("8"), symbol_capability_sha256: D("5"), safety_epoch: 7,
  direction: "LONG", broker_symbol: "EURUSD", entry_ticks: 110000, stop_ticks: 109800, target_ticks: 110800, volume_steps: 10,
  issued_at_epoch: 1_787_472_000, expires_at_epoch: 1_787_472_030, lease_duration_seconds: 30,
  execution_mode: "DRY_RUN", real_execution_allowed: false, command_body_sha256: D("f"),
};

const heartbeatEvent = {
  schema_version: "AgentEventV1", event_id: "event-1", installation_id: "installation-1", account_id: "account-demo-1",
  account_profile_sha256: D("4"), safety_epoch: 7, sequence: 1, observed_at_epoch: 1_787_472_000,
  kind: "HEARTBEAT", body_sha256: D("6"), fact: {
    terminal_connection_state: "CONNECTED", account_trade_permission: "DENIED", terminal_trade_permission: "DENIED", algo_trading_permission: "DENIED",
    broker_time_epoch: 1_787_472_000, windows_time_epoch: 1_787_472_000,
  },
};

const accountSnapshot = {
  terminal_build: 4410, ea_sha256: D("a"), manifest_sha256: D("b"), account_fingerprint_sha256: D("8"),
  broker_time_epoch: 1_787_472_001, windows_time_epoch: 1_787_472_001,
  terminal_connection_state: "CONNECTED", account_trade_permission: "DENIED", terminal_trade_permission: "DENIED", algo_trading_permission: "DENIED",
  balance_minor_units: 10_000_000, equity_minor_units: 10_000_000, margin_minor_units: 0, free_margin_minor_units: 10_000_000, margin_level_bps: null,
  symbols: [{ source_symbol: "EURUSD", broker_symbol: "EURUSD", synchronization_state: "SYNCHRONIZED", selection_state: "SELECTED", capability_state: "CURRENT", symbol_capability_sha256: D("5"), trade_mode: "FULL", bid_ticks: 109999, ask_ticks: 110001, observed_at_epoch: 1_787_472_001 }],
  open_orders: [], positions: [],
  reconciliation_watermark: { watermark: "cursor-1", state: "STABLE", reconciliation_sha256: D("7"), history_through_epoch: 1_787_472_000, consecutive_stable_sweeps: 2 },
  observed_at_epoch: 1_787_472_001,
};

const evidence = {
  schema_version: "BrokerBarEvidenceV1", evidence_id: "evidence-1", installation_id: "installation-1", account_id: "account-demo-1",
  account_profile_sha256: D("4"), source_symbol: "EURUSD", broker_symbol: "EURUSD", symbol_capability_sha256: D("5"), timeframe: "M5",
  reconciliation_cursor: "cursor-1", reconciliation_sha256: D("7"),
  bars: [{ open_epoch: 1_787_471_700, close_epoch: 1_787_472_000, open_ticks: 110000, high_ticks: 110100, low_ticks: 109900, close_ticks: 110000, closed: true }],
  observed_at_epoch: 1_787_472_001,
};

const fixtures = {
  "account-profile-v1.schema.json": profile,
  "signed-account-profile-v1.schema.json": {
    schema_version: "SignedAccountProfileV1", profile, profile_sha256: D("8"), issuer_id: "execution-edge-profile-issuer", key_id: "profile-key-1",
    issued_at_epoch: 1_787_472_000, not_before_epoch: 1_787_472_000, expires_at_epoch: 1_790_064_000, safety_epoch: 7,
    mac_alg: "HMAC-SHA256", mac_hex: D("9"),
  },
  "prop-rule-pack-v1.schema.json": {
    schema_version: "PropRulePackV1", pack_version: "fundingpips-demo-v1", pack_sha256: D("a"), environment: "DEMO",
    daily_loss_bps: 500, overall_loss_bps: 1000, risk_per_trade_bps: 50, max_concurrent_ideas: 2,
    weekend_holding_allowed: false, high_impact_news_block_minutes_before: 15, high_impact_news_block_minutes_after: 15,
    issued_at_epoch: 1_787_472_000, not_before_epoch: 1_787_472_000, expires_at_epoch: 1_790_064_000, authority_ceiling: "DRY_RUN",
  },
  "news-calendar-pack-v1.schema.json": {
    schema_version: "NewsCalendarPackV1", pack_version: "news-week-1", pack_sha256: D("b"), coverage_start_epoch: 1_787_472_000,
    coverage_end_epoch: 1_788_076_800, issuer_id: "operator-news-issuer", issued_at_epoch: 1_787_471_000,
    events: [{ event_id: "nfp-1", currencies: ["USD"], impact: "HIGH", start_epoch: 1_787_558_400, end_epoch: 1_787_562_000, title: "Nonfarm Payrolls" }],
  },
  "agent-event-v1.schema.json": heartbeatEvent,
  "agent-sync-request-v1.schema.json": {
    schema_version: "AgentSyncRequestV1", installation_id: "installation-1", account_id: "account-demo-1", account_profile_sha256: D("4"), safety_epoch: 7,
    request_sequence: 2, last_acknowledged_server_sequence: 1, nonce: "nonce-2", sent_at_epoch: 1_787_472_002, body_sha256: D("c"),
    account_snapshot: accountSnapshot,
    events: [heartbeatEvent], broker_bar_evidence: [evidence],
  },
  "agent-sync-response-v1.schema.json": {
    schema_version: "AgentSyncResponseV1", response_body_sha256: D("d"), server_sequence: 2, server_time_epoch: 1_787_472_003,
    mode: "DRY_RUN", freeze_reasons: [], acknowledged_event_sequence: 1,
    evidence_requests: [{ request_id: "request-1", source_symbol: "EURUSD", timeframe: "M5", from_epoch: 1_787_471_700, to_epoch: 1_787_472_000 }], command: null,
  },
  "trade-command-v1.schema.json": command,
  "execution-decision-v1.schema.json": {
    schema_version: "ExecutionDecisionV1", decision_sha256: D("3"), candidate_id: D("2"), candidate_body_sha256: D("e"), account_id: "account-demo-1",
    account_profile_sha256: D("4"), symbol_capability_sha256: D("5"), reconstruction_sha256: D("6"), prop_rule_pack_sha256: D("a"), news_calendar_pack_sha256: D("b"),
    safety_epoch: 7, outcome: "DRY_RUN_AUTHORIZED", reason_code: "AUTHORIZED", modeled_risk_bps: 50, modeled_risk_minor_units: 50_000,
    reservation_id: "reservation-1", created_at_epoch: 1_787_472_000, expires_at_epoch: 1_787_472_030, authority: "DRY_RUN", real_execution_allowed: false,
  },
  "routing-manifest-v1.schema.json": {
    schema_version: "RoutingManifestV1", manifest_version: "routing-demo-v1", manifest_sha256: D("f"), issued_at_epoch: 1_787_472_000,
    not_before_epoch: 1_787_472_000, expires_at_epoch: 1_790_064_000, authority_ceiling: "DRY_RUN",
    routes: [{ source_symbol: "EURUSD", account_id: "account-demo-1", account_profile_sha256: D("4"), symbol_capability_sha256: D("5") }],
  },
} satisfies Record<string, Record<string, unknown>>;

type ContractCase = { required: string; invalidEnum: (value: Record<string, unknown>) => Record<string, unknown>; unsafeInteger: (value: Record<string, unknown>) => Record<string, unknown>; malformedDigest: (value: Record<string, unknown>) => Record<string, unknown>; forbiddenAuthority: (value: Record<string, unknown>) => Record<string, unknown> };

const cases: Record<keyof typeof fixtures, ContractCase> = {
  "account-profile-v1.schema.json": { required: "profile_id", invalidEnum: (v) => ({ ...v, environment: "LIVE" }), unsafeInteger: (v) => ({ ...v, expires_at_epoch: unsafe }), malformedDigest: (v) => ({ ...v, account_fingerprint_sha256: "xyz" }), forbiddenAuthority: (v) => ({ ...v, authority_ceiling: "LIVE" }) },
  "signed-account-profile-v1.schema.json": { required: "mac_hex", invalidEnum: (v) => ({ ...v, mac_alg: "SHA256" }), unsafeInteger: (v) => ({ ...v, safety_epoch: unsafe }), malformedDigest: (v) => ({ ...v, profile_sha256: "xyz" }), forbiddenAuthority: (v) => ({ ...v, profile: { ...(v.profile as object), authority_ceiling: "LIVE" } }) },
  "prop-rule-pack-v1.schema.json": { required: "pack_version", invalidEnum: (v) => ({ ...v, environment: "LIVE" }), unsafeInteger: (v) => ({ ...v, issued_at_epoch: unsafe }), malformedDigest: (v) => ({ ...v, pack_sha256: "xyz" }), forbiddenAuthority: (v) => ({ ...v, authority_ceiling: "EVALUATION" }) },
  "news-calendar-pack-v1.schema.json": { required: "events", invalidEnum: (v) => ({ ...v, events: [{ ...((v.events as object[])[0]), impact: "LOW" }] }), unsafeInteger: (v) => ({ ...v, coverage_end_epoch: unsafe }), malformedDigest: (v) => ({ ...v, pack_sha256: "xyz" }), forbiddenAuthority: (v) => ({ ...v, authority_ceiling: "LIVE" }) },
  "agent-event-v1.schema.json": { required: "event_id", invalidEnum: (v) => ({ ...v, kind: "LOG" }), unsafeInteger: (v) => ({ ...v, sequence: unsafe }), malformedDigest: (v) => ({ ...v, body_sha256: "xyz" }), forbiddenAuthority: (v) => ({ ...v, execution_mode: "LIVE" }) },
  "agent-sync-request-v1.schema.json": { required: "nonce", invalidEnum: (v) => ({ ...v, broker_bar_evidence: [{ ...((v.broker_bar_evidence as object[])[0]), timeframe: "H1" }] }), unsafeInteger: (v) => ({ ...v, request_sequence: unsafe }), malformedDigest: (v) => ({ ...v, body_sha256: "xyz" }), forbiddenAuthority: (v) => ({ ...v, authority: "LIVE" }) },
  "agent-sync-response-v1.schema.json": { required: "server_sequence", invalidEnum: (v) => ({ ...v, mode: "LIVE" }), unsafeInteger: (v) => ({ ...v, server_time_epoch: unsafe }), malformedDigest: (v) => ({ ...v, response_body_sha256: "xyz" }), forbiddenAuthority: (v) => ({ ...v, mode: "EVALUATION" }) },
  "trade-command-v1.schema.json": { required: "lease_id", invalidEnum: (v) => ({ ...v, direction: "BUY" }), unsafeInteger: (v) => ({ ...v, volume_steps: unsafe }), malformedDigest: (v) => ({ ...v, decision_sha256: "xyz" }), forbiddenAuthority: (v) => ({ ...v, execution_mode: "LIVE", real_execution_allowed: true }) },
  "execution-decision-v1.schema.json": { required: "outcome", invalidEnum: (v) => ({ ...v, outcome: "EXECUTE" }), unsafeInteger: (v) => ({ ...v, modeled_risk_minor_units: unsafe }), malformedDigest: (v) => ({ ...v, reconstruction_sha256: "xyz" }), forbiddenAuthority: (v) => ({ ...v, authority: "LIVE", real_execution_allowed: true }) },
  "routing-manifest-v1.schema.json": { required: "routes", invalidEnum: (v) => ({ ...v, routes: [{ ...((v.routes as object[])[0]), source_symbol: "BTCUSD" }] }), unsafeInteger: (v) => ({ ...v, expires_at_epoch: unsafe }), malformedDigest: (v) => ({ ...v, manifest_sha256: "xyz" }), forbiddenAuthority: (v) => ({ ...v, authority_ceiling: "LIVE" }) },
};

function without(value: Record<string, unknown>, key: string): Record<string, unknown> { const clone = structuredClone(value); delete clone[key]; return clone; }

function assertEveryObjectIsStrict(node: unknown, path = "$", seen = new Set<object>()): void {
  if (node === null || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (!Array.isArray(node)) {
    const record = node as Record<string, unknown>;
    if (record.type === "object") expect(record.additionalProperties, path).toBe(false);
    for (const [key, value] of Object.entries(record)) assertEveryObjectIsStrict(value, `${path}.${key}`, seen);
  } else node.forEach((value, index) => assertEveryObjectIsStrict(value, `${path}[${index}]`, seen));
}

describe("remaining execution-edge V1 schemas", () => {
  it.each(Object.entries(fixtures))("accepts a strict inert %s fixture", (file, fixture) => { expect(validateJsonSchemaPayload(schema(file), fixture)).toEqual([]); });

  it.each(Object.entries(fixtures))("rejects required negative cases for %s", (file, fixture) => {
    const contract = cases[file as keyof typeof fixtures];
    const parsed = schema(file);
    for (const [name, invalid] of [["unknown field", { ...fixture, unexpected: true }], ["missing required field", without(fixture, contract.required)], ["invalid enum", contract.invalidEnum(fixture)], ["unsafe integer", contract.unsafeInteger(fixture)], ["malformed digest", contract.malformedDigest(fixture)], ["forbidden authority", contract.forbiddenAuthority(fixture)]] as const) {
      expect(validateJsonSchemaPayload(parsed, invalid), name).not.toEqual([]);
    }
  });

  it.each(Object.keys(fixtures))("makes every root and nested object strict in %s", (file) => { assertEveryObjectIsStrict(schema(file)); });

  it("selects the bounded AgentEventV1 fact schema by kind", () => {
    const parsed = schema("agent-event-v1.schema.json");
    expect(validateJsonSchemaPayload(parsed, { ...heartbeatEvent, fact: { ...heartbeatEvent.fact, order_ticket: 1 } })).not.toEqual([]);
    expect(validateJsonSchemaPayload(parsed, {
      ...heartbeatEvent,
      kind: "ORDER_STATE",
      fact: {
        order_ticket: 123, attribution_state: "ATTRIBUTED", command_id: "command-1", broker_request_id: "request-1",
        state: "PENDING", direction: "LONG", broker_symbol: "EURUSD", requested_volume_steps: 10, filled_volume_steps: 0, residual_volume_steps: 10,
        entry_price_ticks: 110000, stop_ticks: 109800, target_ticks: 110800,
      },
    })).toEqual([]);
  });

  it("keeps commands inert, bounded, and non-generic", () => {
    const parsed = schema("trade-command-v1.schema.json");
    for (const invalid of [{ ...command, execution_mode: "EVALUATION" }, { ...command, real_execution_allowed: true }, { ...command, lease_duration_seconds: 31 }, { ...command, generic_instruction: "BUY NOW" }, { ...command, order_payload: { arbitrary: true } }]) expect(validateJsonSchemaPayload(parsed, invalid)).not.toEqual([]);
  });

  it("keeps the standalone and embedded TradeCommandV1 schemas exactly in parity", () => {
    const standalone = schema("trade-command-v1.schema.json");
    const response = schema("agent-sync-response-v1.schema.json");
    const embedded = (response.$defs as Record<string, unknown>).tradeCommand as Record<string, unknown>;
    const standaloneShape = {
      type: standalone.type,
      additionalProperties: standalone.additionalProperties,
      required: standalone.required,
      properties: standalone.properties,
    };

    expect(embedded).toEqual(standaloneShape);
    const referencedDefinitions = new Set(
      Object.values(standalone.properties as Record<string, { $ref?: string }>)
        .flatMap((property) => property.$ref?.startsWith("#/$defs/")
          ? [property.$ref.slice("#/$defs/".length)]
          : []),
    );
    for (const definition of referencedDefinitions) {
      expect((response.$defs as Record<string, unknown>)[definition], definition).toEqual(
        (standalone.$defs as Record<string, unknown>)[definition],
      );
    }
  });

  it.each([
    ["candidate_body_sha256", "not-a-digest"],
    ["reconstruction_sha256", "not-a-digest"],
    ["prop_rule_pack_sha256", "not-a-digest"],
    ["news_calendar_pack_sha256", "not-a-digest"],
    ["execution_policy_sha256", "not-a-digest"],
    ["reservation_id", ""],
    ["account_fingerprint_sha256", "not-a-digest"],
    ["command_body_sha256", "not-a-digest"],
  ] as const)("requires and validates immutable command pin %s in both schema locations", (pin, invalidValue) => {
    const standalone = schema("trade-command-v1.schema.json");
    const response = schema("agent-sync-response-v1.schema.json");
    const responseFixture = fixtures["agent-sync-response-v1.schema.json"];

    expect(validateJsonSchemaPayload(standalone, without(command, pin))).not.toEqual([]);
    expect(validateJsonSchemaPayload(standalone, { ...command, [pin]: invalidValue })).not.toEqual([]);
    expect(validateJsonSchemaPayload(response, {
      ...responseFixture,
      command: without(command, pin),
    })).not.toEqual([]);
    expect(validateJsonSchemaPayload(response, {
      ...responseFixture,
      command: { ...command, [pin]: invalidValue },
    })).not.toEqual([]);
  });

  it("allows a command only when freeze reasons are empty", () => {
    const parsed = schema("agent-sync-response-v1.schema.json");
    const response = fixtures["agent-sync-response-v1.schema.json"];

    expect(validateJsonSchemaPayload(parsed, { ...response, freeze_reasons: [], command })).toEqual([]);
    expect(validateJsonSchemaPayload(parsed, { ...response, freeze_reasons: [], command: null })).toEqual([]);
    expect(validateJsonSchemaPayload(parsed, {
      ...response,
      freeze_reasons: ["RECONCILIATION_UNKNOWN"],
      command: null,
    })).toEqual([]);
    expect(validateJsonSchemaPayload(parsed, {
      ...response,
      freeze_reasons: ["RECONCILIATION_UNKNOWN"],
      command,
    })).not.toEqual([]);
  });

  it("expresses authorized, expired, and every blocked decision mapping as disjoint branches", () => {
    const parsed = schema("execution-decision-v1.schema.json");
    const decision = fixtures["execution-decision-v1.schema.json"];
    const blockedReasons = [
      "ACCOUNT_FROZEN",
      "PROFILE_INVALID",
      "CAPABILITY_MISMATCH",
      "RECONSTRUCTION_MISMATCH",
      "RULE_LIMIT",
      "NEWS_BLACKOUT",
      "RISK_LIMIT",
      "STALE_INPUT",
      "RESERVATION_UNAVAILABLE",
    ] as const;
    const allReasons = ["AUTHORIZED", ...blockedReasons, "DECISION_EXPIRED"] as const;

    expect(validateJsonSchemaPayload(parsed, decision)).toEqual([]);
    expect(validateJsonSchemaPayload(parsed, {
      ...decision,
      outcome: "EXPIRED",
      reason_code: "DECISION_EXPIRED",
      reservation_id: null,
    })).toEqual([]);
    for (const reasonCode of blockedReasons) {
      expect(validateJsonSchemaPayload(parsed, {
        ...decision,
        outcome: "BLOCKED",
        reason_code: reasonCode,
        reservation_id: null,
      }), reasonCode).toEqual([]);
    }

    for (const outcome of ["DRY_RUN_AUTHORIZED", "BLOCKED", "EXPIRED"] as const) {
      for (const reasonCode of allReasons) {
        const allowed = outcome === "DRY_RUN_AUTHORIZED"
          ? reasonCode === "AUTHORIZED"
          : outcome === "EXPIRED"
            ? reasonCode === "DECISION_EXPIRED"
            : blockedReasons.includes(reasonCode as typeof blockedReasons[number]);
        const reservationId = outcome === "DRY_RUN_AUTHORIZED" ? "reservation-1" : null;
        expect(validateJsonSchemaPayload(parsed, {
          ...decision,
          outcome,
          reason_code: reasonCode,
          reservation_id: reservationId,
        }).length === 0, `${outcome}/${reasonCode}`).toBe(allowed);
      }
    }
    expect(validateJsonSchemaPayload(parsed, { ...decision, reservation_id: null })).not.toEqual([]);
    expect(validateJsonSchemaPayload(parsed, {
      ...decision,
      outcome: "BLOCKED",
      reason_code: "ACCOUNT_FROZEN",
      reservation_id: "reservation-1",
    })).not.toEqual([]);
    expect(validateJsonSchemaPayload(parsed, {
      ...decision,
      outcome: "EXPIRED",
      reason_code: "DECISION_EXPIRED",
      reservation_id: "reservation-1",
    })).not.toEqual([]);
  });
});
