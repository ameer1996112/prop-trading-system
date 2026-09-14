import { useId, useState, type ReactNode } from "react";
import { Activity, Bell, Brain, Check, Clock3, Database, Globe, GraduationCap, History, Layers, Plus, Radio, RefreshCw, Settings, Shield, Target, Train, Wifi, Zap } from "lucide-react";
import { DisabledAction, Unavailable, inputClass } from "./primitives";

function Panel({ title, label, icon, children, actions }: { title: string; label?: string; icon?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  const id = useId();
  return <section aria-label={label || title} className="to-panel"><div className="to-panel-header"><div className="flex items-center gap-2"><span className="text-text-dim">{icon}</span><h2 id={id} className="panel-label font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">{title}</h2></div>{actions}</div>{children}</section>;
}

function ConfigRows({ labels }: { labels: readonly string[] }) {
  return <div className="divide-y divide-panel-border-subtle">{labels.map((label) => <div key={label} className="flex items-center justify-between gap-3 px-4 py-2.5"><span className="text-[11px] text-[var(--to-text-dim)] uppercase tracking-wider font-mono">{label}</span><span className="font-mono text-xs text-[var(--to-text-secondary)]">Unavailable</span></div>)}</div>;
}

function LocalDisclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="px-4 py-3"><button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-[10px] text-[var(--to-text-dim)] hover:text-[var(--to-text-secondary)] font-mono"><History className="w-3 h-3" />{title}</button>{open && <div className="mt-2">{children}</div>}</div>;
}

const timezones = [
  { value: "Asia/Jerusalem", label: "Israel (IL)" }, { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "New York (ET)" }, { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" }, { value: "Asia/Dubai", label: "Dubai (GST)" },
  { value: "Europe/Berlin", label: "Frankfurt (CET/CEST)" }, { value: "Asia/Singapore", label: "Singapore (SGT)" },
];

function TimezonePanel() {
  const [draft, setDraft] = useState<string | null>(null);
  return <Panel title="Display Timezone" icon={<Globe className="h-3.5 w-3.5" />} actions={<span className="text-[10px] font-mono text-[var(--to-text-dim)]">{draft ? `Local draft: ${draft}` : "Unavailable"}</span>}><div className="p-3"><p className="mb-3 text-[11px] text-[var(--to-text-dim)]">Saved timezone is unavailable. Selection here is an unsaved local draft only; it does not change dashboard timestamps or browser storage.</p><div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">{timezones.map((option) => <button key={option.value} type="button" aria-pressed={draft === option.value} onClick={() => setDraft(option.value)} className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-all ${draft === option.value ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-300" : "border-[var(--to-border)] bg-[var(--to-surface-raised)] text-[var(--to-text-secondary)] hover:border-white/10 hover:text-white"}`}><div><p className="text-[11px] font-semibold">{option.label}</p><p className="text-[9px] font-mono text-[var(--to-text-dim)] mt-0.5">{option.value}</p></div>{draft === option.value && <Check className="h-3.5 w-3.5 text-indigo-400 shrink-0" />}</button>)}</div></div></Panel>;
}

function ConnectionPanel() {
  return <Panel title="Connection Status" icon={<Wifi className="w-4 h-4" />}><div className="divide-y divide-panel-border-subtle">{[{ name: "Supabase Database", Icon: Database }, { name: "Supabase Realtime", Icon: Radio }, { name: "Railway Backend", Icon: Train }].map(({ name, Icon }) => <div key={name} className="px-4 py-3 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><Icon className="w-4 h-4 text-text-muted" /><div><span className="text-[13px] text-text-primary font-medium">{name}</span><p className="mt-0.5 font-mono text-[11px] text-text-secondary">Not connected by this paper console; no check performed.</p></div></div><span className="font-mono text-[11px] uppercase text-[var(--to-text-dim)]">Unavailable</span></div>)}</div></Panel>;
}

function AiPanels() {
  return <section aria-label="AI / ML / RAG Configuration" className="space-y-4"><div className="flex items-center justify-between gap-3"><h2 className="font-mono text-[11px] text-text-muted uppercase tracking-[0.18em]">Live Configuration from Railway</h2><DisabledAction reason="Legacy AI configuration service is not connected."><RefreshCw className="w-3 h-3" />Refresh</DisabledAction></div><Unavailable>AI, ML, RAG, execution configuration, and risk settings cannot be read by this paper console.</Unavailable>
    <Panel title="AI Guardian (LLM)" icon={<Brain className="w-4 h-4" />}><ConfigRows labels={["Status", "Provider", "Model", "Base URL", "Min Confidence", "Timeout", "API Key"]} /></Panel>
    <Panel title="ML Guardian (Random Forest)" icon={<Shield className="w-4 h-4" />}><ConfigRows labels={["Status", "Min Win Probability", "Model"]} /></Panel>
    <Panel title="Ensemble Brain" icon={<Zap className="w-4 h-4" />}><ConfigRows labels={["LLM Filter", "Shadow Mode", "RAG Engine", "Embeddings", "RAG Top-K"]} /></Panel>
    <Panel title="Strategy Graduation" icon={<GraduationCap className="w-4 h-4" />}><ConfigRows labels={["AI Mode", "Readiness", "Sample Size", "Win-Rate Edge", "AI Blocked (executed)", "AI Allowed"]} /><div className="px-4 py-3"><DisabledAction reason="AI mode changes are not connected.">Enable Enforce</DisabledAction></div><LocalDisclosure title="Toggle History"><Unavailable>AI mode history is not connected.</Unavailable></LocalDisclosure></Panel>
    <Panel title="Execution" icon={<Target className="w-4 h-4" />}><ConfigRows labels={["Kill Switch", "Run Mode", "Execution Mode", "Live Trading", "Shadow Mode", "MetaAPI"]} /><LocalDisclosure title="Kill Switch History"><Unavailable>kill-switch event history is not connected.</Unavailable></LocalDisclosure></Panel>
    <Panel title="AI Operating Layer" icon={<Brain className="w-4 h-4" />}><ConfigRows labels={["Panic Mode", "Global Module States", "Provider Enabled"]} /><div className="p-4 space-y-3"><label className="block space-y-1 text-[11px] text-[var(--to-text-dim)]"><span>Provider Endpoint</span><input disabled placeholder="Unavailable" className={inputClass} /></label><div className="grid grid-cols-2 gap-3">{["Timeout Seconds", "Retry Count"].map((label) => <label key={label} className="space-y-1 text-[11px] text-[var(--to-text-dim)]"><span>{label}</span><input disabled placeholder="Unavailable" className={inputClass} /></label>)}</div><DisabledAction reason="AI Operating Layer configuration writes are not connected.">Save</DisabledAction></div></Panel>
    <Panel title="Trinity Risk Engine" icon={<Shield className="w-4 h-4" />}><ConfigRows labels={["Status", "Max Daily Loss", "Max Drawdown", "Risk Per Trade", "Max Positions", "Risk %"]} /></Panel>
  </section>;
}

function RolloverPanel() {
  return <Panel title="Rollover Guard" icon={<Shield className="h-3.5 w-3.5" />} actions={<DisabledAction reason="Rollover configuration writes are not connected.">Save</DisabledAction>}><div className="space-y-4 p-3"><div className="flex items-center justify-between gap-3 rounded-md border border-[var(--to-border)] bg-[var(--to-surface-raised)] px-3 py-2"><span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--to-text-secondary)]"><Clock3 className="h-3.5 w-3.5" />Runtime Managed</span><span className="text-xs text-[var(--to-text-dim)]">Unavailable</span></div><div className="grid gap-3 md:grid-cols-3">{["Swap Time", "Timezone", "Close Before Min", "Min Block After Min", "Max Block After Min", "Healthy Checks", "Recovery Window Sec", "FX Max Spread", "JPY Max Spread", "Gold Max Spread", "Default Max Spread"].map((label) => <label key={label} className="space-y-1"><span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--to-text-dim)]">{label}</span><input disabled placeholder="Unavailable" className="w-full rounded-md border border-[var(--to-border)] bg-[var(--to-surface-raised)] px-3 py-2 font-mono text-xs text-[var(--to-text-primary)]" /></label>)}</div><label className="block space-y-1"><span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--to-text-dim)]">Symbol Overrides JSON</span><textarea disabled rows={3} placeholder="Unavailable — rollover configuration is not connected." className="w-full rounded-md border border-[var(--to-border)] bg-[var(--to-surface-raised)] px-3 py-2 font-mono text-xs" /></label></div></Panel>;
}

function AlertRulesPanel() {
  const [open, setOpen] = useState(false);
  return <Panel title="Alert Rules" icon={<Bell className="w-4 h-4" />} actions={<button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[10px] font-mono text-text-muted"><Plus className="w-3 h-3" />Add Rule</button>}>{open && <div className="px-4 py-3 border-b border-panel-border-subtle space-y-2"><p className="text-[11px] text-[var(--to-text-dim)]">Local draft only — creating rules is unavailable.</p><div className="grid grid-cols-2 gap-2">{["Rule type", "Threshold", "Severity", "Cooldown (min)"].map((label) => <label key={label} className="space-y-1 text-[10px] text-text-muted"><span>{label}</span>{label === "Severity" ? <select className={inputClass} defaultValue=""><option value="">Select local draft</option>{["Info", "Warning", "Error", "Critical"].map((value) => <option key={value}>{value}</option>)}</select> : <input type={label === "Rule type" ? "text" : "number"} className={inputClass} />}</label>)}</div><DisabledAction reason="Alert rule creation is not connected.">Create</DisabledAction></div>}<div className="px-4 py-6 text-center text-xs font-mono text-text-muted">Unavailable — alert rules are not connected. Existing enablement and cooldowns are unknown.</div></Panel>;
}

// Presentation from app/settings/page.tsx and components/settings/* at cc740a1.
export function SettingsPage() {
  return <div className="space-y-4 animate-fade-in-up"><header><div className="flex items-center gap-2"><Settings className="h-4 w-4 text-[var(--to-text-dim)]" /><h1 className="page-title text-lg font-semibold">Settings</h1></div><p className="page-subtitle mt-0.5 text-xs">System configuration, connections, and infrastructure.</p></header><TimezonePanel /><ConnectionPanel /><AiPanels />
    <Panel title="System Health" icon={<Activity className="w-4 h-4" />}><ConfigRows labels={["Dead Letters", "Queue Depth", "Redis"]} /></Panel>
    <Panel title="TradingView MCP Compatibility" label="TradingView MCP" icon={<Shield className="h-3.5 w-3.5" />}><div className="space-y-3 p-3"><p className="text-[11px] text-[var(--to-text-dim)]">TradingView Desktop compatibility and chart context require the disconnected local provider.</p><div className="overflow-hidden rounded-lg border border-[var(--to-border)]"><ConfigRows labels={["Current Version", "Local Status", "Chart Context", "Approved Versions"]} /></div><DisabledAction reason="TradingView version approval writes are not connected.">Approve Current Version</DisabledAction></div></Panel>
    <RolloverPanel />
    <Panel title="Broker Sync Controls" icon={<Layers className="h-3.5 w-3.5" />}><div className="flex flex-wrap items-center justify-between px-3 py-3 gap-3"><p className="text-[11px] text-[var(--to-text-dim)] max-w-xl">Manually trigger a full MetaAPI account sync and reconciliation for all active accounts. This legacy control is unavailable in the paper console.</p><DisabledAction reason="Broker sync and reconciliation writes are not connected.">Sync All Accounts</DisabledAction></div></Panel>
    <AlertRulesPanel />
    <Panel title="Environment"><ConfigRows labels={["SUPABASE_URL", "SUPABASE_KEY", "API_URL", "NODE_ENV"]} /><p className="px-4 pb-3 text-[10px] text-[var(--to-text-dim)]">Environment variables are not read by this presentation.</p></Panel>
    <Panel title="Infrastructure" icon={<Layers className="h-3.5 w-3.5" />}><ConfigRows labels={["Hosting", "Broker", "Database", "Realtime"]} /></Panel>
    <Panel title="Tech Stack"><ConfigRows labels={["Frontend", "Backend", "UI", "Charts", "Execution"]} /></Panel>
  </div>;
}
