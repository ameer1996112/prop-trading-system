"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Activity, FlaskConical, EyeOff, Zap, Menu, PanelLeft, PanelLeftClose, X } from "lucide-react";
import { NAV_GROUPS, viewPath, type TradeOpsView } from "./navigation";
import { OriginalTopBar } from "./OriginalTopBar";
import { OriginalClock } from "./OriginalClock";
import styles from "./tradeops.module.css";

export type ApiStatus = "ONLINE" | "OFFLINE" | "UNKNOWN" | "STALE";
export type TradeOpsShellProps = {
  view: TradeOpsView;
  onViewChange: (view: TradeOpsView) => void;
  apiStatus: ApiStatus;
  eaStatus?: ApiStatus;
  refreshAction?: ReactNode;
  credentialAction?: ReactNode;
  children?: ReactNode;
};

function Navigation({ view, onSelect, collapsed = false }: {
  view: TradeOpsView; onSelect: (view: TradeOpsView) => void; collapsed?: boolean;
}) {
  return (
    <nav className={styles.navigation} aria-label="TradeOps navigation">
      {NAV_GROUPS.map((group) => (
        <section key={group.id} className={styles.navGroup} aria-label={group.label}>
          <h2 className={collapsed ? styles.srOnly : styles.navGroupLabel}>{group.label}</h2>
          {group.items.map((item) => (
            <div key={item.id} className={styles.navItem}>
              <a
                href={viewPath(item.view)}
                className={`${styles.navButton} ${item.view === view ? styles.navActive : ""}`}
                aria-label={item.label}
                aria-current={item.view === view ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault(); onSelect(item.view);
                }}
              >
                <item.icon size={16} aria-hidden="true" />
                <span className={collapsed ? styles.srOnly : undefined}>{item.label}</span>
              </a>
            </div>
          ))}
        </section>
      ))}
    </nav>
  );
}

/** Presentation only: networking and credentials remain owned by the caller. */
export function TradeOpsShell({ view, onViewChange, apiStatus, eaStatus = "UNKNOWN", refreshAction, credentialAction, children }: TradeOpsShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const dialogId = useId();
  const mainId = useId();
  const currentGroup = NAV_GROUPS.find((group) => group.items.some((item) => item.view === view));
  const currentItem = currentGroup?.items.find((item) => item.view === view);

  // Every route change, including back/forward, starts at its header. The main
  // scroller is shared so navigation never inherits another page's offset.
  useEffect(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }, [view]);

  useEffect(() => {
    if (!mobileOpen) return;
    const opener = openerRef.current;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, [mobileOpen]);

  function closeMobile() {
    setMobileOpen(false);
  }

  function handleDialogKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobile();
    }
    if (event.key !== "Tab") return;
    const buttons = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  return (
    <div className={`${styles.root} ${collapsed ? styles.collapsed : ""}`}>
      <div inert={mobileOpen || undefined} aria-hidden={mobileOpen || undefined}>
        <a className={styles.skipLink} href={`#${mainId}`} onClick={() => mainRef.current?.focus()}>Skip to content</a>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}><Activity size={16} aria-hidden="true" /></span>
            <div className={collapsed ? styles.srOnly : styles.brandCopy}>
              <strong>TradeOps</strong><span>5M · PAPER</span>
            </div>
          </div>
          <Navigation view={view} onSelect={onViewChange} collapsed={collapsed} />
          <div className={styles.sidebarFooter}>
            {collapsed ? <span className={styles.paperBadge} title="PAPER · read-only"><FlaskConical size={13} aria-hidden="true" /></span> : <div className={styles.modePanel}>
              <span>Mode</span><div>
                <span className={styles.paperBadge}><FlaskConical size={12} aria-hidden="true" />Paper</span>
                <button type="button" disabled title="Trading mode changes are unavailable in this read-only console."><Zap size={12} aria-hidden="true" />Live</button>
                <button type="button" disabled title="Trading mode changes are unavailable in this read-only console."><EyeOff size={12} aria-hidden="true" />Dry Run</button>
              </div>
              <p>Mode changes unavailable · read-only</p>
            </div>}
            <button type="button" className={styles.collapseButton} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed((value) => !value)}>
              {collapsed ? <PanelLeft size={16} aria-hidden="true" /> : <><PanelLeftClose size={16} aria-hidden="true" /><span>Collapse</span></>}
            </button>
          </div>
        </aside>
        <div className={styles.shellColumn}>
          <header className={styles.topbar}>
            <div className={styles.headerIdentity}>
              <button ref={openerRef} type="button" className={`${styles.iconButton} ${styles.mobileMenu}`} aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls={dialogId} onClick={() => setMobileOpen(true)}><Menu size={18} aria-hidden="true" /></button>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366f1]/10 to-[#a855f7]/10 border border-white/5 shadow-[0_0_15px_rgba(99,102,241,0.15)]"><Activity size={20} className="text-indigo-400" /></div>
              <div className={styles.headerTitle}><span>{currentGroup?.label}</span><h1>{currentItem?.label}</h1></div>
              <OriginalClock />
            </div>
            <div className={styles.headerActions}>
              <OriginalTopBar apiStatus={apiStatus} eaStatus={eaStatus} onNotifications={() => onViewChange("notifications")} />
              {refreshAction}{credentialAction}
            </div>
          </header>
          <div className={styles.observationBar}><span>Observation only · read-only</span><span>Broker status unavailable</span></div>
          <main ref={mainRef} id={mainId} tabIndex={-1} className={styles.main}><div className={styles.content}>{children}</div></main>
        </div>
      </div>
      {mobileOpen && (
        <div className={styles.mobileBackdrop} onClick={(event) => { if (event.target === event.currentTarget) closeMobile(); }}>
          <div id={dialogId} role="dialog" aria-modal="true" aria-label="Navigation" className={styles.mobileDrawer} onKeyDown={handleDialogKeys}>
            <div className={styles.mobileDrawerHeader}><strong>TradeOps</strong><button ref={closeRef} type="button" className={styles.iconButton} aria-label="Close navigation" onClick={closeMobile}><X size={18} aria-hidden="true" /></button></div>
            <Navigation view={view} onSelect={(selectedView) => { onViewChange(selectedView); closeMobile(); }} />
          </div>
        </div>
      )}
    </div>
  );
}
