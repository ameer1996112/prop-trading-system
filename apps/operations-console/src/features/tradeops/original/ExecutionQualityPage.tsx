import { useId, useState } from "react";
import { RefreshCw, TrendingDown, Clock, DollarSign, AlertTriangle } from "lucide-react";
import { Card, ChartUnavailable, DisabledAction, Unavailable, moveLocalTabFocus } from "./primitives";

function TracePill({ label }: { label: string }) {
  return (
    <div role="group" aria-label={label} className="rounded border border-[var(--to-border)] bg-[var(--to-surface)] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-widest text-[var(--to-text-dim)]">{label}</div>
      <div className="mt-0.5 font-mono text-[15px] font-bold text-[var(--to-text-primary)]">—</div>
    </div>
  );
}

function TraceTable() {
  return (
    <div role="table" aria-label="Pipeline traces" className="overflow-x-auto rounded border border-[var(--to-border)]">
      <div role="row" className="grid min-w-[620px] gap-2 border-b border-[var(--to-border)] bg-[var(--to-surface)] px-3 py-2" style={{ gridTemplateColumns: "28px 80px 68px 1fr 100px 84px 80px 20px" }}>
        {["", "Symbol", "Side", "Correlation ID", "Account", "Total", "Time", ""].map((label, index) => (
          <span key={index} role="columnheader" className="text-[10px] font-medium uppercase tracking-widest text-[var(--to-text-dim)]">{label}</span>
        ))}
      </div>
      <div role="row"><div role="cell" className="px-4 py-8 text-center text-xs text-[var(--to-text-dim)]">Unavailable — pipeline trace records are not connected.</div></div>
    </div>
  );
}

function LatencyRows() {
  return (
    <div className="space-y-4">
      {["Signal → Submit", "Submit → Fill", "Total"].map((label) => (
        <div key={label} className="flex items-center justify-between text-xs text-[var(--to-text-secondary)]"><span>{label}</span><span className="font-mono">—</span></div>
      ))}
      <div className="space-y-2 border-t border-[var(--to-border)] pt-4">
        {["P95 Latency", "P99 Latency"].map((label) => (
          <div key={label} className="flex items-center justify-between text-[11px] text-[var(--to-text-dim)]"><span>{label}</span><span className="font-mono">—</span></div>
        ))}
      </div>
    </div>
  );
}

// Presentation adapted from app/execution-quality/page.tsx and TraceTable.tsx at cc740a1.
export function ExecutionQualityPage() {
  const [tab, setTab] = useState("Pipeline Traces");
  const [period, setPeriod] = useState("7d");
  const tabId = useId();
  const tabs = ["Pipeline Traces", "TCA Metrics"];
  const cards = [
    { label: "Avg Slippage", detail: "Total cost unavailable", Icon: TrendingDown },
    { label: "Avg Spread Cost", detail: "Per trade", Icon: DollarSign },
    { label: "Avg Execution Time", detail: "Signal to fill", Icon: Clock },
    { label: "Total Trades", detail: `Last ${period.replace("d", "")} days`, Icon: AlertTriangle },
  ];
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="page-title text-lg font-semibold">Execution Quality</h1><p className="page-subtitle mt-0.5 text-xs">Pipeline traces · TCA metrics · latency instrumentation</p></div>
        <div className="flex items-center gap-3">
          {tab === "TCA Metrics" ? (
            <div className="flex items-center gap-1 rounded border border-[var(--to-border)] bg-[var(--to-surface)] p-0.5">
              {["1d", "7d", "30d"].map((p) => <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} className={`rounded px-2.5 py-1 font-mono text-[11px] ${period === p ? "bg-[var(--to-accent-blue)]/20 text-[var(--to-accent-blue)]" : "text-[var(--to-text-dim)]"}`}>{p}</button>)}
            </div>
          ) : <DisabledAction reason="Pipeline traces API is not connected."><RefreshCw className="h-3 w-3" />Refresh</DisabledAction>}
        </div>
      </header>
      <Unavailable>execution traces and TCA services are not connected. Metrics below are unknown.</Unavailable>
      <div role="tablist" aria-label="Execution quality views" className="inline-flex gap-1 rounded border border-[var(--to-border)] bg-[var(--to-surface)] p-0.5">
        {tabs.map((label, index) => <button type="button" role="tab" tabIndex={tab === label ? 0 : -1} id={`${tabId}-${index}`} aria-controls={`${tabId}-panel`} aria-selected={tab === label} key={label} onClick={() => setTab(label)} onKeyDown={(event) => moveLocalTabFocus(event, tabs, index, setTab)} className={`h-7 px-3 text-[11px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--to-accent-blue)] ${tab === label ? "bg-[var(--to-surface-raised)] text-[var(--to-text-primary)]" : "text-[var(--to-text-dim)]"}`}>{label}</button>)}
      </div>
      <div role="tabpanel" id={`${tabId}-panel`} tabIndex={0} aria-labelledby={`${tabId}-${tabs.indexOf(tab)}`} className="space-y-4">
        {tab === "Pipeline Traces" ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{["Total Traces", "Errors", "Avg Latency", "p95 Latency"].map((label) => <TracePill key={label} label={label} />)}</div>
            <TraceTable />
            <p className="text-[10px] text-[var(--to-text-dim)]">Pipeline trace detail and broker hop timestamps are unavailable.</p>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              {cards.map(({ label, detail, Icon }) => <div key={label} role="group" aria-label={label} className="glow-card rounded-xl border border-[var(--to-border)] bg-[var(--to-surface)] p-6"><p className="flex items-center gap-1.5 text-xs text-[var(--to-text-dim)]"><Icon className="h-3.5 w-3.5" />{label}</p><p className="mt-2 text-2xl font-bold text-[var(--to-text-primary)]">—</p><p className="mt-1 text-xs text-[var(--to-text-secondary)]">{detail}</p></div>)}
            </div>
            <Card title="Slippage by Symbol (Last 30 Days)"><ChartUnavailable label="Slippage by symbol" /></Card>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card title="Slippage by Hour (UTC)"><ChartUnavailable label="Hourly slippage" height="h-[250px]" /></Card>
              <Card title="Latency Breakdown (Last 7 Days)"><LatencyRows /></Card>
            </div>
            <Card title="Recent TCA Alerts (Last 7 Days)"><Unavailable>TCA alerts are not connected.</Unavailable></Card>
          </>
        )}
      </div>
    </div>
  );
}
