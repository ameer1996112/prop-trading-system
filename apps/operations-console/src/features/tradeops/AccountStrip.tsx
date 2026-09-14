"use client";

import { AlertTriangle } from "lucide-react";
import { formatMinor, type AccountView } from "./model";
import type { PresentationStatus } from "./navigation";
import styles from "./tradeops.module.css";
export type AccountStripProps = {
  accounts: readonly AccountView[];
  status: PresentationStatus;
  selectedAccountId?: string | null;
  onAccountSelect?: (accountId: string | null) => void;
};

export function AccountStrip({ accounts, status, selectedAccountId = null, onAccountSelect }: AccountStripProps) {
  if (status !== "ready" || accounts.length === 0) {
    return <section aria-label="Paper accounts"><div className={styles.emptyState} role="status" aria-busy={status === "loading"}>
      {status === "loading" ? "Loading paper accounts" : status === "unavailable" ? "Paper accounts unavailable" : "No paper accounts"}
    </div></section>;
  }

  return <section className={styles.accountGrid} aria-label="Paper accounts">
    {accounts.map((account) => {
      const { ledger, simulation } = account;
      const label = ledger?.label ?? simulation?.label ?? account.accountId;
      const selected = selectedAccountId === account.accountId;
      return <article key={account.accountId} className={`${styles.accountCard} ${selected ? styles.accountSelected : ""}`}>
        <div className={styles.accountHeading}>
          {onAccountSelect ? <button type="button" className={styles.accountSelect} aria-label={`Filter by ${label}`} aria-pressed={selected} onClick={() => onAccountSelect(selected ? null : account.accountId)}>{label}</button> : <h3>{label}</h3>}
          <span className={styles.paperBadge}>PAPER</span>
        </div>
        <span className={styles.accountId}>{account.accountId}</span>
        <dl className={styles.accountMetrics}>
          <div className={styles.primaryBalance}><dt>Ledger balance</dt><dd>{ledger ? formatMinor(ledger.balanceMinor, ledger.currencyCode, ledger.currencyScale) : "—"}</dd></div>
          <div><dt>Simulation-reported balance</dt><dd>{simulation ? formatMinor(simulation.balanceMinor, simulation.currencyCode, simulation.currencyScale) : "—"}</dd></div>
          <div><dt>Broker equity</dt><dd>—</dd></div>
          <div><dt>Win rate</dt><dd>{account.winRatePercent === null ? "—" : `${account.winRatePercent.toFixed(1)}%`}</dd></div>
        </dl>
        {!ledger && <p className={styles.sourceNote}>Ledger source unavailable</p>}
        {!simulation && <p className={styles.sourceNote}>Simulation source unavailable</p>}
        {account.currencyCompatibility === "MISMATCH" && <p className={styles.warningNote}><AlertTriangle size={12} aria-hidden="true" />Currency/scale mismatch — sources kept separate</p>}
      </article>;
    })}
  </section>;
}
