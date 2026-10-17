import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Pre-mock agents.registry and routes.workflows to avoid needing a live Postgres
# connection during module import
import agents.registry
agents.registry.validate_workflow_template_agents = MagicMock()
import routes.workflows
routes.workflows.load_system_templates = MagicMock()

import app as app_module
from core.session_token import issue_browser_session_token


class TrustedProjectIdTests(unittest.TestCase):
    def setUp(self):
        self.app = app_module.app
        self.client = self.app.test_client()
        self.secret_key = self.app.config.get("SECRET_KEY") or "test-secret-key"
        self.user_id = "test-attacker-user"
        self.auth_token = issue_browser_session_token(self.secret_key, self.user_id)
        self.auth_headers = {
            "Authorization": f"Bearer {self.auth_token}",
            "Content-Type": "application/json",
        }
        self.unauthorized_project = "proj-other-team-123"
        self.authorized_project = "proj-my-team-456"

    def _mock_user_can_access_project(self, user_id, project_id):
        # Only self.authorized_project is accessible to self.user_id
        return project_id == self.authorized_project

    def test_trusted_project_id_helper(self):
        """_trusted_project_id should only return project_id if the user can access it."""
        if not hasattr(app_module, "_trusted_project_id"):
            self.fail("_trusted_project_id helper is not implemented in app.py")

        with self.app.test_request_context():
            from flask import g
            g.user_id = self.user_id

            with patch("core.auth.user_can_access_project", side_effect=self._mock_user_can_access_project):
                # Unauthorized project must return None
                self.assertIsNone(
                    app_module._trusted_project_id({"project_id": self.unauthorized_project})
                )
                # Authorized project must return the project ID
                self.assertEqual(
                    app_module._trusted_project_id({"project_id": self.authorized_project}),
                    self.authorized_project,
                )
                # None or missing project_id must return None
                self.assertIsNone(app_module._trusted_project_id({}))
                self.assertIsNone(app_module._trusted_project_id({"project_id": None}))
                self.assertIsNone(app_module._trusted_project_id({"project_id": ""}))
                # Non-dict data must return None safely
                self.assertIsNone(app_module._trusted_project_id(None))

    def test_generate_email_rejects_unauthorized_project_id(self):
        """POST /api/generate-email must not forward unauthorized project_id."""
        with patch("core.auth.user_can_access_project", side_effect=self._mock_user_can_access_project), \
             patch("app.generate_email_content", return_value={"subject": "Hi", "body": "Hello"}) as mock_gen:
            
            # Calling with unauthorized project_id
            resp = self.client.post(
                "/api/generate-email",
                headers=self.auth_headers,
                json={
                    "sender_name": "Alex",
                    "business": {"name": "Acme Inc"},
                    "project_id": self.unauthorized_project,
                },
            )
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(mock_gen.call_count, 1)
            _, kwargs = mock_gen.call_args
            self.assertIsNone(
                kwargs.get("project_id"),
                f"Expected project_id to be None, got {kwargs.get('project_id')}",
            )

    def test_chat_api_rejects_unauthorized_project_id(self):
        """POST /chat_api must not forward unauthorized project_id to generate."""
        with patch("core.auth.user_can_access_project", side_effect=self._mock_user_can_access_project), \
             patch("glob.glob", return_value=["/data/embeddings/test_hash_index.pkl"]), \
             patch("app.load_embeddings", return_value=(MagicMock(), {(1, 0): [0.1]}, {1: ["chunk1"]})), \
             patch("app.extract_phrases_from_query", return_value=["query"]), \
             patch("app.get_embeddings_for_query", return_value=[[0.1]]), \
             patch("app.retrieve_similar_chunks", return_value=["chunk1"]), \
             patch("app.generate", return_value="Test answer") as mock_gen:

            resp = self.client.post(
                "/chat_api",
                headers=self.auth_headers,
                json={
                    "query": "hello",
                    "file_hash": "test_hash",
                    "project_id": self.unauthorized_project,
                },
            )
            self.assertEqual(resp.status_code, 200)
            _, kwargs = mock_gen.call_args
            self.assertIsNone(
                kwargs.get("project_id"),
                f"Expected project_id to be None, got {kwargs.get('project_id')}",
            )

    def test_simple_search_rejects_unauthorized_project_id(self):
        """POST /simple_search must not forward unauthorized project_id."""
        with patch("core.auth.user_can_access_project", side_effect=self._mock_user_can_access_project), \
             patch("app.parse_simple_query_enhanced", return_value={"success": True, "type": "regular", "company": [], "skills": [], "keywords": ["python"]}) as mock_parse, \
             patch("app.simple_search_json", return_value=[{"company": "Acme"}]):
            
            resp = self.client.post(
                "/simple_search",
                headers=self.auth_headers,
                json={
                    "query": "find python developers",
                    "data": [{"company": "Acme", "skills": ["python"]}],
                    "project_id": self.unauthorized_project,
                },
            )
            self.assertEqual(resp.status_code, 200)
            _, kwargs = mock_parse.call_args
            self.assertIsNone(
                kwargs.get("project_id"),
                f"Expected project_id to be None, got {kwargs.get('project_id')}",
            )

    def test_enrich_with_openai_rejects_unauthorized_project_id(self):
        """POST /enrich_with_openai must not forward unauthorized project_id."""
        with patch("core.auth.user_can_access_project", side_effect=self._mock_user_can_access_project), \
             patch("app.enrich_json_with_openai", return_value={"success": True, "enriched_data": []}) as mock_enrich:
            
            resp = self.client.post(
                "/enrich_with_openai",
                headers=self.auth_headers,
                json={
                    "data": [{"name": "Test Company"}],
                    "project_id": self.unauthorized_project,
                },
            )
            self.assertEqual(resp.status_code, 200)
            _, kwargs = mock_enrich.call_args
            self.assertIsNone(
                kwargs.get("project_id"),
                f"Expected project_id to be None, got {kwargs.get('project_id')}",
            )

    def test_route_task_rejects_unauthorized_project_id(self):
        """POST /api/route-task must not forward unauthorized project_id to ai_chat_completion."""
        fake_response = MagicMock()
        fake_response.choices = [MagicMock(message=MagicMock(content='{"type": "none"}'))]

        with patch("core.auth.user_can_access_project", side_effect=self._mock_user_can_access_project), \
             patch("models.workflow.WorkflowTemplate") as mock_tmpl_cls, \
             patch("core.ai_client.ai_chat_completion", return_value=fake_response) as mock_ai:
            
            mock_tmpl_cls.query.filter_by.return_value.all.return_value = []

            resp = self.client.post(
                "/api/route-task",
                headers=self.auth_headers,
                json={
                    "task": "Perform market research on widgets",
                    "project_id": self.unauthorized_project,
                },
            )
            self.assertEqual(resp.status_code, 200)
            _, kwargs = mock_ai.call_args
            self.assertIsNone(
                kwargs.get("project_id"),
                f"Expected project_id to be None, got {kwargs.get('project_id')}",
            )

    def test_rag_test_rejects_unauthorized_project_id(self):
        """POST /rag_test must not forward unauthorized project_id to generate."""
        with patch("core.auth.user_can_access_project", side_effect=self._mock_user_can_access_project), \
             patch("app.get_credentials", return_value="fake-key"), \
             patch("app.get_file_hash", return_value="test_hash"), \
             patch("app.load_embeddings", return_value=(MagicMock(), MagicMock(), ["chunk 1"])), \
             patch("app.extract_phrases_from_query", return_value=["query"]), \
             patch("app.get_embeddings_for_query", return_value=[[0.1]]), \
             patch("app.retrieve_similar_chunks", return_value=["chunk 1"]), \
             patch("app.generate", return_value="Generated answer") as mock_gen, \
             patch("os.path.exists", return_value=True):
            
            app_module.cache["test_hash"] = (MagicMock(), MagicMock(), ["chunk 1"])

            resp = self.client.post(
                "/rag_test",
                headers=self.auth_headers,
                json={
                    "query": "test query",
                    "file_name": "test.pdf",
                    "project_id": self.unauthorized_project,
                },
            )
            self.assertEqual(resp.status_code, 200)
            _, kwargs = mock_gen.call_args
            self.assertIsNone(
                kwargs.get("project_id"),
                f"Expected project_id to be None, got {kwargs.get('project_id')}",
            )

    def test_openai_chat_rejects_unauthorized_project_id(self):
        """POST /search_suggestions must not forward unauthorized project_id to ai_chat_completion."""
        fake_response = MagicMock()
        fake_response.choices = [MagicMock(message=MagicMock(content="Matchmaking answer"))]

        with patch("core.auth.user_can_access_project", side_effect=self._mock_user_can_access_project), \
             patch("core.ai_client.ai_chat_completion", return_value=fake_response) as mock_ai:
            
            resp = self.client.post(
                "/search_suggestions",
                headers=self.auth_headers,
                json={
                    "prompt": "Find a match for software developer",
                    "project_id": self.unauthorized_project,
                },
            )
            self.assertEqual(resp.status_code, 200)
            _, kwargs = mock_ai.call_args
            self.assertIsNone(
                kwargs.get("project_id"),
                f"Expected project_id to be None, got {kwargs.get('project_id')}",
            )

    def test_extract_with_kg_rag_rejects_unauthorized_project_id(self):
        """POST /extract-with-kg-rag must not forward unauthorized project_id to process_documents_with_kg_rag."""
        with patch("core.auth.user_can_access_project", side_effect=self._mock_user_can_access_project), \
             patch("app.process_documents_with_kg_rag", return_value={"answer": "42"}) as mock_kg:
            
            resp = self.client.post(
                "/extract-with-kg-rag",
                headers=self.auth_headers,
                json={
                    "documents": [{"source_type": "file", "path": "test.txt"}],
                    "query": "What is the answer?",
                    "project_id": self.unauthorized_project,
                },
            )
            self.assertEqual(resp.status_code, 200)
            _, kwargs = mock_kg.call_args
            self.assertIsNone(
                kwargs.get("project_id"),
                f"Expected project_id to be None, got {kwargs.get('project_id')}",
            )

    def test_ai_key_resolution_not_used_for_unauthorized_project(self):
        """End-to-end check: calling an endpoint with an unauthorized project_id must not use that project's key."""
        with patch("core.auth.user_can_access_project", side_effect=self._mock_user_can_access_project), \
             patch("core.project_settings.ProjectSettings.get", return_value="sk-victim-key-99999"), \
             patch("core.settings.UserSettings.get", return_value=None), \
             patch.dict(os.environ, {"OPENAI_API_KEY": "sk-platform-key-00000"}):

            fake_response = MagicMock()
            fake_response.choices = [MagicMock(message=MagicMock(content=json.dumps({"subject": "Hi", "body": "Hello"})))]
            fake_response.usage = MagicMock(prompt_tokens=10, completion_tokens=10)

            with patch("core.ai_client._retry_call", side_effect=lambda fn: fn()), \
                 patch("core.ai_client.reserve_budget_for_call", return_value=[]), \
                 patch("core.ai_client.release_reservations"), \
                 patch("core.ai_client.log_ai_usage"), \
                 patch("openai.OpenAI") as mock_openai_cls:

                mock_openai_client = MagicMock()
                mock_openai_cls.return_value = mock_openai_client
                mock_openai_client.chat.completions.create.return_value = fake_response

                resp = self.client.post(
                    "/api/generate-email",
                    headers=self.auth_headers,
                    json={
                        "sender_name": "Attacker",
                        "business": {"name": "Target Corp"},
                        "project_id": self.unauthorized_project,
                    },
                )
                self.assertEqual(resp.status_code, 200)

                # The OpenAI client must have been initialized with the platform key, NOT the victim's project key!
                mock_openai_cls.assert_called_with(api_key="sk-platform-key-00000")
                self.assertNotEqual(
                    mock_openai_cls.call_args.kwargs.get("api_key"),
                    "sk-victim-key-99999",
                    "Security breach: Victim's project API key was used for unauthorized user!",
                )

    def test_ai_key_resolution_used_for_authorized_project(self):
        """When calling with an authorized project_id, that project's configured key SHOULD be used."""
        with patch("core.auth.user_can_access_project", side_effect=self._mock_user_can_access_project), \
             patch("core.project_settings.ProjectSettings.get", return_value="sk-my-project-key-77777"), \
             patch("core.settings.UserSettings.get", return_value=None), \
             patch.dict(os.environ, {"OPENAI_API_KEY": "sk-platform-key-00000"}):

            fake_response = MagicMock()
            fake_response.choices = [MagicMock(message=MagicMock(content=json.dumps({"subject": "Hi", "body": "Hello"})))]
            fake_response.usage = MagicMock(prompt_tokens=10, completion_tokens=10)

            with patch("core.ai_client._retry_call", side_effect=lambda fn: fn()), \
                 patch("core.ai_client.reserve_budget_for_call", return_value=[]), \
                 patch("core.ai_client.release_reservations"), \
                 patch("core.ai_client.log_ai_usage"), \
                 patch("openai.OpenAI") as mock_openai_cls:

                mock_openai_client = MagicMock()
                mock_openai_cls.return_value = mock_openai_client
                mock_openai_client.chat.completions.create.return_value = fake_response

                resp = self.client.post(
                    "/api/generate-email",
                    headers=self.auth_headers,
                    json={
                        "sender_name": "Alex",
                        "business": {"name": "Target Corp"},
                        "project_id": self.authorized_project,
                    },
                )
                self.assertEqual(resp.status_code, 200)

                # For an authorized project, the project's key should be used!
                mock_openai_cls.assert_called_with(api_key="sk-my-project-key-77777")

    def test_save_message_sanitizes_unauthorized_project_id(self):
        """POST /api/ai_assistant_messages must sanitize project_id to None if unauthorized."""
        with patch("core.auth.user_can_access_project", side_effect=self._mock_user_can_access_project), \
             patch("core.models.AiAssistantMessage") as mock_msg_cls, \
             patch("core.database.db.session"):

            mock_msg_cls.query.filter_by.return_value.first.return_value = None

            resp = self.client.post(
                "/api/ai_assistant_messages",
                headers=self.auth_headers,
                json={
                    "id": "msg-123",
                    "role": "user",
                    "text": "Hello assistant",
                    "project_id": self.unauthorized_project,
                },
            )
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(mock_msg_cls.call_count, 1)
            _, kwargs = mock_msg_cls.call_args
            self.assertIsNone(
                kwargs.get("project_id"),
                f"Expected project_id to be None, got {kwargs.get('project_id')}",
            )

