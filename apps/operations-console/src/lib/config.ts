export type ConsoleConfig = {
  apiBaseUrl: string;
  fetchTimeoutMs: 2500;
};

export function getConsoleConfig(): ConsoleConfig {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";
  return {
    apiBaseUrl: configured.replace(/\/$/u, ""),
    fetchTimeoutMs: 2500,
  };
}
