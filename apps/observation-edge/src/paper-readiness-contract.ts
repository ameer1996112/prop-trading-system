export type PaperKillSwitchCommand = {
  readonly schema_version: "1.0";
  readonly enabled: boolean;
  readonly reason: string;
};

export class PaperReadinessContractError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validatePaperKillSwitchCommand(
  value: unknown,
): PaperKillSwitchCommand {
  if (!isRecord(value)) {
    throw new PaperReadinessContractError("Kill-switch command must be an object");
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "enabled" ||
    keys[1] !== "reason" ||
    keys[2] !== "schema_version"
  ) {
    throw new PaperReadinessContractError(
      "Kill-switch command has unexpected fields",
    );
  }
  if (
    value.schema_version !== "1.0" ||
    typeof value.enabled !== "boolean" ||
    typeof value.reason !== "string"
  ) {
    throw new PaperReadinessContractError("Kill-switch command is malformed");
  }
  const reason = value.reason.trim();
  if (reason.length < 3 || reason.length > 240) {
    throw new PaperReadinessContractError(
      "Kill-switch reason must contain 3 to 240 characters",
    );
  }
  return {
    schema_version: "1.0",
    enabled: value.enabled,
    reason,
  };
}
