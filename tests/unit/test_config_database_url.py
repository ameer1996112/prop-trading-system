from __future__ import annotations

import pytest

from prop_trading.config import Settings


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        (
            "postgresql://postgres.internal:5432/prop_trading",
            "postgresql+asyncpg://postgres.internal:5432/prop_trading",
        ),
        (
            "postgres://postgres.internal:5432/prop_trading",
            "postgresql+asyncpg://postgres.internal:5432/prop_trading",
        ),
        (
            "postgresql+asyncpg://postgres.internal:5432/prop_trading",
            "postgresql+asyncpg://postgres.internal:5432/prop_trading",
        ),
    ],
)
def test_database_dsn_is_normalized_for_asyncpg(
    configured: str,
    expected: str,
) -> None:
    settings = Settings(database_dsn=configured)

    assert settings.migration_database_url() == expected


def test_non_postgresql_database_dsn_fails_closed() -> None:
    settings = Settings(database_dsn="sqlite:///tmp/unsafe.db")

    with pytest.raises(RuntimeError, match="must use postgresql"):
        settings.migration_database_url()
