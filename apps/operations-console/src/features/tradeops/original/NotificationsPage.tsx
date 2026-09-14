import { Bell, Route } from "lucide-react";
import { Unavailable } from "./primitives";

const types = ["Trade Signals", "Trade Closes", "Risk Alerts", "Guard Alerts", "Bug / System Errors"];

// Routing presentation and category labels from components/notifications/RoutingPanel.tsx at cc740a1.
export function NotificationsPage() {
  return (
    <div className="space-y-4 p-4">
      <header className="flex items-center gap-2 mb-2">
        <Bell className="h-4 w-4 text-[var(--to-text-dim)]" />
        <h1 className="text-sm font-semibold text-[var(--to-text-primary)]">Notification Settings</h1>
      </header>
      <Unavailable>notification routing settings and writes are not connected. Existing channel states are unknown.</Unavailable>
      <section aria-label="Notification Routing" className="to-panel">
        <div className="to-panel-header"><div className="flex items-center gap-2"><Route className="h-3.5 w-3.5 text-[var(--to-text-dim)]" /><h2 className="to-panel-title">Notification Routing</h2></div></div>
        <div className="overflow-x-auto">
          <table aria-label="Notification Routing" className="w-full text-xs">
            <thead><tr className="border-b border-[var(--to-border)]">{["Alert Type", "Discord", "Telegram", "Discord Channel"].map((label, index) => <th key={label} className={`py-2 px-3 text-[10px] uppercase tracking-wider text-[var(--to-text-dim)] ${index ? "text-center" : "text-left"}`}>{label}</th>)}</tr></thead>
            <tbody>
              {types.map((label) => (
                <tr key={label} className="border-b border-[var(--to-border)] last:border-0 hover:bg-[var(--to-surface-hover)]">
                  <td className="py-2.5 px-3 text-[var(--to-text-secondary)] font-medium">{label}</td>
                  {["Discord", "Telegram"].map((channel) => <td key={channel} className="py-2.5 px-3 text-center text-[var(--to-text-dim)]"><button type="button" disabled aria-label={`${label} ${channel} unavailable`} title="Routing service is not connected" className="text-[10px] cursor-not-allowed">Unavailable</button></td>)}
                  <td className="py-2.5 px-3 text-center"><select aria-label={`${label} Discord channel`} disabled value="" className="bg-[var(--to-surface)] border border-[var(--to-border)] rounded px-1.5 py-0.5 text-xs text-[var(--to-text-dim)]"><option value="">Unavailable</option></select></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
