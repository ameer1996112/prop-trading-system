# Three-model signal admission local implementation audit

## Approved baseline update — 2026-09-15

The owner explicitly approved the reviewed 62 additions and removal of one stale
fingerprint. Applied only those changes: 60 deterministic vector hashes, one
local-only delivery-test credential fingerprint, and the current protected-region
integrity fingerprint replacing its predecessor. Scanner rules and exclusions
are unchanged. This supersedes the pending-baseline status below.

Fresh verification: 562 narrowly baselined false positives, zero new findings;
five lockfiles with zero credential URLs; all three secret-scanner regression
tests passed. The `make secret-scan` launcher itself was blocked by the local
Xcode license gate (exit 69), so both recipe checks were run directly with the
same scanner options and baseline assertion. No license was accepted.

The final scoped rereview completed with all findings addressed. Independent
verification on unchanged source passed 1,014 observation tests when run alone,
781 execution tests and 875 Python tests. A parallel-run capability-test timeout
remains a load-sensitivity warning. Native Pine and external acceptance remain
pending. Deployment and trading stay disabled; no push or merge was performed.

## Final review fix wave — 2026-09-14

Measured source revision: `b55f6f3`, following production fix `b574822` from
reviewed base `7b1abec`. The final observation run measured `b55f6f3` directly.
The other full checks measured `b574822`; the only intervening change replaced
an adversarial import-test fixture with bounded synthetic sources. Production,
Python, execution tests and all boundary-check inputs were identical. This
section supersedes the historical Task 8 verification below for current results.

All four Important findings and grouped cleanup were addressed. Current
quarantined streams retain subsequent BODY_CONFLICT audit/dispute evidence under
the same CAS fence, with immutable receipt and reservation identity and sticky
quarantine. Live D1 regressions cover concurrent conflicts, all five rollback
write boundaries, and generation retirement races. Private status now exposes
stream state/reason and retained attempt associations, distinguishes unknown
from empty generations, checks operator scope before lookup, and caps each
deterministically ordered list at 50. The exact fields and non-atomic snapshot
limitation are documented in the contract and recovery runbook.

Pine registration IDs now reject spaces and match ASCII 0x21–0x7e excluding
backslash; credential spaces remain significant. RELEASE was regenerated and
the existing protected-region integrity oracle updated. The Python harness pins
and executes the authored escape replacements; native Pine acceptance remains
pending. Import guards enforce each reviewed dependency edge, including the
transitive pure dependencies, store/outbox links and independent receiver.
Existing forbidden checks and the narrow receiver PAPER_ONLY AST exception
remain. E2E assertions mask only explicitly EDGE_DERIVED input positions, so
supplied identities compare directly. Receiver schemas and outbox classification
were expanded for readability. A real-D1 fake-timer test checks the 5,999/6,000 ms
deadline and proves a late valid ACK cannot mutate the settled durable row.
The accidentally tracked task-1 report was removed from the Git index and remains
locally available; other plans and reports were untouched.

| Final command | Result |
| --- | --- |
| Observation Worker suite | PASS: 32 files, 1,014 tests; 25.90 s |
| Execution Worker suite | PASS: 42 files, 781 tests; 57.54 s |
| Python suite | PASS: 875 tests; 42.46 s |
| Both Worker typechecks | PASS |
| Ruff check / format check | PASS / 104 files already formatted |
| Pine generator check | PASS |
| Static boundary / MT5 dry-run boundary | PASS / PASS |
| Lockfile credentials | PASS: 5 lockfiles, 0 credential URLs |
| Secret scan | Expected pending gate: exit 2, 62 new findings, 1 stale entry |
| Diff whitespace | PASS |

The first complete observation run had 1 timeout and 1,013 passing tests. The new
adversarial graph test repeatedly parsed the full production tree and exceeded
its unchanged 5-second limit under parallel suite load. The final test fixture
uses small synthetic modules; the separate real production scan is retained.
The affected full Worker suite was rerun successfully. Initial RED regressions
were 9 Worker failures / 49 passes and 8 Pine failures / 32 passes. Intermediate
fixture corrections and complete verification output are retained locally at
`.superpowers/sdd/2026-09-14-three-model-signal-admission/final-fix-report.md`.

The 62 new/1 stale secret findings remain pending explicit baseline approval.
The new integrity oracle replaces the earlier pending oracle without increasing
the finding count. No baseline entry was accepted or removed. Native compiler,
real escaping/Unicode/boundary/no-sequence tests, scoped final rereview and
separately authorized external acceptance remain pending. No deployment,
remote database, real credential, alert, MT5 installation, order, broker, trading,
dependency upgrade, push or merge action occurred.

## Historical Task 8 evidence

Date: 2026-09-14. Production implementation baseline:
`33eea13085408af867d6fa81c1ea3ba462bf79d9` on
`codex/three-model-signal-admission`, isolated checkout
`/private/tmp/tradeops-integration-20260914`.
Checks measured that exact production baseline plus the Task 8 working diff
(the new integration test, runbook, audit and scoped static/formatting updates).
The resulting commit is recorded after creation in the local task report;
no future commit is claimed to have been tested in advance.

## Result and boundaries

Combined proof is implemented; release acceptance remains incomplete. No
production source, deployment configuration, remote schema, credentials, alerts,
MT5 installation or broker action changed in Task 8. The complete branch still
requires controller review after this task's review. All checked-in admission,
dispatch, status and inbox flags remain false; existing agent responses retain
`command: null`. Admission and receiver storage grant no execution authority.

The new 11-case integration suite connects production admission, outbox and
receiver handlers using two isolated real D1 databases and injected time.
It proves all six model/direction fixtures, byte-identical queued/received bodies,
semantic chronology and fidelity preservation, one receiver row after lost
acknowledgment and retry, duplicate receipt stability, same-attempt namespace
isolation, authenticate-first retirement and late quarantine after receiver
commit. The latter deliberately leaves one immutable evidence-only inbox row;
it is neither remote revocation nor execution authorization.

## Measured verification

| Command | Actual result |
| --- | --- |
| `npm --prefix apps/observation-edge test` | PASS: 32 files, 1001 tests; 31.62 s |
| `npm --prefix apps/execution-edge test` | PASS: 42 files, 781 tests; 53.19 s |
| Observation `npm run typecheck` | PASS, exit 0 |
| Execution `npm run typecheck` | PASS, exit 0 |
| `uv run pytest` initial | FAIL: 4 failed, 865 passed; 34.05 s |
| `uv run pytest` after scoped static updates | PASS: 869 tests; 26.50 s |
| Three changed static test files | PASS: 21 tests; 0.22 s |
| Pine transport test after mechanical formatting | PASS: 34 tests; 0.08 s |
| `uv run ruff check .` | PASS, exit 0 |
| `uv run ruff format --check .` | Initial FAIL: one Pine test file; final PASS: 104 files formatted |
| `make secret-scan` | FAIL, exit 2: 62 new findings, one stale baseline entry |
| `node scripts/verify-mt5-dry-run-boundary.mjs` | PASS |
| `uv run python scripts/generate_rd_v3_release.py --check` | PASS, exit 0 |
| `git diff --check` | PASS, exit 0 |

Worker tests used local workerd sockets with approved sandbox escalation. Python
checks used the existing uv cache. No dependency upgrades were made. Complete
command output and TDD evidence are retained in the local task report at
`.superpowers/sdd/2026-09-14-three-model-signal-admission/task-8-report.md`.

The initial Python failures were obsolete static inventory assertions: two
expected only the legacy evidence alert call, and two assumed the checked-in
migration list stopped at 0030. Controller-authorized updates verify the two
mutually exclusive transport/legacy branches, one guarded post-alert sequence
commit, unchanged legacy alert counts outside this emitter, the historical
0030 no-op explicitly, and the exact new local migration inventory separately.
The existing remote rollout runbook still reports 0030; no remote migration is
claimed. The sole Pine test formatting fix is mechanical.

## Secret-scan gate: individually identified findings

The baseline is unchanged. No finding is automatically approved by this audit.
The controller requested explicit owner approval for exactly 62 additions and
one stale removal; that approval is pending at this audit's initial preparation.
The first failed Make target stops before the separate lockfile-credential check,
so that subsequent recipe step is not counted as passing here.

For each of the following 60 Hex High Entropy String findings in
`contracts/vectors/signal-admission-v1.json`, a read-only scan compared its
scanner fingerprint to SHA-1 of each parsed 64-hex JSON string. Every finding
matched (zero unmatched). Each row identifies one finding by reported source
line and a matching JSON path. These values are public deterministic test
content digests or identity keys, not bearer credentials; repeated references
within the fixture refer to the same value. Classification is based on its
individual field role, not a blanket entropy suppression.

| Source line | Matching JSON path | Individual rationale |
| --- | --- | --- |
| 11 | `$.cases[0].body_sha256` | Canonical request-body integrity digest. |
| 16 | `$.cases[1].body_sha256` | Canonical request-body integrity digest. |
| 27 | `$.cases[3].body_sha256` | Canonical request-body integrity digest. |
| 32 | `$.cases[4].body_sha256` | Canonical request-body integrity digest. |
| 37 | `$.cases[5].body_sha256` | Canonical request-body integrity digest. |
| 48 | `$.cases[7].body_sha256` | Canonical request-body integrity digest. |
| 53 | `$.cases[8].body_sha256` | Canonical request-body integrity digest. |
| 72 | `$.deliveries[0].body.attempt_key` | Economic attempt identity in a public fixture. |
| 74 | `$.deliveries[0].body.evidence_body_sha256` | Canonical evidence-body integrity digest. |
| 125 | `$.deliveries[0].body.evidence.edge_evaluation.evidence[0].payload_sha256` | Evidence payload integrity digest. |
| 145 | `$.deliveries[0].body.evidence.edge_evaluation.candidates[0].candidate_id` | Derived candidate identity in a public fixture. |
| 176 | `$.deliveries[0].body.evidence.formation_body_sha256` | Formation-content integrity digest. |
| 434 | `$.deliveries[0].body.delivery_body_sha256` | Canonical delivery-body integrity digest. |
| 466 | `$.deliveries[1].body.attempt_key` | Economic attempt identity in a public fixture. |
| 468 | `$.deliveries[1].body.evidence_body_sha256` | Canonical evidence-body integrity digest. |
| 519 | `$.deliveries[1].body.evidence.edge_evaluation.evidence[0].payload_sha256` | Evidence payload integrity digest. |
| 539 | `$.deliveries[1].body.evidence.edge_evaluation.candidates[0].candidate_id` | Derived candidate identity in a public fixture. |
| 570 | `$.deliveries[1].body.evidence.formation_body_sha256` | Formation-content integrity digest. |
| 828 | `$.deliveries[1].body.delivery_body_sha256` | Canonical delivery-body integrity digest. |
| 865 | `$.deliveries[2].body.evidence_body_sha256` | Canonical evidence-body integrity digest. |
| 954 | `$.deliveries[2].body.evidence.edge_evaluation.evidence[0].payload_sha256` | Evidence payload integrity digest. |
| 1001 | `$.deliveries[2].body.evidence.edge_evaluation.evidence[1].payload_sha256` | Evidence payload integrity digest. |
| 1047 | `$.deliveries[2].body.evidence.edge_evaluation.evidence[2].payload_sha256` | Evidence payload integrity digest. |
| 1069 | `$.deliveries[2].body.evidence.edge_evaluation.candidates[0].candidate_id` | Derived candidate identity in a public fixture. |
| 1070 | `$.deliveries[2].body.evidence.edge_evaluation.candidates[1].candidate_id` | Derived candidate identity in a public fixture. |
| 1071 | `$.deliveries[2].body.evidence.edge_evaluation.candidates[2].candidate_id` | Derived candidate identity in a public fixture. |
| 1503 | `$.deliveries[2].body.delivery_body_sha256` | Canonical delivery-body integrity digest. |
| 1537 | `$.deliveries[3].body.evidence_body_sha256` | Canonical evidence-body integrity digest. |
| 1614 | `$.deliveries[3].body.evidence.edge_evaluation.evidence[0].payload_sha256` | Evidence payload integrity digest. |
| 1663 | `$.deliveries[3].body.evidence.edge_evaluation.evidence[1].payload_sha256` | Evidence payload integrity digest. |
| 1683 | `$.deliveries[3].body.evidence.edge_evaluation.candidates[0].candidate_id` | Derived candidate identity in a public fixture. |
| 1684 | `$.deliveries[3].body.evidence.edge_evaluation.candidates[1].candidate_id` | Derived candidate identity in a public fixture. |
| 2067 | `$.deliveries[3].body.delivery_body_sha256` | Canonical delivery-body integrity digest. |
| 2101 | `$.deliveries[4].body.evidence_body_sha256` | Canonical evidence-body integrity digest. |
| 2171 | `$.deliveries[4].body.evidence.edge_evaluation.evidence[0].payload_sha256` | Evidence payload integrity digest. |
| 2218 | `$.deliveries[4].body.evidence.edge_evaluation.evidence[1].payload_sha256` | Evidence payload integrity digest. |
| 2247 | `$.deliveries[4].body.evidence.edge_evaluation.candidates[0].candidate_id` | Derived candidate identity in a public fixture. |
| 2248 | `$.deliveries[4].body.evidence.edge_evaluation.candidates[1].candidate_id` | Derived candidate identity in a public fixture. |
| 2637 | `$.deliveries[4].body.delivery_body_sha256` | Canonical delivery-body integrity digest. |
| 2671 | `$.deliveries[5].body.evidence_body_sha256` | Canonical evidence-body integrity digest. |
| 2748 | `$.deliveries[5].body.evidence.edge_evaluation.evidence[0].payload_sha256` | Evidence payload integrity digest. |
| 2797 | `$.deliveries[5].body.evidence.edge_evaluation.evidence[1].payload_sha256` | Evidence payload integrity digest. |
| 2817 | `$.deliveries[5].body.evidence.edge_evaluation.candidates[0].candidate_id` | Derived candidate identity in a public fixture. |
| 2818 | `$.deliveries[5].body.evidence.edge_evaluation.candidates[1].candidate_id` | Derived candidate identity in a public fixture. |
| 3125 | `$.deliveries[5].body.delivery_body_sha256` | Canonical delivery-body integrity digest. |
| 3162 | `$.deliveries[6].body.evidence_body_sha256` | Canonical evidence-body integrity digest. |
| 3212 | `$.deliveries[6].body.evidence.edge_evaluation.evidence[0].payload_sha256` | Evidence payload integrity digest. |
| 3234 | `$.deliveries[6].body.evidence.edge_evaluation.candidates[0].candidate_id` | Derived candidate identity in a public fixture. |
| 3265 | `$.deliveries[6].body.evidence.formation_body_sha256` | Formation-content integrity digest. |
| 3532 | `$.deliveries[6].body.delivery_body_sha256` | Canonical delivery-body integrity digest. |
| 3566 | `$.deliveries[7].body.evidence_body_sha256` | Canonical evidence-body integrity digest. |
| 3626 | `$.deliveries[7].body.evidence.edge_evaluation.evidence[0].payload_sha256` | Evidence payload integrity digest. |
| 3655 | `$.deliveries[7].body.evidence.edge_evaluation.candidates[0].candidate_id` | Derived candidate identity in a public fixture. |
| 3980 | `$.deliveries[7].body.delivery_body_sha256` | Canonical delivery-body integrity digest. |
| 4014 | `$.deliveries[8].body.evidence_body_sha256` | Canonical evidence-body integrity digest. |
| 4084 | `$.deliveries[8].body.evidence.edge_evaluation.evidence[0].payload_sha256` | Evidence payload integrity digest. |
| 4121 | `$.deliveries[8].body.evidence.edge_evaluation.evidence[1].payload_sha256` | Evidence payload integrity digest. |
| 4143 | `$.deliveries[8].body.evidence.edge_evaluation.candidates[0].candidate_id` | Derived candidate identity in a public fixture. |
| 4144 | `$.deliveries[8].body.evidence.edge_evaluation.candidates[1].candidate_id` | Derived candidate identity in a public fixture. |
| 4492 | `$.deliveries[8].body.delivery_body_sha256` | Canonical delivery-body integrity digest. |

The remaining findings are individually accounted for:

- New Secret Keyword at `apps/observation-edge/test/signal-admission-route-v1.test.ts:89`:
  a hardcoded local-only delivery credential passed to an in-process test stub.
  It is synthetic fixture material, not a deployed value. It remains unapproved
  in the baseline; no source spelling was changed to silence the scanner.
- New Hex High Entropy String at `tests/unit/test_generate_rd_v3_release.py:19`:
  the protected-region SHA-256 expectation for generated Pine source. It is a
  public integrity oracle, not authentication material. The scanner fingerprint
  and its parsed association are recorded in the local task report.
- One stale finding in that same generator test: the previous protected-region
  integrity digest is no longer in source after the authorized producer update.
  Its old baseline entry remains pending explicit removal approval.

## Pending acceptance and rollback

Native Pine compilation and real encoder behavior have not been tested here.
The [recovery runbook](../runbooks/three-model-signal-admission.md) includes explicit
acceptance checks for real escaping, payload boundaries, Unicode rejection and
no sequence consumption on failure, plus the six model/direction cases and
legacy behavior. Python source checks do not satisfy those native gates.

Remote deployment/schema reconciliation, credential provisioning, live alerts,
external integration acceptance and any demo execution are pending separate
authorization. No operational numeric freshness policy or account arming
instruction is provided. Cross-service local byte parity is verified by the new
suite and shared-vector suites; remote byte parity remains untested.

Rollback disables the new flags and retains additive migrations, immutable
receipts/evidence, reservations, audit rows and receiver inbox history. The
runbook explicitly rejects destructive down migrations and does not promise to
undo a receiver commit after late quarantine. Final whole-branch review remains
the controller's responsibility after task review.
