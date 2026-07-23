import { FoundationDashboard } from "../components/FoundationDashboard";
import { loadFoundationSnapshot } from "../lib/api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const snapshot = await loadFoundationSnapshot();
  return <FoundationDashboard snapshot={snapshot} />;
}
