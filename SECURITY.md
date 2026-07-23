# Security policy for the Phase 0 foundation

Do not report or paste credentials into issues, fixtures, logs, screenshots, or operator templates.
This repository accepts only redacted evidence and secret references. If a secret is discovered,
revoke it at its provider, preserve the incident audit, remove it through a reviewed history-cleanup
procedure, and rerun `make verify-phase0`.

Phase 0 has no broker security boundary because it has no broker capability. Adding any provider
SDK, account credential setting, command endpoint, or order/position mutation interface is a
security-sensitive scope expansion and requires a separate approved phase.
