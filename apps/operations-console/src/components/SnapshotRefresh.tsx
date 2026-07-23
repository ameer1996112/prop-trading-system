"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

export const SNAPSHOT_REFRESH_MS = 30_000;

export function SnapshotRefresh() {
  const router = useRouter();
  const [lastRequestedAt, setLastRequestedAt] = useState<string | null>(null);
  const [isRefreshing, startTransition] = useTransition();
  const refresh = useCallback(() => {
    setLastRequestedAt(new Date().toISOString());
    startTransition(() => router.refresh());
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(refresh, SNAPSHOT_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <aside className="refresh-state" aria-live="polite">
      <span>Refresh cadence: 30 seconds</span>
      <span>{isRefreshing ? "Refresh state: refreshing" : "Refresh state: waiting"}</span>
      <span>
        Last refresh requested: {lastRequestedAt ?? "not yet — current server snapshot remains visible"}
      </span>
      <button type="button" onClick={refresh}>
        Refresh server snapshot
      </button>
    </aside>
  );
}
