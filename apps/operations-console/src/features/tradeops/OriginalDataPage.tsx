"use client";

import { useId, useState, type ReactNode } from "react";
import { BookOpen, Download, Settings2, Shield } from "lucide-react";
import type { TradeOpsView } from "./navigation";
import type { PaperReadinessSnapshot, PaperSimulationIntent } from "../../lib/api";
import type { AccountView } from "./model";
import { OriginalAnalyticsLayout, OriginalJournalStats, OriginalRiskMonitor } from "./OriginalDataPanels";

/** Presentation extracted from donor accounts, risk, analytics and journal pages at cc740a1.
 * The paper adapter content is supplied by the one session owner; no original hooks mount. */
export function OriginalDataPage({ view, children, accounts = [], accountId = null, readiness = null, intents = null, filters }: { view: TradeOpsView; children: ReactNode; accounts?: readonly AccountView[]; accountId?: string | null; readiness?: PaperReadinessSnapshot | null; intents?: readonly PaperSimulationIntent[] | null; filters?: ReactNode }) {
  const [tab, setTab] = useState("Monitor");
  const [journalTab, setJournalTab] = useState("Table");
  if (view === "accounts") return <div className="space-y-6">
    <p className="page-subtitle text-xs">Overview of paper accounts. Select an account to inspect its source data.</p>
    {children}
    <details className="rounded-xl border border-[var(--to-border)]">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-[var(--to-text-secondary)]"><Settings2 size={16} className="text-[var(--to-warning)]" />Manage Broker Credentials</summary>
      <div className="border-t border-[var(--to-border)] p-4 space-y-3"><p className="text-xs text-[var(--to-text-secondary)]">Broker credential management is unavailable in this read-only console. No credentials from the old project are loaded.</p><button type="button" disabled className="rounded-md border border-[var(--to-border)] px-3 py-1.5 text-xs opacity-50">Add broker profile</button></div>
    </details>
  </div>;

  if (view === "risk") return <div className="space-y-4 animate-fade-in-up">
    <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 border border-indigo-500/20"><Shield size={16} className="text-indigo-400" /></div><p className="page-subtitle text-[11px]">Risk monitoring, trade guards, and strategy rules · paper sources only</p></div>
    <LocalTabs label="Risk sections" values={["Monitor", "Guards", "Risk Rules", "Strategy"]} value={tab} onChange={setTab}>
      {tab === "Monitor" ? <OriginalRiskMonitor accounts={accounts} accountId={accountId} data={readiness}>{children}</OriginalRiskMonitor> : tab === "Risk Rules" ? <div className="space-y-3"><header className="flex items-center justify-between"><h3 className="text-sm font-semibold">Symbol Risk Rules</h3><button type="button" disabled className="rounded-md border border-[var(--to-border)] px-3 py-1 text-xs opacity-50">Add Rule</button></header><p className="text-xs text-[var(--to-text-secondary)]">Symbol rules and rule editing are unavailable. No inferred risk settings are applied.</p><UnknownTable columns={["Symbol", "Risk %", "Max Lot", "Min Lot", "Lot Step", "SL Buffer", "Max Positions", "Enabled"]} subject="Symbol risk rules" /></div> : <div className="glow-card p-4 space-y-3"><h3 className="text-sm font-semibold">{tab === "Guards" ? "Trade Guards" : "Strategy Rules"}</h3><p className="text-xs text-[var(--to-text-secondary)]">{tab === "Guards" ? "Live guard configuration and broker enforcement status are unavailable." : "The strategy rule catalog is not connected. Pine rules are not read or modified here."}</p><UnknownTable columns={tab === "Guards" ? ["Guard", "Status", "Scope", "Last Check"] : ["Strategy", "Rule", "Value", "Enabled"]} subject={tab} /></div>}
    </LocalTabs>
  </div>;

  if (view === "journal") return <div className="space-y-4">
    <div className="flex items-center gap-2 text-[var(--to-text-secondary)]"><BookOpen size={16} /><p className="text-xs">Review settled paper intents. Historical broker trades are not connected.</p></div>
    <OriginalJournalStats intents={intents} />
    {filters}
    <div className="flex flex-wrap gap-3 items-center rounded-xl border border-[var(--to-border)] bg-[var(--to-surface)] p-3">
      <label className="text-xs">Period <select disabled className="ml-2 rounded border border-[var(--to-border)] bg-[var(--to-surface-raised)] p-1"><option>Loaded window only</option></select></label>
      <label className="text-xs">Mode <select disabled className="ml-2 rounded border border-[var(--to-border)] bg-[var(--to-surface-raised)] p-1"><option>Paper</option></select></label>
      <button type="button" disabled className="ml-auto flex gap-2 items-center text-xs opacity-50" title="Complete journal export requires a historical data source."><Download size={14} />Export CSV</button>
    </div>
    <LocalTabs label="Journal view" values={["Table", "Calendar"]} value={journalTab} onChange={setJournalTab}>
      {journalTab === "Calendar" ? <div className="glow-card p-4"><h3 className="text-sm font-semibold mb-4">Calendar PnL</h3><div className="grid grid-cols-7 gap-1 text-center text-[10px] text-[var(--to-text-dim)]">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}</div><p className="py-16 text-center text-xs text-[var(--to-text-secondary)]">Calendar PnL unavailable: complete daily history is not connected.</p></div> : <div className="space-y-4"><section className="glow-card p-4"><h3 className="text-sm font-semibold mb-3">Symbol Breakdown</h3><UnknownTable columns={["Symbol", "Trades", "Win %", "Avg PnL", "Best", "Worst", "Total PnL"]} subject="Historical symbol performance" /></section><UnknownChart title="Equity Curve" description="Historical broker equity is unavailable; paper intent outcomes are not an equity curve." /><UnknownChart title="Drawdown" description="Historical drawdown series is unavailable." /><UnknownChart title="Pattern Analysis" description="Historical pattern insights are unavailable. Partial paper records do not establish strategy performance." />{children}</div>}
    </LocalTabs>
  </div>;

  if (view === "analytics") return <OriginalAnalyticsLayout>{filters}{children}</OriginalAnalyticsLayout>;
  return <>{children}</>;
}

function UnknownChart({ title, description }: { title: string; description: string }) {
  return <section className="glow-card overflow-hidden" aria-label={title}><header className="to-panel-header"><h3 className="panel-label">{title}</h3><span className="text-xs text-[var(--to-text-dim)]">—</span></header><div className="min-h-[160px] flex items-center justify-center p-6 text-center text-xs text-[var(--to-text-secondary)]">{description}</div></section>;
}
function UnknownTable({ columns, subject }: { columns: string[]; subject: string }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-[11px]" aria-label={subject}><thead><tr>{columns.map((column) => <th className="border-b border-[var(--to-border)] px-3 py-2 text-[var(--to-text-dim)] font-medium whitespace-nowrap" key={column}>{column}</th>)}</tr></thead><tbody><tr><td colSpan={columns.length} className="p-6 text-center text-[var(--to-text-secondary)]">{subject} unavailable</td></tr></tbody></table></div>;
}
function LocalTabs({ label, values, value, onChange, children }: { label: string; values: string[]; value: string; onChange: (value: string) => void; children: ReactNode }) {
  const id = useId();
  return <>
    <div role="tablist" aria-label={label} className="inline-flex flex-wrap gap-1 surface-soft rounded-lg border border-[var(--to-border)] p-0.5" onKeyDown={(event) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const index = values.indexOf(value);
      const next = event.key === "Home" ? 0 : event.key === "End" ? values.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + values.length) % values.length;
      onChange(values[next]!); (event.currentTarget.children[next] as HTMLElement)?.focus();
    }}>{values.map((item) => <button type="button" role="tab" id={`${id}-${item}`} key={item} aria-selected={item === value} aria-controls={`${id}-panel`} tabIndex={item === value ? 0 : -1} onClick={() => onChange(item)} className={`rounded-md px-3 py-1.5 text-[11px] font-medium ${item === value ? "bg-indigo-600/20 text-indigo-300" : "text-[var(--to-text-dim)]"}`}>{item}</button>)}</div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${value}`} className="mt-4">{children}</div>
  </>;
}
