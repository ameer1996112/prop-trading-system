"use client";

import { useState, type ReactNode } from "react";
import { Activity, BarChart3, Download } from "lucide-react";
import type { PaperReadinessSnapshot, PaperSimulationIntent } from "../../lib/api";
import { formatMinor, summarizeIntentWindow, type AccountView } from "./model";
import type { PresentationStatus } from "./navigation";
import { AccountSourceView } from "./PaperViews";

/** Source-derived composition: donor AccountOverviewList, RiskMonitorTab,
 * JournalStats and analytics/page.tsx at cc740a197209cef27374ca6166a505b14af54ab6.
 * Legacy query hooks and mock values are deliberately not imported. */
export function OriginalAccountOverview({ accounts, status }: { accounts: readonly AccountView[]; status: PresentationStatus }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = status === "ready" ? accounts.find((account) => account.accountId === selectedId) : undefined;
  return <section aria-label="Account overview" className="space-y-4">
    {status !== "ready" || accounts.length === 0 ? <div className="glow-card p-8 text-center text-xs text-[var(--to-text-secondary)]">{status === "ready" ? "No paper accounts match this selection." : "Paper accounts unavailable. Unlock or refresh the paper session."}</div> : <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {accounts.map((account) => {
        const source = account.ledger ?? account.simulation;
        const label = source?.label ?? account.accountId;
        return <button type="button" key={account.accountId} aria-label={`Inspect paper account ${label}`} aria-pressed={selectedId === account.accountId} onClick={() => setSelectedId(account.accountId)} className="w-full text-left rounded-xl border border-[var(--to-border)] bg-[var(--to-surface)] p-4 transition-all duration-150 group hover:shadow-[0_0_16px_rgba(0,0,0,0.25)] hover:border-[var(--to-accent-blue)]">
          <div className="flex items-start justify-between gap-2 mb-3"><div className="min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className="font-mono font-bold text-sm text-[var(--to-text-primary)] truncate">{label}</span><span className="text-[9px] rounded border border-[var(--to-border)] px-1.5 py-0.5">PAPER</span></div><p className="mt-1 text-[10px] text-[var(--to-text-dim)]">Broker status unavailable</p></div><span aria-hidden="true">→</span></div>
          <div className="grid grid-cols-3 gap-3"><Metric label={account.ledger ? "Ledger balance" : "Simulation balance"} value={source ? formatMinor(source.balanceMinor, source.currencyCode, source.currencyScale) : "—"} /><Metric label="Equity" /><Metric label="Today" /></div>
          {account.currencyCompatibility === "MISMATCH" && <p className="mt-2 text-[10px] text-[var(--to-warning)]">Currency/scale conflict · inspect separate sources</p>}
        </button>;
      })}
    </div>}
    {selected && <div className="space-y-2"><button type="button" onClick={() => setSelectedId(null)} className="text-xs text-[var(--to-accent-blue)]">Close account details</button><AccountSourceView accounts={[selected]} status="ready" /></div>}
  </section>;
}

export function OriginalRiskMonitor({ data, accounts, accountId, children }: { data: PaperReadinessSnapshot | null; accounts: readonly AccountView[]; accountId: string | null; children: ReactNode }) {
  return <div className="space-y-3">
    <section className="glow-card p-4" aria-label="Fleet Summary"><div className="mb-3 flex items-center gap-2"><Activity size={14} className="text-[var(--to-accent-blue)]" /><h3 className="panel-label">Fleet Summary</h3><span className="text-[9px] text-[var(--to-text-dim)]">PAPER READINESS</span></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{[["Total Accounts", data?.accounts.length], ["Total Equity", null], ["Daily PnL", null], ["Open Intents", data?.openHealth.openIntents], ["With reasons", data?.accounts.filter((account) => account.reasons.length > 0).length], ["Stopped", data?.accounts.filter((account) => account.state === "STOPPED").length]].map(([label, value]) => <div key={label} className="rounded-lg border border-[var(--to-border)] bg-[var(--to-panel)]/60 p-3"><Metric label={String(label)} value={value == null ? "—" : String(value)} /></div>)}</div>
      <p className="mt-3 text-[10px] text-[var(--to-text-dim)]">All-account summary. Paper states are not broker guard status. Equity and cross-currency daily totals are unavailable.</p>
    </section>
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{data?.accounts.filter((item) => accountId === null || item.accountId === accountId).map((item) => {
      const account = accounts.find((value) => value.accountId === item.accountId);
      const ledger = account?.ledger;
      const currency = account?.simulation ?? ledger;
      const daily = currency && account?.currencyCompatibility !== "MISMATCH" ? formatMinor(item.dailyPnlMinor, currency.currencyCode, currency.currencyScale) : "Currency unavailable";
      return <article className="glow-card p-4" key={item.accountId}>
        <div className="flex items-start justify-between gap-3 border-b border-[var(--to-border)] pb-3"><div><h3 className="text-sm font-semibold text-[var(--to-text-primary)]">{item.label}</h3><p className="mt-1 text-[10px] text-[var(--to-text-dim)]">{item.accountId} · PAPER</p></div><span className="rounded-full border border-[var(--to-border)] px-2 py-1 text-[10px] tracking-[0.14em]">{item.state}</span></div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Ledger starting" value={ledger ? formatMinor(ledger.openingBalanceMinor, ledger.currencyCode, ledger.currencyScale) : "—"} /><Metric label="Broker equity" /><Metric label="Paper daily PnL" value={daily} /><Metric label="Effective risk %" /></div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2"><RiskProgress title="Drawdown" current={item.totalDrawdownBps} limit={data.thresholds.maxTotalDrawdownBps} /><RiskProgress title="Daily Loss Used" current={item.dailyLossBps} limit={data.thresholds.maxDailyLossBps} /></div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Open Pos" value={`${item.openPositions} / ${data.thresholds.maxOpenPositions}`} /><Metric label="Trades Today" /><Metric label="Risk Mult" /><Metric label="Base Risk" /></div>
        <div className="mt-3 space-y-2 border-t border-[var(--to-border)] pt-3"><h4 className="text-[10px] uppercase tracking-[0.16em] text-[var(--to-text-dim)]">Guard Rails</h4><p className="text-[10px] text-[var(--to-text-dim)]">Broker enforcement unavailable. Reported paper reasons:</p>{item.reasons.length ? item.reasons.map((reason, index) => <p key={index} className="text-[11px] text-[var(--to-warning)]">{reason.code} · {reason.message}</p>) : <p className="text-xs">No paper reasons reported.</p>}</div>
      </article>;
    })}</div>
    {children}
  </div>;
}

function RiskProgress({ title, current, limit }: { title: string; current: number; limit: number }) {
  const utilization = limit > 0 ? Math.min(100, Math.max(0, current / limit * 100)) : null;
  return <div className="rounded-lg border border-[var(--to-border)] p-3"><div className="flex justify-between gap-2 text-[10px]"><span>{title}</span><span className="font-mono">{current / 100}% / {limit / 100}%</span></div>{utilization === null ? <p className="mt-2 text-[10px]">Utilization unavailable</p> : <div role="meter" aria-label={`Paper ${title}`} aria-valuenow={utilization} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-1.5 rounded-full bg-[var(--to-border)]"><div className="h-full rounded-full bg-[var(--to-warning)]" style={{ width: `${utilization}%` }} /></div>}</div>;
}

export function OriginalJournalStats({ intents }: { intents: readonly PaperSimulationIntent[] | null }) {
  const stats = summarizeIntentWindow(intents);
  const cells = [["Total PnL", "—"], ["Win Rate", stats?.winRatePercent == null ? "—" : `${stats.winRatePercent.toFixed(1)}%`], ["Profit Factor", "—"], ["Avg R:R", "—"], ["Expectancy", "—"], ["Closed", stats == null ? "—" : String(stats.settledIntents)]];
  return <section aria-label="Journal statistics" className="space-y-2"><div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-[#2a2e39] rounded-xl overflow-hidden border border-[#2a2e39]">{cells.map(([label, value]) => <div className="flex flex-col gap-1 px-3 py-3 bg-[#0d1117]" key={label}><span className="font-mono text-[9px] uppercase tracking-wider text-[var(--to-text-dim)]">{label}</span><span className="font-mono text-[15px] font-semibold leading-tight">{value}</span></div>)}</div><p className="text-[10px] text-[var(--to-text-dim)]">Loaded paper window only; win rate uses settled intent R. Monetary performance and complete history are unavailable.</p></section>;
}

export function OriginalAnalyticsLayout({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6 pb-8 animate-fade-in-up">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--to-accent-blue)]/12 border border-[var(--to-accent-blue)]/25"><BarChart3 size={18} className="text-[var(--to-accent-blue)]" /></div><div><h2 className="page-title text-lg font-bold">Performance Intelligence</h2><p className="page-subtitle mt-0.5 text-xs">Deep-dive analytics · patterns · risk-adjusted metrics</p></div></div>
      <div className="flex flex-wrap items-center gap-2"><button type="button" disabled title="Historical analytics are unavailable." className="flex items-center gap-1.5 rounded-lg border border-[var(--to-border)] bg-[var(--to-surface)] px-3 py-1.5 text-[10px] opacity-40"><Download size={12} />Export CSV</button><UnavailableButtons label="Analytics period" values={["7d", "30d", "90d", "All"]} /><UnavailableButtons label="Analytics mode" values={["ALL", "LIVE", "PAPER"]} /></div>
    </div>
    <p className="text-xs text-[var(--to-text-secondary)]">Historical analytics are not connected. Controls are unavailable; loaded paper metrics below do not represent lifetime or broker performance.</p>
    <AnalyticsSection title="Performance Score" subtitle="Composite score across win rate, profit factor, risk-adjusted returns, and drawdown"><div className="glow-card p-6 grid grid-cols-1 gap-5 sm:grid-cols-[140px_1fr]"><div className="rounded-full border-8 border-[var(--to-border)] h-28 w-28 flex items-center justify-center font-mono text-3xl" aria-label="Performance score unavailable">—</div><div className="grid grid-cols-2 gap-3 md:grid-cols-3">{["Win Rate", "Profit Factor", "Expectancy", "Sharpe", "Sortino", "Max Drawdown"].map((label) => <Metric label={label} key={label} />)}</div></div></AnalyticsSection>
    {children}
    <AnalyticsSection title="Equity Curve" subtitle="Cumulative PnL over all closed trades"><HistoricalPanel text="Broker equity history unavailable." /></AnalyticsSection>
    <AnalyticsSection title="Drawdown Analysis" subtitle="Underwater equity curve — how deep and how long"><HistoricalPanel text="Broker drawdown history unavailable." /></AnalyticsSection>
    <AnalyticsSection title="Intelligence Insights" subtitle="Best-performing patterns · minimum 3 trades"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{["Best Symbol", "Best Hour", "Best Day", "Best Entry Model"].map((label) => <div key={label} className="glow-card p-4"><Metric label={label} /><p className="mt-3 text-[10px] text-[var(--to-text-dim)]">Historical source unavailable</p></div>)}</div></AnalyticsSection>
    <AnalyticsSection title="Strategy Breakdown" subtitle="Multi-strategy visibility by realized PnL, win rate, and trade count"><div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_280px]"><div className="glow-card p-4"><UnknownDataTable columns={["Strategy", "Trades", "PnL", "Win Rate"]} subject="Strategy Performance" /></div><div className="grid gap-3">{["Strategies Tracked", "Leading PnL", "Best Win Rate"].map((label) => <div className="glow-card p-3" key={label}><Metric label={label} /></div>)}</div></div></AnalyticsSection>
    <AnalyticsSection title="Breakdown Analysis" subtitle="Symbol performance and AI confidence correlation"><div className="grid grid-cols-1 gap-3 lg:grid-cols-2"><div className="glow-card p-4"><UnknownDataTable columns={["Symbol", "Trades", "PnL", "Win %"]} subject="Symbol Performance" /></div><HistoricalPanel text="AI confidence correlation unavailable. No AI provider is connected." /></div></AnalyticsSection>
    <AnalyticsSection title="Time-of-Day Analysis" subtitle="PnL distribution across trading hours (UTC)"><HistoricalPanel text="PnL by Hour of Day (UTC) unavailable." /></AnalyticsSection>
    <AnalyticsSection title="Pattern Analysis" subtitle="Day-of-week performance and entry model breakdown"><div className="grid grid-cols-1 gap-3 lg:grid-cols-2"><HistoricalPanel text="Day of Week performance unavailable." /><div className="glow-card p-4"><UnknownDataTable columns={["Entry Model", "Trades", "PnL", "Win %"]} subject="Entry Model Breakdown" /></div></div></AnalyticsSection>
    <AnalyticsSection title="Rolling Metrics" subtitle="10-trade rolling window — Win Rate, Profit Factor, Avg R:R"><HistoricalPanel text="Complete, ordered historical outcomes are unavailable." /></AnalyticsSection>
    <AnalyticsSection title="Streak Analysis" subtitle="Win/loss streak history and current momentum"><HistoricalPanel text="A partial returned window cannot establish historical streaks." /></AnalyticsSection>
    <AnalyticsSection title="Zone & Setup Analysis" subtitle="Performance by zone type and setup quality"><div className="glow-card p-4"><UnknownDataTable columns={["Zone Type", "Trades", "Win Rate", "Avg R:R", "PnL"]} subject="Zone Type Breakdown" /></div></AnalyticsSection>
  </div>;
}

function UnavailableButtons({ label, values }: { label: string; values: string[] }) {
  return <div role="group" aria-label={label} className="surface-soft flex items-center gap-0.5 rounded-lg p-0.5">{values.map((value) => <button type="button" disabled key={value} title="Historical data source unavailable" className="rounded-md px-2.5 py-1 text-[10px] font-mono text-[var(--to-text-dim)] opacity-60">{value}</button>)}</div>;
}
function AnalyticsSection({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <section aria-label={title} className="space-y-3"><div><h3 className="text-sm font-semibold">{title}</h3><p className="text-[11px] text-[var(--to-text-dim)] mt-1">{subtitle}</p></div>{children}</section>;
}
function HistoricalPanel({ text }: { text: string }) {
  return <div className="glow-card min-h-[180px] p-6 flex items-center justify-center text-center text-xs text-[var(--to-text-secondary)]">{text}</div>;
}
function Metric({ label, value = "—" }: { label: string; value?: string }) {
  return <div><p className="text-[9px] uppercase tracking-wider text-[var(--to-text-dim)] mb-0.5">{label}</p><p className="font-mono text-xs font-semibold text-[var(--to-text-primary)] break-words">{value}</p></div>;
}
export function UnknownDataTable({ columns, subject }: { columns: string[]; subject: string }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-[11px]" aria-label={subject}><thead><tr>{columns.map((column) => <th className="border-b border-[var(--to-border)] px-3 py-2 text-[var(--to-text-dim)] font-medium whitespace-nowrap" key={column}>{column}</th>)}</tr></thead><tbody><tr><td colSpan={columns.length} className="p-6 text-center text-[var(--to-text-secondary)]">{subject} unavailable</td></tr></tbody></table></div>;
}
