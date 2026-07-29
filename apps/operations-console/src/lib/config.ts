export type ConsoleConfig = {
  apiBaseUrl: string;
  fetchTimeoutMs: 6000;
  fetchAttempts: 2;
};

export function getConsoleConfig(): ConsoleConfig {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";
  return {
    apiBaseUrl: configured.replace(/\/$/u, ""),
    fetchTimeoutMs: 6000,
    fetchAttempts: 2,
  };
}
