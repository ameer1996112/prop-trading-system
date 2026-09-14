"use client";

import { X } from "lucide-react";
import { EntryDecisionPanel } from "../../components/EntryDecisionPanel";
import type { DecisionCandle, EntryDecisionCandidate, EntryDecisionItem } from "../../lib/entry-decisions";
import styles from "./tradeops.module.css";

export type SetupInspectorProps = {
  decisions: readonly EntryDecisionItem[];
  selectedId: string | null;
  onClose: () => void;
};

function candleDetail(candle: DecisionCandle | null): string {
  return candle === null ? "Not retained" : `Epoch ${candle.openEpoch}–${candle.closeEpoch ?? "open"} seconds · O ${candle.openTicks} · H ${candle.highTicks} · L ${candle.lowTicks} · C ${candle.closeTicks} ticks`;
}

function RawEvidence({ candidate }: { candidate: EntryDecisionCandidate }) {
  const evidence = candidate.evidence;
  const fields: Array<[string, string]> = [
    ["Candidate / evidence", `${candidate.candidateId} / ${evidence.evidenceId}`],
    ["State", candidate.state], ["Fidelity", evidence.fidelity],
    ["Passed rule IDs", evidence.passedRuleIds.join(" · ") || "None"],
    ["Failed rule IDs", evidence.failedRuleIds.join(" · ") || "None"],
    ["Proof plane", evidence.proofPlane], ["Replayability", evidence.replayability],
    ["Event anchor / ordinal", `${candidate.eventAnchorEpoch} seconds / #${candidate.triggerOrdinal}`],
    ["Trigger", `${evidence.observedTriggerEpoch ?? "Not retained"} seconds / #${evidence.triggerSequence} / ${evidence.observedTriggerTicks ?? "Not retained"} ticks`],
    ["Coverage (epoch seconds)", `${evidence.coverageStartEpoch}–${evidence.coverageEndEpoch}`],
    ["HTF context", evidence.htfContextMinutes.map((minutes) => `${minutes}m`).join(" · ") || "None retained"],
    ["Ambiguity codes", evidence.ambiguityCodes.join(" · ") || "None retained"],
    ["Reference candle", candleDetail(evidence.referenceCandle)],
    ["Contact candle", candleDetail(evidence.contactCandle)],
    ["Recross candle", candleDetail(evidence.recrossCandle)],
    ["Source claim IDs", candidate.sourceClaimIds.join(" · ") || "None retained"],
  ];
  return <section className={styles.setupEvidence} aria-label={`${candidate.model} raw evidence`}>
    <h3>Raw evidence · {candidate.model}</h3>
    <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </section>;
}

export function SetupInspector({ decisions, selectedId, onClose }: SetupInspectorProps) {
  const item = decisions.find((decision) => decision.decisionId === selectedId);
  if (!item) return null;
  return <section className={styles.setupInspector} aria-label="Setup evidence inspector">
    <header className={styles.panelHeader}>
      <div><h2 className={styles.panelTitle}>{item.symbol} · Setup evidence</h2><p className={styles.sourceNote}>{item.setupId} / {item.attemptKind}</p></div>
      <button className={styles.iconButton} type="button" aria-label="Close setup inspector" onClick={onClose}><X size={15} aria-hidden="true" /></button>
    </header>
    <div className={styles.setupInspectorBody}>
      <div className={styles.setupPlan}>
        <p className={styles.warning}>Plan ticks are not broker fill prices.</p>
        <p className={styles.sourceNote}>Candidate evidence, receipts and PAPER_ELIGIBLE do not prove a filled order.</p>
        <dl className={styles.setupPlanGrid}>
          <div><dt>Plan entry ticks</dt><dd>{item.tradePlan.entryTicks}</dd></div>
          <div><dt>Plan stop ticks</dt><dd>{item.tradePlan.stopTicks}</dd></div>
          <div><dt>Plan target ticks</dt><dd>{item.tradePlan.targetTicks}</dd></div>
          <div><dt>Tick size</dt><dd>{item.tradePlan.tickSize}</dd></div>
        </dl>
        <p className={styles.sourceNote}>Latest selection · {item.selection.canonicalModel ?? "None selected"} / {item.selection.selectionId} / revision {item.selection.revision}</p>
        <p className={styles.sourceNote}>Policy action · {item.selection.policyAction} / effective action · {item.selection.action}</p>
        <p className={styles.sourceNote}>Selection reason · {item.selection.reason}</p>
        {item.selection.effectiveActionReason !== null && <p className={styles.warning}>{item.selection.effectiveActionReason}</p>}
        <p className={styles.sourceNote}>Raw evaluated epoch · {item.selection.evaluatedAtEpoch} seconds</p>
        <p className={styles.sourceNote}>Paper state · {item.trade?.state ?? "No linked paper trade"}. Supplied paper prices below are decimal strings, not broker fills.</p>
        {item.openedEconomicSelection !== null && <p className={styles.sourceNote}>Opened economic selection · {item.openedEconomicSelection.canonicalModel} / {item.openedEconomicSelection.selectionId} / {item.openedEconomicSelection.decisionId} / {item.openedEconomicSelection.reason} / epoch {item.openedEconomicSelection.evaluatedAtEpoch} seconds</p>}
      </div>
      {item.paperIntentId !== null && item.trade !== null && (
        <section id={`paper-intent-${item.paperIntentId}`} className={styles.setupPlan} aria-label="Linked paper intent details">
          <h3 className={styles.panelTitle}>Paper intent · {item.paperIntentId}</h3>
          <p className={styles.sourceNote}>Recorded paper state · {item.trade.state}. These are supplied paper prices, not broker fills.</p>
          <dl className={styles.setupPlanGrid}>
            <div><dt>Paper entry price</dt><dd>{item.trade.entryPrice}</dd></div>
            <div><dt>Paper stop loss</dt><dd>{item.trade.stopLoss}</dd></div>
            <div><dt>Paper take profit</dt><dd>{item.trade.takeProfit}</dd></div>
          </dl>
        </section>
      )}
      <EntryDecisionPanel initialSnapshot={{ state: "READY", items: [item], message: "Selected immutable backend decision." }} />
      <div className={styles.setupEvidenceGrid}>{item.candidates.map((candidate) => <RawEvidence candidate={candidate} key={candidate.candidateId} />)}</div>
    </div>
  </section>;
}
