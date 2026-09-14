import { Bell, Globe, Power, Sparkles } from "lucide-react";
import type { ApiStatus } from "./TradeOpsShell";
import styles from "./tradeops.module.css";

/** TopBar.tsx presentation adapted from donor cc740a1. No legacy provider or mutation. */
export function OriginalTopBar({ apiStatus, eaStatus = "UNKNOWN", onNotifications }: { apiStatus: ApiStatus; eaStatus?: ApiStatus; onNotifications: () => void }) {
  return <>
    <div className={`${styles.apiBadge} ${apiStatus === "ONLINE" ? styles.positive : apiStatus === "OFFLINE" ? styles.negative : styles.warning}`}>
      <span role="status" aria-label="API status" className="flex items-center gap-1.5"><span className={styles.statusDot} />API {apiStatus}</span>
      <span className="h-3 w-px bg-current opacity-30" /><span className="text-[var(--to-text-secondary)]">BROKER —</span>
    </div>
    <span role="status" aria-label="EA heartbeat status" className={`${styles.badge} ${eaStatus === "ONLINE" ? styles.positive : eaStatus === "OFFLINE" ? styles.negative : styles.warning}`}>EA {eaStatus}</span>
    <div className="hidden lg:flex items-center bg-[#09090b] border border-white/5 rounded-xl shadow-inner overflow-hidden shrink-0 whitespace-nowrap">
      <div className="flex flex-col items-end gap-1 px-4 py-1.5 font-mono" title="Broker daily PnL is unavailable; paper totals are shown separately below."><span className="text-[9px] text-[var(--to-text-dim)] uppercase tracking-widest">Today</span><span className="text-[13px]">—</span></div>
    </div>
    <div className="flex items-center gap-1.5 bg-[#09090b] border border-white/5 p-1 rounded-xl shadow-inner shrink-0">
      <button type="button" disabled aria-label="Live markets unavailable" title="Market stream is not connected." className="p-2 text-[var(--to-text-dim)]"><Globe size={16} /></button>
      <button type="button" disabled aria-label="AI Copilot unavailable" title="AI service is not connected." className="p-2 text-[var(--to-text-dim)]"><Sparkles size={16} /></button>
      <button type="button" aria-label="Open notifications" onClick={onNotifications} className="p-2 text-[var(--to-text-secondary)]"><Bell size={16} /></button>
      <span className="h-6 w-px bg-white/10" />
      <button type="button" disabled aria-label="Kill switch unavailable" title="Execution controls are unavailable. This console is read-only." className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1.5 text-[10px] font-bold tracking-widest text-[var(--to-text-dim)]"><Power size={14} />KILL</button>
    </div>
  </>;
}
