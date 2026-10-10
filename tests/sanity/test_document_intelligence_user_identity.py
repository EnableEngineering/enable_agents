import ast
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class DocumentIntelligenceUserIdentityAstTests(unittest.TestCase):
    """AST-based structural checks ensuring user_id and project_id are preserved
    across document-intelligence embedding functions and their callers in app.py."""

    @classmethod
    def setUpClass(cls):
        app_file = BACKEND_DIR / "app.py"
        cls.source = app_file.read_text(encoding="utf-8")
        cls.tree = ast.parse(cls.source)
        cls.functions = {
            node.name: node
            for node in ast.walk(cls.tree)
            if isinstance(node, ast.FunctionDef)
        }

    def test_get_embeddings_signature(self):
        self.assertIn("get_embeddings", self.functions)
        args = [arg.arg for arg in self.functions["get_embeddings"].args.args]
        self.assertIn("phrase", args)
        self.assertIn("user_id", args)
        self.assertIn("project_id", args)

    def test_get_embeddings_batch_signature(self):
        self.assertIn("get_embeddings_batch", self.functions)
        args = [arg.arg for arg in self.functions["get_embeddings_batch"].args.args]
        self.assertIn("phrases", args)
        self.assertIn("user_id", args)
        self.assertIn("project_id", args)

    def test_store_embeddings_signature(self):
        self.assertIn("store_embeddings", self.functions)
        args = [arg.arg for arg in self.functions["store_embeddings"].args.args]
        self.assertIn("page_phrases", args)
        self.assertIn("chunk_phrases", args)
        self.assertIn("user_id", args)
        self.assertIn("project_id", args)

    def test_get_embeddings_for_query_signature(self):
        self.assertIn("get_embeddings_for_query", self.functions)
        args = [arg.arg for arg in self.functions["get_embeddings_for_query"].args.args]
        self.assertIn("phrases", args)
        self.assertIn("user_id", args)
        self.assertIn("project_id", args)

    def test_get_embeddings_calls_ai_embeddings_with_user_identity(self):
        fn = self.functions["get_embeddings"]
        calls = [
            node for node in ast.walk(fn)
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "ai_embeddings"
        ]
        self.assertTrue(len(calls) >= 1, "get_embeddings must call ai_embeddings")
        for call in calls:
            kw_names = {kw.arg: kw.value for kw in call.keywords}
            self.assertIn("user_id", kw_names)
            self.assertIn("project_id", kw_names)
            # Must not be None literal
            self.assertIsInstance(kw_names["user_id"], ast.Name)
            self.assertEqual(kw_names["user_id"].id, "user_id")
            self.assertIsInstance(kw_names["project_id"], ast.Name)
            self.assertEqual(kw_names["project_id"].id, "project_id")

    def test_get_embeddings_batch_calls_ai_embeddings_with_user_identity(self):
        fn = self.functions["get_embeddings_batch"]
        calls = [
            node for node in ast.walk(fn)
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "ai_embeddings"
        ]
        self.assertTrue(len(calls) >= 1, "get_embeddings_batch must call ai_embeddings")
        for call in calls:
            kw_names = {kw.arg: kw.value for kw in call.keywords}
            self.assertIn("user_id", kw_names)
            self.assertIn("project_id", kw_names)
            self.assertIsInstance(kw_names["user_id"], ast.Name)
            self.assertEqual(kw_names["user_id"].id, "user_id")
            self.assertIsInstance(kw_names["project_id"], ast.Name)
            self.assertEqual(kw_names["project_id"].id, "project_id")

    def test_get_embeddings_for_query_calls_ai_embeddings_with_user_identity(self):
        fn = self.functions["get_embeddings_for_query"]
        calls = [
            node for node in ast.walk(fn)
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "ai_embeddings"
        ]
        self.assertTrue(len(calls) >= 1, "get_embeddings_for_query must call ai_embeddings")
        for call in calls:
            kw_names = {kw.arg: kw.value for kw in call.keywords}
            self.assertIn("user_id", kw_names)
            self.assertIn("project_id", kw_names)
            self.assertIsInstance(kw_names["user_id"], ast.Name)
            self.assertEqual(kw_names["user_id"].id, "user_id")
            self.assertIsInstance(kw_names["project_id"], ast.Name)
            self.assertEqual(kw_names["project_id"].id, "project_id")

    def test_store_embeddings_threads_user_identity_to_batch(self):
        fn = self.functions["store_embeddings"]
        calls = [
            node for node in ast.walk(fn)
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "get_embeddings_batch"
        ]
        self.assertTrue(len(calls) >= 1, "store_embeddings must call get_embeddings_batch")
        for call in calls:
            kw_names = {kw.arg: kw.value for kw in call.keywords}
            self.assertIn("user_id", kw_names)
            self.assertIn("project_id", kw_names)
            self.assertIsInstance(kw_names["user_id"], ast.Name)
            self.assertEqual(kw_names["user_id"].id, "user_id")
            self.assertIsInstance(kw_names["project_id"], ast.Name)
            self.assertEqual(kw_names["project_id"].id, "project_id")

    def test_rag_test_threads_user_identity_to_embeddings(self):
        fn = self.functions["rag_test"]
        store_calls = [
            node for node in ast.walk(fn)
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "store_embeddings"
        ]
        self.assertTrue(len(store_calls) >= 1, "rag_test must call store_embeddings")
        for call in store_calls:
            kw_names = {kw.arg: kw.value for kw in call.keywords}
            self.assertIn("user_id", kw_names)
            self.assertIn("project_id", kw_names)

        query_calls = [
            node for node in ast.walk(fn)
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "get_embeddings_for_query"
        ]
        self.assertTrue(len(query_calls) >= 1, "rag_test must call get_embeddings_for_query")
        for call in query_calls:
            kw_names = {kw.arg: kw.value for kw in call.keywords}
            self.assertIn("user_id", kw_names)
            self.assertIn("project_id", kw_names)

    def test_chat_api_threads_user_identity_to_query_embeddings(self):
        fn = self.functions["chat_api"]
        query_calls = [
            node for node in ast.walk(fn)
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "get_embeddings_for_query"
        ]
        self.assertTrue(len(query_calls) >= 1, "chat_api must call get_embeddings_for_query")
        for call in query_calls:
            kw_names = {kw.arg: kw.value for kw in call.keywords}
            self.assertIn("user_id", kw_names)
            self.assertIn("project_id", kw_names)


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
    def test_get_embeddings_fallback_to_g(self, mock_ai_embeddings):
        import flask
        ns = self._compile_functions()
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.1, 0.2, 0.3])]
        mock_ai_embeddings.return_value = mock_response

        app = flask.Flask("test")
        with app.test_request_context():
            flask.g.user_id = "user_g_ctx"
            flask.g.project_id = "proj_g_ctx"
            fn = ns["get_embeddings"]
            fn("test phrase")

        mock_ai_embeddings.assert_called_once()
        kwargs = mock_ai_embeddings.call_args.kwargs
        self.assertEqual(kwargs.get("user_id"), "user_g_ctx")
        self.assertEqual(kwargs.get("project_id"), "proj_g_ctx")

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
    def test_get_embeddings_batch_fallback_to_g(self, mock_ai_embeddings):
        import flask
        ns = self._compile_functions()
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.1])]
        mock_ai_embeddings.return_value = mock_response

        app = flask.Flask("test")
        with app.test_request_context():
            flask.g.user_id = "user_g_batch"
            flask.g.project_id = "proj_g_batch"
            fn = ns["get_embeddings_batch"]
            fn(["phrase1"])

        mock_ai_embeddings.assert_called_once()
        kwargs = mock_ai_embeddings.call_args.kwargs
        self.assertEqual(kwargs.get("user_id"), "user_g_batch")
        self.assertEqual(kwargs.get("project_id"), "proj_g_batch")

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
    def test_get_embeddings_for_query_fallback_to_g(self, mock_ai_embeddings):
        import flask
        ns = self._compile_functions()
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.1, 0.2, 0.3])]
        mock_ai_embeddings.return_value = mock_response

        app = flask.Flask("test")
        with app.test_request_context():
            flask.g.user_id = "user_g_q"
            flask.g.project_id = "proj_g_q"
            fn = ns["get_embeddings_for_query"]
            fn(["query phrase"])

        mock_ai_embeddings.assert_called_once()
        kwargs = mock_ai_embeddings.call_args.kwargs
        self.assertEqual(kwargs.get("user_id"), "user_g_q")
        self.assertEqual(kwargs.get("project_id"), "proj_g_q")

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

