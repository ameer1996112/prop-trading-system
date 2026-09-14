export const DEMO_MODELS = Object.freeze(["BOC", "DIR_CLOSE", "HTF_FLIP"] as const);

export type DemoModel = (typeof DEMO_MODELS)[number];

export function isDemoModel(value: unknown): value is DemoModel {
  return typeof value === "string" && DEMO_MODELS.some(model => model === value);
}
