"use client";

import type {
  EntryDecisionCandidate,
  EntryDecisionItem,
  EntryDecisionSnapshot,
  EntryModel,
} from "../lib/entry-decisions";

const MODEL_LABELS: Readonly<Record<EntryModel, string>> = {
  BOC: "BOC",
  DIR_CLOSE: "Directional close",
  HTF_FLIP: "HTF flip",
};
const MODEL_ORDER: readonly EntryModel[] = ["BOC", "DIR_CLOSE", "HTF_FLIP"];

const REASON_LABELS: Readonly<Record<string, string>> = {
  ONLY_EXACT_TRIGGER: "Only exact trigger",
  EARLIEST_EXACT_TRIGGER: "Earliest exact trigger",
  FALLBACK_TO_CONFIRMED_CLOSE: "Confirmed-close fallback",
  CO_TRIGGER_SAME_EVENT: "Same-event co-trigger",
  CO_TRIGGER_PRICE_CONFLICT: "Co-trigger price conflict",
  NO_EXACT_CANDIDATE: "No exact candidate",
  SETUP_INVALIDATED: "Setup invalidated",
  NO_CANDIDATE: "No candidate",
  PROMOTION_IDENTITY_MISMATCH: "Reviewed producer identity does not match",
  PAPER_CONFIGURATION_UNAVAILABLE: "Paper configuration is unavailable",
  NOT_SELECTED_ALREADY_OPEN: "A paper attempt is already open",
  BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED:
    "Context is not mechanically quantified",
  BOC_WRONG_DIRECTION: "Break direction does not match the setup",
  ENTRY_BEFORE_ZONE_ENGAGEMENT: "Trigger preceded zone engagement",
  REALTIME_EVIDENCE_NOT_LIVE: "Realtime evidence was not observed live",
};

function titleCaseReason(value: string): string {
  return (
    REASON_LABELS[value] ??
    value
      .toLowerCase()
      .split("_")
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ")
  );
}

function modelDecision(candidate: EntryDecisionCandidate, item: EntryDecisionItem): string {
  if (candidate.candidateId === item.selection.canonicalCandidateId) {
    return `${MODEL_LABELS[candidate.model]} won arbitration`;
  }
  if (item.selection.coTriggeredModels.includes(candidate.model)) {
    return `${MODEL_LABELS[candidate.model]} retained as co-trigger`;
  }
  if (candidate.state === "BLOCKED") return `${MODEL_LABELS[candidate.model]} blocked`;
  if (candidate.state === "REJECTED") return `${MODEL_LABELS[candidate.model]} rejected`;
  return `${MODEL_LABELS[candidate.model]} not selected`;
}

function candidateHeading(candidate: EntryDecisionCandidate): string {
  if (candidate.model === "BOC" && candidate.bocTier === "DISCRETIONARY_5M") {
    return "Discretionary 5m BOC";
  }
  if (candidate.model === "BOC") return "HTF-timed BOC";
  return MODEL_LABELS[candidate.model];
}

function triggerValue(candidate: EntryDecisionCandidate): string {
  const evidence = candidate.evidence;
  return evidence.observedTriggerEpoch === null ||
    evidence.observedTriggerTicks === null
    ? "No retained trigger"
    : `${evidence.observedTriggerTicks} ticks · ${evidence.observedTriggerEpoch} / #${evidence.triggerSequence}`;
}

function evidenceReasons(candidate: EntryDecisionCandidate): string[] {
  const reasons = candidate.evidence.failedRuleIds.map(titleCaseReason);
  return reasons.length === 0
    ? [`${candidate.evidence.fidelity} evidence accepted`]
    : reasons;
}

function CandidateRow({
  candidate,
  item,
}: {
  candidate: EntryDecisionCandidate;
  item: EntryDecisionItem;
}) {
  const reasons = evidenceReasons(candidate);
  return (
    <article className={`entry-candidate entry-candidate-${candidate.state.toLowerCase()}`}>
      <header>
        <div>
          <p>{candidateHeading(candidate)}</p>
          <h4>{modelDecision(candidate, item)}</h4>
        </div>
        <strong>{candidate.state}</strong>
      </header>
      <dl>
        <div>
          <dt>Trigger</dt>
          <dd>{triggerValue(candidate)}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>
            {candidate.evidence.fidelity} · {candidate.evidence.proofPlane}
          </dd>
        </div>
        {candidate.model === "BOC" ? (
          <>
            <div>
              <dt>Tier</dt>
              <dd>
                {candidate.bocTier === "HTF_TIMED"
                  ? "HTF timed"
                  : "Discretionary 5m"}
              </dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd>
                {candidate.referenceCandleOpenEpoch === null
                  ? "Not retained"
                  : `${candidate.referenceCandleOpenEpoch} · ${
                      candidate.evidence.referenceCandle?.highTicks ?? "?"
                    }/${candidate.evidence.referenceCandle?.lowTicks ?? "?"}`}
              </dd>
            </div>
          </>
        ) : null}
        {candidate.model === "DIR_CLOSE" ? (
          <div>
            <dt>Close candle</dt>
            <dd>
              {candidate.evidence.coverageStartEpoch}–
              {candidate.evidence.coverageEndEpoch}
            </dd>
          </div>
        ) : null}
        {candidate.model === "HTF_FLIP" ? (
          <>
            <div>
              <dt>HTF contexts</dt>
              <dd>
                {candidate.evidence.htfContextMinutes.length === 0
                  ? "None retained"
                  : candidate.evidence.htfContextMinutes
                      .map((context) => `${context}m`)
                      .join(" · ")}
              </dd>
            </div>
            <div>
              <dt>Lifecycle</dt>
              <dd>
                {candidate.evidence.contactCandle === null
                  ? "Contact not retained"
                  : `Contact ${candidate.evidence.contactCandle.openEpoch}`}
                {" · "}
                {candidate.evidence.recrossCandle === null
                  ? "Recross not retained"
                  : `Recross ${candidate.evidence.recrossCandle.closeEpoch}`}
              </dd>
            </div>
          </>
        ) : null}
      </dl>
      <ul aria-label={`${candidateHeading(candidate)} decision reasons`}>
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </article>
  );
}

function MissingCandidateRow({ model }: { model: EntryModel }) {
  return (
    <article className="entry-candidate entry-candidate-missing">
      <header>
        <div>
          <p>{MODEL_LABELS[model]}</p>
          <h4>{MODEL_LABELS[model]} not observed</h4>
        </div>
        <strong>NOT OBSERVED</strong>
      </header>
      <dl>
        <div>
          <dt>Trigger</dt>
          <dd>Not triggered</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>No candidate evidence retained</dd>
        </div>
      </dl>
    </article>
  );
}

function coTriggerLabel(item: EntryDecisionItem): string | null {
  const models = new Set<EntryModel>(item.selection.coTriggeredModels);
  if (item.selection.canonicalModel !== null) {
    models.add(item.selection.canonicalModel);
  }
  if (models.size < 2) return null;
  return `Co-trigger · ${[...models].map((model) => MODEL_LABELS[model]).join(" + ")}`;
}

function parityLabel(item: EntryDecisionItem): string {
  if (item.parity.status === "MISMATCH") {
    return `Parity mismatch · ${item.parity.mismatchReason ?? "UNSPECIFIED"}`;
  }
  return item.parity.status === "MATCH"
    ? "TradingView / backend parity match"
    : "TradingView parity not provided";
}

function shadowLabel(item: EntryDecisionItem): string {
  const shadow = item.shadowOutcome;
  if (shadow === null) return "No shadow outcome";
  if (shadow.state === "OPEN") return "Shadow open";
  if (shadow.state === "AMBIGUOUS") return "Shadow ambiguous";
  const outcome =
    shadow.outcomeRMillis === null
      ? ""
      : ` · ${(shadow.outcomeRMillis / 1_000).toFixed(2)}R`;
  return `Shadow ${shadow.state.toLowerCase().replace("_", " ")}${outcome}`;
}

function DecisionCard({ item }: { item: EntryDecisionItem }) {
  const selected =
    item.selection.canonicalModel === null
      ? "No model selected"
      : `${MODEL_LABELS[item.selection.canonicalModel]} selected`;
  const coTrigger = coTriggerLabel(item);
  const candidatesByModel = new Map(
    item.candidates.map((candidate) => [candidate.model, candidate]),
  );
  return (
    <article className="entry-decision-card">
      <header className="entry-decision-heading">
        <div>
          <p>
            {item.symbol} / {item.direction}
          </p>
          <h3>{selected}</h3>
          <span>
            {titleCaseReason(item.selection.reason)}
            {item.selection.effectiveActionReason === null
              ? ""
              : ` · ${titleCaseReason(item.selection.effectiveActionReason)}`}
          </span>
        </div>
        <div className="entry-decision-states">
          <strong>{item.selection.action}</strong>
          <span>{parityLabel(item)}</span>
        </div>
      </header>

      <dl className="entry-decision-levels">
        <div>
          <dt>Entry</dt>
          <dd>{item.trade?.entryPrice ?? `${item.tradePlan.entryTicks} ticks`}</dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd>{item.trade?.stopLoss ?? `${item.tradePlan.stopTicks} ticks`}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{item.trade?.takeProfit ?? `${item.tradePlan.targetTicks} ticks`}</dd>
        </div>
        <div>
          <dt>Paper</dt>
          <dd>
            {item.paperIntentId === null ? (
              "No paper trade"
            ) : (
              <a href={`#paper-intent-${item.paperIntentId}`}>
                Paper intent {item.paperIntentId}
              </a>
            )}
          </dd>
        </div>
        <div>
          <dt>Shadow</dt>
          <dd>{shadowLabel(item)}</dd>
        </div>
      </dl>

      {coTrigger === null ? null : <p className="entry-co-trigger">{coTrigger}</p>}

      <div className="entry-candidate-grid">
        {MODEL_ORDER.map((model) => {
          const candidate = candidatesByModel.get(model);
          return candidate === undefined ? (
            <MissingCandidateRow key={model} model={model} />
          ) : (
            <CandidateRow candidate={candidate} item={item} key={model} />
          );
        })}
      </div>
    </article>
  );
}

export function EntryDecisionPanel({
  initialSnapshot,
}: {
  initialSnapshot: EntryDecisionSnapshot;
}) {
  return (
    <section
      aria-label="Entry decision ledger"
      className="entry-decision-panel"
      id="entry-decisions"
    >
      <header className="entry-decision-panel-heading">
        <div>
          <p>RD / THREE-MODEL ARBITRATION</p>
          <h2>Entry decision ledger</h2>
        </div>
        <strong>PAPER ONLY</strong>
      </header>
      <p className="entry-decision-intro">
        Immutable backend decisions explain which model won, which evidence was
        blocked, and whether a paper or shadow position was opened.
      </p>
      {initialSnapshot.state === "ERROR" ? (
        <p className="entry-decision-message entry-decision-error" role="alert">
          {initialSnapshot.message}
        </p>
      ) : initialSnapshot.state === "EMPTY" ? (
        <p className="entry-decision-message">{initialSnapshot.message}</p>
      ) : (
        <div className="entry-decision-list">
          {initialSnapshot.items.map((item) => (
            <DecisionCard item={item} key={item.decisionId} />
          ))}
        </div>
      )}
    </section>
  );
}
