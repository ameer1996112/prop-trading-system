import {
  canonicalStringifyRdEntry,
  type CanonicalJsonInput,
} from "./rd-entry-domain";

export const ENTRY_POLICY_VERSION = "rd-entry-arbitration-v2" as const;

export const SOURCE_CLAIMS = {
  DIR_CLOSE: [
    "standard-close-2024-03",
    "closure-or-flip-2025-03",
    "directional-close-2025-08",
    "directional-close-required-2026-06",
    "model-continuation-2026-07",
  ],
  HTF_FLIP: [
    "htf-flip-2024-03",
    "htf-context-set-2025-08",
    "htf-flip-definition-2025-08",
    "pure-flip-narrowing-2026-05",
    "model-continuation-2026-07",
  ],
  LEGACY_BREAK_CANDLE: [
    "gold-break-exception-2025-03",
    "discretionary-break-2025-11",
    "reject-non-htf-break-2026-05",
    "break-normalized-to-flip-2026-06",
  ],
  LEGACY_REJECTION_RESPECT: [
    "closure-or-flip-2025-03",
    "directional-close-2025-08",
    "directional-close-required-2026-06",
  ],
  NEXT_CANDLE_WICK: [
    "next-candle-wick-2025-05",
    "prompt-close-2025-05",
    "close-fallback-2025-11",
  ],
  HTF_BOUNDARY: ["htf-boundary-caution-2025-08"],
} as const;

export async function canonicalSha256<const T>(
  value: CanonicalJsonInput<T>,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalStringifyRdEntry(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
