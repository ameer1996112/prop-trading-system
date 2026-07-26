import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  parseRdEntryOracleVectorDocument,
  type RdEntryOracleVectorDocument,
} from "../src/rd-entry-vector-contract";

const VECTOR_BYTES = readFileSync(
  new URL(
    "../../../contracts/vectors/rd-entry-arbitration-v2.json",
    import.meta.url,
  ),
);
const VECTOR_TEXT = VECTOR_BYTES.toString("utf8");

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`);
  }
  return value;
}

function mutableDocument(): Record<string, unknown> {
  return objectValue(JSON.parse(VECTOR_TEXT) as unknown, "document");
}

function mutableCase(
  document: Record<string, unknown>,
  caseId: string,
): Record<string, unknown> {
  const cases = arrayValue(document.cases, "cases");
  const vector = cases
    .map((value, index) => objectValue(value, `cases[${index}]`))
    .find((value) => value.case_id === caseId);
  if (vector === undefined) throw new TypeError(`missing ${caseId}`);
  return vector;
}

function encoded(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

async function rejectMutation(
  caseId: string,
  mutate: (vector: Record<string, unknown>) => void,
): Promise<void> {
  const document = mutableDocument();
  mutate(mutableCase(document, caseId));
  await expect(
    parseRdEntryOracleVectorDocument(encoded(document)),
  ).rejects.toThrow();
}

function inputEvent(
  vector: Record<string, unknown>,
  inputName: "input" | "edge_input" | "pine_edge_input",
  index = 0,
): Record<string, unknown> {
  const input = objectValue(vector[inputName], inputName);
  return objectValue(
    arrayValue(input.events, `${inputName}.events`)[index],
    `${inputName}.events[${index}]`,
  );
}

describe("strict RD entry vector trust boundary", () => {
  it("loads the complete authoritative artifact through strict JSON", async () => {
    const document = await parseRdEntryOracleVectorDocument(VECTOR_BYTES);

    expect(document.schema_id).toBe(
      "phase0.rd-entry-arbitration-vectors.v2",
    );
    expect(document.cases).toHaveLength(24);
  });

  it.each([
    [
      "duplicate object keys",
      VECTOR_TEXT.replace(
        /^\{/u,
        '{"schema_id":"phase0.rd-entry-arbitration-vectors.v2",',
      ),
    ],
    [
      "non-finite numeric overflow",
      VECTOR_TEXT.replace(
        /"calculation_start_epoch":\s*[0-9]+/u,
        '"calculation_start_epoch": 1e400',
      ),
    ],
    [
      "unsafe integer",
      VECTOR_TEXT.replace(
        /"calculation_start_epoch":\s*[0-9]+/u,
        '"calculation_start_epoch": 9007199254740992',
      ),
    ],
  ])("rejects %s before vector validation", async (_, source) => {
    await expect(
      parseRdEntryOracleVectorDocument(new TextEncoder().encode(source)),
    ).rejects.toThrow();
  });

  it("rejects unknown raw-event fields", async () => {
    await rejectMutation("htf-flip-15m", (vector) => {
      inputEvent(vector, "input").unknown_raw_field = true;
    });
  });

  it("rejects malformed raw child chronology", async () => {
    await rejectMutation("htf-flip-15m", (vector) => {
      const event = inputEvent(vector, "input");
      const scans = arrayValue(
        event.htf_scan_requests,
        "htf_scan_requests",
      );
      const scan = objectValue(scans[0], "htf_scan_requests[0]");
      const children = arrayValue(scan.children, "children");
      children.reverse();
    });
  });

  it("rejects a forged numeric token in an unused post-recross raw child", async () => {
    await rejectMutation("htf-flip-15m", (vector) => {
      const event = inputEvent(vector, "input");
      const scan = objectValue(
        arrayValue(event.htf_scan_requests, "htf_scan_requests")[0],
        "htf_scan_requests[0]",
      );
      const children = arrayValue(scan.children, "children");
      const postRecrossChild = objectValue(
        children[children.length - 1],
        "children[last]",
      );
      postRecrossChild.close_ticks = {
        type: "json-number",
        raw: "99",
        value: 99,
        isIntegerToken: true,
      };
    });
  });

  it("requires Edge proofs to be the canonical expansion of raw scans", async () => {
    await rejectMutation("htf-flip-15m", (vector) => {
      const event = inputEvent(vector, "input");
      const scan = objectValue(
        arrayValue(event.htf_scan_requests, "htf_scan_requests")[0],
        "htf_scan_requests[0]",
      );
      scan.htf_open_ticks = 99;
    });
  });

  it("fully validates expected result identities and nested fields", async () => {
    await rejectMutation("dir-close-engagement", (vector) => {
      const expected = objectValue(vector.expected, "expected");
      const candidate = objectValue(
        arrayValue(expected.candidates, "expected.candidates")[0],
        "expected.candidates[0]",
      );
      candidate.candidate_id = "f".repeat(64);
    });
    await rejectMutation("dir-close-engagement", (vector) => {
      const expected = objectValue(vector.expected, "expected");
      const evidence = objectValue(
        arrayValue(expected.evidence, "expected.evidence")[0],
        "expected.evidence[0]",
      );
      delete evidence.observed_at_epoch;
    });
  });

  it("fully validates pine_expected and requires non-promotability", async () => {
    await rejectMutation("non-exact-only", (vector) => {
      const expected = objectValue(vector.pine_expected, "pine_expected");
      const selection = objectValue(
        expected.selection,
        "pine_expected.selection",
      );
      delete selection.reason;
    });
    await rejectMutation("dir-close-engagement", (vector) => {
      const expected = objectValue(vector.pine_expected, "pine_expected");
      const selection = objectValue(
        expected.selection,
        "pine_expected.selection",
      );
      selection.action = "PAPER_ELIGIBLE";
    });
  });

  it("keeps Pine expected separate from authoritative Edge expected", async () => {
    const document = await parseRdEntryOracleVectorDocument(VECTOR_BYTES);
    const vector = document.cases.find(
      (item) => item.case_id === "dir-close-engagement",
    );

    expect(vector?.expected.selection.action).toBe("PAPER_ELIGIBLE");
    expect(vector?.pine_expected.selection.action).toBe("SHADOW_ONLY");
  });
});

function compileTimeClosedVectorSurface(
  document: RdEntryOracleVectorDocument,
): void {
  document.cases[0]?.edge_input.events[0]?.match_request.setup.setup_id;
  document.cases[0]?.expected.selection.selection_id;
  document.cases[0]?.pine_expected.htf_transcripts[0]?.context_minutes;
}

void compileTimeClosedVectorSurface;
