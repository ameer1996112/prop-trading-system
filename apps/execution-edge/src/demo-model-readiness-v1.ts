import { DEMO_MODELS } from "./demo-models-v1";
import { readGeometryPolicy, type GeometryPolicy } from "./demo-geometry-policy-v1";

export type ModelReadiness =
  | Readonly<{ ready: false; executionAllowed: false; reason: "ALL_MODEL_POLICIES_REQUIRED" }>
  | Readonly<{ ready: true; executionAllowed: false; policies: readonly GeometryPolicy[] }>;

export function assessModelReadiness(value: unknown): ModelReadiness {
  const blocked = Object.freeze({
    ready: false,
    executionAllowed: false,
    reason: "ALL_MODEL_POLICIES_REQUIRED",
  } as const);

  try {
    if (!Array.isArray(value)) return blocked;

    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.value !== DEMO_MODELS.length) return blocked;

    const policies: GeometryPolicy[] = [];
    for (let index = 0; index < DEMO_MODELS.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) return blocked;
      const policy = readGeometryPolicy(descriptor.value);
      if (!policy) return blocked;
      policies.push(policy);
    }

    if (DEMO_MODELS.some(model => policies.filter(policy => policy.model === model).length !== 1)) return blocked;

    const ordered = DEMO_MODELS.map(model => policies.find(policy => policy.model === model)!);
    return Object.freeze({
      ready: true,
      executionAllowed: false,
      policies: Object.freeze(ordered),
    });
  } catch {
    return blocked;
  }
}
