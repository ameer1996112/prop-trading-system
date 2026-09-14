# Original service-page presentations

Donor: `liquidity-supply-and-demand` worktree `prop-pine-v3-production-consolidation`, revision `cc740a197209cef27374ca6166a505b14af54ab6`.

These eight page presentations were adapted by reading the donor's Frontend module. They retain page-specific section order, classes, headings, forms, and tab/list arrangements. They do not import donor containers, hooks, providers, routes, or clients.

| Local file | Donor source under `frontend/src` |
| --- | --- |
| `ExecutionQualityPage.tsx` | `app/execution-quality/page.tsx`, `components/execution/TraceTable.tsx` |
| `AlertsPage.tsx` | `app/alerts/page.tsx` |
| `PropFirmPage.tsx` | `app/prop-firm/page.tsx`, `components/prop-firm/{ChallengeHeader,HealthScoreGauge,ChallengeMetrics,ChallengeRules,PayoutReadiness,PerformanceSummary}.tsx` |
| `AlertSetupPage.tsx` | `app/alert-setup/page.tsx`, `components/alert-setup/AlertSetupWorkspace.tsx` |
| `OptimizerPage.tsx` | `app/optimizer/page.tsx`, `components/optimizer/OptimizerRunsWorkspace.tsx` |
| `StrategiesPage.tsx` | `app/strategies/page.tsx` |
| `NotificationsPage.tsx` | `app/notifications/page.tsx`, `components/notifications/RoutingPanel.tsx` |
| `SettingsPage.tsx` | `app/settings/page.tsx`, `components/settings/{ConnectionStatus,AiConfigPanel,SystemHealthPanel,TradingViewMcpPanel,SwapGuardPanel,AlertRulesPanel}.tsx`; timezone labels only from `providers/TimezoneProvider.tsx` |

Safety adaptations:

- No donor service is connected. All remote counts, settings, status booleans, thresholds, routing states, histories, and chart values remain `—` or `Unavailable`.
- The prop-firm mock-metrics fallback was not copied. Gauges are neutral and have no fabricated score or progress fill.
- Service writes remain visibly disabled with reasons. New strategy, validation, save, activation, alert acknowledgement/deletion, batch/run launch/cancellation, broker sync, and configuration writes have no handlers.
- Tabs, severity filters, form drafts, timezone draft selection, and history/form disclosure are memory-only. They do not read or write storage or environment variables and do not trigger requests.
- Native local primitives replace the donor's UI-package wrappers. Tabs include ArrowLeft/ArrowRight/Home/End roving focus and explicit panel relationships.
- Source-controlled categories and form options are labels only, not evidence of an active account, enabled feature, approved pair, installed broker, or connected service.
- Charts and the calendar keep their original surrounding layout but show unavailable-data containers; no points, dates, periods, or broker history are fabricated.
