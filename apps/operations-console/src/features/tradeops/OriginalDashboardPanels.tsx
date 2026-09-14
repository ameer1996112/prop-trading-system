import { Activity, AlertTriangle, Clock } from "lucide-react";
import type { ApiStatus } from "./TradeOpsShell";

// Original MarketSessionBanner card markup and palette (donor cc740a1).
// Schedule context only: no market feed, automatic broker permission or network timer.
const sessions = [
  { name: "Sydney", city: "Australia", time: "22:00 → 07:00 UTC", color: "from-cyan-950/40 to-cyan-900/10" },
  { name: "Tokyo", city: "Japan", time: "00:00 → 09:00 UTC", color: "from-blue-950/40 to-blue-900/10" },
  { name: "London", city: "United Kingdom", time: "08:00 → 17:00 UTC", color: "from-indigo-950/40 to-indigo-900/10" },
  { name: "New York", city: "United States", time: "13:00 → 22:00 UTC", color: "from-emerald-950/40 to-emerald-900/10" },
];

export function OriginalDashboardPanels({ apiStatus }: { apiStatus: ApiStatus }) {
  return <>
    {apiStatus !== "ONLINE" && <div className="rounded-lg border border-amber-500/30 bg-amber-950/60 px-3 py-2.5 text-[11px] text-amber-100 flex items-start gap-2">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" />
      <div><div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">Observation API {apiStatus.toLowerCase()}</div><p className="mt-0.5 font-mono text-[10px] text-amber-100/80">Dashboard · Data availability is shown per source. Broker connection and trading actions are unavailable.</p></div>
    </div>}
    <section aria-label="Market sessions" className="shrink-0">
      <div className="rounded-md border border-zinc-800/80 bg-[#09090b] p-3">
        <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-gradient-to-r from-zinc-900/40 to-zinc-800/10 px-2.5 py-1.5"><Activity size={14} className="text-[var(--to-text-dim)]" /><h2 className="font-sans text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--to-text-secondary)]">Market Sessions</h2></div>
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--to-text-dim)]"><Clock size={13} />Reference schedule · live market status unavailable</span>
        </div>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
          {sessions.map((session) => <div key={session.name} className={`group relative overflow-hidden rounded-md border border-zinc-800/80 bg-gradient-to-br ${session.color}`}>
            <div className="p-3"><div className="mb-2.5 flex items-center justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase leading-none tracking-[0.12em]">{session.name}</p><p className="mt-1 text-[9px] uppercase tracking-[0.08em] text-[var(--to-text-dim)]">{session.city}</p></div><span className="rounded-md border border-zinc-800/50 bg-black/20 px-2 py-1 text-[9px] text-[var(--to-text-dim)]">UNAVAILABLE</span></div>
              <p className="font-mono text-[10px] text-[var(--to-text-dim)]">{session.time}</p><div className="mt-2 h-1 rounded-full bg-zinc-800/50" />
            </div>
          </div>)}
        </div>
        <p className="mt-2 text-[9px] text-[var(--to-text-dim)]">Original fixed-UTC reference hours; daylight saving and broker holidays are not evaluated. Not a trade-permission signal.</p>
      </div>
    </section>
  </>;
}
