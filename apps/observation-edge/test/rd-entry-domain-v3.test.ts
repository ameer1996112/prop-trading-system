import { describe, expect, it } from "vitest";

import {
  ACTIVE_ENTRY_MODELS_V3,
  SELECTION_ACTIONS_V3,
  validateEntryEvaluationV3,
} from "../src/rd-entry-domain-v3";

describe("RD entry v3 closed domain", () => {
  it("freezes the three active entry models without execution actions", () => {
    expect(ACTIVE_ENTRY_MODELS_V3).toEqual([
      "BOC",
      "DIR_CLOSE",
      "HTF_FLIP",
    ]);
    expect(SELECTION_ACTIONS_V3).toEqual([
      "OBSERVE",
      "PAPER_ELIGIBLE",
      "SHADOW_ONLY",
      "NONE",
    ]);
    expect(SELECTION_ACTIONS_V3.join(" ")).not.toMatch(/BROKER|EXECUTE|ORDER/u);
  });

  it("rejects canonical-null selection fields that are not null", () => {
    expect(() =>
      validateEntryEvaluationV3({
        candidates: [],
        evidence: [],
        selection: {
          selection_id: "a".repeat(64),
          setup_id: "setup-1",
          policy_version: "rd-entry-arbitration-v3",
          revision: 0,
          candidate_ids_considered: [],
          canonical_candidate_id: null,
          canonical_evidence_id: null,
          canonical_model: "BOC",
          reason: "NO_CANDIDATE",
          fidelity: null,
          action: "NONE",
          co_triggered_models: [],
          evaluated_at_epoch: 300,
        },
      }),
    ).toThrow(TypeError);
  });
});
