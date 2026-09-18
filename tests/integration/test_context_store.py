"""
Integration tests for ContextStore and agent registry dependency validation.

ContextStore tests run against the test Postgres database (the same one
conftest.py points DATABASE_URI at - SQLite is no longer a supported backend,
see core/database.py). Redis is mocked out so no Redis is required.
"""

import json
import unittest
from unittest.mock import MagicMock, patch


_APP = None


def _make_app():
    """One shared Flask app on the test Postgres DB (built once - each
    init_db() opens its own connection pool)."""
    global _APP
    if _APP is None:
        from flask import Flask
        from core.database import db, init_db
        import core.models  # noqa: F401

        _APP = Flask(__name__)
        _APP.config["TESTING"] = True
        _APP.config["SECRET_KEY"] = "test-secret-key"
        init_db(_APP)
        with _APP.app_context():
            db.create_all()
    return _APP


def _cleanup():
    """Clear what these tests wrote. Deliberately NOT db.drop_all(): that
    database is shared with the rest of the session's tests."""
    from core.database import db
    from core.models import AgentContext

    db.session.rollback()
    AgentContext.query.delete()
    db.session.commit()
    db.session.remove()


class TestContextStorePersistence(unittest.TestCase):
    """Tests that use only the persistent (PostgreSQL) tier — no Redis needed."""

    def setUp(self):
        self.app = _make_app()
        self._ctx = self.app.app_context()
        self._ctx.push()

    def tearDown(self):
        _cleanup()
        self._ctx.pop()

    def _store(self):
        from core.context import ContextStore
        return ContextStore()

    @patch("core.context._get_redis", return_value=None)
    def test_set_and_get(self, _mock_redis):
        store = self._store()
        store.set("user1", "market_research", "company_profile", {"industry": "SaaS"})
        result = store.get("user1", "market_research", "company_profile")
        self.assertEqual(result, {"industry": "SaaS"})

    @patch("core.context._get_redis", return_value=None)
    def test_get_returns_default_when_missing(self, _mock_redis):
        store = self._store()
        result = store.get("user1", "market_research", "nonexistent_key", default="fallback")
        self.assertEqual(result, "fallback")

    @patch("core.context._get_redis", return_value=None)
    def test_overwrite_existing_key(self, _mock_redis):
        store = self._store()
        store.set("user1", "market_research", "company_profile", {"industry": "SaaS"})
        store.set("user1", "market_research", "company_profile", {"industry": "FinTech"})
        result = store.get("user1", "market_research", "company_profile")
        self.assertEqual(result["industry"], "FinTech")

    @patch("core.context._get_redis", return_value=None)
    def test_snapshot_returns_all_keys(self, _mock_redis):
        store = self._store()
        store.set("user2", "market_research", "company_profile", {"name": "Acme"})
        store.set("user2", "content_marketing", "content_brief", {"title": "Top 10"})
        snapshot = store.snapshot("user2")
        self.assertIn("company_profile", snapshot["market_research"])
        self.assertIn("content_brief", snapshot["content_marketing"])
        self.assertEqual(snapshot["market_research"]["company_profile"]["name"], "Acme")

    @patch("core.context._get_redis", return_value=None)
    def test_snapshot_is_isolated_per_user(self, _mock_redis):
        store = self._store()
        store.set("user_a", "market_research", "company_profile", {"name": "A Corp"})
        store.set("user_b", "market_research", "company_profile", {"name": "B Corp"})
        snap_a = store.snapshot("user_a")
        snap_b = store.snapshot("user_b")
        self.assertEqual(snap_a["market_research"]["company_profile"]["name"], "A Corp")
        self.assertEqual(snap_b["market_research"]["company_profile"]["name"], "B Corp")

    @patch("core.context._get_redis", return_value=None)
    def test_delete_removes_key(self, _mock_redis):
        store = self._store()
        store.set("user1", "market_research", "company_profile", {"x": 1})
        store.delete("user1", "market_research", "company_profile")
        result = store.get("user1", "market_research", "company_profile")
        self.assertIsNone(result)

    @patch("core.context._get_redis", return_value=None)
    def test_clear_removes_all_user_context(self, _mock_redis):
        store = self._store()
        store.set("user3", "market_research", "company_profile", {"x": 1})
        store.set("user3", "content_marketing", "content_brief", {"y": 2})
        store.clear("user3")
        self.assertEqual(store.snapshot("user3"), {})

    @patch("core.context._get_redis", return_value=None)
    def test_supports_non_dict_values(self, _mock_redis):
        store = self._store()
        store.set("user1", "market_research", "prospect_list", ["a@b.com", "c@d.com"])
        result = store.get("user1", "market_research", "prospect_list")
        self.assertIsInstance(result, list)
        self.assertIn("a@b.com", result)

    @patch("core.context._get_redis", return_value=None)
    def test_set_many_writes_all_keys(self, _mock_redis):
        store = self._store()
        store.set_many(
            "user_batch",
            "sales_helper",
            [
                ("key_a", {"text": "alpha"}, None),
                ("key_b", {"text": "beta"}, None),
            ],
        )
        self.assertEqual(store.get("user_batch", "sales_helper", "key_a"), {"text": "alpha"})
        self.assertEqual(store.get("user_batch", "sales_helper", "key_b"), {"text": "beta"})

    @patch("core.context._get_redis", return_value=None)
    def test_search_matches_value_substring(self, _mock_redis):
        store = self._store()
        store.set("search_u", "agent", "k1", {"text": "Contoso Robotics", "data": {}})
        rows = store.search("search_u", "Robotics", limit=10)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].key, "k1")

    @patch("core.context._get_redis", return_value=None)
    def test_search_limit_validation(self, _mock_redis):
        store = self._store()
        with self.assertRaises(ValueError):
            store.search("u", "", limit=0)

    @patch("core.context._get_redis", return_value=None)
    def test_same_logical_key_different_agents_isolated(self, _mock_redis):
        store = self._store()
        store.set("u9", "agent_a", "shared_name", {"which": "a"})
        store.set("u9", "agent_b", "shared_name", {"which": "b"})
        self.assertEqual(store.get("u9", "agent_a", "shared_name"), {"which": "a"})
        self.assertEqual(store.get("u9", "agent_b", "shared_name"), {"which": "b"})


class TestContextStoreRedis(unittest.TestCase):
    """Tests that verify the Redis fast-path is hit when Redis is available."""

    def setUp(self):
        self.app = _make_app()
        self._ctx = self.app.app_context()
        self._ctx.push()

    def tearDown(self):
        _cleanup()
        self._ctx.pop()

    def _mock_redis(self):
        rc = MagicMock()
        rc.get.return_value = json.dumps({"industry": "SaaS"})
        rc.set.return_value = True
        rc.delete.return_value = 1
        rc.keys.return_value = []
        return rc

    def test_redis_hit_skips_database(self):
        mock_rc = self._mock_redis()
        with patch("core.context._get_redis", return_value=mock_rc):
            from core.context import ContextStore
            store = ContextStore()
            result = store.get("u1", "market_research", "company_profile")
        self.assertEqual(result, {"industry": "SaaS"})
        mock_rc.get.assert_called_once_with("agent_ctx:u1:market_research:company_profile")

    def test_redis_set_called_on_write(self):
        mock_rc = self._mock_redis()
        with patch("core.context._get_redis", return_value=mock_rc):
            from core.context import ContextStore
            store = ContextStore()
            store.set("u1", "market_research", "company_profile", {"industry": "SaaS"})
        mock_rc.set.assert_called()


class TestRegistryDependencyValidation(unittest.TestCase):
    """Tests for registry startup validation of provides/consumes contracts."""

    def setUp(self):
        from agents.registry import _registry

        # These tests _registry.clear() and repopulate the process-wide
        # registry; put it back so they don't change what every later test
        # (and the app under test) sees.
        self._registry_backup = dict(_registry)
        self.app = _make_app()
        self._ctx = self.app.app_context()
        self._ctx.push()

    def tearDown(self):
        from agents.registry import _registry

        _registry.clear()
        _registry.update(self._registry_backup)
        _cleanup()
        self._ctx.pop()

    def test_no_warning_when_provider_exists(self):
        """market_research provides company_profile, which content_marketing consumes — no warning."""
        from agents.registry import _validate_dependencies, _registry

        _registry.clear()
        _registry["market_research"] = {
            "id": "market_research",
            "enabled": True,
            "provides": {"company_profile": {}},
            "consumes": [],
        }
        _registry["content_marketing"] = {
            "id": "content_marketing",
            "enabled": True,
            "provides": {},
            "consumes": ["company_profile"],
        }
        import io
        from contextlib import redirect_stdout

        buf = io.StringIO()
        with redirect_stdout(buf):
            _validate_dependencies()
        self.assertNotIn("WARNING", buf.getvalue())

    def test_warning_when_no_provider(self):
        """email_outreach consumes prospect_list but no agent provides it — should warn."""
        from agents.registry import _validate_dependencies, _registry

        _registry.clear()
        _registry["email_outreach"] = {
            "id": "email_outreach",
            "enabled": True,
            "provides": {},
            "consumes": ["prospect_list"],
        }
        import io
        from contextlib import redirect_stdout

        buf = io.StringIO()
        with redirect_stdout(buf):
            _validate_dependencies()
        output = buf.getvalue()
        self.assertIn("WARNING", output)
        self.assertIn("prospect_list", output)

    def test_disabled_agent_not_checked(self):
        """Disabled agents are ignored — no warning even if their consumes are unmet."""
        from agents.registry import _validate_dependencies, _registry

        _registry.clear()
        _registry["email_outreach"] = {
            "id": "email_outreach",
            "enabled": False,
            "provides": {},
            "consumes": ["prospect_list"],
        }
        import io
        from contextlib import redirect_stdout

        buf = io.StringIO()
        with redirect_stdout(buf):
            _validate_dependencies()
        self.assertNotIn("WARNING", buf.getvalue())

    def test_context_graph_endpoint(self):
        """GET /api/v1/agents/context-graph returns nodes and edges."""
        from agents.registry import _registry, registry_bp
        from flask import Flask
        from core.database import db, init_db
        import core.models  # noqa: F401

        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        init_db(app)
        app.register_blueprint(registry_bp, url_prefix="/api/v1/agents")

        _registry.clear()
        _registry["market_research"] = {
            "id": "market_research",
            "name": "Market Research",
            "enabled": True,
            "provides": {"company_profile": {}},
            "consumes": [],
        }
        _registry["content_marketing"] = {
            "id": "content_marketing",
            "name": "Content Marketing",
            "enabled": True,
            "provides": {},
            "consumes": ["company_profile"],
        }

        with app.app_context():
            db.create_all()
        from core.session_token import issue_browser_session_token

        with app.app_context():
            token = issue_browser_session_token(app.config["SECRET_KEY"], "user_1")
        client = app.test_client()
        resp = client.get("/api/v1/agents/context-graph", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn("nodes", data)
        self.assertIn("edges", data)
        edge_keys = [e["context_key"] for e in data["edges"]]
        self.assertIn("company_profile", edge_keys)


if __name__ == "__main__":
    unittest.main()
