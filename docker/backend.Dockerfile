FROM ghcr.io/astral-sh/uv:0.11.21 AS uv
FROM python:3.12.8-slim-bookworm AS runtime

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

COPY --from=uv /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev --no-editable

COPY evidence ./evidence
COPY alembic.ini ./alembic.ini
COPY alembic ./alembic
USER 65532:65532
EXPOSE 8000
CMD ["uvicorn", "prop_trading.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
