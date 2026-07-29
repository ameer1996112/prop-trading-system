import type {
  ObservationReceipt,
  ObservationReceiptStatus,
  ObservationReceiptsSnapshot,
} from "../lib/api";

export const LOADING_OBSERVATION_RECEIPTS: ObservationReceiptsSnapshot = {
  state: "LOADING",
  ingressEnabled: null,
  count: 0,
  items: [],
  message: "Checking the observation ledger. Ingress remains blocked until verified.",
};

function displayTimestamp(value: string): string {
  return value.replace("T", " ").replace("Z", " UTC");
}

function statusCounts(items: ObservationReceipt[]): Record<ObservationReceiptStatus, number> {
  return items.reduce<Record<ObservationReceiptStatus, number>>(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    { RECEIVED: 0, DUPLICATE: 0, REJECTED: 0 },
  );
}

function ReceiptNotice({ snapshot }: { snapshot: ObservationReceiptsSnapshot }) {
  const copy = {
    LOADING: "Verifying ledger",
    ERROR: "Ledger unavailable",
    EMPTY: "Ledger is empty",
    BLOCKED: "Ingress blocked",
    RECEIVED: "Observations recorded",
  }[snapshot.state];
  return (
    <div
      className={`ledger-notice ledger-notice-${snapshot.state.toLowerCase()}`}
      role={snapshot.state === "ERROR" ? "alert" : "status"}
      aria-live={snapshot.state === "ERROR" ? "assertive" : "polite"}
      aria-busy={snapshot.state === "LOADING"}
    >
      <span className="notice-mark" aria-hidden="true" />
      <div>
        <strong>{copy}</strong>
        <p>{snapshot.message}</p>
      </div>
      <span className="notice-code">{snapshot.state}</span>
    </div>
  );
}

function ReceiptCard({ receipt, index }: { receipt: ObservationReceipt; index: number }) {
  return (
    <li className="receipt-card">
      <div className="receipt-ordinal" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="receipt-instrument">
        <div className="receipt-badges">
          <span className={`receipt-outcome receipt-outcome-${receipt.status.toLowerCase()}`}>
            {receipt.status}
          </span>
          <span className={`receipt-source receipt-source-${receipt.source.toLowerCase()}`}>
            {receipt.source}
          </span>
        </div>
        <h3>{receipt.symbol}</h3>
        <p>
          {receipt.feed} <span aria-hidden="true">/</span> {receipt.kind}
        </p>
      </div>
      <dl className="receipt-metadata">
        <div>
          <dt>Sequence</dt>
          <dd>{receipt.sequence}</dd>
        </div>
        <div>
          <dt>Observed</dt>
          <dd>
            <time dateTime={receipt.receivedAt}>{displayTimestamp(receipt.receivedAt)}</time>
          </dd>
        </div>
      </dl>
      <p className="receipt-safety">Recorded only · execution disconnected</p>
    </li>
  );
}

export function ObservationReceiptsPanel({
  snapshot,
}: {
  snapshot: ObservationReceiptsSnapshot;
}) {
  const counts = statusCounts(snapshot.items);
  return (
    <section className="receipt-section" aria-labelledby="observation-receipts-heading">
      <div className="section-heading">
        <div>
          <p className="section-number">B / OBSERVATION LOG</p>
          <h2 id="observation-receipts-heading">Alert receipts</h2>
        </div>
        <p>
          Delivery evidence, not trade intent. The latest fifty safe metadata records are shown.
        </p>
      </div>

      <ReceiptNotice snapshot={snapshot} />

      <dl className="receipt-counts" aria-label="Receipt outcome counts">
        <div>
          <dt>Total</dt>
          <dd>{snapshot.count}</dd>
        </div>
        {(Object.keys(counts) as ObservationReceiptStatus[]).map((status) => (
          <div key={status}>
            <dt>{status}</dt>
            <dd>{counts[status]}</dd>
          </div>
        ))}
      </dl>

      {snapshot.items.length > 0 ? (
        <ul className="receipt-list" aria-label="Observation receipt cards">
          {snapshot.items.map((receipt, index) => (
            <ReceiptCard
              key={`${receipt.symbol}:${receipt.sequence}:${receipt.receivedAt}:${index}`}
              receipt={receipt}
              index={index}
            />
          ))}
        </ul>
      ) : (
        <div className="empty-ledger" aria-hidden={snapshot.state === "LOADING"}>
          <span>—</span>
          <p>No safe receipt metadata to display.</p>
        </div>
      )}
    </section>
  );
}
