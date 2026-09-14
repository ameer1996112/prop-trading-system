import {
  BarChart3, Bell, BookOpen, Gauge, LayoutDashboard, PlaySquare,
  Settings, SlidersHorizontal, Timer, Trophy, Users, type LucideIcon,
} from "lucide-react";

export type TradeOpsView = "dashboard" | "accounts" | "risk" | "analytics" | "journal" | "execution-quality" | "alerts" | "prop-firm" | "alert-setup" | "optimizer" | "strategies" | "notifications" | "settings";
export type PresentationStatus = "loading" | "ready" | "unavailable";
export type NavItem = { id: string; label: string; icon: LucideIcon; view: TradeOpsView };
export type NavGroup = { id: string; label: string; items: readonly NavItem[] };
/** Original TradeOps routes remain navigable; capability restrictions belong inside pages. */
export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "overview", label: "Overview", items: [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, view: "dashboard" },
  ] },
  { id: "trading", label: "Trading", items: [
    { id: "accounts", label: "Accounts", icon: Users, view: "accounts" },
    { id: "execution", label: "Exec Quality", icon: Timer, view: "execution-quality" },
  ] },
  { id: "monitoring", label: "Monitoring", items: [
    { id: "risk", label: "Risk & Rules", icon: Gauge, view: "risk" },
    { id: "alerts", label: "Alerts", icon: Bell, view: "alerts" },
    { id: "prop-firm", label: "Prop Firm", icon: Trophy, view: "prop-firm" },
  ] },
  { id: "analytics", label: "Analytics", items: [
    { id: "analytics", label: "Analytics", icon: BarChart3, view: "analytics" },
  ] },
  { id: "automation", label: "Automation", items: [
    { id: "alert-setup", label: "Alert Setup", icon: Bell, view: "alert-setup" },
    { id: "optimizer", label: "Optimizer", icon: PlaySquare, view: "optimizer" },
  ] },
  { id: "strategy", label: "Strategy", items: [
    { id: "strategies", label: "Strategies", icon: SlidersHorizontal, view: "strategies" },
  ] },
  { id: "ops", label: "Ops", items: [
    { id: "journal", label: "Journal", icon: BookOpen, view: "journal" },
    { id: "notifications", label: "Notifications", icon: Bell, view: "notifications" },
    { id: "settings", label: "Settings", icon: Settings, view: "settings" },
  ] },
];

export function viewPath(view: TradeOpsView): string { return view === "dashboard" ? "/" : `/${view}/`; }
export function pathView(path: string): TradeOpsView | null {
  const trimmed = path.replace(/\/+$/, "") || "/";
  return NAV_GROUPS.flatMap((group) => group.items).find((item) => viewPath(item.view).replace(/\/+$/, "") === trimmed.replace(/\/+$/, ""))?.view ?? null;
}
