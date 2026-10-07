import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import core.ai_client as ai_client


class MockRateLimitError(Exception):
    status_code = 429


class MockInternalServerError(Exception):
    status_code = 500


class MockAuthenticationError(Exception):
    status_code = 401


class MockBadRequestError(Exception):
    status_code = 400


class AIClientRetryTests(unittest.TestCase):
    def setUp(self):
        # Keep retries fast in unit tests
        os.environ["AI_CLIENT_MAX_RETRIES"] = "3"
        os.environ["AI_CLIENT_RETRY_DELAY"] = "0.001"

    def tearDown(self):
        os.environ.pop("AI_CLIENT_MAX_RETRIES", None)
        os.environ.pop("AI_CLIENT_RETRY_DELAY", None)

    def test_is_retryable_exception_identifies_transient_vs_permanent(self):
        self.assertTrue(ai_client._is_retryable_exception(MockRateLimitError("Rate limit")))
        self.assertTrue(ai_client._is_retryable_exception(MockInternalServerError("Server error")))
        self.assertTrue(ai_client._is_retryable_exception(TimeoutError("Socket timeout")))
        self.assertTrue(ai_client._is_retryable_exception(ConnectionError("Connection dropped")))

        # Permanent errors must not be retried
        self.assertFalse(ai_client._is_retryable_exception(MockAuthenticationError("Invalid API key")))
        self.assertFalse(ai_client._is_retryable_exception(MockBadRequestError("Invalid model parameter")))
        self.assertFalse(ai_client._is_retryable_exception(ValueError("Bad value")))
        self.assertFalse(ai_client._is_retryable_exception(RuntimeError("Unknown crash")))

    def test_ai_chat_completion_retries_transient_error_and_succeeds(self):
        attempts = 0

        def fake_create(*args, **kwargs):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise MockRateLimitError("Rate limit hit")
            return MagicMock(
                usage=MagicMock(prompt_tokens=15, completion_tokens=10),
                choices=[MagicMock(message=MagicMock(content="Hello from AI"))],
            )

        mock_openai_module = MagicMock()
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = fake_create
        mock_openai_module.OpenAI.return_value = mock_client

        with patch.object(ai_client, "resolve_model_and_provider", return_value=("gpt-4o-mini", "openai")), \
             patch.object(ai_client, "reserve_budget_for_call", return_value=["res-1"]), \
             patch.object(ai_client, "release_reservations") as mock_release, \
             patch.object(ai_client, "resolve_api_key", return_value=("fake-key", "platform")), \
             patch.object(ai_client, "log_ai_usage") as mock_log, \
             patch.dict("sys.modules", {"openai": mock_openai_module}):

            response = ai_client.ai_chat_completion(
                user_id="user_123",
                project_id=None,
                agent="test.agent",
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": "hi"}],
            )

            self.assertEqual(attempts, 2, "Expected call to succeed on attempt 2 after 1 retry")
            self.assertEqual(response.choices[0].message.content, "Hello from AI")
            mock_log.assert_called_once()
            mock_release.assert_called_once_with(["res-1"])

    def test_ai_chat_completion_fails_immediately_on_non_retryable_error(self):
        attempts = 0

        def fake_create(*args, **kwargs):
            nonlocal attempts
            attempts += 1
            raise MockAuthenticationError("Incorrect API key provided")

        mock_openai_module = MagicMock()
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = fake_create
        mock_openai_module.OpenAI.return_value = mock_client

        with patch.object(ai_client, "resolve_model_and_provider", return_value=("gpt-4o-mini", "openai")), \
             patch.object(ai_client, "reserve_budget_for_call", return_value=["res-1"]), \
             patch.object(ai_client, "release_reservations") as mock_release, \
             patch.object(ai_client, "resolve_api_key", return_value=("fake-key", "platform")), \
             patch.object(ai_client, "log_ai_usage") as mock_log, \
             patch.dict("sys.modules", {"openai": mock_openai_module}):

            with self.assertRaises(MockAuthenticationError):
                ai_client.ai_chat_completion(
                    user_id="user_123",
                    project_id=None,
                    agent="test.agent",
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": "hi"}],
                )

            self.assertEqual(attempts, 1, "Non-retryable error should not be retried")
            mock_log.assert_not_called()
            mock_release.assert_called_once_with(["res-1"])

    def test_ai_chat_completion_exhausts_retries_and_raises(self):
        attempts = 0

        def fake_create(*args, **kwargs):
            nonlocal attempts
            attempts += 1
            raise MockRateLimitError("Persistent rate limit")

        mock_openai_module = MagicMock()
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = fake_create
        mock_openai_module.OpenAI.return_value = mock_client

        with patch.object(ai_client, "resolve_model_and_provider", return_value=("gpt-4o-mini", "openai")), \
             patch.object(ai_client, "reserve_budget_for_call", return_value=["res-1"]), \
             patch.object(ai_client, "release_reservations") as mock_release, \
             patch.object(ai_client, "resolve_api_key", return_value=("fake-key", "platform")), \
             patch.object(ai_client, "log_ai_usage") as mock_log, \
             patch.dict("sys.modules", {"openai": mock_openai_module}):

            with self.assertRaises(MockRateLimitError):
                ai_client.ai_chat_completion(
                    user_id="user_123",
                    project_id=None,
                    agent="test.agent",
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": "hi"}],
                )

            self.assertEqual(attempts, 3, "Expected 3 attempts before raising")
            mock_log.assert_not_called()
            mock_release.assert_called_once_with(["res-1"])

    def test_ai_embeddings_retries_transient_error(self):
        attempts = 0

        def fake_embed(*args, **kwargs):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise MockInternalServerError("500 Internal Server Error from OpenAI")
            return MagicMock(usage=MagicMock(prompt_tokens=8), data=[MagicMock(embedding=[0.1, 0.2])])

        mock_openai_module = MagicMock()
        mock_client = MagicMock()
        mock_client.embeddings.create.side_effect = fake_embed
        mock_openai_module.OpenAI.return_value = mock_client

        with patch.object(ai_client, "reserve_budget_for_call", return_value=["res-embed"]), \
             patch.object(ai_client, "release_reservations") as mock_release, \
             patch.object(ai_client, "resolve_api_key", return_value=("fake-key", "platform")), \
             patch.object(ai_client, "log_ai_usage") as mock_log, \
             patch.dict("sys.modules", {"openai": mock_openai_module}):

            response = ai_client.ai_embeddings(
                user_id="user_123",
                project_id=None,
                agent="test.embeddings",
                model="text-embedding-ada-002",
                input="Sample text",
            )

            self.assertEqual(attempts, 2)
            mock_log.assert_called_once()
            mock_release.assert_called_once_with(["res-embed"])


class SafeParseJsonAndUserIdentityTests(unittest.TestCase):
    def test_safe_parse_json_valid_dict(self):
        result = ai_client.safe_parse_json('{"key": "value", "number": 42}')
        self.assertEqual(result, {"key": "value", "number": 42})

    def test_safe_parse_json_valid_array(self):
        result = ai_client.safe_parse_json('[{"index": 1}, {"index": 2}]')
        self.assertEqual(result, [{"index": 1}, {"index": 2}])

    def test_safe_parse_json_markdown_fenced(self):
        payload = "```json\n{\"subject\": \"Quick idea\", \"body\": \"Hello\"}\n```"
        result = ai_client.safe_parse_json(payload)
        self.assertEqual(result, {"subject": "Quick idea", "body": "Hello"})

    def test_safe_parse_json_markdown_fenced_plain(self):
        payload = "```\n{\"subject\": \"Plain fence\", \"body\": \"Hello\"}\n```"
        result = ai_client.safe_parse_json(payload)
        self.assertEqual(result, {"subject": "Plain fence", "body": "Hello"})

    def test_safe_parse_json_surrounded_by_commentary(self):
        payload = "Here is the JSON you requested:\n```json\n{\"answer\": 42}\n```\nLet me know if you need more!"
        result = ai_client.safe_parse_json(payload)
        self.assertEqual(result, {"answer": 42})

    def test_safe_parse_json_empty_and_none(self):
        self.assertEqual(ai_client.safe_parse_json(""), {})
        self.assertEqual(ai_client.safe_parse_json(None), {})

    def test_safe_parse_json_invalid_raises_decode_error(self):
        import json
        with self.assertRaises(json.JSONDecodeError):
            ai_client.safe_parse_json("not valid json at all")

    def test_current_user_id_fallback(self):
        mock_flask = MagicMock()
        mock_flask.has_request_context.return_value = True
        mock_flask.g.user_id = "user_abc"
        with patch.dict("sys.modules", {"flask": mock_flask}):
            # Explicit user_id is preferred
            self.assertEqual(ai_client._current_user_id("user_explicit"), "user_explicit")
            # If None, falls back to g.user_id
            self.assertEqual(ai_client._current_user_id(None), "user_abc")

    def test_app_endpoints_preserve_user_id_and_project_id_ast(self):
        import ast
        app_file = BACKEND_DIR / "app.py"
        source = app_file.read_text(encoding="utf-8")
        tree = ast.parse(source)

        functions = {
            node.name: node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
        }

        # generate_email_content must accept user_id and project_id
        self.assertIn("generate_email_content", functions)
        gen_email_args = [arg.arg for arg in functions["generate_email_content"].args.args]
        self.assertIn("user_id", gen_email_args)
        self.assertIn("project_id", gen_email_args)

        # get_company_skills_from_openai must accept user_id and project_id
        self.assertIn("get_company_skills_from_openai", functions)
        skills_args = [arg.arg for arg in functions["get_company_skills_from_openai"].args.args]
        self.assertIn("user_id", skills_args)
        self.assertIn("project_id", skills_args)

        # enrich_json_with_openai must accept user_id and project_id
        self.assertIn("enrich_json_with_openai", functions)
        enrich_args = [arg.arg for arg in functions["enrich_json_with_openai"].args.args]
        self.assertIn("user_id", enrich_args)
        self.assertIn("project_id", enrich_args)

        # parse_simple_query_enhanced must accept user_id and project_id
        self.assertIn("parse_simple_query_enhanced", functions)
        parse_args = [arg.arg for arg in functions["parse_simple_query_enhanced"].args.args]
        self.assertIn("user_id", parse_args)
        self.assertIn("project_id", parse_args)

        # generate must accept user_id and project_id
        self.assertIn("generate", functions)
        gen_args = [arg.arg for arg in functions["generate"].args.args]
        self.assertIn("user_id", gen_args)
        self.assertIn("project_id", gen_args)

        # Check calls to ai_chat_completion inside generate_email_content
        for node in ast.walk(functions["generate_email_content"]):
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "ai_chat_completion":
                kw_names = {kw.arg: kw.value for kw in node.keywords}
                self.assertIn("user_id", kw_names)
                self.assertIn("project_id", kw_names)
                # Verify user_id is passed as variable user_id, not None literal
                self.assertIsInstance(kw_names["user_id"], ast.Name)
                self.assertEqual(kw_names["user_id"].id, "user_id")
                self.assertIsInstance(kw_names["project_id"], ast.Name)
                self.assertEqual(kw_names["project_id"].id, "project_id")


if __name__ == "__main__":
    unittest.main()

