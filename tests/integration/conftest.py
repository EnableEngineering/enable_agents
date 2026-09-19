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
# Budget alert emails are queued to Celery in production; tests send (and intercept) them inline.
os.environ.setdefault("BUDGET_ALERTS_INLINE", "1")
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_RESULT_BACKEND", "cache+memory://")

# Add backend/ to the Python path
_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


def _bootstrap_schema():
    """Create the core + workflow tables before pytest collects any test
    module. Several test modules `import app` (the full monolith) at module
    level, and importing it runs load_system_templates(), which queries
    workflow_templates - so on an empty database (a fresh CI service
    container, or after a previous session's teardown db.drop_all()) test
    *collection* itself crashed with UndefinedTable. conftest.py is imported
    before the test modules in this directory, so doing it here makes the
    suite hermetic instead of requiring a manual schema bootstrap first."""
    from flask import Flask

    from core.database import db, init_db

    bootstrap_app = Flask("schema_bootstrap")
    init_db(bootstrap_app)
    with bootstrap_app.app_context():
        import core.models  # noqa: F401
        import models.workflow  # noqa: F401
        db.create_all()


_bootstrap_schema()


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


TEST_USER_ID = "user_1"


@pytest.fixture
def auth_headers(flask_app):
    """A valid session Bearer token for TEST_USER_ID - the only identity
    signal require_auth trusts (core/auth.py). Every agent route is
    behind it, so tests that call one need this."""
    from core.session_token import issue_browser_session_token

    with flask_app.app_context():
        token = issue_browser_session_token(flask_app.config["SECRET_KEY"], TEST_USER_ID)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def anon_client(flask_app):
    """No session token - for asserting that a route rejects anonymous calls."""
    return flask_app.test_client()


@pytest.fixture
def client(flask_app, auth_headers):
    """Authenticated as TEST_USER_ID by default (a request that passes its
    own Authorization header still overrides this)."""
    test_client = flask_app.test_client()
    test_client.environ_base["HTTP_AUTHORIZATION"] = auth_headers["Authorization"]
    return test_client


# ── The app.py monolith ──────────────────────────────────────────────────
# /register, /login, /health and the /api/content-marketing routes are
# defined in app.py, not in a blueprint, so the minimal app above (which
# intentionally doesn't import app.py) can't serve them. Tests for those go
# through the real app.

@pytest.fixture(scope="session")
def monolith_app(flask_app):
    import app as app_module
    from core.database import db

    app_module.app.config["TESTING"] = True
    with app_module.app.app_context():
        db.create_all()
    return app_module.app


@pytest.fixture
def monolith_anon_client(monolith_app):
    return monolith_app.test_client()


@pytest.fixture
def monolith_client(monolith_app):
    from core.session_token import issue_browser_session_token

    with monolith_app.app_context():
        token = issue_browser_session_token(monolith_app.config["SECRET_KEY"], TEST_USER_ID)
    test_client = monolith_app.test_client()
    test_client.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return test_client
