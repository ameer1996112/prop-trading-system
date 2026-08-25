from __future__ import annotations

from pathlib import Path


def test_local_secret_directory_is_outside_git_and_both_docker_contexts() -> None:
    assert "config/local/" in Path(".gitignore").read_text()
    assert "config/local" in Path(".dockerignore").read_text()
    console_ignore = Path("apps/operations-console/.dockerignore").read_text()
    for entry in ("node_modules", ".next", ".env", "coverage"):
        assert entry in console_ignore


def test_example_configuration_uses_compose_password_file_boundary() -> None:
    example = Path(".env.example").read_text()
    assert "POSTGRES_PASSWORD_FILE=" in example
    assert "\nPOSTGRES_PASSWORD=" not in example


def test_backend_image_contains_runnable_alembic_path_and_frontend_is_static() -> None:
    backend = Path("docker/backend.Dockerfile").read_text()
    assert "COPY alembic.ini" in backend
    assert "COPY alembic" in backend
    compose = Path("compose.yaml").read_text()
    assert 'command: ["alembic", "upgrade", "head"]' in compose
    next_config = Path("apps/operations-console/next.config.ts").read_text()
    assert 'output: "export"' in next_config
    page = Path("apps/operations-console/src/app/page.tsx").read_text()
    assert 'dynamic = "force-dynamic"' not in page
    console_image = Path("apps/operations-console/Dockerfile").read_text()
    assert "COPY --from=build /app/out /usr/share/nginx/html" in console_image


def test_container_build_startup_and_cleanup_are_explicitly_bounded() -> None:
    smoke = Path("scripts/container_smoke.sh").read_text()
    assert 'run_bounded.py" --seconds "$bound_seconds" --' in smoke
    for command in (
        "compose_bounded 60 config --quiet",
        "compose_bounded 600 build --quiet",
        "compose_bounded 180 up --detach",
        "compose_bounded 60 ps",
        "compose_bounded 60 logs --no-color",
        "compose_bounded 60 down --volumes --remove-orphans",
    ):
        assert command in smoke
    compose_invocations = [
        line.strip() for line in smoke.splitlines() if line.lstrip().startswith("docker compose")
    ]
    assert compose_invocations == [
        'docker compose --project-name "$project_name" --file "$repository_root/compose.yaml" "$@"'
    ]
    assert "scripts/database_smoke.py" in smoke
    assert "temporary registry" not in smoke


def test_container_smoke_secret_is_readable_by_rootless_backend() -> None:
    smoke = Path("scripts/container_smoke.sh").read_text()
    create_secret = "printf '%s\\n' 'ephemeral-phase0-smoke-password' > \"$secret_file\""
    make_container_readable = 'chmod 0444 "$secret_file"'

    assert "umask 077" in smoke
    assert create_secret in smoke
    assert make_container_readable in smoke
    assert smoke.index(create_secret) < smoke.index(make_container_readable)
    assert smoke.index(make_container_readable) < smoke.index(
        'export POSTGRES_PASSWORD_FILE="$secret_file"'
    )


def test_container_smoke_uses_a_docker_visible_macos_cache_for_file_secrets() -> None:
    smoke = Path("scripts/container_smoke.sh").read_text()

    assert '"$(uname -s)" = "Darwin"' in smoke
    assert "Library/Caches/prop-trading-container-smoke" in smoke
