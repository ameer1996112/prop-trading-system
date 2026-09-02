"use client";

import { useEffect, useState } from "react";

import {
  type ApiHealthSnapshot,
  loadApiHealth,
  loadObservationReceipts,
  type ObservationReceiptsSnapshot,
} from "../lib/api";
import {
  LOADING_OBSERVATION_RECEIPTS,
  ObservationReceiptsPanel,
} from "./ObservationReceipts";
import { PaperSimulationPanel } from "./PaperSimulationPanel";
import { startVisiblePolling } from "../lib/visible-polling";

const POLL_INTERVAL_MS = 30_000;

const OFFLINE_HEALTH: ApiHealthSnapshot = {
  state: "OFFLINE",
  paperSimulator: "UNKNOWN",
  execution: "UNKNOWN",
  message: "API health has not been verified. The console remains fail-closed.",
};

function ingressLabel(snapshot: ObservationReceiptsSnapshot): "ENABLED" | "BLOCKED" {
  return snapshot.ingressEnabled === true ? "ENABLED" : "BLOCKED";
}

function formatCheckTime(value: Date | null): string {
  if (value === null) return "Awaiting first check";
  return `${value.toISOString().replace("T", " ").replace(/\.\d{3}Z$/u, " UTC")}`;
}

export function FoundationDashboard() {
  const [health, setHealth] = useState<ApiHealthSnapshot>(OFFLINE_HEALTH);
  const [receipts, setReceipts] = useState<ObservationReceiptsSnapshot>(
    LOADING_OBSERVATION_RECEIPTS,
  );
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [paused, setPaused] = useState(false);
  const [stale, setStale] = useState(true);

  useEffect(() => {
    let active = true;
    let inFlight: AbortController | null = null;

    const poll = async () => {
      setPaused(false);
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      const [nextHealth, nextReceipts] = await Promise.all([
        loadApiHealth(controller.signal),
        loadObservationReceipts(controller.signal),
      ]);
      if (!active || controller.signal.aborted) return;
      setHealth(nextHealth);
      setReceipts(nextReceipts);
      setLastCheckedAt(new Date());
      setStale(false);
    };

    const stopPolling = startVisiblePolling(
      () => void poll(),
      () => {
        inFlight?.abort();
        setPaused(true);
        setStale(true);
      },
      POLL_INTERVAL_MS,
    );
    return () => {
      active = false;
      stopPolling();
      inFlight?.abort();
    };
  }, []);

  const displayedHealth = stale ? OFFLINE_HEALTH : health;
  const ingress = stale ? "BLOCKED" : ingressLabel(receipts);

  return (
    <main className="ledger-shell">
      <div className="safety-ribbon" role="note">
        <span>PAPER LAB</span>
        <strong>NO EXECUTION</strong>
        <span>OBSERVE · RECORD · REVIEW</span>
      </div>

      <header className="editorial-header">
        <div className="header-index" aria-hidden="true">
          01
        </div>
        <div className="header-copy">
          <p className="eyebrow">TradingView observation ledger</p>
          <h1>Signals enter here. Orders never do.</h1>
        </div>
        <p className="header-note">
          Alert delivery, three-model entry arbitration, and protected paper
          simulation. This console has no broker connection or live execution
          path.
        </p>
      </header>

      <section className="system-strip" aria-labelledby="system-state-heading">
        <div className="strip-heading">
          <p className="section-number">A / SYSTEM STATE</p>
          <h2 id="system-state-heading">Fail-closed monitor</h2>
        </div>
        <dl className="system-readings">
          <div>
            <dt>Observation API</dt>
            <dd className={`reading reading-${displayedHealth.state.toLowerCase()}`}>
              <span aria-hidden="true" />
              {displayedHealth.state}
            </dd>
          </div>
          <div>
            <dt>Ingress</dt>
            <dd className={`reading reading-${ingress.toLowerCase()}`}>
              <span aria-hidden="true" />
              {ingress}
            </dd>
          </div>
          <div>
            <dt>Paper simulator</dt>
            <dd
              className={`reading reading-${displayedHealth.paperSimulator.toLowerCase()}`}
            >
              <span aria-hidden="true" />
              {displayedHealth.paperSimulator}
            </dd>
          </div>
          <div>
            <dt>Broker execution</dt>
            <dd className={`reading reading-${displayedHealth.execution.toLowerCase()}`}>
              <span aria-hidden="true" />
              {displayedHealth.execution}
            </dd>
          </div>
          <div>
            <dt>Last check</dt>
            <dd>
              <time dateTime={lastCheckedAt?.toISOString()}>{formatCheckTime(lastCheckedAt)}</time>
            </dd>
          </div>
        </dl>
        <p className="system-message" role="status" aria-live="polite">
          {paused
            ? "Updates paused — page hidden or offline. Displayed evidence may be stale."
            : stale ? "Snapshot stale — awaiting a fresh status check." : health.message}
        </p>
      </section>

      <ObservationReceiptsPanel snapshot={receipts} />
      <PaperSimulationPanel />

      <footer className="ledger-footer">
        <p>
          <strong>PAPER LAB · BROKER EXECUTION DISABLED</strong>
          Simulation outcomes are bookkeeping facts only. Nothing on this page can reach a
          broker or prop-firm account.
        </p>
        <span>Auto-check every 30 seconds while visible and online</span>
      </footer>
    </main>
  );
}
