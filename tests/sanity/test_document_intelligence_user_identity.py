import ast
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class DocumentIntelligenceFunctionalTests(unittest.TestCase):
    """Functional tests by compiling target AST nodes in a clean namespace
    and testing mock execution with explicit parameters and g fallback."""

    def _compile_functions(self):
        app_file = BACKEND_DIR / "app.py"
        source = app_file.read_text(encoding="utf-8")
        tree = ast.parse(source)

        target_names = {
            "get_embeddings",
            "get_embeddings_batch",
            "store_embeddings",
            "get_embeddings_for_query",
        }
        target_nodes = [
            node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name in target_names
        ]

        module_ast = ast.Module(body=target_nodes, type_ignores=[])
        code = compile(module_ast, filename="<ast_helpers>", mode="exec")

        fake_g = MagicMock()
        import faiss
        import flask
        import numpy as np

        ns = {
            "g": flask.g,
            "faiss": faiss,
            "np": np,
            "print": lambda *args, **kwargs: None,
        }

        exec(code, ns)
        return ns

    @patch("core.ai_client.ai_embeddings")
    def test_get_embeddings_explicit_args(self, mock_ai_embeddings):
        ns = self._compile_functions()
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.1, 0.2, 0.3])]
        mock_ai_embeddings.return_value = mock_response

        fn = ns["get_embeddings"]
        res = fn("test phrase", user_id="user_123", project_id="proj_456")
        self.assertEqual(res, [0.1, 0.2, 0.3])

        mock_ai_embeddings.assert_called_once()
        kwargs = mock_ai_embeddings.call_args.kwargs
        self.assertEqual(kwargs.get("user_id"), "user_123")
        self.assertEqual(kwargs.get("project_id"), "proj_456")
        self.assertEqual(kwargs.get("input"), "test phrase")

    @patch("core.ai_client.ai_embeddings")
    def test_get_embeddings_batch_explicit_args(self, mock_ai_embeddings):
        ns = self._compile_functions()
        mock_response = MagicMock()
        mock_response.data = [
            MagicMock(embedding=[0.1, 0.2]),
            MagicMock(embedding=[0.3, 0.4]),
        ]
        mock_ai_embeddings.return_value = mock_response

        fn = ns["get_embeddings_batch"]
        res = fn(["phrase1", "phrase2"], user_id="user_batch", project_id="proj_batch")
        self.assertEqual(len(res), 2)

        mock_ai_embeddings.assert_called_once()
        kwargs = mock_ai_embeddings.call_args.kwargs
        self.assertEqual(kwargs.get("user_id"), "user_batch")
        self.assertEqual(kwargs.get("project_id"), "proj_batch")
        self.assertEqual(kwargs.get("input"), ["phrase1", "phrase2"])

    @patch("core.ai_client.ai_embeddings")
    def test_get_embeddings_for_query_explicit_args(self, mock_ai_embeddings):
        ns = self._compile_functions()
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.1, 0.2, 0.3])]
        mock_ai_embeddings.return_value = mock_response

        fn = ns["get_embeddings_for_query"]
        res = fn(["query phrase 1", "query phrase 2"], user_id="user_q", project_id="proj_q")
        self.assertEqual(len(res), 2)
        self.assertEqual(mock_ai_embeddings.call_count, 2)

        for call in mock_ai_embeddings.call_args_list:
            kwargs = call.kwargs
            self.assertEqual(kwargs.get("user_id"), "user_q")
            self.assertEqual(kwargs.get("project_id"), "proj_q")

    @patch("core.ai_client.ai_embeddings")
    def test_store_embeddings_forwards_user_identity(self, mock_ai_embeddings):
        ns = self._compile_functions()
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.1, 0.2, 0.3])]
        mock_ai_embeddings.return_value = mock_response

        fn = ns["store_embeddings"]
        page_phrases = {1: ["p1"]}
        chunk_phrases = {(1, 1): ["c1"]}

        index, phrase_embeddings = fn(
            page_phrases, chunk_phrases, user_id="user_store", project_id="proj_store"
        )
        self.assertIsNotNone(index)
        self.assertIn((1, 1), phrase_embeddings)

        mock_ai_embeddings.assert_called_once()
        kwargs = mock_ai_embeddings.call_args.kwargs
        self.assertEqual(kwargs.get("user_id"), "user_store")
        self.assertEqual(kwargs.get("project_id"), "proj_store")


if __name__ == "__main__":
    unittest.main()

