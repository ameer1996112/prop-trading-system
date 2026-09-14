import { expect, it } from "vitest";
import { DEMO_MODELS, isDemoModel } from "../src/demo-models-v1";

it("supports all strict models without aliases", () => {
  expect(DEMO_MODELS).toEqual(["BOC", "DIR_CLOSE", "HTF_FLIP"]);
  for (const model of DEMO_MODELS) expect(isDemoModel(model)).toBe(true);
  for (const value of ["FLIP", "LEGACY_BREAK_CANDLE", "boc", null, {}, 1])
    expect(isDemoModel(value)).toBe(false);
  expect(Object.isFrozen(DEMO_MODELS)).toBe(true);
});
