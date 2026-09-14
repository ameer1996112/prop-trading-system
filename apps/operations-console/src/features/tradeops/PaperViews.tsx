"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ObservationReceiptsSnapshot, PaperReadinessSnapshot, PaperSimulationIntent } from "../../lib/api";
import { formatMinor, summarizeIntentWindow, type AccountView } from "./model";
import type { PresentationStatus } from "./navigation";
import styles from "./tradeops.module.css";

type Freshness = { lastSuccess: number | null; loading: boolean; stale: boolean; error: string | null };

export function ResourceStatus({ label, resource, locked = false }: { label: string; resource: Freshness; locked?: boolean }) {
  const state = locked ? "Locked" : resource.loading ? `Refreshing${resource.stale ? " · Stale" : ""}` : resource.stale ? "Stale" : "Current";
  const lastSuccess = resource.lastSuccess === null ? "Never" : new Date(resource.lastSuccess).toISOString();
  return <div role="status" aria-label={`${label} freshness`} className={styles.resourceStatus}>
    <strong>{label}</strong><span className={resource.stale ? styles.warning : styles.muted}>{state}</span>
    {resource.error && <span className={styles.warning}>{resource.error}</span>}
    <span>Last success: {lastSuccess}</span>
  </div>;
}

function Panel({ title, name = title, badge = "PAPER", children }: { title: string; name?: string; badge?: "PAPER" | "PUBLIC"; children: ReactNode }) {
  return <section className={styles.panel} aria-label={name}>
    <header className={styles.panelHeader}><h2 className={styles.panelTitle}>{title}</h2><span className={badge === "PAPER" ? styles.paperBadge : styles.badge}>{badge}</span></header>
    {children}
  </section>;
}

function Unavailable({ status, subject }: { status: PresentationStatus; subject: string }) {
  return <p className={styles.panelBody}>{status === "loading" ? `Loading ${subject}…` : `${subject} unavailable. Unlock or refresh the paper session.`}</p>;
}

/** Readiness/allocation payloads carry minor units without their own currency metadata. */
function accountAmount(value: number | null, account: AccountView | undefined): string {
  if (value === null) return "—";
  if (account?.currencyCompatibility === "MISMATCH") return `Currency/scale conflict · ${value} minor units`;
  const source = account?.simulation ?? account?.ledger;
  return source ? formatMinor(value, source.currencyCode, source.currencyScale) : `Currency unavailable · ${value} minor units`;
}

export function PaperIntentView({ intents, accounts, status, settled = false }: {
  intents: readonly PaperSimulationIntent[]; accounts: readonly AccountView[]; status: PresentationStatus; settled?: boolean;
}) {
  const [exitFilter, setExitFilter] = useState("");
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const inspectTrigger = useRef<HTMLButtonElement | null>(null);
  const title = settled ? "Paper journal" : "Open paper positions";
  const records = intents.filter((intent) => intent.state === (settled ? "SETTLED" : "OPEN") && (!settled || !exitFilter || (exitFilter === "UNKNOWN" ? intent.exitReason === null : intent.exitReason === exitFilter)));
  const inspected = status === "ready" ? records.find((intent) => intent.intentId === inspectedId) : undefined;
  const inspectedIntentId = inspected?.intentId;
  useEffect(() => { if (inspectedIntentId) inspectorHeading.current?.focus(); }, [inspectedIntentId]); // Only user-selected record changes move focus.
  return <Panel title={title}>
    <div className={styles.setupNotes}>
      <p className={styles.sourceNote}>Latest returned intent window, at most 50 records; local filters apply. This is not complete history.</p>
      <p className={styles.sourceNote}>{settled ? "Settled paper intents only; these are not broker fills." : "Open paper intents only; these are not broker positions."}</p>
    </div>
    {settled && <div className={styles.panelBody}><label className={styles.field}>Settlement status<select className={styles.select} disabled={status !== "ready"} value={exitFilter} onChange={(event) => { setExitFilter(event.target.value); setInspectedId(null); }}><option value="">All settled</option><option value="TARGET">Target</option><option value="STOP">Stop</option><option value="MANUAL">Manual</option><option value="UNKNOWN">Unknown exit</option></select></label><p className={styles.sourceNote}>Filters the journal table only; summary statistics describe the loaded window.</p></div>}
    {inspected && <section aria-label="Paper trade details" className={`${styles.panelBody} ${styles.detailCard}`}>
      <div className="flex items-center justify-between gap-3"><h3 ref={inspectorHeading} tabIndex={-1}>Paper trade · {inspected.symbol}</h3><button type="button" className={styles.button} onClick={() => { setInspectedId(null); inspectTrigger.current?.focus(); }}>Close trade details</button></div>
      <p className={styles.sourceNote}>Read-only paper record, not a broker fill.</p><dl className={styles.thresholdGrid}>{[["Intent", inspected.intentId], ["Setup", inspected.setupId ?? "Unavailable"], ["Receipt", inspected.sourceReceiptId ?? "Unavailable"], ["Entry", inspected.entryPrice], ["Stop", inspected.stopLoss], ["Target", inspected.takeProfit], ["Entry model", inspected.selectedEntryModel ?? "Unavailable"], ["Exit", inspected.exitReason ?? "Unavailable"], ["Settled", inspected.settledAt ?? "Unavailable"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </section>}
    {status !== "ready" ? <Unavailable status={status} subject={title} /> : records.length === 0 ? <p className={styles.panelBody}>
      {settled ? "No settled paper intents match the loaded window filters." : "No open paper intents match the loaded window filters."}
    </p> : <div className={styles.tableScroll}>
      <table className={`${styles.table} ${styles.paperTable}`} aria-label={title}>
        <thead><tr>{["Symbol / intent", "Side / model", "Entry", "Stop", "Target", "Risk", "Paper source", "Allocations", settled ? "Settlement" : "Created"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{records.map((intent) => <tr key={intent.intentId} id={`paper-record-${intent.intentId}`}>
          <td><button type="button" className="text-[var(--to-accent-blue)] hover:underline font-semibold" aria-label={`Inspect ${intent.symbol} paper trade`} onClick={(event) => { inspectTrigger.current = event.currentTarget; setInspectedId(intent.intentId); }}>{intent.symbol}</button><span className={styles.cellDetail}>{intent.intentId}</span><span className={styles.cellDetail}>{intent.setupId ?? "No setup link"}</span></td>
          <td><span className={intent.side === "BUY" ? styles.positive : styles.negative}>{intent.side}</span><span className={styles.cellDetail}>{intent.selectedEntryModel ?? "No selected model"}</span><span className={styles.sourceNote}>Co-triggered: {intent.coTriggeredModels.join(", ") || "None"}</span></td>
          <td>{intent.entryPrice}</td><td>{intent.stopLoss}</td><td>{intent.takeProfit}</td><td>{intent.riskBps} bps</td>
          <td><span>{intent.source}</span><span className={styles.cellDetail}>{intent.sourceReceiptId ?? "No receipt link"}</span><span className={styles.paperBadge}>{intent.state}</span></td>
          <td><ul className={styles.allocations}>{intent.allocations.map((allocation) => <li key={allocation.accountId}>
            <strong>{allocation.accountId}</strong><dl className={styles.compactMetrics}>
              <div><dt>Risk</dt><dd>{accountAmount(allocation.riskAmountMinor, accounts.find((account) => account.accountId === allocation.accountId))}</dd></div>
              <div><dt>Balance before</dt><dd>{accountAmount(allocation.balanceBeforeMinor, accounts.find((account) => account.accountId === allocation.accountId))}</dd></div>
              <div><dt>Realized PnL</dt><dd>{accountAmount(allocation.pnlMinor, accounts.find((account) => account.accountId === allocation.accountId))}</dd></div>
            </dl>
          </li>)}</ul></td>
          <td>{settled ? <><span>{intent.exitReason ?? "Exit reason unavailable"}</span><span className={styles.cellDetail}>{intent.settledAt ?? "Settlement time unavailable"}</span><span className={styles.cellDetail}>{intent.outcomeRMillis === null ? "Outcome unavailable" : `${intent.outcomeRMillis / 1_000}R`}</span><span className={styles.sourceNote}>Created: {intent.createdAt}</span></> : intent.createdAt}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </Panel>;
}

export function AccountSourceView({ accounts, status }: { accounts: readonly AccountView[]; status: PresentationStatus }) {
  return <Panel title="Account source details">
    <p className={`${styles.panelBody} ${styles.sourceNote}`}>Joined by account ID; ledger and simulation balances remain separate. Neither source is broker equity.</p>
    {status !== "ready" ? <Unavailable status={status} subject="Account sources" /> : accounts.length === 0 ? <p className={styles.panelBody}>No paper accounts match this selection.</p> : <div className={styles.detailGrid}>
      {accounts.map(({ accountId, ledger, simulation, currencyCompatibility, winRatePercent }) => <article key={accountId} className={styles.detailCard}>
        <h3>{ledger?.label ?? simulation?.label ?? accountId}</h3><p className={styles.mono}>{accountId}</p>
        {ledger ? <dl className={styles.compactMetrics}>
          <div><dt>Ledger opening balance</dt><dd>{formatMinor(ledger.openingBalanceMinor, ledger.currencyCode, ledger.currencyScale)}</dd></div>
          <div><dt>Ledger delta</dt><dd>{formatMinor(ledger.ledgerDeltaMinor, ledger.currencyCode, ledger.currencyScale)}</dd></div>
          <div><dt>Ledger balance</dt><dd>{formatMinor(ledger.balanceMinor, ledger.currencyCode, ledger.currencyScale)}</dd></div>
          <div><dt>Ledger sequence</dt><dd>{ledger.lastSequence}</dd></div>
          <div><dt>Created</dt><dd>{ledger.createdAt}</dd></div>
        </dl> : <p className={styles.sourceNote}>Ledger source unavailable</p>}
        {simulation ? <dl className={styles.compactMetrics}>
          <div><dt>Simulation-reported balance</dt><dd>{formatMinor(simulation.balanceMinor, simulation.currencyCode, simulation.currencyScale)}</dd></div>
          <div><dt>Realized PnL</dt><dd>{formatMinor(simulation.realizedPnlMinor, simulation.currencyCode, simulation.currencyScale)}</dd></div>
          <div><dt>Open risk</dt><dd>{formatMinor(simulation.openRiskMinor, simulation.currencyCode, simulation.currencyScale)}</dd></div>
          <div><dt>Max drawdown</dt><dd>{formatMinor(simulation.maxDrawdownMinor, simulation.currencyCode, simulation.currencyScale)}</dd></div>
          <div><dt>Open positions</dt><dd>{simulation.openPositions}</dd></div>
          <div><dt>Settled trades</dt><dd>{simulation.settledTrades}</dd></div>
          <div><dt>Winning / losing</dt><dd>{simulation.winningTrades} / {simulation.losingTrades}</dd></div>
          <div><dt>Win rate</dt><dd>{winRatePercent === null ? "—" : `${winRatePercent.toFixed(1)}%`}</dd></div>
        </dl> : <p className={styles.sourceNote}>Simulation source unavailable</p>}
        {currencyCompatibility === "MISMATCH" && <p className={styles.warningNote}>Currency/scale mismatch — sources kept separate.</p>}
        <p className={styles.sourceNote}>Broker equity unavailable</p>
      </article>)}
    </div>}
  </Panel>;
}

export function ReadinessBrief({ data }: { data: PaperReadinessSnapshot | null }) {
  return <section className={styles.readinessBrief} aria-label="Paper readiness summary">
    <strong>Paper readiness: <span className={data?.state === "READY" ? styles.positive : styles.warning}>{data?.state ?? "Unavailable"}</span></strong>
    <span>{data ? `${data.reasons.length} reported reason(s) · Kill switch ${data.killSwitch.enabled ? "ENABLED" : "DISABLED"}` : "Unlock paper data for readiness checks."}</span>
    <span className={styles.sourceNote}>Read-only paper assessment · no live-trading permission.</span>
  </section>;
}

export function RiskReadinessView({ data, accounts, accountId, status }: {
  data: PaperReadinessSnapshot | null; accounts: readonly AccountView[]; accountId: string | null; status: PresentationStatus;
}) {
  return <Panel title="Paper risk and readiness">
    <div className={styles.panelBody}>
      <p className={styles.sourceNote}>READY describes paper readiness, not permission for live trading. All controls are read-only.</p>
      {data === null ? <Unavailable status={status} subject="Paper readiness" /> : <div className={styles.viewStack}>
        <div className={styles.readinessBrief}><strong className={data.state === "READY" ? styles.positive : styles.warning}>{data.state}</strong><span>Evaluated: {data.evaluatedAt}</span><span>Execution: {data.execution}</span></div>
        <p>Kill switch: {data.killSwitch.enabled ? "ENABLED" : "DISABLED"} · read-only</p>
        <p className={styles.sourceNote}>Reason: {data.killSwitch.reason ?? "None reported"} · Changed: {data.killSwitch.changedAt ?? "Unavailable"}</p>
        <h3 className={styles.panelTitle}>Reported thresholds</h3>
        <dl className={styles.thresholdGrid}>
          <div><dt>Receipt max age</dt><dd>{data.thresholds.receiptMaxAgeSeconds} seconds</dd></div>
          <div><dt>Stale trade age</dt><dd>{data.thresholds.staleTradeSeconds} seconds</dd></div>
          <div><dt>Max daily loss</dt><dd>{data.thresholds.maxDailyLossBps} bps</dd></div>
          <div><dt>Max total drawdown</dt><dd>{data.thresholds.maxTotalDrawdownBps} bps</dd></div>
          <div><dt>Max open risk</dt><dd>{data.thresholds.maxOpenRiskBps} bps</dd></div>
          <div><dt>Max open positions</dt><dd>{data.thresholds.maxOpenPositions}</dd></div>
        </dl>
        <h3 className={styles.panelTitle}>Global readiness reasons</h3>
        {data.reasons.length === 0 ? <p className={styles.sourceNote}>No global reasons reported.</p> : <ul className={styles.reasonList}>{data.reasons.map((reason, index) => <li key={index}><strong>{reason.code}</strong><p>{reason.message}</p>{reason.accountId && <span className={styles.mono}>{reason.accountId}</span>}</li>)}</ul>}
        <dl className={styles.thresholdGrid}>
          <div><dt>Open intents</dt><dd>{data.openHealth.openIntents}</dd></div>
          <div><dt>Stale open intents</dt><dd>{data.openHealth.staleOpenIntents}</dd></div>
          <div><dt>Oldest open intent</dt><dd>{data.openHealth.oldestOpenIntentAt ?? "Unavailable"}</dd></div>
        </dl>
        <p className={styles.sourceNote}>{data.latestReceipt ? `Latest automation receipt: ${data.latestReceipt.receiptId} · ${data.latestReceipt.symbol} · ${data.latestReceipt.receivedAt} · Sequence ${data.latestReceipt.sequence} · Age ${data.latestReceipt.ageSeconds ?? "unknown"} seconds` : "No automation receipt reported."}</p>
        <h3 className={styles.panelTitle}>Per-account readiness</h3>
        {data.accounts.filter((item) => accountId === null || item.accountId === accountId).map((item) => <article className={styles.detailCard} key={item.accountId}>
          <h4>{item.label} · {item.state}</h4><p className={styles.mono}>{item.accountId}</p>
          <dl className={styles.thresholdGrid}>
            <div><dt>Daily PnL</dt><dd>{accountAmount(item.dailyPnlMinor, accounts.find((account) => account.accountId === item.accountId))}</dd></div>
            <div><dt>Daily loss</dt><dd>{item.dailyLossBps} bps</dd></div>
            <div><dt>Total drawdown</dt><dd>{item.totalDrawdownBps} bps</dd></div>
            <div><dt>Open risk</dt><dd>{item.openRiskBps} bps</dd></div>
            <div><dt>Open positions</dt><dd>{item.openPositions}</dd></div>
          </dl>
          {item.reasons.length === 0 ? <p className={styles.sourceNote}>No account reasons reported.</p> : <ul className={styles.reasonList}>{item.reasons.map((reason, index) => <li key={index}><strong>{reason.code}</strong><p>{reason.message}</p></li>)}</ul>}
        </article>)}
        {data.accounts.length === 0 && <p className={styles.sourceNote}>No account readiness records.</p>}
      </div>}
    </div>
  </Panel>;
}

export function PaperAnalyticsView({ intents }: { intents: readonly PaperSimulationIntent[] | null }) {
  const summary = summarizeIntentWindow(intents);
  return <Panel title="Paper analytics">
    <div className={`${styles.panelBody} ${styles.viewStack}`}>
      <p className={styles.sourceNote}>All-account source aggregates above remain unfiltered, grouped by currency AND scale. They are separate from the distinct intent counts below.</p>
      <p className={styles.sourceNote}>Latest returned intent window, at most 50 records; current local filters apply. Not complete history. Multi-account allocations do not multiply these intent counts.</p>
      <dl className={styles.thresholdGrid}>
        <div><dt>Distinct loaded intents</dt><dd>{summary?.intentCount ?? "—"}</dd></div>
        <div><dt>Open intents</dt><dd>{summary?.openIntents ?? "—"}</dd></div>
        <div><dt>Settled intents</dt><dd>{summary?.settledIntents ?? "—"}</dd></div>
        <div><dt>Winning intents</dt><dd>{summary?.winningIntents ?? "—"}</dd></div>
        <div><dt>Losing intents</dt><dd>{summary?.losingIntents ?? "—"}</dd></div>
        <div><dt>Breakeven intents</dt><dd>{summary?.breakevenIntents ?? "—"}</dd></div>
        <div><dt>Unknown outcomes</dt><dd>{summary?.unknownOutcomeIntents ?? "—"}</dd></div>
        <div><dt>Loaded-window win rate</dt><dd>{summary?.winRatePercent == null ? "—" : `${summary.winRatePercent.toFixed(1)}%`}</dd></div>
      </dl>
      <p className={styles.sourceNote}>Outcome basis: settled intent R, not rounded allocation PnL. An unavailable window is shown as —; a loaded empty window has zero intents.</p>
      <p className={styles.sourceNote}>No broker performance or equity curve is available.</p>
    </div>
  </Panel>;
}

export function ObservationLog({ data, status, accountSelected }: { data: ObservationReceiptsSnapshot | null; status: PresentationStatus; accountSelected: boolean }) {
  return <Panel title="Live Log" name="Observation log" badge="PUBLIC">
    <div className={styles.setupNotes}><p className={styles.sourceNote}>Public observations · latest returned window, at most 50.</p>
      {accountSelected && <p className={styles.warningNote}>Observations are unfiltered and account-independent.</p>}
      {data && <p className={styles.sourceNote}>Ingress {data.ingressEnabled === null ? "unknown" : data.ingressEnabled ? "enabled" : "disabled"} · {data.state} · {data.count} returned</p>}
    </div>
    {data === null ? <Unavailable status={status} subject="Observation log" /> : data.items.length === 0 ? <p className={styles.panelBody}>No public observations in this window.</p> : <ol className={styles.observationList}>
      {data.items.slice(0, 50).map((receipt, index) => <li key={`${receipt.source}-${receipt.sequence}-${receipt.receivedAt}-${index}`}>
        <div className={styles.logHeading}><span className={styles.badge}>{receipt.source}</span><strong>{receipt.symbol}</strong></div>
        <time dateTime={receipt.receivedAt}>{receipt.receivedAt}</time>
        <p>{receipt.feed} · {receipt.kind}</p><p>Sequence {receipt.sequence} · {receipt.status}</p>
      </li>)}
    </ol>}
  </Panel>;
}
