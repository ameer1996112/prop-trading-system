import { formatMinorTotal, type AccountSummary } from "./model";
import type { PresentationStatus } from "./navigation";
import styles from "./tradeops.module.css";
export type AggregateBarProps = { summary: AccountSummary | null; status: PresentationStatus };

export function AggregateBar({ summary, status }: AggregateBarProps) {
  if (status !== "ready" || summary === null) {
    return <section className={styles.aggregateBar} aria-label="Account aggregates" aria-busy={status === "loading"}>
      <div className="flex flex-wrap items-center justify-between gap-4 py-1 font-mono text-[10px]">
        <span className="flex gap-3"><strong className="text-[var(--to-warning)]">PAPER</strong><span className="text-[var(--to-text-dim)]">Total PnL <span className="text-[var(--to-text-secondary)]">—</span></span></span>
        <span className="flex gap-4 text-[var(--to-text-dim)]"><span>Open —</span><span>Win Rate —</span><span>Accounts —</span></span>
        <span role="status" className={styles.srOnly}>{status === "loading" ? "Loading account aggregates" : "Account aggregates unavailable"}</span>
      </div>
    </section>;
  }
  return <section className={styles.aggregateBar} aria-label="Account aggregates">
    <div className={styles.aggregateHeading}><h2>Account aggregates</h2><span>Source account totals · not the loaded intent window</span></div>
    <div role="group" aria-label="Ledger account aggregates" className={styles.aggregateSource}>
      <span className={styles.aggregateSourceLabel}>Ledger <span className={styles.mono}>{summary.ledger?.accountCount ?? "—"}</span></span>
      {summary.ledger === null ? <span className={styles.sourceNote}>Ledger unavailable</span> : summary.ledger.groups.length === 0 ? <span className={styles.sourceNote}>No ledger accounts</span> : summary.ledger.groups.map((group) => (
        <div key={`${group.currencyCode}-${group.currencyScale}`} className={styles.currencyGroup}>
          <span className={styles.currencyLabel}>{group.currencyCode} · scale {group.currencyScale}</span>
          <dl className={styles.aggregateMetrics}>
            <div><dt>Balance</dt><dd>{formatMinorTotal(group.balanceMinor, group.currencyCode, group.currencyScale)}</dd></div>
            <div><dt>Ledger delta</dt><dd>{formatMinorTotal(group.ledgerDeltaMinor, group.currencyCode, group.currencyScale)}</dd></div>
          </dl>
        </div>
      ))}
    </div>
    <div role="group" aria-label="Simulation account aggregates" className={styles.aggregateSource}>
      <span className={styles.aggregateSourceLabel}>Simulation <span className={styles.mono}>{summary.simulation?.accountCount ?? "—"}</span></span>
      {summary.simulation === null ? <span className={styles.sourceNote}>Simulation unavailable</span> : summary.simulation.groups.length === 0 ? <span className={styles.sourceNote}>No simulation accounts</span> : summary.simulation.groups.map((group) => (
        <div key={`${group.currencyCode}-${group.currencyScale}`} className={styles.currencyGroup}>
          <span className={styles.currencyLabel}>{group.currencyCode} · scale {group.currencyScale}</span>
          <dl className={styles.aggregateMetrics}>
            <div><dt>Reported balance</dt><dd>{formatMinorTotal(group.balanceMinor, group.currencyCode, group.currencyScale)}</dd></div>
            <div><dt>Realized PnL</dt><dd className={group.realizedPnlMinor === null ? undefined : group.realizedPnlMinor < 0n ? styles.negative : group.realizedPnlMinor > 0n ? styles.positive : undefined}>{formatMinorTotal(group.realizedPnlMinor, group.currencyCode, group.currencyScale)}</dd></div>
            <div><dt>Open risk</dt><dd>{formatMinorTotal(group.openRiskMinor, group.currencyCode, group.currencyScale)}</dd></div>
          </dl>
        </div>
      ))}
      <dl className={styles.aggregateMetrics}>
        <div><dt>Open positions</dt><dd>{summary.simulation?.openPositions ?? "—"}</dd></div>
        <div><dt>Settled trades</dt><dd>{summary.simulation?.settledTrades ?? "—"}</dd></div>
        <div><dt>Win rate</dt><dd>{summary.simulation?.winRatePercent == null ? "—" : `${summary.simulation.winRatePercent.toFixed(1)}%`}</dd></div>
      </dl>
    </div>
    {summary.currencyMismatchAccountIds.length > 0 && <p className={styles.warningNote}>Currency/scale mismatch in {summary.currencyMismatchAccountIds.length} account(s) — sources kept separate.</p>}
  </section>;
}
