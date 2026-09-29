"""Unit and integration tests for Document Intelligence Retrieval Cache."""
import time
import unittest
from unittest.mock import MagicMock, patch

from agents.document_intelligence.retrieval import (
    RetrievalCache,
    DocumentRetriever,
    invalidate_retrieval_cache,
    _global_retrieval_cache,
)


class TestRetrievalCache(unittest.TestCase):
    def setUp(self):
        self.cache = RetrievalCache(max_size=3, ttl_seconds=1)

    def test_cache_miss_and_set(self):
        result = self.cache.get("test query", "user1", ["doc1"], 5, 0.2)
        self.assertIsNone(result)

        dummy_chunks = [{"chunk_id": "c1", "content": "hello", "score": 0.9}]
        self.cache.set("test query", "user1", ["doc1"], 5, 0.2, dummy_chunks)

        cached = self.cache.get("test query", "user1", ["doc1"], 5, 0.2)
        self.assertIsNotNone(cached)
        self.assertEqual(len(cached), 1)
        self.assertEqual(cached[0]["chunk_id"], "c1")

    def test_cache_ttl_expiration(self):
        dummy_chunks = [{"chunk_id": "c1", "content": "hello", "score": 0.9}]
        self.cache.set("query", "user1", ["doc1"], 5, 0.2, dummy_chunks)
        time.sleep(1.1)

        result = self.cache.get("query", "user1", ["doc1"], 5, 0.2)
        self.assertIsNone(result)

    def test_cache_lru_eviction(self):
        self.cache.set("q1", "user1", ["doc1"], 5, 0.2, [{"chunk_id": "1"}])
        self.cache.set("q2", "user1", ["doc1"], 5, 0.2, [{"chunk_id": "2"}])
        self.cache.set("q3", "user1", ["doc1"], 5, 0.2, [{"chunk_id": "3"}])
        # Max size is 3, adding 4th should evict q1
        self.cache.set("q4", "user1", ["doc1"], 5, 0.2, [{"chunk_id": "4"}])

        self.assertIsNone(self.cache.get("q1", "user1", ["doc1"], 5, 0.2))
        self.assertIsNotNone(self.cache.get("q4", "user1", ["doc1"], 5, 0.2))

    def test_cache_invalidation_by_document_id(self):
        self.cache.set("q1", "user1", ["doc1"], 5, 0.2, [{"chunk_id": "1"}])
        self.cache.set("q2", "user1", ["doc2"], 5, 0.2, [{"chunk_id": "2"}])

        self.cache.invalidate("doc1")
        self.assertIsNone(self.cache.get("q1", "user1", ["doc1"], 5, 0.2))
        self.assertIsNotNone(self.cache.get("q2", "user1", ["doc2"], 5, 0.2))

    def test_document_retriever_uses_cache(self):
        _global_retrieval_cache.invalidate()

        retriever = DocumentRetriever()
        mock_chunks = [{"chunk_id": "c1", "content": "financial data", "score": 0.85}]

        with patch.object(retriever.vector_store, 'search', return_value=mock_chunks) as mock_search:
            # First search: cache miss -> calls vector_store.search
            res1 = retriever.search("revenue in 2024", "user123", ["docA"], top_k=3, min_score=0.2)
            self.assertEqual(len(res1), 1)
            self.assertEqual(mock_search.call_count, 1)

            # Second identical search: cache hit -> does NOT call vector_store.search
            res2 = retriever.search("revenue in 2024", "user123", ["docA"], top_k=3, min_score=0.2)
            self.assertEqual(len(res2), 1)
            self.assertEqual(mock_search.call_count, 1)

            # Bypass cache: forces call to vector_store.search
            res3 = retriever.search("revenue in 2024", "user123", ["docA"], top_k=3, min_score=0.2, bypass_cache=True)
            self.assertEqual(len(res3), 1)
            self.assertEqual(mock_search.call_count, 2)


if __name__ == '__main__':
    unittest.main()
