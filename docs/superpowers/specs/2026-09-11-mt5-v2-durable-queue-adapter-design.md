# MT5 v2 durable-queue adapter

Date: 2026-09-11
Status: written design approved by user on 2026-09-11; implementation plan prepared separately.

## Purpose and boundaries

Connect the tested v2 JSON codec to the existing durable telemetry outbox. A committed request must survive restart byte-for-byte; only a correlated, durably committed acknowledgment may advance the accepted prefix. This checkpoint is offline. It does not make the trading system operational.

Use the backend worktree `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`, not the older checkout under `dev/projects`. Keep design/audit documents in the `tradeops-dashboard-migration` worktree containing this document. Preserve existing dirty changes. No staging, commits, merge, deployment, credentials, migration, private uploads, active-terminal installation, broker calls, HTTP, timers, or order submission. The no-commit boundary overrides generic skill commit instructions.

Parent references: `2026-09-03-mt5-account-telemetry-journal-design.md`, delivery plan `2026-09-03-mt5-telemetry-ea-delivery.md`, and `2026-09-10-mt5-v2-wire-contract.md`. This is the adapter checkpoint identified in the wire plan, not the subsequent transport/lifecycle checkpoint.

## Evidence entering this checkpoint

The supplied UTF-16 log `/Users/ameeramer/Downloads/20260911.log` contains two complete native wire runs, ending at 09:55:08.441 and 09:55:21.295 with `TOV2_WIRE_PASS checks=412 failures=0`; each completed all 12 vectors. This establishes runtime test success, not a cryptographic association with a source ZIP or compiler build. It does not validate the new adapter.

## Approach

Selected: a production adapter and recovery validator on top of the existing State/outbox, with a narrowly scoped acknowledgment-witness extension where necessary. Keep the synthetic CPEND1/CACK1 adapters for existing tests only.

Alternative: combine adapter and HTTP integration. Deferred because it mixes persistence and transport failure modes and requires a separate lifecycle owner and stale-request policy. Replacing the whole storage subsystem is unnecessary and would discard previously tested behavior.

## Components and ownership

1. A production `ITov2TelemetryOutboxAdapter` implementation assembles and validates v2 requests and correlates responses. It owns a private immutable build binding, not State or storage. Constructors perform no I/O.
2. A production `ITov2CaptureWirePayloadValidator` implementation validates recovered pending requests and acknowledged request/response pairs. It never calls State, storage, the terminal, or the broker.
3. State remains the sole owner of persistence, object lookup, commit publication, recovery, and pruning. A targeted paired-ACK validation seam supplies already-read bytes to the validator; it is not a general callback-based State reader.
4. An offline self-test uses fake capture/storage inputs, the production adapter, and the existing State/outbox. A source-only, isolated versioned package supports later native MT5 compilation and testing without replacing the running EA.

Large request/checkpoint fixtures use heap-owned objects where needed to stay below MQL local-variable limits. Dependencies are non-owning where the existing contracts are non-owning; their lifetimes must exceed the adapter/State use. Failure clears outputs and invalidates partial bindings, including explicit empty-string initialization.

## Build binding and data mapping

Before requesting a new message, the caller reads `ReadCaptureContext` outside all validation callbacks. Binding validates the registration and capture frames against their State references, decodes the checkpoint, and proves `Tov2CaptureContextMatches`. It freezes the root digest, generation, capture, registration, diagnostic inputs, and send timestamp. Build and ValidateRequest must reject a changed generation/root. Existing persisted pending bytes take priority even if a fresh binding is absent or invalid.

Identity comes from the validated seven-part local identity and must agree with registration/boundary digests. Request sequence is accepted request + 1; prior acknowledged event comes from State. Collection produced count comes from State and must equal the checkpoint. Watermark, scan completion, observation gap, and record gap come from the bound checkpoint; translate its `-` gap sentinel to wire null without losing named gaps.

Account comes from committed `account_json`. Exposure represents the latest attempt, not an invented complete snapshot: decode `last_complete_json` only for COMPLETE; for PARTIAL/FAILED initialize empty item arrays and preserve attempt status, times, and known/unknown counts exactly as the capture validator does. Never relabel an older complete snapshot as a newer successful attempt.

For every selected event, compare sequence, event ID, record digest, deal ID/revision, and raw canonical record bytes against the committed prefix. Find observation time in matching checkpoint queue metadata. Missing/mismatched metadata is invalid, not replaced by current time. Preserve raw ticket/decimal strings.

Release/build/symbol, permission/connection observations, optional source/manifest digests, optional last-successful-upload time, last error, and diagnostic observation time are explicitly supplied immutable inputs. Do not fabricate native readings. Derive diagnostic accepted-request count and unsent-event count from State. This offline adapter does not invent an upload time from server acceptance time; absent caller evidence remains null. The wire validator enforces all timestamp and enum relationships.

Use the existing contiguous-prefix selection, 32-event maximum, and at-most-one-revision-per-deal rule. Only a proven size overflow may trigger prefix shrinking. Distinguish malformed data from size overflow; a boolean encoder failure alone is not sufficient to label SIZE_LIMIT. An individually oversized head event returns LIMIT without skipping it or emitting an empty batch. Zero events are allowed only when no queued events exist. Keep the 262144-byte request and 16384-byte response limits.

The adapter's `candidate.body_sha` and State's `pending_body`/`ack_body` hold the protocol request digest (canonical JSON excluding `body_sha256`). The framed object's `pending.sha` and `ack_pending_sha` hold the storage-frame digest. Whole serialized-byte hashes are separate. Tests must deliberately distinguish all three.

ValidateRequest rebuilds from the same immutable binding and compares exact bytes and every candidate field. No fresh clock sampling, new snapshot, or mutable diagnostics during validation.

## Pending, acceptance, and restart

Recovered pending validation fully decodes canonical JSON, verifies identity/registration, protocol digest, pending sequence/prior/final/count/produced fields, and membership of the frozen event prefix in current retained events. Capture may advance while pending exists, so a valid old pending request must not be rejected solely because current generation, account, diagnostics, or produced count is newer. Never rebuild a pending request during retry or recovery.

Before accepting a response, validate the pending request against State and call `Tov2WireVerifyResponse` on its exact bytes. Require all identity fields, request digest/sequence, final event acknowledgment, computed coverage, DRY_RUN, and null command. Populate acceptance using the verified result and State's registration and pending-frame references. State publishes the raw response and queue advancement atomically through its existing commit protocol. Returning success requires durable publication; ambiguous writes require reload/recovery, not optimistic success.

Retained duplicate exact acknowledgments remain idempotent and must not acknowledge a newer request. A response's age alone does not invalidate a correctly correlated receipt.

### Required acknowledgment-witness extension

The current `Ack(payload,state,identity)` callback lacks the original request. Moreover, current pruning treats a retired pending object with a retained ACK as eligible for deletion. Consequently, full response-to-request validation on restart cannot rely on the present callback alone.

For the production validator, State must resolve the original PENDING frame by committed `ack_pending_sha` from its bounded inventory, verify the frame digest/kind/generation and decode its payload, then provide that payload with the ACK to a pure paired validation hook. Missing or ambiguous witnesses fail closed. This also runs for the prospective ACK before publication using the already-read pending bytes. Never use a newly active pending request to validate an older ACK.

Protect the original pending object for each retained ACK in both current and previous protected roots during pruning. It becomes eligible only when neither retained root needs it. Preserve bounded inventory/delete behavior. This is a targeted retention and callback extension, not a local-state schema migration. Existing synthetic validators retain their explicitly selected behavior; production must never silently fall back to unpaired validation. Exact method names and compatibility plumbing belong in the implementation plan.

Pair validation re-verifies the request/response using the wire verifier and compares identity, protocol request digest, request sequence, final event, accepted time, registration association, and original pending-frame digest with the committed ACK metadata. It does not require already-acknowledged event objects to remain in the queue.

## Rejection and failure policy

`ValidateReplacement` returns false in this checkpoint. A timeout, generic HTTP error, local age, or uncorrelated STALE_ENVELOPE response is not proof that a request was never accepted. Do not renew timestamps or replace immutable pending bytes. No automatic stale-request recovery is claimed.

Corrupt/missing persisted objects yield recovery-required. Identity mismatch fails closed. Stale binding fails without publication. Exhaustion, ownership loss, and I/O errors preserve existing State result semantics. No automatic store reset, dropping events, fallback to v1, or order execution.

## Verification and deliverables

Use test-first development in the implementation plan. Required coverage:

- Empty and nonempty real v2 messages; COMPLETE/PARTIAL/FAILED exposure; exact decimal/ticket preservation; registration and diagnostic mapping.
- Wrong identity/root/generation/frame digest; failed rebind after success; missing or mismatched observation metadata; every candidate-field mutation.
- 32-event boundary, repeated deal revision split, actual encoded-size shrink, invalid input distinguished from overflow, oversized head event, counter exhaustion.
- Exact pending replay after reopen and after later capture/diagnostic changes; no binding required for replay.
- Correct ACK, rehashed wrong identity/sequence/digest/final-event/coverage, duplicate old ACK with a newer pending, and rejected replacements.
- Restart after PREPARE and ACK; failures around object creation/verification/commit publication; no acknowledged-prefix loss or duplicate advancement.
- ACK recovery with original witness retained through pruning; missing/corrupt/substituted witness; previous-root witness protection; eventual eligible cleanup; legacy synthetic test regression.
- Callback reentrancy refusal, large-object memory handling, and no network/broker/order APIs in the deliverable include closure.

Host tests independently check adapter-generated canonical fixtures with the execution-edge receiver, not merely source text patterns. Native MQL self-tests exercise the real adapter/State paths; host results do not stand in for native execution. Run existing wire, capture, outbox, State, receiver and dry-run boundary regression checks, plus typecheck and diff hygiene. Record exact commands/results and a fresh baseline of pre-existing dirty files.

Package only the necessary source include closure under a new isolated versioned Scripts folder. Include manifest and hashes; independently verify ZIP extraction and extracted-file hashes. Save the handoff archive in Downloads. Native compile/run remains a separate user action and its evidence is recorded separately. No fixed expected assertion count is promised before the test suite exists.

## Completion and next boundary

Completion means reviewed adapter/recovery code, passing host checks, reproducible source package, and separately recorded native test status. It does not mean upload connectivity or trade execution. Only after this checkpoint should a separate approved plan address the single v1/v2 lifecycle owner, HTTP scheduling/retry, correlated stale rejection, deployment, and dashboard integration.
