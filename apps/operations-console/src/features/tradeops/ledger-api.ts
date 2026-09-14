import { fetchBounded, PaperAuthorizationError, parseStrictResponse } from "../../lib/api";

export type PaperLedgerAccount = {
  accountId: string;
  label: string;
  currencyCode: string;
  currencyScale: number;
  openingBalanceMinor: number;
  ledgerDeltaMinor: number;
  balanceMinor: number;
  lastSequence: number;
  createdAt: string;
};

function fail(): never {
  throw new Error("Paper ledger accounts are malformed.");
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail();
  return object;
}

function text(value: unknown, maximum: number, pattern: RegExp): string {
  if (
    typeof value !== "string" || value.length < 1 || value.length > maximum ||
    value.trim() !== value || !pattern.test(value)
  ) fail();
  return value;
}

function integer(value: unknown, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") fail();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u.exec(value);
  if (match === null) fail();
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const date = new Date(value);
  if (
    date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day || date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second
  ) fail();
  return value;
}

function parseAccount(value: unknown): PaperLedgerAccount {
  const account = record(value, [
    "schema_version", "account_id", "mode", "label", "currency_code", "currency_scale",
    "opening_balance_minor", "ledger_delta_minor", "balance_minor", "last_sequence", "created_at",
  ]);
  if (account.schema_version !== "1.0" || account.mode !== "PAPER_ONLY") fail();
  const accountId = text(account.account_id, 128, /^[A-Za-z0-9_.:-]+$/u);
  if (accountId === "." || accountId === "..") fail();
  const openingBalanceMinor = integer(account.opening_balance_minor, 0);
  const ledgerDeltaMinor = integer(account.ledger_delta_minor);
  const balanceMinor = integer(account.balance_minor);
  // Never allow floating-point rounding to hide an inconsistent ledger sum.
  if (BigInt(openingBalanceMinor) + BigInt(ledgerDeltaMinor) !== BigInt(balanceMinor)) fail();
  return {
    accountId,
    label: text(account.label, 80, /^[\x20-\x5b\x5d-\x7e]+$/u),
    currencyCode: text(account.currency_code, 3, /^[A-Z]{3}$/u),
    currencyScale: integer(account.currency_scale, 0, 8),
    openingBalanceMinor,
    ledgerDeltaMinor,
    balanceMinor,
    lastSequence: integer(account.last_sequence, 0),
    createdAt: timestamp(account.created_at),
  };
}

function parseAccounts(value: unknown): PaperLedgerAccount[] {
  const report = record(value, ["mode", "count", "items"]);
  if (
    report.mode !== "PAPER_ONLY" || !Array.isArray(report.items) ||
    integer(report.count, 0, 200) !== report.items.length
  ) fail();
  const accounts = report.items.map(parseAccount);
  if (new Set(accounts.map((account) => account.accountId)).size !== accounts.length) fail();
  return accounts;
}

export async function loadPaperLedgerAccounts(
  credential: string,
  signal?: AbortSignal,
): Promise<PaperLedgerAccount[]> {
  if (credential.length < 1 || credential.length > 1_024) {
    throw new Error("Paper operator credential is invalid.");
  }
  const response = await fetchBounded(
    "/api/v1/paper-accounts?limit=200",
    signal,
    { Authorization: `Bearer ${credential}` },
  );
  if (response.status === 401) throw new PaperAuthorizationError();
  if (response.status !== 200) throw new Error("Paper ledger accounts are unavailable.");
  return parseAccounts(await parseStrictResponse(response));
}
