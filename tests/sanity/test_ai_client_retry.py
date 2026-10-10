import ast
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import anthropic
from anthropic._base_client import httpx2
import core.ai_client as ai_client
import httpx
import openai


class AIClientRetryTests(unittest.TestCase):
    def setUp(self):
        os.environ["AI_CLIENT_MAX_RETRIES"] = "3"
        os.environ["AI_CLIENT_TIMEOUT"] = "60.0"

    def tearDown(self):
        os.environ.pop("AI_CLIENT_MAX_RETRIES", None)
        os.environ.pop("AI_CLIENT_TIMEOUT", None)

    def test_build_client_kwargs_defaults_and_overrides(self):
        # Default behavior: max_retries=3, timeout=60.0
        kwargs = {}
        client_kwargs = ai_client._build_client_kwargs("sk-test", kwargs)
        self.assertEqual(client_kwargs["api_key"], "sk-test")
        self.assertEqual(client_kwargs["max_retries"], 3)
        self.assertEqual(client_kwargs["timeout"], 60.0)
        self.assertNotIn("http_client", client_kwargs)

        # Environment variable overrides
        os.environ["AI_CLIENT_MAX_RETRIES"] = "5"
        os.environ["AI_CLIENT_TIMEOUT"] = "30.0"
        client_kwargs_env = ai_client._build_client_kwargs("sk-test", {})
        self.assertEqual(client_kwargs_env["max_retries"], 5)
        self.assertEqual(client_kwargs_env["timeout"], 30.0)

        # Explicit kwargs override environment
        mock_http = MagicMock()
        client_kwargs_explicit = ai_client._build_client_kwargs(
            "sk-test", {"max_retries": 1, "timeout": 15.0, "http_client": mock_http, "other_arg": "value"}
        )
        self.assertEqual(client_kwargs_explicit["max_retries"], 1)
        self.assertEqual(client_kwargs_explicit["timeout"], 15.0)
        self.assertEqual(client_kwargs_explicit["http_client"], mock_http)

    def test_openai_chat_completion_persistent_429_http_attempts(self):
        """Asserts total HTTP attempts on a persistent 429 does not multiply.
        With max_retries=2, total HTTP requests must be exactly 3 (1 initial + 2 retries),
        not 3 * 3 = 9.
        """
        attempts = 0

        def handler(request):
            nonlocal attempts
            attempts += 1
            return httpx.Response(
                429,
                headers={"retry-after": "0.001"},
                json={"error": {"message": "Rate limit exceeded", "type": "requests", "code": "rate_limit_exceeded"}},
            )

        transport = httpx.MockTransport(handler)
        mock_http_client = httpx.Client(transport=transport)

        with patch.object(ai_client, "resolve_model_and_provider", return_value=("gpt-4o-mini", "openai")), \
             patch.object(ai_client, "reserve_budget_for_call", return_value=["res-1"]), \
             patch.object(ai_client, "release_reservations") as mock_release, \
             patch.object(ai_client, "resolve_api_key", return_value=("fake-key", "platform")), \
             patch.object(ai_client, "log_ai_usage") as mock_log:

            with self.assertRaises(openai.RateLimitError):
                ai_client.ai_chat_completion(
                    user_id="user_123",
                    project_id=None,
                    agent="test.agent",
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": "hi"}],
                    max_retries=2,
                    http_client=mock_http_client,
                )

            self.assertEqual(attempts, 3, "Expected exactly 3 HTTP attempts (1 initial + 2 retries)")
            mock_log.assert_not_called()
            mock_release.assert_called_once_with(["res-1"])

    def test_openai_chat_completion_zero_retries_makes_single_attempt(self):
        attempts = 0

        def handler(request):
            nonlocal attempts
            attempts += 1
            return httpx.Response(
                429,
                headers={"retry-after": "0.001"},
                json={"error": {"message": "Rate limit exceeded", "type": "requests"}},
            )

        transport = httpx.MockTransport(handler)
        mock_http_client = httpx.Client(transport=transport)

        with patch.object(ai_client, "resolve_model_and_provider", return_value=("gpt-4o-mini", "openai")), \
             patch.object(ai_client, "reserve_budget_for_call", return_value=["res-1"]), \
             patch.object(ai_client, "release_reservations") as mock_release, \
             patch.object(ai_client, "resolve_api_key", return_value=("fake-key", "platform")), \
             patch.object(ai_client, "log_ai_usage") as mock_log:

            with self.assertRaises(openai.RateLimitError):
                ai_client.ai_chat_completion(
                    user_id="user_123",
                    project_id=None,
                    agent="test.agent",
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": "hi"}],
                    max_retries=0,
                    http_client=mock_http_client,
                )

            self.assertEqual(attempts, 1, "Expected single attempt with max_retries=0")
            mock_log.assert_not_called()
            mock_release.assert_called_once_with(["res-1"])

    def test_openai_chat_completion_transient_429_recovers_and_succeeds(self):
        attempts = 0

        def handler(request):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return httpx.Response(
                    429,
                    headers={"retry-after": "0.001"},
                    json={"error": {"message": "Rate limit hit", "type": "requests"}},
                )
            return httpx.Response(
                200,
                json={
                    "id": "chatcmpl-test",
                    "object": "chat.completion",
                    "created": 1234567,
                    "model": "gpt-4o-mini",
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": "Hello from AI"},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {"prompt_tokens": 15, "completion_tokens": 10, "total_tokens": 25},
                },
            )

        transport = httpx.MockTransport(handler)
        mock_http_client = httpx.Client(transport=transport)

        with patch.object(ai_client, "resolve_model_and_provider", return_value=("gpt-4o-mini", "openai")), \
             patch.object(ai_client, "reserve_budget_for_call", return_value=["res-1"]), \
             patch.object(ai_client, "release_reservations") as mock_release, \
             patch.object(ai_client, "resolve_api_key", return_value=("fake-key", "platform")), \
             patch.object(ai_client, "log_ai_usage") as mock_log:

            response = ai_client.ai_chat_completion(
                user_id="user_123",
                project_id=None,
                agent="test.agent",
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": "hi"}],
                max_retries=2,
                http_client=mock_http_client,
            )

            self.assertEqual(attempts, 2, "Expected call to succeed on attempt 2 after 1 retry")
            self.assertEqual(response.choices[0].message.content, "Hello from AI")
            mock_log.assert_called_once()
            mock_release.assert_called_once_with(["res-1"])

    def test_openai_chat_completion_fails_immediately_on_non_retryable_error(self):
        attempts = 0

        def handler(request):
            nonlocal attempts
            attempts += 1
            return httpx.Response(
                401,
                json={"error": {"message": "Invalid authentication", "type": "invalid_request_error"}},
            )

        transport = httpx.MockTransport(handler)
        mock_http_client = httpx.Client(transport=transport)

        with patch.object(ai_client, "resolve_model_and_provider", return_value=("gpt-4o-mini", "openai")), \
             patch.object(ai_client, "reserve_budget_for_call", return_value=["res-1"]), \
             patch.object(ai_client, "release_reservations") as mock_release, \
             patch.object(ai_client, "resolve_api_key", return_value=("fake-key", "platform")), \
             patch.object(ai_client, "log_ai_usage") as mock_log:

            with self.assertRaises(openai.AuthenticationError):
                ai_client.ai_chat_completion(
                    user_id="user_123",
                    project_id=None,
                    agent="test.agent",
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": "hi"}],
                    max_retries=3,
                    http_client=mock_http_client,
                )

            self.assertEqual(attempts, 1, "Permanent 401 error must not be retried")
            mock_log.assert_not_called()
            mock_release.assert_called_once_with(["res-1"])

    def test_anthropic_chat_completion_persistent_529_overloaded_attempts(self):
        """Anthropic 529 OverloadedError is retried natively by the Anthropic SDK."""
        attempts = 0

        def handler(request):
            nonlocal attempts
            attempts += 1
            return httpx2.Response(
                529,
                headers={"retry-after": "0.001"},
                json={"type": "error", "error": {"type": "overloaded_error", "message": "Anthropic is overloaded"}},
            )

        transport = httpx2.MockTransport(handler)
        mock_http_client = httpx2.Client(transport=transport)

        with patch.object(ai_client, "resolve_model_and_provider", return_value=("claude-3-5-sonnet", "anthropic")), \
             patch.object(ai_client, "reserve_budget_for_call", return_value=["res-anthropic"]), \
             patch.object(ai_client, "release_reservations") as mock_release, \
             patch.object(ai_client, "resolve_api_key", return_value=("fake-key", "platform")), \
             patch.object(ai_client, "log_ai_usage") as mock_log:

            with self.assertRaises(anthropic.OverloadedError):
                ai_client.ai_chat_completion(
                    user_id="user_123",
                    project_id=None,
                    agent="test.agent",
                    model="claude-3-5-sonnet",
                    messages=[{"role": "user", "content": "hi"}],
                    max_retries=2,
                    http_client=mock_http_client,
                )

            self.assertEqual(attempts, 3, "Expected 3 attempts (1 initial + 2 retries) on Anthropic 529")
            mock_log.assert_not_called()
            mock_release.assert_called_once_with(["res-anthropic"])

    def test_anthropic_chat_completion_transient_529_recovers_and_succeeds(self):
        attempts = 0

        def handler(request):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return httpx2.Response(
                    529,
                    headers={"retry-after": "0.001"},
                    json={"type": "error", "error": {"type": "overloaded_error", "message": "Anthropic is overloaded"}},
                )
            return httpx2.Response(
                200,
                json={
                    "id": "msg_test",
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "text", "text": "Anthropic success response"}],
                    "model": "claude-3-5-sonnet-20241022",
                    "stop_reason": "end_turn",
                    "usage": {"input_tokens": 12, "output_tokens": 8},
                },
            )

        transport = httpx2.MockTransport(handler)
        mock_http_client = httpx2.Client(transport=transport)

        with patch.object(ai_client, "resolve_model_and_provider", return_value=("claude-3-5-sonnet", "anthropic")), \
             patch.object(ai_client, "reserve_budget_for_call", return_value=["res-anthropic"]), \
             patch.object(ai_client, "release_reservations") as mock_release, \
             patch.object(ai_client, "resolve_api_key", return_value=("fake-key", "platform")), \
             patch.object(ai_client, "log_ai_usage") as mock_log:

            response = ai_client.ai_chat_completion(
                user_id="user_123",
                project_id=None,
                agent="test.agent",
                model="claude-3-5-sonnet",
                messages=[{"role": "user", "content": "hi"}],
                max_retries=2,
                http_client=mock_http_client,
            )

            self.assertEqual(attempts, 2, "Expected call to succeed on attempt 2 after recovering from 529")
            self.assertEqual(response.choices[0].message.content, "Anthropic success response")
            mock_log.assert_called_once()
            mock_release.assert_called_once_with(["res-anthropic"])

    def test_ai_embeddings_persistent_429_http_attempts(self):
        attempts = 0

        def handler(request):
            nonlocal attempts
            attempts += 1
            return httpx.Response(
                429,
                headers={"retry-after": "0.001"},
                json={"error": {"message": "Rate limit exceeded", "type": "requests"}},
            )

        transport = httpx.MockTransport(handler)
        mock_http_client = httpx.Client(transport=transport)

        with patch.object(ai_client, "reserve_budget_for_call", return_value=["res-embed"]), \
             patch.object(ai_client, "release_reservations") as mock_release, \
             patch.object(ai_client, "resolve_api_key", return_value=("fake-key", "platform")), \
             patch.object(ai_client, "log_ai_usage") as mock_log:

            with self.assertRaises(openai.RateLimitError):
                ai_client.ai_embeddings(
                    user_id="user_123",
                    project_id=None,
                    agent="test.embeddings",
                    model="text-embedding-ada-002",
                    input="Sample text",
                    max_retries=2,
                    http_client=mock_http_client,
                )

            self.assertEqual(attempts, 3, "Expected 3 attempts (1 initial + 2 retries) on persistent 429")
            mock_log.assert_not_called()
            mock_release.assert_called_once_with(["res-embed"])

    def test_ai_embeddings_transient_500_recovers_and_succeeds(self):
        attempts = 0

        def handler(request):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return httpx.Response(
                    500,
                    headers={"retry-after": "0.001"},
                    json={"error": {"message": "Internal error", "type": "internal_server_error"}},
                )
            return httpx.Response(
                200,
                json={
                    "object": "list",
                    "data": [{"object": "embedding", "index": 0, "embedding": [0.1, 0.2, 0.3]}],
                    "model": "text-embedding-ada-002",
                    "usage": {"prompt_tokens": 8, "total_tokens": 8},
                },
            )

        transport = httpx.MockTransport(handler)
        mock_http_client = httpx.Client(transport=transport)

        with patch.object(ai_client, "reserve_budget_for_call", return_value=["res-embed"]), \
             patch.object(ai_client, "release_reservations") as mock_release, \
             patch.object(ai_client, "resolve_api_key", return_value=("fake-key", "platform")), \
             patch.object(ai_client, "log_ai_usage") as mock_log:

            response = ai_client.ai_embeddings(
                user_id="user_123",
                project_id=None,
                agent="test.embeddings",
                model="text-embedding-ada-002",
                input="Sample text",
                max_retries=2,
                http_client=mock_http_client,
            )

            self.assertEqual(attempts, 2, "Expected embeddings call to succeed on attempt 2")
            self.assertEqual(response.data[0].embedding, [0.1, 0.2, 0.3])
            mock_log.assert_called_once()
            mock_release.assert_called_once_with(["res-embed"])


class GenerateEmailValidationTests(unittest.TestCase):
    def _get_generate_email_function(self):
        app_file = BACKEND_DIR / "app.py"
        source = app_file.read_text(encoding="utf-8")
        tree = ast.parse(source)

        target_nodes = [
            node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "generate_email_content"
        ]
        module_ast = ast.Module(body=target_nodes, type_ignores=[])
        code = compile(module_ast, filename="<ast_helpers>", mode="exec")
        ns = {"os": MagicMock(), "g": MagicMock()}
        exec(code, ns)
        return ns["generate_email_content"]

    def test_generate_email_content_raises_on_empty_reply(self):
        """When the LLM returns an empty string, safe_parse_json returns {},
        and generate_email_content must raise ValueError rather than returning {}.
        """
        fn = self._get_generate_email_function()
        with patch("core.settings.get_response_language_instruction", return_value=""), \
             patch("core.ai_client.ai_chat_completion") as mock_ai:
            mock_ai.return_value = MagicMock(choices=[MagicMock(message=MagicMock(content=""))])
            with self.assertRaises(ValueError):
                fn({"name": "Acme"}, "Alex")

    def test_generate_email_content_raises_on_missing_subject_or_body(self):
        fn = self._get_generate_email_function()
        with patch("core.settings.get_response_language_instruction", return_value=""), \
             patch("core.ai_client.ai_chat_completion") as mock_ai:
            # Missing body
            mock_ai.return_value = MagicMock(choices=[MagicMock(message=MagicMock(content='{"subject": "Hello"}'))])
            with self.assertRaises(ValueError):
                fn({"name": "Acme"}, "Alex")

            # Missing subject
            mock_ai.return_value = MagicMock(choices=[MagicMock(message=MagicMock(content='{"body": "Hello world"}'))])
            with self.assertRaises(ValueError):
                fn({"name": "Acme"}, "Alex")

    def test_generate_email_content_succeeds_on_valid_payload(self):
        fn = self._get_generate_email_function()
        with patch("core.settings.get_response_language_instruction", return_value=""), \
             patch("core.ai_client.ai_chat_completion") as mock_ai:
            mock_ai.return_value = MagicMock(
                choices=[MagicMock(message=MagicMock(content='{"subject": "Idea for Acme", "body": "Hi there"}'))]
            )
            result = fn({"name": "Acme"}, "Alex")
            self.assertEqual(result, {"subject": "Idea for Acme", "body": "Hi there"})


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
