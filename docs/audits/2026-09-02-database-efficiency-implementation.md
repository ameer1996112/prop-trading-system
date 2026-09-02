# Database efficiency implementation — 2026-09-02

Status: implemented and verified locally; no deployment performed.

Branch: `codex/console-reliability`, base
`d4466766085ff432b507f7f6ab18413dbc0c32f2`. This worktree also retains the previous
console-reliability batch. No existing work was discarded.

## Scope and safety

Implements audit findings A04–A06 for V3 entry preflight and decision listing.
No migrations, new indexes, projections, dependency upgrades, or paid services
were introduced. Pine, entry rules, risk values, atomic allocation triggers,
immutable ledger, authentication, and production configuration are unchanged.
No TradingView changes or broker actions were performed.

The Cloudflare guidance informed the use of bound JSON set queries and existing
indexes. Combining statements with `DB.batch` does not remove repeated SQL
computation; Cloudflare documents sequential statement execution in a batch.
See [D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
and [index guidance](https://developers.cloudflare.com/d1/best-practices/use-indexes/).

## Changes

- **A04:** `paperConfigurationReadiness` requests all configured accounts in one
  filtered query against the existing historical view. Results are mapped by
  account ID, then classified in configuration order. Missing, nonpositive, and
  risk-limited accounts remain distinct. No readiness/balance cache is used;
  allocation triggers still enforce current state atomically.
- **A05:** latest decisions use two indexed anti-join probes instead of ranking
  every historical selection first. Newer evaluation epochs take precedence;
  equal epochs use later SQLite rowid, never lexical selection ID. Setup and
  INITIAL/RE_ENTRY identities, result fields, ordering, and limits are unchanged.
- **A06:** initial ownership lookup uses two set queries instead of two queries
  per bundle: 64 to 2 statements for 32 setups. Explicit null entries preserve
  missing-link semantics. Cohort/exit checks and race-retry rereads remain in
  place. This count applies only to that initial lookup phase, not total ingress.

All new set-read paths reject unsuccessful database responses before persisting
new events or intents. Existing uniqueness-race, atomic risk-gate, immutable
ledger, experimental ownership, and exit-reconciliation tests continue to pass.

## Measurements

Synthetic, in-memory SQLite 3.53.4 fixtures apply the existing migrations.
Measurements count virtual-machine steps in increments of 100, not billed D1
rows, remote latency, or wall-clock performance. Full returned rows match the
frozen pre-optimization query. These results do not guarantee free-tier usage.

Latest decisions, limit 20:

| History shape | Rows | Previous VM steps | New VM steps |
|---|---:|---:|---:|
| Diverse, increasing epochs | 200 | 38,300 | 1,800 |
| Diverse, increasing epochs | 2,000 | 319,100 | 1,800 |
| Diverse, increasing epochs | 20,000 | 3,127,100 | 1,800 |
| Repeated epochs, out-of-order | 20,000 | 3,015,900 | 119,300 |
| One setup, separate attempts | 20,000 | 3,120,100 | 320,100 |
| All epochs equal | 20,000 | 3,008,300 | 587,400 |

The constant result for diverse history is not a universal complexity guarantee.
Skewed or equal-epoch history can still require substantial scans and sorting.
`EXPLAIN QUERY PLAN` confirms indexed attempt probes, including the rowid range
for equal-epoch ties. No latest-row projection was needed for this batch.

Four-account readiness preflight:

| Settlements | Previous VM steps | New VM steps |
|---:|---:|---:|
| 20 | 47,300 | 12,100 |
| 200 | 440,500 | 110,400 |
| 1,000 | 2,187,700 | 547,200 |

Readiness fixtures include shared/unequal allocation coverage, partial-R
outcomes, backdated and tied settlements, UTC boundary timestamps, still-open
risk, and manual adjustments producing a negative balance. Aggregation still
scans historical data once. The legacy manual-intent endpoint and atomic
allocation-trigger queries are intentionally unchanged.

## Verification and review

- Worker: `npm test` — 607 tests passed across 16 files.
- Worker: `npm run lint` and `npm run typecheck` — passed.
- Worker: `npm run build` — local Wrangler dry-run passed, no deployment.
- Console regression: `npm test` — 139 tests passed across 11 files.
- SQLite equivalence/work regression file — 20 tests passed with Python 3.12.8,
  pytest 8.4.1, SQLite 3.53.4. Used a standalone pytest configuration (`-c
  /dev/null`) because the local runner lacked the project's async plugin; this
  file contains only synchronous SQL checks. No Python application-suite claim.
- Changed Python test file: Ruff checks and formatting passed.
- Static safety-boundary check and `git diff --check` — passed.
- Independent scoped code review: no actionable findings. Reviewer additionally
  compared 20,000-row skewed/equal-epoch fixtures at limits 1, 20, and 200.

TDD evidence: account-query count initially failed at 3 instead of 1; bundle
tests failed with point reads instead of set reads; the decision-work tests
initially measured the same full-history work as the frozen legacy query.
All pass after the implementation. No production data was read or modified.

## Handoff

No Pine update or alert recreation is needed for this batch. Production is
unchanged. These changes must be reviewed through the PR before a separately
authorized rollout. The next planned audit batch is ingress diagnostics and build hygiene
(A07–A12); strategy/EA compatibility and broker activation remain separate gates.
