"""
Shared pytest fixtures for integration tests.

Builds a MINIMAL Flask app from just the blueprints and agent packages
under test — intentionally does NOT import the giant app.py so that
tests run without the full dependency stack (faiss, selenium, etc.).

For full end-to-end tests that also exercise the legacy routes, run
inside Docker: docker compose exec backend-dev pytest tests/integration/
"""
import os
import sys

import pytest

# ── Env stubs (must be set before any module is imported) ────────────────────
# core/database.py enforces PostgreSQL (SQLite was removed as a supported
# backend — see commit 9684a130), so this suite needs a real Postgres to
# connect to. CI provides one via DATABASE_URL (postgres service container);
# locally, default to a dedicated `enable_agents_test` DB so runs never touch
# the real dev database. Create it once with: createdb enable_agents_test
os.environ.setdefault(
    "DATABASE_URI",
    os.environ.get("DATABASE_URL") or "postgresql://localhost:5432/enable_agents_test",
)
os.environ.setdefault("PUBLIC_URL", "http://localhost:5000")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client-id")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test-client-secret")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_RESULT_BACKEND", "cache+memory://")

# Add backend/ to the Python path
_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


def _build_test_app():
    """Create a minimal Flask app for blueprint/agent testing."""
    from flask import Flask
    from flask_cors import CORS

    from core.database import db, init_db
    from core.logging_config import configure_logging

    app = Flask("test_app")
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "test-secret-key")
    CORS(app)
    configure_logging(app)
    init_db(app)

    # Core blueprints — auth/health/prompts/favorites were folded into the
    # app.py monolith at some point and no longer exist as blueprint modules
    # here; skip rather than fail so the rest of this fixture (and every
    # other file sharing it) still builds. test_auth.py/test_health.py will
    # correctly fail with 404s until those routes are re-exposed as blueprints.
    for module_path, bp_name in [
        ("blueprints.auth_bp", "auth_bp"),
        ("blueprints.health_bp", "health_bp"),
        ("blueprints.prompts_bp", "prompts_bp"),
        ("blueprints.favorites_bp", "favorites_bp"),
    ]:
        try:
            import importlib as _importlib
            mod = _importlib.import_module(module_path)
            app.register_blueprint(getattr(mod, bp_name))
        except ModuleNotFoundError as exc:
            print(f"[test] Skipping core blueprint {bp_name}: {exc}")

    # Agent blueprints
    from agents.registry import registry_bp, _load_manifests, _registry, agent_dir_for
    import importlib

    _load_manifests()
    for agent_id, manifest in _registry.items():
        if not manifest.get("enabled"):
            continue
        dir_name = agent_dir_for(agent_id)
        try:
            module = importlib.import_module(f"agents.{dir_name}.routes")
            from flask import Blueprint as _BP
            for attr in dir(module):
                obj = getattr(module, attr)
                if isinstance(obj, _BP) and obj.name != "agent_registry":
                    app.register_blueprint(obj)
                    break
        except Exception as exc:
            print(f"[test] Skipping agent {agent_id}: {exc}")

    app.register_blueprint(registry_bp)

    from routes.workflows import workflows_bp
    app.register_blueprint(workflows_bp)

    with app.app_context():
        # Ensure all models are imported so db.create_all() sees their tables
        import core.models  # noqa: F401 — registers User, GoogleOAuthToken
        import models.workflow  # noqa: F401 — registers WorkflowTemplate, WorkflowInstance
        db.create_all()

    return app


@pytest.fixture(scope="session")
def flask_app():
    app = _build_test_app()
    yield app
    with app.app_context():
        from core.database import db
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(flask_app):
    return flask_app.test_client()
