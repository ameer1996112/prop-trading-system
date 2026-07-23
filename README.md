# Autonomous Prop-Trading System — Phase 0

This repository currently contains an observation-only, fail-closed foundation. It has no broker
command interface, no account credential settings, and no ingress traffic path. Every external
activation dependency is represented as explicit evidence and is currently blocked.

The one proof command is:

```sh
make verify-phase0
```

See [docs/development.md](docs/development.md), [docs/architecture.md](docs/architecture.md),
[docs/threat-model.md](docs/threat-model.md), and
[docs/runbooks/phase0-to-phase1a.md](docs/runbooks/phase0-to-phase1a.md) for the development,
safety, and promotion contracts.
