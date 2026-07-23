# ADR 0003: external operations providers

Status: `CANDIDATES_SELECTED / BLOCKED`

## Decision

- Grafana Cloud is the OpenTelemetry metrics/logs/traces candidate.
- Better Stack is the independent synthetic/dead-man and escalation candidate.
- Resend is the transactional email and delivery-event candidate.

Official documentation reviewed on 2026-07-22 describes Grafana Cloud OTLP signal ingestion,
Better Stack heartbeat/grace/escalation behavior, and Resend at-least-once delivery webhooks:

- <https://grafana.com/docs/grafana-cloud/send-data/>
- <https://grafana.com/docs/grafana-cloud/send-data/otlp/otlp-format-considerations/>
- <https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/>
- <https://betterstack.com/docs/uptime/escalation-policies/>
- <https://resend.com/docs/webhooks/introduction>
- <https://resend.com/docs/webhooks/event-types>

PostgreSQL remains authoritative; provider telemetry cannot authorize safety. Metric labels are
bounded and never include receipt/setup/intent/order/position/user/trace/raw broker identifiers.

## Blocking proof

No stacks, monitors, domains, keys, retention plans, owners, or escalation schedules were created.
The required 13-month metric and 90-day log/trace retention, signed seven-year gate evidence,
bounded cardinality, query export/restore, two-missed-interval behavior, 60-second dual delivery,
acknowledgement/escalation timing, and exporter/channel/vendor failure drills are unproven.
