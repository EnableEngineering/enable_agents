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


if __name__ == "__main__":
    unittest.main()
