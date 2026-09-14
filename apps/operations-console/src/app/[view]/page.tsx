import { notFound } from "next/navigation";
import { TradeOpsDashboard } from "../../features/tradeops/TradeOpsDashboard";
import { NAV_GROUPS, type TradeOpsView } from "../../features/tradeops/navigation";

const views = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.view)).filter((view) => view !== "dashboard");
export const dynamicParams = false;
export function generateStaticParams() { return views.map((view) => ({ view })); }
export default async function Page({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!views.includes(view as Exclude<TradeOpsView, "dashboard">)) notFound();
  return <TradeOpsDashboard initialView={view as TradeOpsView} />;
}
