import { isDemoModel, type DemoModel } from "./demo-models-v1";

export type GeometryPolicy = Readonly<{
  model: DemoModel;
  kind: "FIXED_BROKER_TICKS";
  stopTicks: number;
  targetTicks: number;
}>;

export function readGeometryPolicy(value: unknown): GeometryPolicy | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;

    const expectedKeys = ["model", "kind", "stopTicks", "targetTicks"] as const;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.length || !expectedKeys.every(key => ownKeys.includes(key))) return null;

    const descriptors = expectedKeys.map(key => Object.getOwnPropertyDescriptor(value, key));
    if (descriptors.some(descriptor => !descriptor || !("value" in descriptor))) return null;

    const [model, kind, stopTicks, targetTicks] = descriptors.map(descriptor => descriptor!.value);
    if (!isDemoModel(model) || kind !== "FIXED_BROKER_TICKS") return null;
    if (typeof stopTicks !== "number" || !Number.isSafeInteger(stopTicks) || stopTicks <= 0) return null;
    if (typeof targetTicks !== "number" || !Number.isSafeInteger(targetTicks) || targetTicks <= 0) return null;

    return Object.freeze({ model, kind, stopTicks, targetTicks });
  } catch {
    return null;
  }
}
