# Stage 3A MT5 exact values — local execution audit

Date: 2026-09-03

Status: local implementation, specification review and separate quality review pass. User-provided Windows screenshots show the self-test compiled with zero errors/warnings and identify MetaEditor 5.00 build 6140. The supplied raw Experts log confirms two native `TOV2_VALUES_PASS checks=146 failures=0` results, no failure/error entries in that file, and subsequent Algo Trading disablement. The uploaded sources match the reviewed files byte-for-byte, and the earlier uploaded EX5 hash is recorded below. The planned fresh-directory compiler log and precise executed-artifact/runtime correlation remain incomplete. This is not an EA installation or deployment attestation.

## Scope and workflow

The user selected sub-agents for the first executable EA checkpoint. The approved plan's Tasks 1–3 are one tightly coupled test-first unit: native test vectors, TypeScript fixture/source tests, then the pure MQL5 values include. One implementer handles that unit; independent specification and subsequent quality review follow. The controller owns fresh regression/scope checks and this handoff. No parallel implementation writers.

Backend root: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`, branch `codex/mt5-stale-payload-recovery`, HEAD `8a801423bc19b3bb27c8e24f45d2800a9deb6881`.

Only three new source/test paths are authorized:

- `mt5/TradeOpsAgent/Include/TradeOpsTelemetryValues.mqh`
- `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryValuesSelfTest.mq5`
- `apps/execution-edge/test/mt5-telemetry-values-v2-source.test.ts`

Current EA lifecycle, existing v1 includes/self-test, README, local config/journal, receiver source, package/lock files, schemas, fixtures and integrity manifests remain outside the edit scope. No commit, push, merge, deployment, remote migration, secret/binding change, Pine update, EA attachment or broker action is authorized. Existing Stage 1–2 and frontend changes must be preserved.

## Baseline evidence

- Controller captured SHA-256 values for **467 existing tracked/untracked backend files** before implementation and **398 existing tracked/untracked docs/frontend files** before documentation updates; ignored runtime/private state was not read.
- Initial full-suite run inside the sandbox stalled without test results. Only that run's identified Vitest process and three child processes were terminated; this is not counted as a pass or regression.
- The same full-suite command with access for the disposable local Cloudflare runtime passed: **537 tests / 29 files, 49.40 seconds**. No remote service or account was used.
- A separate unchanged pure-values test run passed **4 tests / 1 file** in the ordinary sandbox.
- At the initial source handoff, the controller found no MetaEditor, Wine or PowerShell executable on the local PATH. The user confirmed MetaEditor is available on their Windows machine. No Windows compiler build or produced EX5 had been observed at that point; subsequent screenshot evidence is recorded below.

## Native verification boundary

TypeScript checks compare native-script literals with the actual receiver and inspect source; they do not execute MQL5. The later Windows check must identify the source hashes, compiler build, fresh EX5 hash and compiler output. Running the pure synthetic script also needs an identified isolated terminal and captured `TOV2_VALUES_PASS`/zero-failure output. Do not substitute a heartbeat, C++ compilation, source scanner or fixture pass for these gates.

The user should keep their existing EA attached. Any transfer bundle for verification must contain only the two new synthetic/native source files under `Scripts` and `Include`, never credentials, configuration or journal files. No production installation is part of this checkpoint.

## Implementation and review evidence

The implementer added the native test and TypeScript checks first, then reported an observed **RED: 5 tests run, 1 failed because the values include was missing**. After adding the include, the implementer reported **15 targeted tests / 3 files, typecheck and safety verifier PASS**. The controller independently reran those 15 tests successfully (220 ms), plus typecheck and the unchanged safety verifier.

Initial specification review found one blocking native-test defect: `StringInit('a',160/161)` was used as though it returned a constructed string. The documented API requires a mutable string reference and returns a boolean. The controller and reviewer independently checked that signature. [MetaQuotes StringInit](https://www.mql5.com/en/docs/strings/stringinit). This was a source-review finding; no actual Windows compiler run was claimed.

The implementer added source guards and observed another RED for the incorrect construction, then restored the approved explicit `long_id` append loop and 160/161-character checks. Targeted tests, typecheck and safety verification passed again. Independent specification re-review read all three files and returned **PASS**, confirming all 66 literal vectors, additional native cases, helper contracts and isolation. Native compilation remains unverified.

The separate quality reviewer subsequently read all three files and returned **PASS for local source readiness**, with no actionable critical, important or minor findings. It checked bounds, exact unsigned formatting, canonical serializers, output clearing, native vectors and the unwired safety boundary. It did not rerun the controller's suite and explicitly retained the Windows compile/runtime gates.

## Fresh controller regression after the fix

- `npm --prefix apps/execution-edge test`: **542 tests / 30 files PASS**, 56.44 seconds, including the existing local-D1 integration and workload tests.
- `typecheck`: PASS.
- `lint` (existing TypeScript no-emit command): PASS.
- Unchanged `scripts/verify-mt5-dry-run-boundary.mjs`: PASS.
- `git diff --check`: PASS; separate checks found zero trailing-whitespace lines in all three new untracked files.
- Staged diff: empty.
- SHA-256 comparison: all **467 pre-existing backend files unchanged**, with exactly the three approved new source/test files added.

These results establish the local source/receiver test seam, not MQL5 runtime correctness. The additional five Vitest tests compare native literals to actual receiver validators; they do not interpret or execute MQL5.

## Source hashes after specification correction

| File | SHA-256 |
| --- | --- |
| `Include/TradeOpsTelemetryValues.mqh` | `0016223e32d8d0cf960a3b015581518948a8a2e1464196c0d8f7952d4dc9ea4f` |
| `Scripts/TradeOpsTelemetryValuesSelfTest.mq5` | `c1287570a90f8a412d303d27aa30d940671c431ace5213dbf76ed7b0067bd04a` |
| `test/mt5-telemetry-values-v2-source.test.ts` | `36ec1017d1f6b79627536db3ff98a606e77279fc502c443bea97b2822b2dc55c` |

The first two paths are relative to `mt5/TradeOpsAgent`; the last is relative to `apps/execution-edge`. Use actual source hashes to correlate any later Windows compile log/EX5, not the script's `1.000` property alone.

Stage 3A is not marked fully complete while the full evidence checklist remains outstanding. The source handoff required a Windows compile of the isolated self-test, followed by native execution in an explicitly identified isolated terminal. Subsequent source matching, compiler screenshots and native PASS screenshots are recorded below, together with their remaining provenance and safeguard limitations. Do not install this test bundle as the reporting EA.

## Windows source handoff

Archive: `/private/tmp/tradeops-values-verify.65iGsy/TradeOpsTelemetryValues-Windows-SelfTest.zip`.

Archive SHA-256: `a97790e4f682754074057a9384d909dc492228970fb91f97482cde360c0b3623`.

The controller inspected the archive directory and compared each extracted entry byte-for-byte with the reviewed source. Exactly two entries are present: `Include/TradeOpsTelemetryValues.mqh` and `Scripts/TradeOpsTelemetryValuesSelfTest.mq5`. No EA, credentials, configuration, journal state, TypeScript sources or precompiled binary are included.

Extract to a separate Windows build folder while preserving those two subdirectories. Open the self-test source in MetaEditor and compile only that file. Return the compiler result and MetaEditor build. Source-hash comparison, a fresh EX5 hash, zero compiler errors/warnings and isolated native PASS output are required evidence. At the source handoff none of the Windows evidence had yet been observed; the update below records the current partial evidence.

## User-provided Windows compiler evidence — 2026-09-03

- An initial screenshot showed a missing `TradeOpsTelemetryValues.mqh` include. A later screenshot showed zero errors/warnings for the helper `.mqh` only; that was not accepted as self-test compilation evidence.
- `/var/folders/gj/7lyzfjm53xnbpmnbn4q6v4t00000gp/T/codex-clipboard-f2ad8544-f753-45b4-92c9-57a8cae97cf3.png` shows `TradeOpsTelemetryValuesSelfTest.mq5` and its helper in the results, followed by `code generated` and `0 errors, 0 warnings, 1205 ms elapsed, cpu='AVX2 + FMA3'`.
- `/var/folders/gj/7lyzfjm53xnbpmnbn4q6v4t00000gp/T/codex-clipboard-479f4e32-cd00-42f7-b0ec-e41456c5b9b6.png` shows MetaEditor **Version 5.00 build 6140**, dated **21 Aug 2026**.
- This is user-provided visual compiler evidence, not an assistant-executed Windows build. At this screenshot checkpoint the Windows source files, generated EX5 and compiler log had not been received or hashed. Screenshots alone did not establish byte identity; the later archive verification below establishes source equality and records the uploaded artifact hash.
- At the compiler-screenshot checkpoint no `TOV2_VALUES_PASS` native execution evidence or isolated terminal identity had been provided. Keep the existing EA unchanged; no broker or deployment authority followed from those screenshots. The separately approved test-copy setup and later runtime evidence are recorded below.
- The next evidence collection requested only the two Windows test sources and generated self-test EX5, not the existing EA, configuration, credentials or account journal. The user supplied that archive as recorded below.

## Uploaded Windows artifact verification — 2026-09-03

Input: `/Users/ameeramer/Downloads/TradeOpsTelemetryValuesSelfTest.zip`.

Archive SHA-256: `50df1a5b08b4cb5d40c769713879b1d736288ede0b2a3c8f43578afc131f073d`.

The controller listed the ZIP, verified exactly the three expected entries (no directories or extra files), and read each entry to memory without extracting or executing it. Both source contents matched the current local files byte-for-byte and the previously frozen reviewed hashes:

| Uploaded entry | Bytes | SHA-256 | Result |
| --- | --- | --- | --- |
| `TradeOpsTelemetryValues.mqh` | 5298 | `0016223e32d8d0cf960a3b015581518948a8a2e1464196c0d8f7952d4dc9ea4f` | Exact reviewed source match |
| `TradeOpsTelemetryValuesSelfTest.mq5` | 6221 | `c1287570a90f8a412d303d27aa30d940671c431ace5213dbf76ed7b0067bd04a` | Exact reviewed source match |
| `TradeOpsTelemetryValuesSelfTest.ex5` | 23230 | `66bd29fbcfada89a5c2023bc156641ac27551ea113b0cade21be5c4f334e3872` | Nonempty uploaded artifact; not executed |

The EX5 prefix is `455835017100fc17`. The archive metadata lists its time as 2026-09-03 16:08 and the source times as 15:58; ZIP timestamps are user-provided metadata, not independent build provenance. Matching source hashes, compiler screenshots and an artifact hash do not alone prove which bytes produced the EX5 or establish native runtime correctness.

At the archive checkpoint the remaining gate was the planned fresh-directory Windows compile/log correlation and approval/identification of a specific isolated offline terminal, followed by native output with exactly one final `TOV2_VALUES_PASS` per run, zero `TOV2_VALUES_FAILURE` lines, and `failures=0` (preserve the check count). No second isolated runtime had yet been identified or approved. No runtime execution, EA replacement, broker action, deployment, source change, staging or commit was performed during that archive check.

## User-provided native runtime evidence — 2026-09-03

After the archive verification the user approved guidance for a separate test copy, was instructed to install into `C:\MT5-Telemetry-Test` without signing in or changing the working EA, and confirmed that the new copy's `origin.txt` showed that installation path. This path confirmation is user-reported, not independently inspected on Windows. The instructions allowed running only the verified synthetic EX5 in that copy, with Algo Trading, DLL and WebRequest permissions disabled.

- Journal screenshot `/var/folders/gj/7lyzfjm53xnbpmnbn4q6v4t00000gp/T/codex-clipboard-5656c693-519b-4012-8c7e-93d5d62307fe.png` shows two script load/remove sequences on USDJPY M5. It also shows automated trading enabled and a platform recompilation of 131 files; neither the recompiled-file identities nor the executing EX5 hash were provided.
- Experts screenshot `/var/folders/gj/7lyzfjm53xnbpmnbn4q6v4t00000gp/T/codex-clipboard-b89e1afd-530e-4565-9356-3d0d7a015357.png` shows `TOV2_VALUES_PASS checks=146 failures=0` twice, at visible times 16:37:36.838 and 16:37:43.923. The two final results correspond to the two launches in the Journal. No failure line is visible in the supplied view; this is not a full raw-log inspection.
- Controller freshly rehashed the reviewed self-test (unchanged `c1287570...bd04a`) and counted the source assertions: 26 fixed-value cases × 3 checks, 11 ticket checks, 11 counter cases × 2 checks, 6 identifier checks, 5 digest checks, 7 missing-reading checks, 8 double checks and 9 direct checks = **146**. This static count corroborates the reported count; it does not substitute for native execution.
- Both screenshots show automated trading enabled, contrary to the prescribed test safeguard. The user was asked to switch it off in the test copy only, subsequently confirmed doing so, and then supplied the log below corroborating disablement at 16:42:10.339. Do not infer an account trade from that setting or claim the offline/no-login state was independently verified.

Recorded outcome: the user-provided native runs report **PASS, 146 checks, zero failures each**. No rerun is requested merely because two runs were made. The test validates the isolated values library, not telemetry transport, financial collection, durable storage, live strategy behavior or the full EA upgrade.

The remaining evidence limits at the screenshot checkpoint included the complete runtime log and confirmation of Algo Trading disablement; the raw-log update below resolves those for the provided file. Planned fresh-directory compiler log, test terminal build, exact runtime EX5 hash correlation (especially in light of automatic recompilation), and independent offline/DLL/WebRequest-state attestation remain incomplete. Existing source code, working EA, broker state and deployed services were not changed by the assistant during this evidence update. No new implementation, staging, commit or deployment was performed.

## Uploaded raw Experts log — 2026-09-03

Input: `/Users/ameeramer/Downloads/20260903.log`, **636 bytes**, UTF-16 little-endian with CRLF lines.

SHA-256: `b600bfd991b33e11f0b89fef3ed81761b499d5245982f74056e315151b9cc88b`.

The controller decoded and read the entire uploaded file, then independently parsed all four rows. In file order:

| Time | Source | Message |
| --- | --- | --- |
| 16:37:16.693 | Experts | automated trading is enabled |
| 16:37:36.838 | TradeOpsTelemetryValuesSelfTest (USDJPY,M5) | TOV2_VALUES_PASS checks=146 failures=0 |
| 16:37:43.923 | TradeOpsTelemetryValuesSelfTest (USDJPY,M5) | TOV2_VALUES_PASS checks=146 failures=0 |
| 16:42:10.339 | Experts | automated trading is disabled |

There are exactly two passing run summaries, zero `TOV2_VALUES_FAIL`/`TOV2_VALUES_FAILURE` entries and zero nonzero-severity entries in the supplied file. The latest recorded Algo Trading state is disabled. Both test runs preceded the disablement; this is not evidence that they ran with Algo Trading disabled. The raw log agrees with the screenshots and expected assertion count. It does not establish unrelated platform/account state or the exact binary executed.

The controller initially requested `TradeOpsTelemetryValuesSelfTest.ex5` again from the new test installation to compare against the earlier upload's `66bd29fb...4e3872` hash. The user pointed out that the artifact had already been uploaded. In response to the specific question whether that same EX5 was copied into the new test MT5 without recompiling there, the user confirmed **yes**. Record this as user-attested unchanged transfer, not a second independently measured Windows hash. The duplicate upload request is withdrawn; no further upload or rerun is requested for this clarification.

User-facing handoff: the supplied raw native log confirms **146 checks and zero failures per run**, the reviewed sources match the uploaded sources, the uploaded EX5 hash is known, and the user confirms the tested copy was transferred unchanged. Keep the working EA unchanged. This does not certify the full EA upgrade or erase the separate fresh-directory compiler-log and environment-attestation limitations above. The next development checkpoint is the separately reviewed plan for durable local state/outbox (3B), not deployment or broker execution. No native rerun, full regression, source change, staging or commit was performed during this confirmation update; only this audit was updated.

## Final integrated handoff review

Final read-only integrated review returned **PASS, no blocking findings** after independently checking the archive entries, byte equality, archive/source hashes and all four documentation updates. It retained the Windows source-verification-only boundary; native correctness remains unverified.

Controller final scope comparison: all 467 pre-existing backend files unchanged, exactly the three authorized additions; of the 398 pre-existing docs/frontend files, only the three checkpoint/roadmap plans received status updates, plus this new execution audit. Both staged diffs remain empty and both HEADs unchanged. Backend HEAD is recorded above; docs/frontend HEAD remains `18e29ce68d9e9fc89311163e95dd2b71f040c527`. Both worktrees passed `git diff --check`, and the four documentation files passed explicit trailing-whitespace checks.

Applied process: [subagent-driven development](/Users/ameeramer/.agents/skills/superpowers/subagent-driven-development/SKILL.md), [test-driven development](/Users/ameeramer/.agents/skills/superpowers/test-driven-development/SKILL.md), and [verification before completion](/Users/ameeramer/.agents/skills/superpowers/verification-before-completion/SKILL.md). These require separate implementation/review ownership and executable evidence before a passing claim.
