import { useId, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

export const inputClass = "h-9 w-full rounded-md border border-[var(--to-border)] bg-[var(--to-surface)] px-3 text-sm text-[var(--to-text-primary)]";

export function moveLocalTabFocus(event: KeyboardEvent<HTMLButtonElement>, tabs: readonly string[], index: number, onChange: (tab: string) => void) {
  let next = index;
  if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
  else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = tabs.length - 1;
  else return;
  event.preventDefault();
  onChange(tabs[next]!);
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
}

export function Unavailable({ children }: { children: ReactNode }) {
  return <p className="flex items-start gap-2 rounded-lg border border-[var(--to-border)] bg-[var(--to-surface)] px-3 py-2.5 text-xs text-[var(--to-text-dim)]"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span>Unavailable — {children}</span></p>;
}

export function DisabledAction({ children, reason, className = "" }: { children: ReactNode; reason: string; className?: string }) {
  const id = useId();
  return <div className="inline-flex max-w-sm flex-col items-start gap-1"><button type="button" disabled aria-describedby={id} className={`flex items-center gap-1.5 rounded border border-[var(--to-border)] bg-[var(--to-surface-raised)] px-3 py-1.5 font-mono text-[11px] text-[var(--to-text-dim)] opacity-60 cursor-not-allowed ${className}`}>{children}</button><span id={id} className="text-[10px] text-[var(--to-text-dim)]">{reason}</span></div>;
}

export function Card({ title, description, children, className = "", accessory }: { title: string; description?: string; children: ReactNode; className?: string; accessory?: ReactNode }) {
  const id = useId();
  return <section aria-labelledby={id} className={`glow-card rounded-xl border border-[var(--to-border)] bg-[var(--to-surface)] ${className}`}><div className="flex flex-col gap-1.5 px-6 pt-6 pb-4"><div className="flex items-center justify-between gap-3"><h2 id={id} className="text-sm font-semibold text-[var(--to-text-primary)]">{title}</h2>{accessory}</div>{description && <p className="text-xs text-[var(--to-text-dim)]">{description}</p>}</div><div className="px-6 pb-6">{children}</div></section>;
}

export function Metric({ label, detail, className = "" }: { label: string; detail?: string; className?: string }) {
  return <div role="group" aria-label={label} className={`rounded-lg border border-[var(--to-border)] bg-[var(--to-surface)] p-3 ${className}`}><p className="text-[10px] uppercase tracking-[0.15em] text-[var(--to-text-dim)]">{label}</p><p className="mt-2 font-mono text-2xl font-semibold text-[var(--to-text-primary)]">—</p>{detail && <p className="mt-1 text-xs text-[var(--to-text-dim)]">{detail}</p>}</div>;
}

export function EmptyTable({ label, columns, reason }: { label: string; columns: string[]; reason: string }) {
  return <div className="overflow-x-auto"><table aria-label={label} className="w-full min-w-max text-left text-xs"><thead><tr className="border-b border-[var(--to-border)]">{columns.map((column) => <th key={column} className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-[var(--to-text-dim)]">{column}</th>)}</tr></thead><tbody><tr><td colSpan={columns.length} className="px-3 py-8 text-center text-[var(--to-text-dim)]">Unavailable — {reason}</td></tr></tbody></table></div>;
}

export function LocalTabs({ label, tabs, active, onChange, children, line = false }: { label: string; tabs: readonly string[]; active: string; onChange: (tab: string) => void; children: ReactNode; line?: boolean }) {
  const id = useId();
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={label} className={line ? "flex flex-wrap justify-start gap-1 border-b border-[var(--to-border)]" : "inline-flex flex-wrap gap-1 rounded border border-[var(--to-border)] bg-[var(--to-surface)] p-0.5"}>
        {tabs.map((tab, index) => (
          <button key={tab} id={`${id}-${index}`} type="button" role="tab" tabIndex={active === tab ? 0 : -1} aria-selected={active === tab} aria-controls={`${id}-panel`} onClick={() => onChange(tab)} onKeyDown={(event) => moveLocalTabFocus(event, tabs, index, onChange)} className={`px-3 py-1.5 text-[11px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--to-accent-blue)] ${active === tab ? "bg-[var(--to-surface-raised)] text-[var(--to-text-primary)]" : "text-[var(--to-text-dim)] hover:text-[var(--to-text-secondary)]"}`}>{tab}</button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" tabIndex={0} aria-labelledby={`${id}-${tabs.indexOf(active)}`} className="space-y-4">{children}</div>
    </div>
  );
}

export function ChartUnavailable({ label, height = "h-[300px]" }: { label: string; height?: string }) {
  return <div className={`${height} flex items-center justify-center rounded border border-dashed border-[var(--to-border)] text-xs text-[var(--to-text-dim)]`}>Unavailable — {label} data is not provided by the paper API.</div>;
}
