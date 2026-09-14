"use client";

import { useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";
import type { EntryModel } from "../../lib/entry-decisions";
import { AccountStrip } from "./AccountStrip";
import { AggregateBar } from "./AggregateBar";
import { ConnectionDetails, ConnectionNotice } from "./ConnectionDetails";
import { buildAccountViews, selectIntents, summarizeAccounts } from "./model";
import { pathView, viewPath, type PresentationStatus, type TradeOpsView } from "./navigation";
import { ObservationLog, PaperAnalyticsView, PaperIntentView, ReadinessBrief, RiskReadinessView } from "./PaperViews";
import type { TradeOpsResource, TradeOpsSessionOptions } from "./session";
import { SetupTable } from "./SetupTable";
import { TradeOpsShell, type ApiStatus } from "./TradeOpsShell";
import { useTradeOps } from "./use-tradeops";
import { OriginalDashboardPanels } from "./OriginalDashboardPanels";
import { OriginalDataPage } from "./OriginalDataPage";
import { OriginalAccountOverview } from "./OriginalDataPanels";
import { OriginalServicePage } from "./original/OriginalServicePage";
import { Mt5HealthPanel } from "./Mt5HealthPanel";
import { mt5HeartbeatAge, mt5HeartbeatStatus } from "./mt5-health";
import styles from "./tradeops.module.css";

function presentation(resource: TradeOpsResource<unknown>): PresentationStatus {
  return resource.data !== null ? "ready" : resource.loading ? "loading" : "unavailable";
}

export function TradeOpsDashboard({ sessionOptions, initialView = "dashboard" }: { sessionOptions?: TradeOpsSessionOptions; initialView?: TradeOpsView } = {}) {
  const { snapshot, unlock, lock, refresh, connectMt5, disconnectMt5 } = useTradeOps(sessionOptions);
  const [healthClock, setHealthClock] = useState(() => Date.now());
  useEffect(() => {
    if (!snapshot.mt5.data) return;
    // Presentation only: never an additional network poll.
    const update = () => setHealthClock(Date.now());
    const initial = setTimeout(update, 0);
    const timer = setInterval(update, 1000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [snapshot.mt5.data]);
  // Heartbeat age is independent of paused/failed transport (shown in the panel).
  const eaStatus = mt5HeartbeatStatus(snapshot.mt5.data, snapshot.mt5.lastSuccess, healthClock);
  const [view, setView] = useState<TradeOpsView>(initialView);
  useEffect(() => {
    const navigate = () => { const next = pathView(window.location.pathname); if (next) setView(next); };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);
  const navigate = (next: TradeOpsView) => {
    setView(next);
    if (window.location.pathname !== viewPath(next)) window.history.pushState(null, "", viewPath(next));
  };
  const [selectedAccountId, setAccountId] = useState<string | null>(null);
  const [selectedModel, setModel] = useState<EntryModel | null>(null);
  const [search, setSearch] = useState("");
  // Rejected credentials purge resource data in the session. Mask local identifiers
  // immediately, then clear them before another credential can unlock the UI.
  const accountId = snapshot.unlocked ? selectedAccountId : null;
  const model = snapshot.unlocked ? selectedModel : null;
  const query = snapshot.unlocked ? search : "";
  const clearFilters = () => { setAccountId(null); setModel(null); setSearch(""); };
  const lockAndClear = () => { clearFilters(); lock(); };
  const accounts = buildAccountViews(snapshot.ledger.data, snapshot.simulation.data?.accounts ?? null);
  const summary = summarizeAccounts(snapshot.ledger.data, snapshot.simulation.data?.accounts ?? null);
  const accountStatus: PresentationStatus = snapshot.ledger.data !== null || snapshot.simulation.data !== null ? "ready" :
    snapshot.ledger.loading || snapshot.simulation.loading ? "loading" : "unavailable";
  const loadedIntents = snapshot.simulation.data?.intents.slice(0, 50) ?? [];
  const filteredIntents = selectIntents(loadedIntents, accountId, model, query);
  const apiStatus: ApiStatus = snapshot.health.data === null ? (snapshot.health.error ? "OFFLINE" : "UNKNOWN") :
    snapshot.health.stale ? "STALE" : snapshot.health.data.state;
  const observationLog = <ObservationLog data={snapshot.receipts.data} status={presentation(snapshot.receipts)} accountSelected={accountId !== null} />;
  const intentFilters = <div className={styles.toolbar}>
    <label className={styles.field}>Search paper intents<input className={styles.input} type="search" value={query} onChange={(event) => setSearch(event.target.value)} placeholder="Symbol, intent or setup ID" /></label>
    <label className={styles.field}>Entry model<select className={styles.select} value={model ?? ""} onChange={(event) => setModel(event.target.value === "" ? null : event.target.value as EntryModel)}><option value="">All models</option><option value="BOC">BOC</option><option value="DIR_CLOSE">Directional close</option><option value="HTF_FLIP">HTF flip</option></select></label>
    <p className={styles.sourceNote}>Local filters apply to loaded paper intents only.</p>
  </div>;

  return <TradeOpsShell view={view} onViewChange={navigate} apiStatus={apiStatus} eaStatus={eaStatus}
    refreshAction={<button type="button" onClick={() => { void refresh(); }}>Refresh data</button>}
    credentialAction={snapshot.unlocked ? <button type="button" onClick={lockAndClear}>Lock paper data</button> : <span className={styles.sourceNote}>Paper data locked</span>}>
    <ConnectionNotice snapshot={snapshot} />
    {!snapshot.unlocked && <form className={styles.compactCredential} aria-label="Unlock paper data" onSubmit={(event) => {
      event.preventDefault();
      const input = event.currentTarget.elements.namedItem("paper-operator-credential") as HTMLInputElement;
      const value = input.value;
      input.value = "";
      clearFilters();
      if (value.length > 0 && value.length <= 1_024) unlock(value);
    }}>
      <LockKeyhole size={15} aria-hidden="true" />
      <label className={styles.field}>Paper operator credential<input name="paper-operator-credential" type="password" className={styles.input} required maxLength={1024} autoComplete="off" autoCapitalize="off" spellCheck={false} /></label>
      <button type="submit" className={`${styles.button} ${styles.primaryButton}`}>Unlock paper data</button>
      <p className={styles.sourceNote}>Tab memory only · no trading controls</p>
      {snapshot.lockReason === "AUTH_REJECTED" && <p role="alert" className={styles.warning}>Paper operator credential was rejected. Enter a valid credential to retry.</p>}
        </form>}
    {view === "dashboard" && <>
      <AggregateBar summary={summary} status={accountStatus} />
      <OriginalDashboardPanels apiStatus={apiStatus} />
      <Mt5HealthPanel resource={snapshot.mt5} connection={snapshot.mt5Connection} status={eaStatus} age={mt5HeartbeatAge(snapshot.mt5.data, snapshot.mt5.lastSuccess, healthClock)} onConnect={connectMt5} onDisconnect={disconnectMt5} />
      <div><p className="kpi-meta mb-2">Accounts</p><AccountStrip accounts={accounts} status={accountStatus} selectedAccountId={accountId} onAccountSelect={setAccountId} /></div>
      <section aria-label="Trade permissions" className={styles.panel}>
        <header className={styles.panelHeader}><h2 className={styles.panelTitle}>Trade permissions</h2><span className={styles.badge}>READ-ONLY</span></header>
        <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">{["Allowed", "Blocked", "Watch", "Research"].map((label) => <div key={label} className="rounded-md border border-[var(--to-border)] bg-[var(--to-surface-raised)] px-3 py-2"><p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--to-text-dim)]">{label}</p><p className="mt-1 font-mono text-lg font-bold leading-none">—</p></div>)}</div>
          <div className="grid gap-3 md:grid-cols-2"><div className="rounded-md border border-[#f6465d]/20 bg-[#f6465d]/5 p-3 text-xs text-[var(--to-text-secondary)]">Broker permission state unavailable. Paper readiness does not grant live-trading permission.</div><div className="rounded-md border border-[var(--to-border)] p-3"><ReadinessBrief data={snapshot.readiness.data} /></div></div>
        </div>
      </section>
    </>}
    {accountId !== null && <div className={styles.filterNotice}><span>Selected account: {accountId}</span><button type="button" className={styles.button} onClick={() => setAccountId(null)}>Clear account filter</button><span className={styles.sourceNote}>Account aggregates stay unfiltered.</span></div>}
    {["accounts", "risk", "analytics", "journal"].includes(view) && <>
    {view === "accounts" && <Mt5HealthPanel resource={snapshot.mt5} connection={snapshot.mt5Connection} status={eaStatus} age={mt5HeartbeatAge(snapshot.mt5.data, snapshot.mt5.lastSuccess, healthClock)} onConnect={connectMt5} onDisconnect={disconnectMt5} />}
    <div className={styles.pageHeading}><h2>{view === "risk" ? "Risk & Rules" : view === "accounts" ? "Accounts" : view === "analytics" ? "Analytics" : "Trade Journal"}</h2><span className={styles.paperBadge}>PAPER SOURCES</span></div>
    {view !== "accounts" && <AccountStrip accounts={accounts} status={accountStatus} selectedAccountId={accountId} onAccountSelect={setAccountId} />}
    </>}
    {view === "dashboard" && <PaperIntentView key={String(snapshot.unlocked)} intents={filteredIntents} accounts={accounts} status={presentation(snapshot.simulation)} />}
    <OriginalDataPage key={view} view={view} accounts={accounts} accountId={accountId} readiness={snapshot.readiness.data} intents={snapshot.simulation.data === null ? null : filteredIntents} filters={["analytics", "journal"].includes(view) ? intentFilters : undefined}>
    <div className={view === "dashboard" ? styles.dashboardGrid : undefined}>
      {view === "dashboard" && <SetupTable decisions={snapshot.decisions.data?.items ?? []} intents={loadedIntents} status={presentation(snapshot.decisions)} accountId={accountId} query={query} model={model} onQueryChange={setSearch} onModelChange={setModel} />}
      {view === "accounts" && <OriginalAccountOverview key={String(snapshot.unlocked)} accounts={accounts.filter((account) => accountId === null || account.accountId === accountId)} status={accountStatus} />}
      {view === "risk" && <RiskReadinessView data={snapshot.readiness.data} accounts={accounts} accountId={accountId} status={presentation(snapshot.readiness)} />}
      {view === "analytics" && <div className="space-y-4"><AggregateBar summary={summary} status={accountStatus} /><PaperAnalyticsView intents={snapshot.simulation.data === null ? null : filteredIntents} /></div>}
      {view === "journal" && <PaperIntentView key={String(snapshot.unlocked)} intents={filteredIntents} accounts={accounts} status={presentation(snapshot.simulation)} settled />}
      {view === "dashboard" && <div className={styles.logPanel}>{observationLog}</div>}
    </div>
    </OriginalDataPage>
    {!["dashboard", "accounts", "risk", "analytics", "journal"].includes(view) && <OriginalServicePage view={view} />}
    <ConnectionDetails snapshot={snapshot} />
    <div className={styles.boundaryBanner}>
      <p>Paper operations · read-only. Broker connection, fills, and equity are unavailable.</p>
      <p className={styles.sourceNote}>Legacy Supabase history is not connected. No legacy database is read by this dashboard.</p>
    </div>
  </TradeOpsShell>;
}
