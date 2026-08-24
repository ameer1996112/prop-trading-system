import { canonicalStringify } from "./canonical";
import { createDryRunResponse, type AgentSyncRequestV1, type AgentSyncResponseV1 } from "./agent-sync-v1";

export interface AccountCoordinatorStorageV1 {
  get<T>(key: string): Promise<T | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
}

export type AccountCoordinatorResultV1 = Readonly<{
  code: "OK";
  replayed: boolean;
  response: AgentSyncResponseV1;
  responseBytes: string;
}> | Readonly<{
  code: "REPLAY_CONFLICT" | "SEQUENCE_INVALID" | "IDENTITY_MISMATCH";
}>;

function fingerprint(request: AgentSyncRequestV1): string {
  return request.account_snapshot.account_fingerprint_sha256 as string;
}

function heartbeatSummary(request: AgentSyncRequestV1): Readonly<Record<string, unknown>> {
  return {
    observed_at_epoch: request.account_snapshot.observed_at_epoch,
    terminal_connection_state: request.account_snapshot.terminal_connection_state,
    account_trade_permission: request.account_snapshot.account_trade_permission,
    terminal_trade_permission: request.account_snapshot.terminal_trade_permission,
    algo_trading_permission: request.account_snapshot.algo_trading_permission,
  };
}

function maximumEventSequence(request: AgentSyncRequestV1): number {
  return request.events.reduce((maximum, event) => Math.max(maximum, event.sequence as number), 0);
}

function storedResponse(bytes: string, digest: string): AgentSyncResponseV1 | null {
  try {
    const response = JSON.parse(bytes) as AgentSyncResponseV1;
    return response.response_body_sha256 === digest ? response : null;
  } catch {
    return null;
  }
}

export async function coordinateAgentSyncV1(
  storage: AccountCoordinatorStorageV1,
  request: AgentSyncRequestV1,
  nowEpoch: number,
): Promise<AccountCoordinatorResultV1> {
  const [lastSequence, installationId, profileDigest, fingerprintDigest, safetyEpoch, requestDigest, storedResponseBytes, responseDigest, acknowledgedSequence] = await Promise.all([
    storage.get<number>("last_accepted_request_sequence"),
    storage.get<string>("installation_id"),
    storage.get<string>("account_profile_sha256"),
    storage.get<string>("account_fingerprint_sha256"),
    storage.get<number>("safety_epoch"),
    storage.get<string>("last_accepted_request_digest"),
    storage.get<string>("last_canonical_response_bytes"),
    storage.get<string>("last_canonical_response_digest"),
    storage.get<number>("last_acknowledged_event_sequence"),
  ]);

  if (lastSequence !== undefined) {
    if (
      installationId !== request.installation_id
      || profileDigest !== request.account_profile_sha256
      || fingerprintDigest !== fingerprint(request)
      || safetyEpoch !== request.safety_epoch
    ) return { code: "IDENTITY_MISMATCH" };
    if (request.request_sequence === lastSequence) {
      if (requestDigest !== request.body_sha256) return { code: "REPLAY_CONFLICT" };
      const response = typeof storedResponseBytes === "string" && typeof responseDigest === "string"
        ? storedResponse(storedResponseBytes, responseDigest)
        : null;
      return response === null ? { code: "SEQUENCE_INVALID" } : { code: "OK", replayed: true, response, responseBytes: storedResponseBytes! };
    }
    if (request.request_sequence !== lastSequence + 1) return { code: "SEQUENCE_INVALID" };
  } else if (request.request_sequence !== 1) {
    return { code: "SEQUENCE_INVALID" };
  }

  const nextAcknowledgedSequence = Math.max(acknowledgedSequence ?? 0, maximumEventSequence(request));
  const response = await createDryRunResponse(
    { ...request, last_acknowledged_event_sequence: nextAcknowledgedSequence },
    request.request_sequence,
    nowEpoch,
  );
  const responseBytes = canonicalStringify(response);
  await storage.put({
    installation_id: request.installation_id,
    account_profile_sha256: request.account_profile_sha256,
    account_fingerprint_sha256: request.account_snapshot.account_fingerprint_sha256,
    safety_epoch: request.safety_epoch,
    last_accepted_request_sequence: request.request_sequence,
    last_accepted_request_digest: request.body_sha256,
    last_canonical_response_bytes: responseBytes,
    last_canonical_response_digest: response.response_body_sha256,
    last_acknowledged_event_sequence: nextAcknowledgedSequence,
    heartbeat_summary: heartbeatSummary(request),
  });
  return { code: "OK", replayed: false, response, responseBytes };
}

export async function getAccountCoordinatorStatusV1(
  storage: AccountCoordinatorStorageV1,
): Promise<Readonly<{ mode: "DRY_RUN"; last_request_sequence: number }>> {
  const lastRequestSequence = await storage.get<number>("last_accepted_request_sequence");
  return { mode: "DRY_RUN", last_request_sequence: lastRequestSequence ?? 0 };
}

function coordinatorJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export class AccountCoordinatorV1 {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request?: Request): Promise<Response> {
    if (request === undefined) return coordinatorJson({ error: "FOUNDATION_ONLY" }, 503);
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/status") {
      return coordinatorJson(await getAccountCoordinatorStatusV1(this.state.storage));
    }
    if (request.method !== "POST" || pathname !== "/sync") return coordinatorJson({ code: "COORDINATOR_INVALID" }, 400);
    try {
      const body = await request.json() as Readonly<{ request: AgentSyncRequestV1; now_epoch: number }>;
      if (!Number.isSafeInteger(body.now_epoch) || body.now_epoch < 0) return coordinatorJson({ code: "COORDINATOR_INVALID" }, 400);
      const result = await coordinateAgentSyncV1(this.state.storage, body.request, body.now_epoch);
      return result.code === "OK"
        ? coordinatorJson({ code: "OK", replayed: result.replayed, response_bytes: result.responseBytes })
        : coordinatorJson({ code: result.code });
    } catch {
      return coordinatorJson({ code: "COORDINATOR_INVALID" }, 400);
    }
  }
}
