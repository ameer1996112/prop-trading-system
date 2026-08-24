# Dashboard integrity manifest design

## Purpose

Replace the incomplete source-pattern capability scanner for the private MT5 DRY_RUN health dashboard with an integrity manifest that freezes the exact reviewed dashboard release.

## Scope

Only these dashboard Worker source files are locked:

- `apps/agent-health-console/src/dashboard-html.ts`
- `apps/agent-health-console/src/health-summary-v1.ts`
- `apps/agent-health-console/src/index.ts`

The execution-edge Worker, MT5 EA, Cloudflare configuration, Access policy, broker connection, and trading authority are outside this change.

## Chosen approach

The boundary verifier will compute SHA-256 digests for the three files and compare them to a checked-in JSON manifest containing only those exact relative paths and digests. The verifier fails if a path is missing, unexpected, changed, duplicated, or the manifest is malformed.

This replaces the claim that a generic JavaScript/HTML scanner can prove absence of every future browser, import, or D1 capability. The release is static, so a content-integrity lock is both simpler and stronger: any dashboard source change fails until its manifest update is intentionally reviewed.

The existing narrow semantic checks remain as defense in depth for obvious forbidden MT5 sync or execution references. They are not the primary no-capability proof.

## Update protocol

Changing any locked dashboard source is a security-sensitive change. The author must:

1. update the source;
2. regenerate the manifest using a repository script that accepts only the three approved paths;
3. add tests proving the modified release remains read-only and DRY_RUN-only;
4. obtain an independent review; and
5. run the boundary verifier before merge or deployment.

No automatic CI action may silently rewrite the manifest.

## Verification

Tests must prove that the current source matches the manifest and that a changed file, added dashboard source file, omitted manifest entry, duplicate entry, or malformed digest fails verification. The existing full repository boundary verifier, dashboard tests, typecheck, and configuration-based dry-run build remain required.

## Rollout

This changes only local source controls. It does not authorize deployment, Cloudflare Access changes, D1 migrations, execution-edge deployment, MT5 settings, or trading.
