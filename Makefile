SHELL := /bin/sh
.DEFAULT_GOAL := help

PYTHON := uv run python
CONSOLE := apps/operations-console
EDGE := apps/observation-edge
DETECT_SECRETS_EXCLUDE := (^|/)(\.git|\.venv|\.mypy_cache|\.pytest_cache|\.ruff_cache|node_modules|\.next|dist|out|\.wrangler)(/|$$)|(^|/)(tsconfig\.tsbuildinfo|\.secrets\.baseline)$$

.PHONY: help bootstrap format format-check lint typecheck backend-tests frontend-checks \
	edge-checks \
	verify-generated verify-evidence frozen-spec-check contract-v3-check secret-scan boundary-check container-check \
	verify-observation verify-phase0

help:
	@echo "make bootstrap       Install exactly locked Python and Node dependencies"
	@echo "make format          Apply Python formatting"
	@echo "make contract-v3-check  Validate the frozen RD three-entry contract"
	@echo "make verify-observation  Run the complete observation-ingress proof"
	@echo "make verify-phase0      Compatibility alias for the complete proof"

bootstrap:
	uv sync --locked --python 3.12
	cd $(CONSOLE) && npm ci --ignore-scripts --no-audit --no-fund
	cd $(EDGE) && npm ci --ignore-scripts --no-audit --no-fund

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

edge-checks: frontend-checks
	cd $(EDGE) && npm run lint
	cd $(EDGE) && npm run typecheck
	cd $(EDGE) && npm test
	cd $(EDGE) && npm run build

verify-generated: contract-v3-check
	$(PYTHON) scripts/build_phase0_evidence.py --output evidence/phase0/evidence-registry.json --check
	$(PYTHON) scripts/build_golden_vectors.py --output contracts/vectors/canonical-json-v1.json --check
	$(PYTHON) scripts/build_rd_entry_oracle_vectors.py \
		--fixtures tests/fixtures/rd_entry_arbitration_cases_v2.json \
		--output contracts/vectors/rd-entry-arbitration-v2.json --check
	$(PYTHON) scripts/build_rd_entry_oracle_vectors_v3.py \
		--fixtures tests/fixtures/rd_entry_arbitration_cases_v3.json \
		--output contracts/vectors/rd-entry-arbitration-v3.json --check
	$(PYTHON) scripts/build_rd_entry_method_vectors.py \
		--fixtures tests/fixtures/rd_entry_method_cases_v1.json \
		--output contracts/vectors/rd-entry-method-v1.json --check
	$(PYTHON) scripts/export_schemas.py --output-dir contracts/schema --check
	$(PYTHON) -m prop_trading.cli gates --evidence evidence/phase0/evidence-registry.json --output reports/phase0-gates.json --check
	$(PYTHON) scripts/assert_phase0_artifacts.py --registry evidence/phase0/evidence-registry.json --report reports/phase0-gates.json

verify-evidence:
	$(PYTHON) tools/evidence_inventory.py validate --inventory evidence/inventory.json --hash-file evidence/inventory.sha256 --repository-root .

frozen-spec-check:
	$(PYTHON) scripts/assert_frozen_specs.py

contract-v3-check:
	$(PYTHON) -c "from prop_trading.contracts.rd_strategy_v3 import load_rd_strategy_contract_v3; load_rd_strategy_contract_v3()"

secret-scan:
	@set -eu; scan_file=$$(mktemp); trap 'rm -f "$$scan_file"' EXIT HUP INT TERM; \
		uv run detect-secrets scan --all-files --exclude-files '$(DETECT_SECRETS_EXCLUDE)' . > "$$scan_file"; \
		$(PYTHON) scripts/assert_secret_baseline.py --baseline .secrets.baseline < "$$scan_file"
	$(PYTHON) scripts/check_lockfile_credentials.py uv.lock $(CONSOLE)/package-lock.json

boundary-check:
	$(PYTHON) scripts/static_boundary_check.py --root .

container-check:
	./scripts/container_smoke.sh

verify-observation: bootstrap format-check lint typecheck backend-tests edge-checks verify-generated verify-evidence frozen-spec-check secret-scan boundary-check container-check
	@echo "OBSERVATION VERIFICATION PASSED — ingress records metadata and no execution surface exists"

verify-phase0: verify-observation
