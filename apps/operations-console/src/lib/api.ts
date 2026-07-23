import { getConsoleConfig } from "./config";
import { CanonicalizationError, parseCanonicalJson } from "./canonical";

const REQUIRED_GATE_IDS = [
  "optimizer_1_inputs",
  "tradingview_alert_configuration",
  "committed_clean_pine_provenance",
  "managed_secret_workload_identity",
  "oidc_mfa",
  "telemetry",
  "independent_dead_man",
  "transactional_email",
  "metaapi_demo_only_tenant",
  "metaapi_common_cursor_barrier",
  "licensed_tick_source",
  "sequence_complete_ticks",
  "five_day_tick_pilot",
] as const;

export type Gate = {
  gate_id: (typeof REQUIRED_GATE_IDS)[number];
  status: "BLOCKED";
  reason: string;
  missing_requirements: string[];
};

export type FoundationSnapshot = {
  source: "SERVER_API" | "UNCONFIGURED" | "API_UNAVAILABLE" | "API_INVALID";
  ready: false;
  status: "BLOCKED" | "DEGRADED" | "UNKNOWN";
  gates: Gate[];
  message: string;
  evaluatedAt: string | null;
  evidenceLastModifiedAt: string | null;
};

class InvalidApiPayload extends Error {}

async function parseStrictResponse(response: Response): Promise<unknown> {
  try {
    return parseCanonicalJson(await response.text());
  } catch (error) {
    if (error instanceof CanonicalizationError) {
      throw new InvalidApiPayload(`response is not strict canonical-profile JSON: ${error.message}`);
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRealUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u.exec(
    value,
  );
  if (match === null) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day &&
    parsed.getUTCHours() === hour &&
    parsed.getUTCMinutes() === minute &&
    parsed.getUTCSeconds() === second
  );
}

function parseReadiness(value: unknown): {
  status: "BLOCKED" | "DEGRADED";
  evaluatedAt: string;
  evidenceLastModifiedAt: string | null;
} {
  if (!isRecord(value) || value.ready !== false) throw new InvalidApiPayload("ready must be false");
  if (value.status !== "BLOCKED" && value.status !== "DEGRADED") {
    throw new InvalidApiPayload("unknown readiness status");
  }
  if (value.mode !== "FOUNDATION_OBSERVATION_ONLY" || !isRealUtcTimestamp(value.evaluated_at)) {
    throw new InvalidApiPayload("readiness mode or evaluated timestamp is invalid");
  }
  if (!isRecord(value.evidence_freshness)) {
    throw new InvalidApiPayload("evidence freshness is missing");
  }
  const freshness = value.evidence_freshness;
  let evidenceLastModifiedAt: string | null = null;
  if (freshness.status === "OBSERVED") {
    if (
      !isRealUtcTimestamp(freshness.last_modified_at) ||
      typeof freshness.age_seconds !== "number" ||
      !Number.isInteger(freshness.age_seconds) ||
      freshness.age_seconds < 0
    ) {
      throw new InvalidApiPayload("observed freshness is malformed");
    }
    evidenceLastModifiedAt = freshness.last_modified_at;
  } else if (
    freshness.status !== "UNKNOWN" ||
    freshness.last_modified_at !== null ||
    freshness.age_seconds !== null
  ) {
    throw new InvalidApiPayload("unknown freshness is malformed");
  }
  return { status: value.status, evaluatedAt: value.evaluated_at, evidenceLastModifiedAt };
}

function parseGates(value: unknown): Gate[] {
  if (!isRecord(value) || value.overall_status !== "BLOCKED" || !Array.isArray(value.gates)) {
    throw new InvalidApiPayload("gate report is malformed or not blocked");
  }
  const required = new Set<string>(REQUIRED_GATE_IDS);
  const seen = new Set<string>();
  const gates: Gate[] = [];
  for (const candidate of value.gates) {
    if (
      !isRecord(candidate) ||
      typeof candidate.gate_id !== "string" ||
      !required.has(candidate.gate_id) ||
      seen.has(candidate.gate_id) ||
      candidate.status !== "BLOCKED" ||
      typeof candidate.reason !== "string" ||
      candidate.reason.length === 0 ||
      !Array.isArray(candidate.missing_requirements) ||
      !candidate.missing_requirements.every((item) => typeof item === "string")
    ) {
      throw new InvalidApiPayload("gate record is missing, duplicated, unknown, or malformed");
    }
    seen.add(candidate.gate_id);
    gates.push(candidate as Gate);
  }
  if (seen.size !== required.size || [...required].some((id) => !seen.has(id))) {
    throw new InvalidApiPayload("the exact 13-gate set is required");
  }
  return gates;
}

function fallback(
  source: FoundationSnapshot["source"],
  status: FoundationSnapshot["status"],
  message: string,
): FoundationSnapshot {
  return {
    source,
    ready: false,
    status,
    gates: [],
    message,
    evaluatedAt: null,
    evidenceLastModifiedAt: null,
  };
}

export async function loadFoundationSnapshot(): Promise<FoundationSnapshot> {
  const config = getConsoleConfig();
  if (config.apiBaseUrl === null) {
    return fallback(
      "UNCONFIGURED",
      "UNKNOWN",
      "Server API origin is not configured. No health values are being inferred.",
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  try {
    const [readinessResponse, gatesResponse] = await Promise.all([
      fetch(`${config.apiBaseUrl}/health/readiness`, {
        cache: "no-store",
        signal: controller.signal,
      }),
      fetch(`${config.apiBaseUrl}/api/v1/phase0/gates`, {
        cache: "no-store",
        signal: controller.signal,
      }),
    ]);
    if (![200, 503].includes(readinessResponse.status) || gatesResponse.status !== 200) {
      throw new Error("unexpected API response status");
    }
    const readiness = parseReadiness(await parseStrictResponse(readinessResponse));
    const gates = parseGates(await parseStrictResponse(gatesResponse));
    return {
      source: "SERVER_API",
      ready: false,
      status: readiness.status,
      gates,
      message: "Values are runtime-validated from the Phase 0 server API.",
      evaluatedAt: readiness.evaluatedAt,
      evidenceLastModifiedAt: readiness.evidenceLastModifiedAt,
    };
  } catch (error) {
    if (error instanceof InvalidApiPayload) {
      return fallback(
        "API_INVALID",
        "DEGRADED",
        "The server returned malformed or unsafe state; readiness remains unknown.",
      );
    }
    return fallback(
      "API_UNAVAILABLE",
      "DEGRADED",
      "The server API is unavailable; dependency state is unknown, not healthy or zero.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
