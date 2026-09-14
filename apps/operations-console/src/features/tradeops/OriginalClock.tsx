"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

/** Local-only DualClock presentation from the original TopBar. No storage or requests. */
export function OriginalClock() {
  const [now, setNow] = useState<Date | null>(null);
  const [timezone, setTimezone] = useState("Asia/Jerusalem");
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const formatted = (zone: string) => now?.toLocaleTimeString("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) ?? "—";
  return <div className="hidden min-[1500px]:flex items-center gap-2 text-[10px] font-mono tabular-nums bg-[var(--to-surface-raised)]/30 px-3 py-1.5 rounded-lg border border-white/5">
    <Clock size={13} className="text-indigo-400" /><span>{formatted("UTC")}</span><span className="text-[var(--to-text-dim)]">UTC</span><span className="h-3 w-px bg-white/10" /><span>{formatted(timezone)}</span>
    <select aria-label="Clock timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} className="bg-[var(--to-surface)] text-[9px] text-[var(--to-text-secondary)] max-w-16">
      <option value="Asia/Jerusalem">IL</option><option value="UTC">UTC</option><option value="Europe/London">London</option><option value="America/New_York">NY</option><option value="Asia/Tokyo">Tokyo</option>
    </select>
  </div>;
}
