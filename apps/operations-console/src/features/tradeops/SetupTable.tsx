"use client";

import { useId, useState } from "react";
import { Search } from "lucide-react";
import type { PaperSimulationIntent } from "../../lib/api";
import type { EntryDecisionItem, EntryModel } from "../../lib/entry-decisions";
import { selectDecisions } from "./model";
import { SetupInspector } from "./SetupInspector";
import styles from "./tradeops.module.css";

export type SetupTableProps = {
  decisions: readonly EntryDecisionItem[];
  intents: readonly PaperSimulationIntent[];
  status: "loading" | "ready" | "unavailable";
  accountId: string | null;
  query: string;
  model: EntryModel | null;
  onQueryChange: (query: string) => void;
  onModelChange: (model: EntryModel | null) => void;
};

// The entry V3 contract uses epoch seconds (a confirmed five-minute bar is 300).
function evaluatedUtc(epoch: number): string {
  const date = new Date(epoch * 1_000);
  return Number.isFinite(date.getTime())
    ? `${date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "")} UTC`
    : "UTC unavailable";
}

export function SetupTable({ decisions, intents, status, accountId, query, model, onQueryChange, onModelChange }: SetupTableProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inspectorId = useId();
  const window = status === "ready" ? decisions.slice(0, 50) : [];
  const filtered = selectDecisions(window, intents.slice(0, 50), accountId, model, query);
  // Reset during render so lock/filter changes cannot retain or later reopen a stale selection.
  if (selectedId !== null && !filtered.some((item) => item.decisionId === selectedId)) setSelectedId(null);

  return (
    <section className={styles.panel} aria-label="Setup decisions panel">
      <header className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>Latest Signals</h2>
        <span className={styles.badge}>PAPER / SHADOW ONLY</span>
      </header>
      <div className={styles.toolbar}>
        <label className={styles.field}>Strategy<select className={styles.select} disabled title="Strategy catalog is not connected. Entry model is a separate filter."><option>Unavailable</option></select></label>
        <label className={styles.setupSearch}>
          <Search size={13} aria-hidden="true" />
          <span className={styles.srOnly}>Search setups</span>
          <input className={styles.input} type="search" value={query} placeholder="Symbol, setup or decision ID"
            onChange={(event) => onQueryChange(event.target.value)} />
        </label>
        <label className={styles.setupModel}>
          <span>Entry model</span>
          <select className={styles.select} value={model ?? ""}
            onChange={(event) => onModelChange(event.target.value === "" ? null : event.target.value as EntryModel)}>
            <option value="">All models</option><option value="BOC">BOC</option>
            <option value="DIR_CLOSE">Directional close</option><option value="HTF_FLIP">HTF flip</option>
          </select>
        </label>
        <span className={styles.sourceNote}>{status === "ready" ? `${filtered.length} / ${window.length} in window` : "Decision window unavailable"}</span>
      </div>
      <div className={styles.setupNotes}>
        <p className={styles.sourceNote}>Latest returned decision window, at most 50 records; not an exhaustive history.</p>
        {accountId !== null && <p className={styles.sourceNote}>Account filter: unlinked decisions are excluded; only matching allocations in the loaded intent window are known.</p>}
      </div>
      {status !== "ready" ? (
        <p className={styles.panelBody} role="status">{status === "loading" ? "Loading setup decisions…" : "Setup decisions unavailable. Unlock or refresh the paper session."}</p>
      ) : filtered.length === 0 ? (
        <p className={styles.panelBody}>{window.length === 0 ? "No setup decisions in the loaded window." : "No setups match the current filters."}</p>
      ) : (
        <div className={`${styles.tableScroll} ${styles.setupScroll}`}>
          <table className={`${styles.table} ${styles.setupTable}`} aria-label="Setup decisions">
            <thead><tr>{["Evaluated UTC", "Symbol", "Direction", "Selected model", "Fidelity", "Effective action", "Reason", "Paper link"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{filtered.map((item) => (
              <tr key={item.decisionId} className={item.decisionId === selectedId ? styles.setupSelected : undefined}>
                <td className={styles.setupTime}>{evaluatedUtc(item.selection.evaluatedAtEpoch)}</td>
                <td><button type="button" className={styles.setupInspectButton} aria-label={`Inspect ${item.symbol} setup`}
                  aria-expanded={item.decisionId === selectedId} aria-controls={inspectorId}
                  onClick={() => setSelectedId(item.decisionId)}>{item.symbol}</button></td>
                <td className={item.direction === "LONG" ? styles.positive : styles.negative}>{item.direction}</td>
                <td>{item.selection.canonicalModel ?? "None selected"}</td>
                <td>{item.selection.fidelity ?? "Not selected"}</td>
                <td className={item.selection.action === "PAPER_ELIGIBLE" ? styles.info : styles.warning}>{item.selection.action}</td>
                <td className={styles.setupReason}><span>{item.selection.reason}</span>{item.selection.effectiveActionReason !== null && <span className={styles.warning}>{item.selection.effectiveActionReason}</span>}</td>
                <td>{item.paperIntentId === null ? <span className={styles.muted}>No linked intent</span> : (
                  <button type="button" className={styles.setupPaperLink} aria-label={`Inspect linked paper intent ${item.paperIntentId}`}
                    aria-expanded={item.decisionId === selectedId} aria-controls={inspectorId}
                    onClick={() => setSelectedId(item.decisionId)}>Paper intent {item.paperIntentId}</button>
                )}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div id={inspectorId}><SetupInspector decisions={filtered} selectedId={selectedId} onClose={() => setSelectedId(null)} /></div>
    </section>
  );
}
