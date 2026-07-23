# Legacy evidence boundary

`inventory.json` records only the nine paths explicitly authorized for Phase 0 review. The
capture was scoped to those paths; it does not make a cleanliness claim about unrelated legacy
files. The source HEAD is recorded separately from working-file SHA-256 values.

The copied Pine file is the exact modified working-tree candidate, not the bytes at HEAD. Its
copy metadata therefore has `claimed_commit: null`, and the activation gate remains blocked.
No legacy Python runtime, database data, environment file, dashboard, worker, AI code, or
deployment configuration crossed the boundary.

Run `make verify-evidence` to validate the manifest, its detached checksum, and the approved
copied artifact. `python tools/evidence_inventory.py check-source ...` additionally compares the
authorized paths with the local legacy repository when that repository is available.
