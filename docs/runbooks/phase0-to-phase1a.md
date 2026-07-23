# Runbook: exact gates before Phase 1A

Phase 0 code is delivered when `make verify-phase0` passes. Phase 0 closure and Phase 1A traffic
remain blocked until every item below has a `VERIFIED` evidence record whose artifact hash and
requirements reproduce under the deterministic evaluator.

1. Capture every exact Optimizer 1 input and feed/chart/session context from the operator; compute
   the settings hash without using Pine defaults.
2. Capture a redacted TradingView destination and message structure, create a dedicated canonical
   instance with diagnostics disabled, bind the approved manifest, and record alert recreation.
3. Commit approved Pine bytes in a clean source tree and prove working bytes equal that commit.
4. Provision and drill AWS Secrets Manager plus scoped workload identity (candidate), including
   versioning, rotation, audit export, backup/restore, revocation, and per-account scope.
5. Provision and spike Supabase Auth (candidate), proving server-side roles, MFA challenge/verify,
   revocation, and the separately implemented bound single-use action-grant protocol.
6. Provision and drill Grafana Cloud, Better Stack, and Resend candidates for required retention,
   bounded labels, evidence queries, independent dead-man timing, delivery, acknowledgement,
   escalation, export/restore, and surviving-channel failure behavior.
7. Establish a separate MetaApi identity containing only demo-provisioned retail-hedging accounts;
   prove arbitrary import disabled, no live-capable credentials, and per-account isolation.
8. Run the broker concurrency spike. A complete synchronization needs one generation, a common
   start cursor, every snapshot/history page, buffered updates, a common end cursor, gapless fold,
   matching history watermark, and Tier 0 durability. Timestamps, repeated identical polls, and a
   generic synchronized flag cannot pass.
9. Complete the legal tick-source review for capture, retention, replay, derived statistics, and
   redistribution limits. Separately prove upstream quote sequence/loss detection, contiguous
   coverage, reconnect backfill, clock tolerance, checksum, and capability behavior before using
   `SEQUENCE_COMPLETE`.
10. Deploy the collector only after authorization. Capture five consecutive correctly labeled
    EURUSD trading days including rollover, a gap/disconnect fixture, alignment, checksum/gap
    detection, encrypted retention, restore, and linked licensing evidence. Do not relabel
    observed-only data.
11. Before any Phase 1A request, complete the Tier 0/Tier 1 durability, PITR, restore, fencing,
    rollback, retention/capacity, and dual-channel alert proof in `docs/durability.md`.

When evidence is supplied, place only redacted/canonical evidence artifacts under the reviewed
evidence path, regenerate the registry/report, and obtain independent review. Never edit the
gate report directly. Phase 1A remains observation-only and still cannot add a broker command.
