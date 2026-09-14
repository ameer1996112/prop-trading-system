import { Radio } from "lucide-react";
import type { Mt5HealthStatus, Mt5HealthSummary } from "./mt5-health-contract.mjs";
import type { Mt5Connection, TradeOpsResource } from "./session";
import styles from "./tradeops.module.css";

function time(epoch: number) { return new Date(epoch * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC"); }

export function Mt5HealthPanel({ resource, connection, status, age, onConnect, onDisconnect }: {
  resource: TradeOpsResource<Mt5HealthSummary>; connection: Mt5Connection; status: Mt5HealthStatus; age: number | null;
  onConnect: () => void; onDisconnect: () => void;
}) {
  const current = resource.data?.current;
  return <section aria-label="MT5 health" className={styles.panel}>
    <header className={`${styles.panelHeader} flex-wrap gap-2`}>
      <h2 className={`${styles.panelTitle} flex items-center gap-2`}><Radio size={15} aria-hidden="true" />MT5 health</h2>
      <div className="flex flex-wrap items-center gap-2"><span className={`${styles.badge} ${status === "ONLINE" ? styles.positive : status === "OFFLINE" ? styles.negative : styles.warning}`}>{connection === "CONNECTED" ? status : connection === "AUTH_REQUIRED" ? "SIGN-IN REQUIRED" : "NOT CONNECTED"}</span>
        {connection === "CONNECTED" ? <button type="button" className={styles.button} onClick={onDisconnect}>Disconnect health feed</button> : <button type="button" className={styles.button} onClick={onConnect}>Read MT5 health</button>}
      </div>
    </header>
    <div className={`${styles.panelBody} space-y-3`}>
      <p className={styles.sourceNote}>Read-only DRY_RUN health feed. Reported permission flags are not trading authority.</p>
      {connection !== "CONNECTED" && <div className="space-y-2 text-xs text-[var(--to-text-secondary)]">
        <p>{connection === "AUTH_REQUIRED" ? "Cloudflare Access sign-in required. Restart the local preview with health authentication, complete sign-in, then read the feed again." : "Read the existing private health service after authenticating the local preview. No EA or trading settings will change."}</p>
        <code className="block break-all rounded border border-[var(--to-border)] px-3 py-2 text-[11px]">npm run preview:tradeops -- --mt5-health</code>
        <p className={styles.sourceNote}>Access credentials stay out of this page. Never enter an EA or broker credential here. Disconnect clears this tab; stopping the local preview clears its token copy.</p>
      </div>}
      {connection === "CONNECTED" && <>
        {resource.loading && <p className={styles.sourceNote}>Reading MT5 health…</p>}
        {(resource.error || resource.stale) && <p role="status" className={styles.warning}>{resource.error ?? "Updates paused."} {resource.data ? "Last-known health is stale; the heartbeat age continues to increase." : "No verified health response is available."}</p>}
        {!current && !resource.loading && !resource.error && <p className={styles.sourceNote}>No accepted heartbeat is available from this health source.</p>}
        {current && <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {([
            ["Last accepted sync", time(current.last_accepted_epoch)], ["Heartbeat age", age === null ? "UNKNOWN" : `${age}s`],
            ["Reported terminal", current.terminal_connection_state], ["Terminal build", String(current.terminal_build)],
            ["Source symbol", current.source_symbol], ["Account trade permission", current.account_trade_permission],
            ["Terminal trade permission", current.terminal_trade_permission], ["EA Algo permission", current.algo_trading_permission],
            ["Accepted request / server sequence", `${current.request_sequence} / ${current.server_sequence}`],
          ] as const).map(([label, value]) => <div key={label} className="min-w-0 rounded border border-[var(--to-border)] bg-[var(--to-surface-raised)] px-3 py-2"><dt className="text-[10px] text-[var(--to-text-dim)]">{label}</dt><dd className="mt-1 break-words font-mono text-xs">{value}</dd></div>)}
        </dl>}
        {resource.data && <details className="rounded border border-[var(--to-border)] px-3 py-2 text-xs">
          <summary className="cursor-pointer text-[var(--to-text-secondary)]">Recent sync results</summary>
          <p className={`${styles.sourceNote} my-2`}>Up to 20 source-reported outcomes. Rejected syncs do not refresh the accepted heartbeat.</p>
          {resource.data.recent.length === 0 ? <p className={styles.sourceNote}>No recent sync results supplied.</p> : <ul className="space-y-2">{resource.data.recent.map((row, index) => <li key={`${row.request_sequence}-${row.received_at_epoch}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--to-border)] pt-2 font-mono text-[11px]">
            <time dateTime={new Date(row.received_at_epoch * 1000).toISOString()}>{time(row.received_at_epoch)}</time><span>Request {row.request_sequence}</span><span>Server {row.server_sequence ?? "—"}</span><span className={row.result_code === "ACCEPTED" ? styles.positive : styles.warning}>{row.result_code}</span>
          </li>)}</ul>}
        </details>}
      </>}
      <p className={styles.sourceNote}>Broker account identity, balance, equity, positions and fills are not supplied by this feed. Paper records below are separate.</p>
    </div>
  </section>;
}
