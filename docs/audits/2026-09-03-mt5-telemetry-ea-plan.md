# MT5 telemetry EA planning audit — 2026-09-03

## Outcome and scope

Stage 3 is split into four dependent checkpoints: exact values, durable local state/outbox, account/history capture, and the v2 transport/lifecycle. The first checkpoint (3A) now has complete proposed source, native tests, TypeScript fixture checks, exact commands and Windows verification gates. The remaining checkpoint descriptions are a delivery map, not complete executable implementations.

This pass changed planning documents only. No Stage 3 source was created; none of its three proposed implementation paths exists at this handoff. No backend, frontend, installed EA, Pine script, live configuration, database, Cloudflare deployment/binding/secret or broker state was changed. No staging, commit or push occurred.

## Documents

- New: `docs/superpowers/plans/2026-09-03-mt5-telemetry-ea-delivery.md`.
- New: `docs/superpowers/plans/2026-09-03-mt5-telemetry-ea-values.md`.
- Updated: the Stage 3 paragraph and final status in `docs/superpowers/plans/2026-09-03-mt5-telemetry-delivery-roadmap.md`.
- New: this audit.

All are in `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration`. Backend source was inspected in `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`, at HEAD `8a801423bc19b3bb27c8e24f45d2800a9deb6881` plus existing uncommitted Stage 1–2 work.

## Evidence inspected

Read the approved telemetry/journal design, delivery roadmap and Stage 2 handoff, plus current EA lifecycle, Config/Sync/CanonicalJson includes, existing self-test/source checks, safety scanner, receiver values/canonical/schema/wire modules and package/test configuration. These establish the unchanged v1 boundary and the actual v2 contract; no alternative parallel trading system was introduced.

Primary MetaQuotes documentation informed unsigned formatting, fixed-double conversion, finite-number checks, file ownership/flush/rename limitations, callback constraints, and the separate Windows compile/network gates. Links are adjacent to the associated claims in the plans. FileMove alone is not treated as proof of crash-atomic storage. WebRequest is not treated as testable in Strategy Tester.

## Planning checks actually performed

1. Extracted **66 literal native test vectors** from the plan and checked them against the actual existing TypeScript value/schema validators loaded in memory: **zero mismatches**. Valid fixed-decimal and missing-reading canonical bytes also matched the actual canonical serializer. These are receiver/fixture checks, not MQL5 execution.
2. Extracted the proposed TS test as a virtual file and typechecked it with the existing execution-edge program/configuration: **zero diagnostics** after correcting the check harness's initial configuration-root resolution. Nothing was written to the backend to perform this check.
3. Applied the existing exported MT5 safety `scan` function to both planned MQL5 code blocks: **zero violations**. This checks those blocks, not a compiled binary or a deployed program.
4. Checked native helper call names against the proposed include definitions: **no undefined project helpers**. Reviewed parameter/output conventions and canonical key order inline.
5. Checked the two new plans for unfinished-code placeholder phrases: none found. Checked the new plans and updated roadmap for trailing whitespace: none. The executable plan has balanced code fences.
6. Confirmed all three proposed implementation paths are still absent. The existing receiver suite was **not rerun** during this planning-only pass; its 537-test/29-file result belongs to the prior Stage 2 execution audit.

The inline review replaced an initially proposed source-string check for missing-value reasons with a direct call to the actual exported schema reader. This makes the planned test verify receiver behavior rather than a string's location in a particular file.

## Unverified / next gates

- No Stage 3 source implementation, actual Vitest run of the proposed new file, native MQL5 compilation, EX5 or native runtime output exists from this pass.
- No usable Windows MetaEditor/Wine executable was found in the local shell. The plan includes a fresh-directory compile procedure and explicitly requires an identified isolated terminal for the pure self-test. The active EA is not a test target.
- 3B–3D still need complete implementation plans against their verified dependencies. State loss, immutable tracking boundaries, ordered outbox ACKs, capture completeness and strict retry semantics cannot be proven by the values checkpoint.
- The measured receiver storage growth (27,017,216 bytes for the prior local idle-day test) remains a continuous-rollout gate. Actual capacity, intended duration and retention require review; no automatic paid upgrade or pruning is authorized.
- Financial/journal dashboard integration is Stage 4. Automatic trade execution remains a separate capability, not something enabled by telemetry work.

## Handoff

Next is local implementation of Stage 3A using its test-first plan, with review checkpoints and no active integration. The writing-plans skill shaped this pass: bounded executable scope, complete code/tests, inline consistency review, and an explicit distinction between planning evidence and native verification.
