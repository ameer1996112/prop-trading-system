"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  loadPaperReadiness,
  loadPaperSimulationSummary,
  setPaperReadinessKillSwitch,
  type PaperReadinessAccount,
  type PaperReadinessSnapshot,
  type PaperSimulationAccount,
  type PaperSimulationIntent,
  type PaperSimulationSnapshot,
} from "../lib/api";

function money(
  amountMinor: number,
  currencyCode: string,
  currencyScale: number,
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: currencyScale,
    maximumFractionDigits: currencyScale,
  }).format(amountMinor / 10 ** currencyScale);
}

function signedMoney(account: PaperSimulationAccount, amountMinor: number): string {
  const formatted = money(
    Math.abs(amountMinor),
    account.currencyCode,
    account.currencyScale,
  );
  return amountMinor > 0 ? `+${formatted}` : amountMinor < 0 ? `-${formatted}` : formatted;
}

function AccountCard({ account }: { account: PaperSimulationAccount }) {
  return (
    <article className="simulation-account">
      <div className="simulation-card-heading">
        <div>
          <span>PAPER ACCOUNT</span>
          <h3>{account.label}</h3>
        </div>
        <strong>{money(account.balanceMinor, account.currencyCode, account.currencyScale)}</strong>
      </div>
      <dl className="simulation-metrics">
        <div>
          <dt>Realized P&amp;L</dt>
          <dd className={account.realizedPnlMinor < 0 ? "negative" : "positive"}>
            {signedMoney(account, account.realizedPnlMinor)}
          </dd>
        </div>
        <div>
          <dt>Open risk</dt>
          <dd>{money(account.openRiskMinor, account.currencyCode, account.currencyScale)}</dd>
        </div>
        <div>
          <dt>Open / settled</dt>
          <dd>
            {account.openPositions} / {account.settledTrades}
          </dd>
        </div>
        <div>
          <dt>Wins / losses</dt>
          <dd>
            {account.winningTrades} / {account.losingTrades}
          </dd>
        </div>
        <div>
          <dt>Max drawdown</dt>
          <dd className={account.maxDrawdownMinor > 0 ? "negative" : ""}>
            {money(account.maxDrawdownMinor, account.currencyCode, account.currencyScale)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function IntentCard({
  intent,
  accounts,
}: {
  intent: PaperSimulationIntent;
  accounts: PaperSimulationAccount[];
}) {
  const accountsById = new Map(accounts.map((account) => [account.accountId, account]));
  return (
    <article className="simulation-intent">
      <div className="simulation-intent-heading">
        <div>
          <span className={`intent-side intent-side-${intent.side.toLowerCase()}`}>
            {intent.side}
          </span>
          <span className="intent-source">
            {intent.source === "TRADINGVIEW" ? "AUTO · TRADINGVIEW" : "MANUAL"}
          </span>
          <h3>{intent.symbol}</h3>
        </div>
        <strong className={`intent-state intent-state-${intent.state.toLowerCase()}`}>
          {intent.state}
        </strong>
      </div>
      <dl className="intent-levels">
        <div>
          <dt>Entry</dt>
          <dd>{intent.entryPrice}</dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd>{intent.stopLoss}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{intent.takeProfit}</dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>{(intent.riskBps / 100).toFixed(2)}%</dd>
        </div>
        <div>
          <dt>Outcome</dt>
          <dd>
            {intent.outcomeRMillis === null
              ? "Awaiting settlement"
              : `${(intent.outcomeRMillis / 1000).toFixed(2)}R · ${intent.exitReason}`}
          </dd>
        </div>
      </dl>
      <ul className="intent-allocations" aria-label={`${intent.symbol} account allocations`}>
        {intent.allocations.map((allocation) => {
          const account = accountsById.get(allocation.accountId);
          const scale = account?.currencyScale ?? 2;
          const currency = account?.currencyCode ?? "USD";
          return (
            <li key={allocation.accountId}>
              <span>{account?.label ?? allocation.accountId}</span>
              <span>Risk {money(allocation.riskAmountMinor, currency, scale)}</span>
              <strong
                className={
                  allocation.pnlMinor === null
                    ? ""
                    : allocation.pnlMinor < 0
                      ? "negative"
                      : "positive"
                }
              >
                {allocation.pnlMinor === null
                  ? "OPEN"
                  : signedMoney(
                      account ?? {
                        accountId: allocation.accountId,
                        label: allocation.accountId,
                        currencyCode: currency,
                        currencyScale: scale,
                        balanceMinor: 0,
                        realizedPnlMinor: 0,
                        openRiskMinor: 0,
                        openPositions: 0,
                        settledTrades: 0,
                        winningTrades: 0,
                        losingTrades: 0,
                        maxDrawdownMinor: 0,
                      },
                      allocation.pnlMinor,
                    )}
              </strong>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function percentage(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

function utcTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function ReadinessAccountCard({
  account,
  simulationAccount,
  readiness,
}: {
  account: PaperReadinessAccount;
  simulationAccount: PaperSimulationAccount | undefined;
  readiness: PaperReadinessSnapshot;
}) {
  return (
    <article className="readiness-account">
      <div className="readiness-account-heading">
        <div>
          <span>RISK ENVELOPE</span>
          <h4>{account.label}</h4>
        </div>
        <strong
          className={`readiness-account-state readiness-account-state-${account.state.toLowerCase()}`}
          aria-label={`${account.label} readiness ${account.state}`}
        >
          {account.state}
        </strong>
      </div>
      <dl className="readiness-account-metrics">
        <div>
          <dt>Daily P&amp;L / loss</dt>
          <dd>
            {simulationAccount === undefined
              ? `${account.dailyPnlMinor} minor units`
              : signedMoney(simulationAccount, account.dailyPnlMinor)}
            <span>
              {percentage(account.dailyLossBps)} /{" "}
              {percentage(readiness.thresholds.maxDailyLossBps)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Total drawdown</dt>
          <dd>
            {percentage(account.totalDrawdownBps)}
            <span>
              Limit {percentage(readiness.thresholds.maxTotalDrawdownBps)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Open risk</dt>
          <dd>
            {percentage(account.openRiskBps)}
            <span>Limit {percentage(readiness.thresholds.maxOpenRiskBps)}</span>
          </dd>
        </div>
        <div>
          <dt>Open positions</dt>
          <dd>
            {account.openPositions}
            <span>Limit {readiness.thresholds.maxOpenPositions}</span>
          </dd>
        </div>
      </dl>
      {account.reasons.length === 0 ? null : (
        <ul className="readiness-account-reasons" aria-label={`${account.label} stop reasons`}>
          {account.reasons.map((reason) => (
            <li key={`${reason.code}:${reason.message}`}>{reason.message}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

function PaperReadinessOverview({
  readiness,
  simulation,
  controlReason,
  controlError,
  mutating,
  onControlReasonChange,
  onControlSubmit,
}: {
  readiness: PaperReadinessSnapshot;
  simulation: PaperSimulationSnapshot;
  controlReason: string;
  controlError: string | null;
  mutating: boolean;
  onControlReasonChange: (value: string) => void;
  onControlSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const switchAction = readiness.killSwitch.enabled ? "RELEASE" : "ENGAGE";
  const simulationAccounts = new Map(
    simulation.accounts.map((account) => [account.accountId, account]),
  );

  return (
    <section
      className={`readiness-panel readiness-panel-${readiness.state.toLowerCase()}`}
      aria-labelledby="paper-readiness-heading"
    >
      <header className="readiness-heading">
        <div>
          <span>LIVE SAFETY CONTRACT · EXECUTION DISABLED</span>
          <h3 id="paper-readiness-heading">Paper readiness</h3>
          <p>
            Evaluated{" "}
            <time dateTime={readiness.evaluatedAt}>
              {utcTimestamp(readiness.evaluatedAt)} UTC
            </time>
          </p>
        </div>
        <strong
          className="readiness-state"
          role="status"
          aria-atomic="true"
          aria-label={`Paper readiness ${readiness.state}`}
        >
          {readiness.state}
        </strong>
      </header>

      <div className="readiness-evidence-grid">
        <section aria-labelledby="readiness-receipt-heading">
          <span>FEED EVIDENCE</span>
          <h4 id="readiness-receipt-heading">Latest automation receipt</h4>
          {readiness.latestReceipt === null ? (
            <p className="readiness-empty">No automation receipt is available.</p>
          ) : (
            <dl className="readiness-detail-list">
              <div>
                <dt>Symbol / sequence</dt>
                <dd>
                  {readiness.latestReceipt.symbol} · #{readiness.latestReceipt.sequence}
                </dd>
              </div>
              <div>
                <dt>Receipt age</dt>
                <dd>
                  {readiness.latestReceipt.ageSeconds === null
                    ? "Clock unavailable"
                    : `${readiness.latestReceipt.ageSeconds}s`}
                  <span>
                    Maximum {readiness.thresholds.receiptMaxAgeSeconds}s
                  </span>
                </dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>
                  <time dateTime={readiness.latestReceipt.receivedAt}>
                    {utcTimestamp(readiness.latestReceipt.receivedAt)} UTC
                  </time>
                </dd>
              </div>
              <div>
                <dt>Producer</dt>
                <dd>{readiness.latestReceipt.producerInstanceId}</dd>
              </div>
              <div>
                <dt>Receipt ID</dt>
                <dd>{readiness.latestReceipt.receiptId}</dd>
              </div>
            </dl>
          )}
        </section>

        <section aria-labelledby="readiness-open-heading">
          <span>OPEN RISK HEALTH</span>
          <h4 id="readiness-open-heading">Intent freshness</h4>
          <dl className="readiness-detail-list">
            <div>
              <dt>Open intents</dt>
              <dd>{readiness.openHealth.openIntents}</dd>
            </div>
            <div>
              <dt>Stale open intents</dt>
              <dd>{readiness.openHealth.staleOpenIntents}</dd>
            </div>
            <div>
              <dt>Oldest open intent</dt>
              <dd>
                {readiness.openHealth.oldestOpenIntentAt === null ? (
                  "None"
                ) : (
                  <time dateTime={readiness.openHealth.oldestOpenIntentAt}>
                    {utcTimestamp(readiness.openHealth.oldestOpenIntentAt)} UTC
                  </time>
                )}
                <span>
                  Stale after {readiness.thresholds.staleTradeSeconds}s
                </span>
              </dd>
            </div>
          </dl>
        </section>

        <section className="readiness-control" aria-labelledby="kill-switch-heading">
          <div className="readiness-control-heading">
            <div>
              <span>OPERATOR CONTROL</span>
              <h4 id="kill-switch-heading">Paper kill switch</h4>
            </div>
            <strong
              className={readiness.killSwitch.enabled ? "switch-engaged" : "switch-released"}
              aria-label={`Paper kill switch ${
                readiness.killSwitch.enabled ? "engaged" : "released"
              }`}
            >
              {readiness.killSwitch.enabled ? "ENGAGED" : "RELEASED"}
            </strong>
          </div>
          <p className="readiness-control-current">
            {readiness.killSwitch.reason ?? "No operator control event has been recorded."}
          </p>
          <form onSubmit={onControlSubmit} aria-label="Paper kill switch control">
            <label htmlFor="paper-kill-switch-reason">Required operator reason</label>
            <textarea
              id="paper-kill-switch-reason"
              aria-describedby={
                controlError === null
                  ? "paper-kill-switch-help"
                  : "paper-kill-switch-help paper-kill-switch-error"
              }
              aria-invalid={controlError === null ? undefined : "true"}
              maxLength={240}
              minLength={3}
              onChange={(event) => onControlReasonChange(event.target.value)}
              required
              rows={3}
              value={controlReason}
            />
            <p id="paper-kill-switch-help">
              3–240 characters. Every state change is idempotent and audited.
            </p>
            {controlError === null ? null : (
              <p id="paper-kill-switch-error" role="alert">
                {controlError}
              </p>
            )}
            <button
              aria-pressed={readiness.killSwitch.enabled}
              disabled={mutating}
              type="submit"
            >
              {mutating ? "APPLYING…" : switchAction}
            </button>
          </form>
        </section>
      </div>

      <section className="readiness-reasons" aria-labelledby="readiness-reasons-heading">
        <div>
          <span>DECISION REASONS</span>
          <h4 id="readiness-reasons-heading">
            {readiness.reasons.length === 0
              ? "No active readiness reasons"
              : `${readiness.reasons.length} active ${
                  readiness.reasons.length === 1 ? "reason" : "reasons"
                }`}
          </h4>
        </div>
        {readiness.reasons.length === 0 ? (
          <p>All monitored paper evidence is within the configured envelope.</p>
        ) : (
          <ul>
            {readiness.reasons.map((reason) => (
              <li key={`${reason.code}:${reason.accountId ?? "global"}:${reason.message}`}>
                <strong>{reason.code.replaceAll("_", " ")}</strong>
                <span>{reason.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="readiness-account-grid">
        {readiness.accounts.map((account) => (
          <ReadinessAccountCard
            account={account}
            key={account.accountId}
            readiness={readiness}
            simulationAccount={simulationAccounts.get(account.accountId)}
          />
        ))}
      </div>
    </section>
  );
}

export function PaperSimulationPanel() {
  const [credential, setCredential] = useState("");
  const [protectedData, setProtectedData] = useState<{
    simulation: PaperSimulationSnapshot;
    readiness: PaperReadinessSnapshot;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [controlReason, setControlReason] = useState("");
  const [controlError, setControlError] = useState<string | null>(null);
  const sessionCredential = useRef("");
  const loadController = useRef<AbortController | null>(null);
  const mutationController = useRef<AbortController | null>(null);
  const sessionVersion = useRef(0);

  const load = useCallback(async (presentedCredential: string, quiet = false) => {
    if (loadController.current !== null) return;
    const controller = new AbortController();
    const version = sessionVersion.current;
    loadController.current = controller;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [simulation, readiness] = await Promise.all([
        loadPaperSimulationSummary(presentedCredential, controller.signal),
        loadPaperReadiness(presentedCredential, controller.signal),
      ]);
      if (controller.signal.aborted || version !== sessionVersion.current) return;
      sessionCredential.current = presentedCredential;
      setProtectedData({ readiness, simulation });
    } catch (cause) {
      if (controller.signal.aborted || version !== sessionVersion.current) return;
      setError(cause instanceof Error ? cause.message : "Paper simulator is unavailable.");
    } finally {
      if (loadController.current === controller) {
        loadController.current = null;
      }
      if (!quiet && version === sessionVersion.current) setLoading(false);
    }
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const presentedCredential = credential;
    setCredential("");
    void load(presentedCredential);
  };

  const lock = () => {
    sessionVersion.current += 1;
    loadController.current?.abort();
    mutationController.current?.abort();
    loadController.current = null;
    mutationController.current = null;
    sessionCredential.current = "";
    setCredential("");
    setProtectedData(null);
    setLoading(false);
    setMutating(false);
    setError(null);
    setControlReason("");
    setControlError(null);
  };

  const unlocked = protectedData !== null;

  useEffect(() => {
    if (!unlocked) return;
    const interval = window.setInterval(() => {
      if (sessionCredential.current !== "") {
        void load(sessionCredential.current, true);
      }
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [load, unlocked]);

  useEffect(
    () => () => {
      sessionVersion.current += 1;
      loadController.current?.abort();
      mutationController.current?.abort();
    },
    [],
  );

  const submitControl = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (protectedData === null || mutating) return;
    const normalizedReason = controlReason.trim();
    if (normalizedReason.length < 3 || normalizedReason.length > 240) {
      setControlError("Enter a required operator reason of 3 to 240 characters.");
      return;
    }
    const presentedCredential = sessionCredential.current;
    if (presentedCredential === "") {
      setControlError("Operator access is locked. Unlock the paper console again.");
      return;
    }
    const enabled = !protectedData.readiness.killSwitch.enabled;
    const controller = new AbortController();
    const version = sessionVersion.current;
    mutationController.current = controller;
    setMutating(true);
    setControlError(null);
    setError(null);
    void (async () => {
      try {
        const result = await setPaperReadinessKillSwitch(
          presentedCredential,
          enabled,
          normalizedReason,
          controller.signal,
        );
        if (controller.signal.aborted || version !== sessionVersion.current) return;
        setProtectedData((current) =>
          current === null
            ? current
            : {
                ...current,
                readiness: {
                  ...current.readiness,
                  state: result.killSwitch.enabled
                    ? "STOPPED"
                    : current.readiness.state,
                  killSwitch: result.killSwitch,
                },
              },
        );
        setControlReason("");
        await load(presentedCredential, true);
      } catch (cause) {
        if (controller.signal.aborted || version !== sessionVersion.current) return;
        setControlError(
          cause instanceof Error
            ? cause.message
            : "Paper readiness control is unavailable.",
        );
      } finally {
        if (mutationController.current === controller) {
          mutationController.current = null;
        }
        if (version === sessionVersion.current) setMutating(false);
      }
    })();
  };

  return (
    <section
      className="simulation-section"
      aria-busy={loading || mutating}
      aria-labelledby="paper-simulation-heading"
    >
      <div className="section-heading">
        <div>
          <p className="section-number">C / PAPER SIMULATOR</p>
          <h2 id="paper-simulation-heading">Account outcomes</h2>
        </div>
        <p>
          Broker-free trade intents, deterministic R settlement, and isolated account risk.
          Operator data remains protected.
        </p>
      </div>

      {protectedData === null ? (
        <form className="simulation-unlock" onSubmit={submit}>
          <div>
            <strong>Operator access required</strong>
            <p>
              The credential stays in this browser tab&apos;s memory and is never saved by the
              console.
            </p>
          </div>
          <label>
            <span>Paper operator credential</span>
            <input
              autoComplete="off"
              maxLength={1_024}
              name="paper-credential"
              onChange={(event) => setCredential(event.target.value)}
              type="password"
              value={credential}
            />
          </label>
          <button disabled={loading || credential.length === 0} type="submit">
            {loading ? "VERIFYING…" : "UNLOCK"}
          </button>
          {error === null ? null : <p role="alert">{error}</p>}
        </form>
      ) : (
        <>
          <div className="simulation-toolbar">
            <p>
              <strong>{protectedData.simulation.accounts.length}</strong> accounts ·{" "}
              <strong>{protectedData.simulation.intents.length}</strong> recent intents ·
              live evidence refreshes every 30s
            </p>
            <div>
              <button
                disabled={loading || mutating}
                onClick={() => void load(sessionCredential.current)}
                type="button"
              >
                {loading ? "REFRESHING…" : "REFRESH"}
              </button>
              <button disabled={mutating} onClick={lock} type="button">
                LOCK
              </button>
            </div>
          </div>

          {error === null ? null : (
            <p className="simulation-message" role="alert">
              {error}
            </p>
          )}

          <PaperReadinessOverview
            controlError={controlError}
            controlReason={controlReason}
            mutating={mutating}
            onControlReasonChange={(value) => {
              setControlReason(value);
              if (controlError !== null) setControlError(null);
            }}
            onControlSubmit={submitControl}
            readiness={protectedData.readiness}
            simulation={protectedData.simulation}
          />

          <div className="simulation-account-grid">
            {protectedData.simulation.accounts.map((account) => (
              <AccountCard account={account} key={account.accountId} />
            ))}
          </div>

          {protectedData.simulation.intents.length === 0 ? (
            <div className="empty-ledger">
              <span>—</span>
              <p>No paper trade intents have been recorded.</p>
            </div>
          ) : (
            <div className="simulation-intent-list">
              {protectedData.simulation.intents.map((intent) => (
                <IntentCard
                  accounts={protectedData.simulation.accounts}
                  intent={intent}
                  key={intent.intentId}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
