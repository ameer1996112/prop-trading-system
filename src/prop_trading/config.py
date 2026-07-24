"""The only runtime environment/settings boundary."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import quote_plus

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _normalize_async_database_url(value: str) -> str:
    """Normalize provider PostgreSQL URLs to the project's asyncpg driver."""
    for scheme in ("postgresql://", "postgres://"):
        if value.startswith(scheme):
            return f"postgresql+asyncpg://{value.removeprefix(scheme)}"
    if value.startswith("postgresql+asyncpg://"):
        return value
    raise RuntimeError(
        "PTS_DATABASE_DSN must use postgresql://, postgres://, or postgresql+asyncpg://"
    )


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="PTS_",
        extra="ignore",
    )

    app_environment: Literal["local", "test", "foundation"] = "foundation"
    operation_mode: Literal["FOUNDATION_OBSERVATION_ONLY"] = "FOUNDATION_OBSERVATION_ONLY"
    database_dsn: str | None = Field(default=None, repr=False)
    database_host: str | None = None
    database_port: int = Field(default=5432, ge=1, le=65535)
    database_name: str = "phase0"
    database_user: str = "phase0"
    database_password_file: Path | None = Field(default=None, repr=False)
    phase0_evidence_path: Path = Path("evidence/phase0/evidence-registry.json")
    tradingview_observation_ingress_enabled: bool = False
    tradingview_observation_credential_sha256: str | None = Field(
        default=None,
        pattern=r"^[0-9a-f]{64}$",
        repr=False,
    )
    tradingview_observation_max_body_bytes: int = Field(
        default=262_144,
        ge=1_024,
        le=1_048_576,
    )

    def migration_database_url(self) -> str:
        """Resolve the async PostgreSQL DSN used by migrations and the API runtime."""
        if self.database_dsn is not None:
            return _normalize_async_database_url(self.database_dsn)
        if self.database_host is None or self.database_password_file is None:
            raise RuntimeError(
                "PTS_DATABASE_DSN or host plus PTS_DATABASE_PASSWORD_FILE is required for "
                "migrations"
            )
        password = self.database_password_file.read_text(encoding="utf-8").strip()
        if not password:
            raise RuntimeError("database password file is empty")
        return _normalize_async_database_url(
            f"postgresql+asyncpg://{quote_plus(self.database_user)}:{quote_plus(password)}@"
            f"{self.database_host}:{self.database_port}/{quote_plus(self.database_name)}"
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
