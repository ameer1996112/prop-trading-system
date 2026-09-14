import { useState } from "react";
import { Play, Square } from "lucide-react";
import { Card, DisabledAction, EmptyTable, Metric, Unavailable, inputClass } from "./primitives";

function DraftField({ label, type = "text" }: { label: string; type?: string }) {
  const [value, setValue] = useState("");
  return <label className="space-y-1 text-xs text-[var(--to-text-secondary)]"><span>{label}</span><input type={type} value={value} onChange={(event) => setValue(event.target.value)} className={inputClass} placeholder={type === "text" ? "Local draft only" : undefined} /></label>;
}

// Adapted from OptimizerRunsWorkspace.tsx at cc740a1; no runner/permission providers.
export function OptimizerPage() {
  const [mode, setMode] = useState("");
  const [range, setRange] = useState("");
  const [broker, setBroker] = useState("");
  const [selectedBrokers, setSelectedBrokers] = useState<string[]>([]);
  const validate = mode === "Validate" || mode === "Multi-Broker Validate";
  return <div className="space-y-4 animate-fade-in-up"><header className="flex items-start justify-between gap-3"><div><h1 className="page-title text-lg font-semibold">Optimizer</h1><p className="page-subtitle mt-0.5 text-xs">Launch parallel optimizer runs, track live progress, and inspect run history.</p></div><span className="tf-badge">OPS</span></header><Unavailable>optimizer runner, production permissions, and run artifacts are not connected. Form changes are unsaved local drafts.</Unavailable>
    <Card title="Run launcher" description="Start one optimizer run at a time from the dashboard." accessory={<span className="text-xs text-[var(--to-text-dim)]">Agent unavailable</span>}><div className="space-y-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><DraftField label="Strategy ID" /><DraftField label="Strategy version" /><label className="space-y-1 text-xs text-[var(--to-text-secondary)]"><span>Mode</span><select value={mode} onChange={(event) => setMode(event.target.value)} className={inputClass}><option value="">Select local draft</option>{["Bayesian", "Smart", "Fast", "Full", "Validate", "Multi-Broker Validate"].map((value) => <option key={value}>{value}</option>)}</select></label>{mode === "Multi-Broker Validate" ? (
        <fieldset className="space-y-1 text-xs text-[var(--to-text-secondary)]">
          <legend>Broker set</legend>
          <div className="flex h-9 items-center gap-3 rounded-md border border-[var(--to-border)] bg-[var(--to-surface)] px-3">
            {["Vantage", "OANDA", "FXCM"].map((option) => (
              <label key={option} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={selectedBrokers.includes(option)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSelectedBrokers((current) =>
                      checked
                        ? [...current, option]
                        : current.filter((item) => item !== option)
                    );
                  }}
                />
                {option}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <label className="space-y-1 text-xs text-[var(--to-text-secondary)]">
          <span>Broker</span>
          <select value={broker} onChange={(event) => setBroker(event.target.value)} className={inputClass}>
            <option value="">Select local draft</option>
            {["Vantage", "OANDA", "FXCM"].map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
      )}<label className="space-y-1 text-xs text-[var(--to-text-secondary)]"><span>Backtest range</span><select value={range} onChange={(event) => setRange(event.target.value)} className={inputClass}><option value="">Select local draft</option>{["Last 30 days", "Last 90 days", "Last 365 days", "Entire history", "Custom range"].map((value) => <option key={value}>{value}</option>)}</select></label>{validate && <DraftField label="Source run ID" />}<DraftField label="Workers" type="number" />{!validate && <DraftField label="Trials" type="number" />}<DraftField label="Max DD %" type="number" /><DraftField label="Pairs" /></div>{range === "Custom range" && <div className="grid gap-3 rounded-lg border border-[var(--to-border)] bg-[var(--to-surface-raised)]/20 p-3 md:grid-cols-2"><DraftField label="Start date" type="date" /><DraftField label="End date" type="date" /><p className="text-xs text-[var(--to-text-dim)] md:col-span-2">Local draft only. Validation requires the unavailable optimizer service.</p></div>}<p className="text-xs text-[var(--to-text-secondary)]">All pairs <span className="text-[10px] text-[var(--to-text-dim)]">— backend default list unavailable</span></p><p className="text-xs text-[var(--to-text-secondary)]">Dry run <span className="text-[10px] text-[var(--to-text-dim)]">— run configuration unavailable</span></p><div className="flex flex-wrap items-start gap-2"><DisabledAction reason="Optimizer launch service is not connected."><Play className="h-4 w-4" />Start Run</DisabledAction><DisabledAction reason="Optimizer cancellation service is not connected."><Square className="h-4 w-4" />Cancel Run</DisabledAction></div></div></Card>
    <Card title="Production permission gate" description="Daily bot permission is separate from optimizer research approval." className="bg-[linear-gradient(135deg,rgba(12,16,22,0.94),rgba(20,25,35,0.82))]" accessory={<span className="text-xs text-[var(--to-text-dim)]">Unavailable</span>}><div className="space-y-4"><div className="grid gap-3 md:grid-cols-4">{["Allowed today", "Blocked today", "Watch only", "Research approved"].map((label) => <Metric key={label} label={label} />)}</div><div className="grid gap-3 xl:grid-cols-2"><div className="rounded-lg border border-[var(--to-border)] p-3"><p className="text-[10px] uppercase tracking-[0.15em] text-[var(--to-text-dim)]">Allowed symbols</p><p className="mt-2 text-xs text-[var(--to-text-secondary)]">Unavailable — no production permission data connected.</p></div><div className="rounded-lg border border-[var(--to-border)] p-3"><p className="text-[10px] uppercase tracking-[0.15em] text-[var(--to-text-dim)]">Blocked / watch-only reasons</p><p className="mt-2 text-xs text-[var(--to-text-secondary)]">Unavailable</p></div></div></div></Card>
    <Card title="Active run" description="Latest running or selected historical optimizer run."><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{["Status", "Completed pairs", "Running pairs", "Failed pairs", "Broker", "Best result"].map((label) => <Metric key={label} label={label} detail={label === "Broker" ? "Market: —" : label === "Best result" ? "Total pairs: —" : undefined} />)}</div></Card>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.95fr)]"><div className="min-w-0 space-y-4"><Card title="Portfolio overview" description="Combined drawdown guardrails, allocation posture, and survivability at the run level."><div className="space-y-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{["Combined max DD", "Combined daily DD", "Worst day", "Pair decisions", "Weights tracked"].map((label) => <Metric key={label} label={label} />)}</div><div className="rounded-xl border border-[var(--to-border)] bg-[var(--to-surface-raised)]/20 p-3"><p className="text-xs uppercase tracking-[0.18em] text-[var(--to-text-dim)]">Allocation weights</p><p className="mt-1 text-sm text-[var(--to-text-secondary)]">Unavailable — portfolio allocation results are not connected.</p></div></div></Card><Card title="Pair analysis" description="Decision-oriented view of per-pair survivability for the selected run."><EmptyTable label="Pair analysis" columns={["Symbol", "Decision", "Score", "Max DD %", "PF", "Risk weight", "Trades"]} reason="per-pair optimizer results are not connected." /></Card><Card title="Pair drill-down" description="Select a symbol from the analysis table to inspect it."><p className="text-xs text-[var(--to-text-dim)]">Unavailable — validation, forward, and stress artifacts are not connected.</p></Card><Card title="Timeline" description="Machine-readable event feed and log lines."><Unavailable>run event history is not connected.</Unavailable></Card></div><Card title="Run comparison & history" description="Select a run to compare portfolio posture, symbol decisions, and timeline context." className="h-fit"><Unavailable>optimizer run history is not connected.</Unavailable></Card></div>
  </div>;
}
