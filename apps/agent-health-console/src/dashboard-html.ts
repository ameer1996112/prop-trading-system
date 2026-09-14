const HEALTH_SUMMARY_PATH = "/api/v1/health-summary";

export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MT5 DRY_RUN Health</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #10131a; color: #e7edf6; }
    body { padding: 2rem; max-width: 72rem; }
    header, section { padding-bottom: 1.5rem; }
    h1 { font-size: 1.6rem; } h2 { font-size: 1rem; }
    #status { display: inline-block; padding: .5rem 1rem; outline: 2px solid currentColor; font-size: 1.4rem; font-weight: 700; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: .5rem 1rem; } dt { color: #aebdce; } dd { overflow-wrap: anywhere; }
    table { width: 100%; } th, td { box-shadow: inset 0 -1px #334155; padding: .5rem; text-align: left; }
    button { padding: .5rem .8rem; font: inherit; cursor: pointer; }
  </style>
</head>
<body>
  <header>
    <h1>MT5 DRY_RUN Health</h1>
    <p id="status" aria-live="polite">UNKNOWN</p>
    <button id="refresh" type="button">Manual refresh</button>
  </header>
  <section aria-labelledby="heartbeat-heading">
    <h2 id="heartbeat-heading">Heartbeat</h2>
    <dl>
      <dt>Last accepted heartbeat</dt><dd id="last-accepted">—</dd>
      <dt>Age</dt><dd id="heartbeat-age">—</dd>
    </dl>
  </section>
  <section aria-labelledby="terminal-heading">
    <h2 id="terminal-heading">Terminal</h2>
    <dl>
      <dt>Connection</dt><dd id="connection">—</dd>
      <dt>Account trade permission</dt><dd id="account-permission">—</dd>
      <dt>Terminal trade permission</dt><dd id="terminal-permission">—</dd>
      <dt>Algo trading permission</dt><dd id="algo-permission">—</dd>
      <dt>Build</dt><dd id="terminal-build">—</dd>
      <dt>Source symbol</dt><dd id="source-symbol">—</dd>
      <dt>Request sequence</dt><dd id="request-sequence">—</dd>
      <dt>Server sequence</dt><dd id="server-sequence">—</dd>
    </dl>
  </section>
  <section aria-labelledby="outcomes-heading">
    <h2 id="outcomes-heading">Latest 20 redacted synchronization outcomes</h2>
    <table>
      <thead><tr><th>Request sequence</th><th>Result code</th><th>Server sequence</th><th>Received</th></tr></thead>
      <tbody id="outcomes"><tr><td colspan="4">No data</td></tr></tbody>
    </table>
  </section>
  <script>
    (() => {
      const blank = "—";
      const ids = ["last-accepted", "heartbeat-age", "connection", "account-permission", "terminal-permission", "algo-permission", "terminal-build", "source-symbol", "request-sequence", "server-sequence"];
      const byId = (id) => document.getElementById(id);
      const showText = (id, value) => { byId(id).textContent = value; };
      const text = (value) => typeof value === "string" || typeof value === "number" ? String(value) : blank;
      const validStatus = (value) => ["ONLINE", "STALE", "OFFLINE", "UNKNOWN"].includes(value) ? value : "UNKNOWN";
      const showEmptyOutcomes = () => {
        const outcomes = byId("outcomes");
        outcomes.textContent = "";
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 4;
        cell.textContent = "No data";
        row.append(cell);
        outcomes.append(row);
      };
      const clear = () => {
        showText("status", "UNKNOWN");
        ids.forEach((id) => showText(id, blank));
        showEmptyOutcomes();
      };
      const addCell = (row, value) => { const cell = document.createElement("td"); cell.textContent = text(value); row.append(cell); };
      const render = (summary) => {
        if (!summary || typeof summary !== "object") { clear(); return; }
        const status = validStatus(summary.status);
        showText("status", status);
        const current = summary.current;
        if (!current || typeof current !== "object") { clear(); return; }
        showText("status", status);
        showText("last-accepted", text(current.last_accepted_epoch));
        const age = typeof summary.server_time_epoch === "number" && typeof current.last_accepted_epoch === "number" ? Math.max(0, summary.server_time_epoch - current.last_accepted_epoch) + " seconds" : blank;
        showText("heartbeat-age", age);
        showText("connection", text(current.terminal_connection_state));
        showText("account-permission", text(current.account_trade_permission));
        showText("terminal-permission", text(current.terminal_trade_permission));
        showText("algo-permission", text(current.algo_trading_permission));
        showText("terminal-build", text(current.terminal_build));
        showText("source-symbol", text(current.source_symbol));
        showText("request-sequence", text(current.request_sequence));
        showText("server-sequence", text(current.server_sequence));
        const outcomes = byId("outcomes");
        outcomes.textContent = "";
        const recent = Array.isArray(summary.recent) ? summary.recent.slice(0, 20) : [];
        if (recent.length === 0) { showEmptyOutcomes(); return; }
        recent.forEach((entry) => {
          const row = document.createElement("tr");
          addCell(row, entry && entry.request_sequence);
          addCell(row, entry && entry.result_code);
          addCell(row, entry && entry.server_sequence);
          addCell(row, entry && entry.received_at_epoch);
          outcomes.append(row);
        });
      };
      const loadSummary = async () => {
        try {
          const response = await fetch("/api/v1/health-summary");
          if (!response.ok) throw new Error("health summary unavailable");
          render(await response.json());
        } catch { clear(); }
      };
      byId("refresh").addEventListener("click", loadSummary);
      loadSummary();
      setInterval(loadSummary, 10_000);
    })();
  </script>
</body>
</html>`;
}
