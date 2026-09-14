import { ChevronDown, Radio } from "lucide-react";
import { ResourceStatus } from "./PaperViews";
import type { TradeOpsSnapshot } from "./session";
import styles from "./tradeops.module.css";

function resourcesFor(snapshot: TradeOpsSnapshot) {
  return [
    { label: "API health", resource: snapshot.health, locked: false },
    { label: "Observations", resource: snapshot.receipts, locked: false },
    { label: "Ledger", resource: snapshot.ledger, locked: !snapshot.unlocked },
    { label: "Simulation", resource: snapshot.simulation, locked: !snapshot.unlocked },
    { label: "Readiness", resource: snapshot.readiness, locked: !snapshot.unlocked },
    { label: "Decisions", resource: snapshot.decisions, locked: !snapshot.unlocked },
  ];
}

/** A failed source must not be mistaken for current data above a long table. */
export function ConnectionNotice({ snapshot }: { snapshot: TradeOpsSnapshot }) {
  const affected = resourcesFor(snapshot).filter(({ resource, locked }) => !locked &&
    (resource.error || (resource.stale && resource.lastSuccess !== null)));
  if (!snapshot.paused && affected.length === 0) return null;
  return <div className={styles.dataNotice} role="status" aria-label="Data freshness warning">
    <Radio size={16} aria-hidden="true" />
    <p>{snapshot.paused ? "Updates paused. " : "Refresh needs attention. "}
      {affected.some(({ resource }) => resource.stale && resource.lastSuccess !== null) ? "Retained data is stale. " : "Some data is unavailable. "}
      {affected.length > 0 && <span>Affected sources: {affected.map(({ label }) => label).join(", ")}. </span>}
      <span>See connection details below.</span>
    </p>
  </div>;
}

/** A disclosure changes presentation only. Resource ownership stays in the session. */
export function ConnectionDetails({ snapshot }: { snapshot: TradeOpsSnapshot }) {
  const resources = resourcesFor(snapshot);
  const active = resources.filter(({ locked }) => !locked);
  const issues = active.filter(({ resource }) => resource.error || (resource.stale && (resource.lastSuccess !== null || !resource.loading)));
  const refreshing = active.some(({ resource }) => resource.loading);
  return <section className={styles.connectionSection} aria-label="Connection diagnostics">
    <div role="status" aria-label="Connection summary" className={styles.connectionSummary}>
      <Radio size={16} aria-hidden="true" />
      <div>
        <p className={issues.length || snapshot.paused ? styles.warning : styles.muted}>
          {snapshot.paused ? "Polling paused while hidden or offline. Last successful data remains visible and stale." :
            issues.length ? "Some data needs attention" : refreshing ? "Refreshing workspace data" : "Latest source refresh completed"}
        </p>
        {issues.length > 0 && <ul>{issues.map(({ label, resource }) => <li key={label}>
          {label}: {resource.error ?? (resource.lastSuccess === null ? "waiting for a successful update" : "last successful data is stale")}
          {resource.error && resource.stale && resource.lastSuccess !== null && " Last successful data is stale."}
        </li>)}</ul>}
      </div>
    </div>
    <details className={styles.connectionDetails}>
      <summary><span>Connection details</span><span className={styles.connectionHint}>Sources & freshness</span><ChevronDown size={16} aria-hidden="true" /></summary>
      <section className={styles.resourceGrid} aria-label="Resource freshness">
        {resources.map(({ label, resource, locked }) => <ResourceStatus key={label} label={label} resource={resource} locked={locked} />)}
      </section>
      <p className={styles.sourceNote}>Freshness describes the last successful response, not the age of the observations inside it.</p>
      <p className={styles.sourceNote}>Paper simulator: {snapshot.health.data?.paperSimulator ?? "UNKNOWN"} · Execution: {snapshot.health.data?.execution ?? "UNKNOWN"}{snapshot.health.stale && snapshot.health.data ? " · Last known values; API data is stale." : ""}</p>
    </details>
  </section>;
}
