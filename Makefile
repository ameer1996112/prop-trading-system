SHELL := /bin/sh
.DEFAULT_GOAL := help

PYTHON := uv run python
CONSOLE := apps/operations-console
DETECT_SECRETS_EXCLUDE := (^|/)(\.git|\.venv|\.mypy_cache|\.pytest_cache|\.ruff_cache|node_modules|\.next)(/|$$)|(^|/)(tsconfig\.tsbuildinfo|\.secrets\.baseline)$$

.PHONY: help bootstrap format format-check lint typecheck backend-tests frontend-checks \
	verify-generated verify-evidence frozen-spec-check secret-scan boundary-check container-check \
	verify-phase0

help:
	@echo "make bootstrap       Install exactly locked Python and Node dependencies"
	@echo "make format          Apply Python formatting"
	@echo "make verify-phase0   Run the complete deterministic Phase 0 proof"

bootstrap:
	uv sync --locked --python 3.12
	cd $(CONSOLE) && npm ci --ignore-scripts --no-audit --no-fund

format:
	uv run ruff format .
	uv run ruff check . --fix

format-check:
	uv run ruff format --check .

lint:
	uv run ruff check .

typecheck:
	uv run mypy

backend-tests:
	uv run pytest

frontend-checks:
	cd $(CONSOLE) && npm run lint
	cd $(CONSOLE) && npm run typecheck
	cd $(CONSOLE) && npm test
	cd $(CONSOLE) && npm run build
	$(PYTHON) scripts/assert_frontend_runtime.py --console-root $(CONSOLE)

verify-generated:
	$(PYTHON) scripts/build_phase0_evidence.py --output evidence/phase0/evidence-registry.json --check
	$(PYTHON) scripts/build_golden_vectors.py --output contracts/vectors/canonical-json-v1.json --check
	$(PYTHON) scripts/export_schemas.py --output-dir contracts/schema --check
	$(PYTHON) -m prop_trading.cli gates --evidence evidence/phase0/evidence-registry.json --output reports/phase0-gates.json --check
	$(PYTHON) scripts/assert_phase0_artifacts.py --registry evidence/phase0/evidence-registry.json --report reports/phase0-gates.json

verify-evidence:
	$(PYTHON) tools/evidence_inventory.py validate --inventory evidence/inventory.json --hash-file evidence/inventory.sha256 --repository-root .

frozen-spec-check:
	$(PYTHON) scripts/assert_frozen_specs.py

secret-scan:
	@set -eu; scan_file=$$(mktemp); trap 'rm -f "$$scan_file"' EXIT HUP INT TERM; \
		uv run detect-secrets scan --all-files --exclude-files '$(DETECT_SECRETS_EXCLUDE)' . > "$$scan_file"; \
		$(PYTHON) scripts/assert_secret_baseline.py --baseline .secrets.baseline < "$$scan_file"
	$(PYTHON) scripts/check_lockfile_credentials.py uv.lock $(CONSOLE)/package-lock.json

boundary-check:
	$(PYTHON) scripts/static_boundary_check.py --root .

container-check:
	./scripts/container_smoke.sh

verify-phase0: bootstrap format-check lint typecheck backend-tests frontend-checks verify-generated verify-evidence frozen-spec-check secret-scan boundary-check container-check
	@echo "PHASE 0 VERIFICATION PASSED — foundation remains observation-only and BLOCKED"
