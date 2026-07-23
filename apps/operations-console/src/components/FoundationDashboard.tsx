import type { FoundationSnapshot } from "../lib/api";
import { SnapshotRefresh } from "./SnapshotRefresh";

export function FoundationDashboard({ snapshot }: { snapshot: FoundationSnapshot }) {
  return (
    <main>
      <header>
        <p className="eyebrow">Observation-only foundation</p>
        <h1>Phase 0 operations console</h1>
        <p className="lede">No broker execution capability exists in this repository.</p>
      </header>
      <section className={`status status-${snapshot.status.toLowerCase()}`} aria-live="polite">
        <div>
          <span className="label">Readiness</span>
          <strong>{snapshot.status}</strong>
        </div>
        <div>
          <span className="label">Data source</span>
          <strong>{snapshot.source}</strong>
        </div>
        <p>{snapshot.message}</p>
        <p>
          <span className="label">Evaluated</span>{" "}
          {snapshot.evaluatedAt ?? "UNKNOWN — no validated server timestamp"}
        </p>
        <p>
          <span className="label">Evidence freshness</span>{" "}
          {snapshot.evidenceLastModifiedAt ?? "UNKNOWN — no validated evidence timestamp"}
        </p>
      </section>
      <SnapshotRefresh />
      <section>
        <h2>Activation gates</h2>
        {snapshot.gates.length === 0 ? (
          <div className="empty">Gate data is unavailable. This is not an empty-success state.</div>
        ) : (
          <ul className="gates">
            {snapshot.gates.map((gate) => (
              <li key={gate.gate_id}>
                <div>
                  <strong>{gate.gate_id.replaceAll("_", " ")}</strong>
                  <span>{gate.status}</span>
                </div>
                <p>{gate.reason}</p>
                {gate.missing_requirements.length > 0 && (
                  <small>{gate.missing_requirements.length} required proof item(s) absent</small>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
