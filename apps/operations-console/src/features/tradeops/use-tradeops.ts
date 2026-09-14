"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { canPollNow, startVisiblePolling } from "../../lib/visible-polling";
import { createTradeOpsSession, type TradeOpsSessionOptions } from "./session";

/** Mount once at the TradeOps shell; views consume snapshots, never their own polls. */
export function useTradeOps(options: TradeOpsSessionOptions = {}) {
  const [session] = useState(() => createTradeOpsSession(options));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const actions = useMemo(() => {
    const refresh = () => {
      if (canPollNow()) return session.refresh();
      session.pause();
      return Promise.resolve();
    };
    return {
      refresh,
      unlock: (credential: string) => {
        session.unlock(credential);
        void refresh();
      },
      lock: session.lock,
      connectMt5: () => { session.connectMt5(); void refresh(); },
      disconnectMt5: session.disconnectMt5,
    };
  }, [session]);

  useEffect(() => {
    const stop = startVisiblePolling(() => { void actions.refresh(); }, session.pause, 30_000);
    return () => {
      stop();
      // Lock aborts and erases credentials synchronously but permits StrictMode's
      // setup-cleanup-setup replay. useSyncExternalStore removes its subscription.
      session.lock();
      session.disconnectMt5();
    };
  }, [actions, session]);

  return { snapshot, ...actions };
}
