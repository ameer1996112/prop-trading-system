import {
  loadApiHealth, loadPaperReadiness, loadTradeOpsObservationReceipts,
  loadPaperSimulationSummary, PaperAuthorizationError,
  type ApiHealthSnapshot, type ObservationReceiptsSnapshot,
  type PaperReadinessSnapshot, type PaperSimulationSnapshot,
} from "../../lib/api";
import { loadEntryDecisionsStrict, type EntryDecisionSnapshot } from "../../lib/entry-decisions";
import { loadPaperLedgerAccounts, type PaperLedgerAccount } from "./ledger-api";
import { loadMt5Health, Mt5AuthorizationError } from "./mt5-health";
import type { Mt5HealthSummary } from "./mt5-health-contract.mjs";

export type TradeOpsResource<T> = {
  data: T | null;
  /** Epoch milliseconds of this resource's last successful response. */
  lastSuccess: number | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
};

type ResourceData = {
  health: ApiHealthSnapshot;
  receipts: ObservationReceiptsSnapshot;
  ledger: PaperLedgerAccount[];
  simulation: PaperSimulationSnapshot;
  readiness: PaperReadinessSnapshot;
  decisions: EntryDecisionSnapshot;
  mt5: Mt5HealthSummary;
};
type ResourceKey = keyof ResourceData;
type ProtectedKey = Exclude<ResourceKey, "health" | "receipts" | "mt5">;
export type Mt5Connection = "DISCONNECTED" | "CONNECTED" | "AUTH_REQUIRED";

export type TradeOpsSnapshot = {
  [K in ResourceKey]: TradeOpsResource<ResourceData[K]>;
} & {
  unlocked: boolean;
  paused: boolean;
  lockReason: "AUTH_REJECTED" | null;
  mt5Connection: Mt5Connection;
};

export type TradeOpsLoaders = {
  health: (signal: AbortSignal) => Promise<ApiHealthSnapshot>;
  receipts: (signal: AbortSignal) => Promise<ObservationReceiptsSnapshot>;
  mt5?: (signal: AbortSignal) => Promise<Mt5HealthSummary>;
} & {
  [K in ProtectedKey]: (credential: string, signal: AbortSignal) => Promise<ResourceData[K]>;
};

export type TradeOpsSessionOptions = {
  loaders?: Partial<TradeOpsLoaders>;
  now?: () => number;
};

export type TradeOpsSession = {
  getSnapshot: () => TradeOpsSnapshot;
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<void>;
  /** Replaces the in-memory credential without starting a request. */
  unlock: (credential: string) => void;
  lock: () => void;
  pause: () => void;
  connectMt5: () => void;
  disconnectMt5: () => void;
  dispose: () => void;
};

const safeErrors: Record<ResourceKey, string> = {
  health: "API health is unavailable.",
  receipts: "Observation receipts are unavailable.",
  ledger: "Paper ledger accounts are unavailable.",
  simulation: "Paper simulation is unavailable.",
  readiness: "Paper readiness is unavailable.",
  decisions: "Entry decisions are unavailable.",
  mt5: "MT5 health is unavailable.",
};

function empty<T>(): TradeOpsResource<T> {
  return { data: null, lastSuccess: null, loading: false, stale: true, error: null };
}

function stale<T>(resource: TradeOpsResource<T>): TradeOpsResource<T> {
  return { ...resource, loading: false, stale: true };
}

// No DOM, persistence, or writes: the only credential owner is this closure.
export function createTradeOpsSession(options: TradeOpsSessionOptions = {}): TradeOpsSession {
  const loaders: TradeOpsLoaders = {
    health: loadApiHealth, receipts: loadTradeOpsObservationReceipts,
    ledger: loadPaperLedgerAccounts, simulation: loadPaperSimulationSummary,
    readiness: loadPaperReadiness, decisions: loadEntryDecisionsStrict,
    mt5: loadMt5Health,
    ...options.loaders,
  };
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  let credential: string | null = null;
  let generation = 0;
  let controller: AbortController | null = null;
  let inFlight: Promise<void> | null = null;
  let disposed = false;
  let snapshot: TradeOpsSnapshot = {
    health: empty(), receipts: empty(), ledger: empty(), simulation: empty(),
    readiness: empty(), decisions: empty(), mt5: empty(), mt5Connection: "DISCONNECTED", unlocked: false, paused: false, lockReason: null,
  };

  const notify = () => { listeners.forEach((listener) => listener()); };
  const invalidate = () => {
    generation += 1;
    controller?.abort();
    controller = null;
    inFlight = null;
    snapshot = {
      ...snapshot,
      health: stale(snapshot.health), receipts: stale(snapshot.receipts),
      ledger: stale(snapshot.ledger), simulation: stale(snapshot.simulation),
      readiness: stale(snapshot.readiness), decisions: stale(snapshot.decisions),
      mt5: stale(snapshot.mt5),
    };
  };
  const purgeProtected = (reason: TradeOpsSnapshot["lockReason"]) => {
    snapshot = {
      ...snapshot, unlocked: credential !== null, lockReason: reason,
      ledger: empty(), simulation: empty(), readiness: empty(), decisions: empty(),
    };
  };
  const lock = (reason: TradeOpsSnapshot["lockReason"] = null) => {
    if (disposed) return;
    credential = null;
    invalidate();
    purgeProtected(reason);
    notify();
  };

  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (inFlight !== null) return inFlight;
    const cycleGeneration = generation;
    const cycleCredential = credential;
    const readMt5 = snapshot.mt5Connection === "CONNECTED";
    const cycleController = new AbortController();
    controller = cycleController;
    const { signal } = cycleController;
    const current = () => !disposed && generation === cycleGeneration && !signal.aborted;
    snapshot = {
      ...snapshot, paused: false,
      health: { ...snapshot.health, loading: true },
      receipts: { ...snapshot.receipts, loading: true },
      ledger: { ...snapshot.ledger, loading: cycleCredential !== null },
      simulation: { ...snapshot.simulation, loading: cycleCredential !== null },
      readiness: { ...snapshot.readiness, loading: cycleCredential !== null },
      decisions: { ...snapshot.decisions, loading: cycleCredential !== null },
      mt5: { ...snapshot.mt5, loading: readMt5 },
    };

    const read = async <K extends ResourceKey>(key: K, load: () => Promise<ResourceData[K]>, failed?: (data: ResourceData[K]) => boolean) => {
      // Schedule after inFlight is assigned, and skip work cancelled before dispatch.
      await Promise.resolve();
      if (!current()) return;
      try {
        const data = await load();
        if (!current()) return;
        if (failed?.(data)) throw new Error(safeErrors[key]);
        snapshot = {
          ...snapshot,
          [key]: { data, lastSuccess: now(), loading: false, stale: false, error: null },
        };
      } catch (error) {
        if (!current()) return;
        if (key === "mt5" && error instanceof Mt5AuthorizationError) {
          snapshot = { ...snapshot, mt5Connection: "AUTH_REQUIRED", mt5: { ...empty<Mt5HealthSummary>(), error: "Cloudflare Access sign-in required." } };
          notify();
          return;
        }
        if (key !== "health" && key !== "receipts" && key !== "mt5" && error instanceof PaperAuthorizationError) {
          lock("AUTH_REJECTED");
          return;
        }
        snapshot = {
          ...snapshot,
          [key]: { ...snapshot[key], loading: false, stale: true, error: safeErrors[key] },
        };
      }
      notify();
    };

    const reads: Promise<void>[] = [
      read("health", () => loaders.health(signal), (data) => data.state === "OFFLINE"),
      read("receipts", () => loaders.receipts(signal), (data) => data.state === "ERROR"),
    ];
    if (readMt5) reads.push(read("mt5", () => (loaders.mt5 ?? loadMt5Health)(signal)));
    if (cycleCredential !== null) {
      reads.push(
        read("ledger", () => loaders.ledger(cycleCredential, signal)),
        read("simulation", () => loaders.simulation(cycleCredential, signal)),
        read("readiness", () => loaders.readiness(cycleCredential, signal)),
        read("decisions", () => loaders.decisions(cycleCredential, signal)),
      );
    }
    const cycle = Promise.all(reads).then(() => undefined).finally(() => {
      // An old, abort-ignoring request must never clear a newer cycle's dedupe slot.
      if (inFlight === cycle) {
        inFlight = null;
        controller = null;
      }
    });
    inFlight = cycle;
    notify();
    return cycle;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      if (!disposed) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh,
    unlock: (value) => {
      if (disposed) return;
      if (value.length < 1 || value.length > 1_024) throw new Error("Paper operator credential is invalid.");
      invalidate();
      credential = value;
      purgeProtected(null);
      notify();
    },
    lock: () => lock(),
    connectMt5: () => {
      if (disposed || snapshot.mt5Connection === "CONNECTED") return;
      invalidate();
      snapshot = { ...snapshot, mt5Connection: "CONNECTED", mt5: empty() };
      notify();
    },
    disconnectMt5: () => {
      if (disposed) return;
      invalidate();
      snapshot = { ...snapshot, mt5Connection: "DISCONNECTED", mt5: empty() };
      notify();
    },
    pause: () => {
      if (disposed) return;
      invalidate();
      snapshot = { ...snapshot, paused: true };
      notify();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      credential = null;
      invalidate();
      purgeProtected(null);
      snapshot = { ...snapshot, mt5Connection: "DISCONNECTED", mt5: empty() };
      notify();
      listeners.clear();
    },
  };
}
