import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseAdmissionTransport } from "../../src/signal-admission-wire-v1";
import { readRegistration } from "../../src/signal-admission-registration-v1";
import type { AdmissionSnapshot } from "../../src/signal-admission-decision-v1";

const vectors = JSON.parse(readFileSync(new URL("../../../../contracts/vectors/signal-evidence-v1.json", import.meta.url), "utf8"));
export const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

export async function fixture(caseId = "strict_long_boc_only") {
  const vector = vectors.cases.find((item: { case_id: string }) => item.case_id === caseId);
  if (!vector) throw new Error(`missing signal evidence fixture: ${caseId}`);
  const input = structuredClone(vector.input);
  input.observation.producer_sequence = 1;
  input.observation.event_id = `${input.observation.producer_instance_id}:1`;
  const request = { schema_version: "TradeOpsSignalAdmissionRequestV1", credential: "LOCAL_TEST_ONLY_ADMISSION", registration_id: "local-test-registration", generation: 1, evidence: input };
  const binding = vector.reviewed_binding;
  const registration = readRegistration(encode({
    schema_version: "TradeOpsSignalAdmissionRegistrationV1", registration_id: request.registration_id,
    generation: 1, revision: 1, enabled: true,
    scope_key: JSON.stringify({ producer_namespace: binding.producer_namespace, strategy_id: input.observation.strategy_id, ticker_id: binding.ticker_id }),
    producer_instance_id: input.observation.producer_instance_id,
    credential_sha256: createHash("sha256").update(request.credential).digest("hex"),
    reviewed_binding: binding, active_from: 0, active_until: 100_000,
    freshness: { max_event_age_seconds: 30, max_observation_age_seconds: 30, future_skew_seconds: 2, max_queue_age_seconds: 20 },
  }));
  if (!registration) throw new Error("invalid local registration fixture");
  const snapshot: AdmissionSnapshot = { state: "ACTIVE", revision: 1, nextSequence: 1, lastAcceptedAt: null, existingReceipt: null, attempts: {}, evidenceFacts: {} };
  return { input, request, registration, snapshot, transport: await parseAdmissionTransport(encode(request)), now: input.observation.observed_at_epoch as number };
}
