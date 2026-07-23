export type ConsoleConfig = {
  apiBaseUrl: string | null;
  fetchTimeoutMs: 2500;
};

export function getConsoleConfig(): ConsoleConfig {
  const value = process.env.PHASE0_API_BASE_URL?.trim();
  return { apiBaseUrl: value ? value.replace(/\/$/u, "") : null, fetchTimeoutMs: 2500 };
}
