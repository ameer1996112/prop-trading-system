import type { PaperSimulationAccount, PaperSimulationIntent } from "../../lib/api";
import type { EntryDecisionItem, EntryModel } from "../../lib/entry-decisions";
import type { PaperLedgerAccount } from "./ledger-api";

export type AccountView = {
  accountId: string;
  ledger: PaperLedgerAccount | null;
  simulation: PaperSimulationAccount | null;
  currencyCompatibility: "MATCH" | "MISMATCH" | "SINGLE_SOURCE";
  brokerEquityMinor: null;
  /** Simulation account winningTrades / settledTrades, expressed as a percentage. */
  winRatePercent: number | null;
};

type CurrencyGroup = {
  currencyCode: string;
  currencyScale: number;
  accountCount: number;
};

export type LedgerAccountGroup = CurrencyGroup & {
  openingBalanceMinor: bigint | null;
  ledgerDeltaMinor: bigint | null;
  balanceMinor: bigint | null;
};

export type SimulationAccountGroup = CurrencyGroup & {
  balanceMinor: bigint | null;
  realizedPnlMinor: bigint | null;
  openRiskMinor: bigint | null;
};

export type LedgerAccountAggregate = {
  accountCount: number;
  groups: LedgerAccountGroup[];
};

export type SimulationAccountAggregate = {
  accountCount: number;
  groups: SimulationAccountGroup[];
  /** Source account counts; one multi-account intent may contribute to multiple accounts. */
  openPositions: number | null;
  settledTrades: number | null;
  winningTrades: number | null;
  losingTrades: number | null;
  winRatePercent: number | null;
};

export type AccountSummary = {
  scope: "ACCOUNT_AGGREGATES";
  ledger: LedgerAccountAggregate | null;
  simulation: SimulationAccountAggregate | null;
  currencyMismatchAccountIds: string[];
};

export type IntentWindowSummary = {
  scope: "LOADED_INTENT_WINDOW";
  /** These outcomes use intent R, not allocation PnL (which can differ after rounding). */
  outcomeBasis: "SETTLED_OUTCOME_R";
  intentCount: number;
  openIntents: number;
  settledIntents: number;
  winningIntents: number;
  losingIntents: number;
  breakevenIntents: number;
  unknownOutcomeIntents: number;
  winRatePercent: number | null;
};

/** Formats an API minor-unit integer without dividing or rounding monetary Numbers. */
export function formatMinor(value: number | null, currency: string, scale: number): string {
  return formatMinorTotal(value !== null && Number.isSafeInteger(value) ? BigInt(value) : null, currency, scale);
}

/** Companion formatter for exact aggregate totals, including values beyond Number's safe range. */
export function formatMinorTotal(value: bigint | null, currency: string, scale: number): string {
  if (value === null || !Number.isInteger(scale) || scale < 0 || scale > 8) return "—";
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, "0");
  const amount = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return `${currency} ${sign}${amount}`;
}

function matchesQuery(query: string, fields: Array<string | null>): boolean {
  return fields.some((field) => field !== null && field.toLowerCase().includes(query));
}

export function selectIntents(
  intents: readonly PaperSimulationIntent[],
  accountId: string | null,
  model: EntryModel | null,
  query: string,
): PaperSimulationIntent[] {
  const normalizedQuery = query.trim().toLowerCase();
  return intents.filter((intent) =>
    (accountId === null || intent.allocations.some((allocation) => allocation.accountId === accountId)) &&
    (model === null || intent.selectedEntryModel === model) &&
    matchesQuery(normalizedQuery, [intent.symbol, intent.intentId, intent.setupId]),
  );
}

export function selectDecisions(
  decisions: readonly EntryDecisionItem[],
  intents: readonly PaperSimulationIntent[],
  accountId: string | null,
  model: EntryModel | null,
  query: string,
): EntryDecisionItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const accountIntentIds = new Set(
    intents.filter((intent) => intent.allocations.some((allocation) => allocation.accountId === accountId))
      .map((intent) => intent.intentId),
  );
  return decisions.filter((decision) =>
    (accountId === null || (decision.paperIntentId !== null && accountIntentIds.has(decision.paperIntentId))) &&
    (model === null || decision.selection.canonicalModel === model) &&
    matchesQuery(normalizedQuery, [decision.symbol, decision.setupId, decision.decisionId]),
  );
}

function winRatePercent(winning: number | null, settled: number | null): number | null {
  if (
    winning === null || settled === null || !Number.isSafeInteger(winning) ||
    !Number.isSafeInteger(settled) || settled <= 0 || winning < 0 || winning > settled
  ) return null;
  return (winning * 100) / settled;
}

/**
 * Union, not intersection. Both source balanceMinor fields originate in
 * paper_account_projections: neither is broker equity or balance plus simulation PnL.
 * Currency mismatches are retained explicitly; no cross-source amounts are joined.
 */
export function buildAccountViews(
  ledgerAccounts: readonly PaperLedgerAccount[] | null,
  simulationAccounts: readonly PaperSimulationAccount[] | null,
): AccountView[] {
  const ledgerById = new Map((ledgerAccounts ?? []).map((account) => [account.accountId, account]));
  const simulationById = new Map((simulationAccounts ?? []).map((account) => [account.accountId, account]));
  const ids = new Set([...ledgerById.keys(), ...simulationById.keys()]);
  return [...ids].map((accountId) => {
    const ledger = ledgerById.get(accountId) ?? null;
    const simulation = simulationById.get(accountId) ?? null;
    const currencyCompatibility = ledger === null || simulation === null ? "SINGLE_SOURCE" :
      ledger.currencyCode === simulation.currencyCode && ledger.currencyScale === simulation.currencyScale ? "MATCH" : "MISMATCH";
    return {
      accountId, ledger, simulation, currencyCompatibility, brokerEquityMinor: null,
      winRatePercent: simulation === null ? null : winRatePercent(simulation.winningTrades, simulation.settledTrades),
    };
  });
}

function sumMinor(values: readonly number[]): bigint | null {
  let sum = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) return null;
    sum += BigInt(value);
  }
  return sum;
}

function sumCounts(values: readonly number[]): number | null {
  if (values.some((value) => value < 0)) return null;
  const sum = sumMinor(values);
  return sum === null || sum > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(sum);
}

function currencyGroups<T extends { currencyCode: string; currencyScale: number }>(accounts: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const account of accounts) {
    const key = JSON.stringify([account.currencyCode, account.currencyScale]);
    const group = groups.get(key);
    if (group) group.push(account);
    else groups.set(key, [account]);
  }
  return [...groups.values()];
}

/** Source availability is independent: null means unavailable, [] means known empty. */
export function summarizeAccounts(
  ledgerAccounts: readonly PaperLedgerAccount[] | null,
  simulationAccounts: readonly PaperSimulationAccount[] | null,
): AccountSummary {
  const ledger: LedgerAccountAggregate | null = ledgerAccounts === null ? null : {
    accountCount: ledgerAccounts.length,
    groups: currencyGroups(ledgerAccounts).map((accounts) => ({
      currencyCode: accounts[0]!.currencyCode,
      currencyScale: accounts[0]!.currencyScale,
      accountCount: accounts.length,
      openingBalanceMinor: sumMinor(accounts.map((account) => account.openingBalanceMinor)),
      ledgerDeltaMinor: sumMinor(accounts.map((account) => account.ledgerDeltaMinor)),
      balanceMinor: sumMinor(accounts.map((account) => account.balanceMinor)),
    })),
  };
  let simulation: SimulationAccountAggregate | null = null;
  if (simulationAccounts !== null) {
    const winningTrades = sumCounts(simulationAccounts.map((account) => account.winningTrades));
    const settledTrades = sumCounts(simulationAccounts.map((account) => account.settledTrades));
    simulation = {
      accountCount: simulationAccounts.length,
      groups: currencyGroups(simulationAccounts).map((accounts) => ({
        currencyCode: accounts[0]!.currencyCode,
        currencyScale: accounts[0]!.currencyScale,
        accountCount: accounts.length,
        balanceMinor: sumMinor(accounts.map((account) => account.balanceMinor)),
        realizedPnlMinor: sumMinor(accounts.map((account) => account.realizedPnlMinor)),
        openRiskMinor: sumMinor(accounts.map((account) => account.openRiskMinor)),
      })),
      openPositions: sumCounts(simulationAccounts.map((account) => account.openPositions)),
      settledTrades,
      winningTrades,
      losingTrades: sumCounts(simulationAccounts.map((account) => account.losingTrades)),
      winRatePercent: winRatePercent(winningTrades, settledTrades),
    };
  }
  return {
    scope: "ACCOUNT_AGGREGATES", ledger, simulation,
    currencyMismatchAccountIds: buildAccountViews(ledgerAccounts, simulationAccounts)
      .filter((view) => view.currencyCompatibility === "MISMATCH").map((view) => view.accountId),
  };
}

/** Only the supplied (possibly filtered) window; never a lifetime or account-allocation metric. */
export function summarizeIntentWindow(intents: readonly PaperSimulationIntent[] | null): IntentWindowSummary | null {
  if (intents === null) return null;
  const settled = intents.filter((intent) => intent.state === "SETTLED");
  const known = settled.filter((intent) => intent.outcomeRMillis !== null && Number.isSafeInteger(intent.outcomeRMillis));
  const winningIntents = known.filter((intent) => intent.outcomeRMillis! > 0).length;
  const unknownOutcomeIntents = settled.length - known.length;
  return {
    scope: "LOADED_INTENT_WINDOW",
    outcomeBasis: "SETTLED_OUTCOME_R",
    intentCount: intents.length,
    openIntents: intents.filter((intent) => intent.state === "OPEN").length,
    settledIntents: settled.length,
    winningIntents,
    losingIntents: known.filter((intent) => intent.outcomeRMillis! < 0).length,
    breakevenIntents: known.filter((intent) => intent.outcomeRMillis === 0).length,
    unknownOutcomeIntents,
    winRatePercent: unknownOutcomeIntents > 0 ? null : winRatePercent(winningIntents, settled.length),
  };
}
