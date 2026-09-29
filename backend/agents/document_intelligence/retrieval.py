"""
Document Intelligence Agent — Retrieval utilities.

Provides:
- pgvector similarity search
- Optional NetworkX graph entity boost
- Context assembly for LLM
"""

from collections import OrderedDict
import hashlib
import logging
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from core.vector_store import VectorStore

logger = logging.getLogger(__name__)


class RetrievalCache:
    """Thread-safe in-memory LRU cache with TTL for document retrieval queries.

    Avoids redundant embeddings API calls and database vector distance searches
    when users ask identical or repeated questions across sessions.
    """

    def __init__(self, max_size: int = 256, ttl_seconds: int = 600):
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        # _cache: key -> (timestamp, doc_ids_set, results)
        self._cache: OrderedDict[str, Tuple[float, set, List[Dict[str, Any]]]] = OrderedDict()
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0

    def _generate_key(
        self,
        query: str,
        user_id: str,
        document_ids: Optional[List[str]],
        top_k: int,
        min_score: float,
    ) -> str:
        norm_query = query.strip().lower()
        query_hash = hashlib.sha256(norm_query.encode("utf-8")).hexdigest()
        doc_key = ",".join(sorted(document_ids)) if document_ids else "all"
        return f"{user_id}:{doc_key}:{top_k}:{min_score:.2f}:{query_hash}"

    def get(
        self,
        query: str,
        user_id: str,
        document_ids: Optional[List[str]],
        top_k: int,
        min_score: float,
    ) -> Optional[List[Dict[str, Any]]]:
        key = self._generate_key(query, user_id, document_ids, top_k, min_score)
        now = time.time()

        with self._lock:
            if key in self._cache:
                timestamp, _, results = self._cache[key]
                if now - timestamp < self.ttl_seconds:
                    self._cache.move_to_end(key)
                    self._hits += 1
                    logger.debug("Retrieval cache hit for query key: %s", key)
                    return [dict(r) for r in results]
                else:
                    del self._cache[key]

            self._misses += 1
            return None

    def set(
        self,
        query: str,
        user_id: str,
        document_ids: Optional[List[str]],
        top_k: int,
        min_score: float,
        results: List[Dict[str, Any]],
    ) -> None:
        key = self._generate_key(query, user_id, document_ids, top_k, min_score)
        now = time.time()
        doc_set = set(document_ids or [])

        with self._lock:
            while len(self._cache) >= self.max_size:
                self._cache.popitem(last=False)
            self._cache[key] = (now, doc_set, [dict(r) for r in results])
            self._cache.move_to_end(key)

    def invalidate(self, document_id: Optional[str] = None) -> None:
        """Invalidate cache entries for a specific document or all documents."""
        with self._lock:
            if document_id is None:
                self._cache.clear()
                logger.info("Retrieval cache cleared completely.")
                return

            keys_to_remove = [
                k
                for k, (_, doc_set, _) in self._cache.items()
                if not doc_set or document_id in doc_set
            ]
            for k in keys_to_remove:
                del self._cache[k]
            if keys_to_remove:
                logger.info(
                    "Invalidated %d cache entries for document %s",
                    len(keys_to_remove),
                    document_id,
                )

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "hits": self._hits,
                "misses": self._misses,
                "size": len(self._cache),
                "max_size": self.max_size,
                "ttl_seconds": self.ttl_seconds,
            }


# Global retrieval cache instance
_global_retrieval_cache = RetrievalCache()


def invalidate_retrieval_cache(document_id: Optional[str] = None) -> None:
    """Invalidate cached retrieval results for a document or globally."""
    _global_retrieval_cache.invalidate(document_id)


class DocumentRetriever:
    """Retrieval service combining vector search with optional entity boost."""

    def __init__(self):
        self.vector_store = VectorStore()

    def search(
        self,
        query: str,
        user_id: str,
        document_ids: Optional[List[str]] = None,
        top_k: int = 5,
        min_score: float = 0.0,
        bypass_cache: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Search for relevant document chunks.

        Args:
            query: Search query text
            user_id: User ID for access control
            document_ids: Optional filter to specific documents
            top_k: Number of results to return
            min_score: Minimum similarity score (0-1)

        Returns:
            List of relevant chunks with scores
        """
        # Check retrieval cache first to avoid re-embedding and pgvector distance queries
        if not bypass_cache:
            cached_results = _global_retrieval_cache.get(
                query=query,
                user_id=user_id,
                document_ids=document_ids,
                top_k=top_k,
                min_score=min_score,
            )
            if cached_results is not None:
                return cached_results

        # Perform vector search
        results = self.vector_store.search(
            query=query,
            top_k=top_k,
            document_ids=document_ids,
            user_id=user_id,
            threshold=min_score,
        )

        # Cache non-empty successful searches
        if not bypass_cache and results:
            _global_retrieval_cache.set(
                query=query,
                user_id=user_id,
                document_ids=document_ids,
                top_k=top_k,
                min_score=min_score,
                results=results,
            )

        return results

    def get_context_for_query(
        self,
        query: str,
        user_id: str,
        document_ids: Optional[List[str]] = None,
        max_chunks: int = 5,
        max_tokens: int = 3000,
    ) -> Dict[str, Any]:
        """
        Get assembled context for LLM query.

        Args:
            query: User query
            user_id: User ID
            document_ids: Optional document filter
            max_chunks: Maximum number of chunks to include
            max_tokens: Approximate token limit (~4 chars/token)

        Returns:
            Dict with 'context', 'sources', 'chunk_count'
        """
        # Search for relevant chunks
        # Use lower threshold (0.2) to capture more potentially relevant content
        results = self.search(
            query=query,
            user_id=user_id,
            document_ids=document_ids,
            top_k=max_chunks * 2,  # Get extra for filtering
            min_score=0.2,
        )

        if not results:
            return {
                "context": "",
                "sources": [],
                "chunk_count": 0,
            }

        # Assemble context within token limit
        context_parts = []
        sources = []
        total_chars = 0
        max_chars = max_tokens * 4

        for chunk in results[:max_chunks]:
            content = chunk.get("content", "")

            # Check token limit
            if total_chars + len(content) > max_chars:
                # Truncate this chunk
                remaining = max_chars - total_chars
                if remaining > 200:
                    content = content[:remaining] + "..."
                else:
                    break

            context_parts.append(content)
            total_chars += len(content)

            sources.append({
                "chunk_id": chunk.get("chunk_id"),
                "document_id": chunk.get("document_id"),
                "chunk_index": chunk.get("chunk_index"),
                "score": chunk.get("score"),
            })

        return {
            "context": "\n\n---\n\n".join(context_parts),
            "sources": sources,
            "chunk_count": len(sources),
        }

    def get_entity_enhanced_context(
        self,
        query: str,
        user_id: str,
        document_ids: Optional[List[str]] = None,
        max_chunks: int = 5,
    ) -> Dict[str, Any]:
        """
        Get context with entity-enhanced retrieval.

        First extracts key entities from query, then boosts chunks
        containing those entities.

        Args:
            query: User query
            user_id: User ID
            document_ids: Optional document filter
            max_chunks: Maximum chunks to return

        Returns:
            Dict with context and sources
        """
        from agents.document_intelligence.models import DocumentEntity

        # Get base vector search results
        base_results = self.search(
            query=query,
            user_id=user_id,
            document_ids=document_ids,
            top_k=max_chunks * 3,
            min_score=0.2,
        )

        if not base_results:
            return self.get_context_for_query(
                query=query,
                user_id=user_id,
                document_ids=document_ids,
                max_chunks=max_chunks,
            )

        # Extract query terms for entity matching
        query_terms = set(query.lower().split())

        # Find matching entities
        chunk_entity_counts: Dict[str, int] = {}

        for result in base_results:
            chunk_id = result.get("chunk_id")
            doc_id = result.get("document_id")

            # Find entities in this document that match query terms
            entities = DocumentEntity.query.filter_by(document_id=doc_id).all()

            for entity in entities:
                entity_terms = set(entity.entity_name.lower().split())
                if query_terms & entity_terms:
                    # Entity matches query, boost chunks containing it
                    for cid in entity.chunk_ids:
                        chunk_entity_counts[cid] = chunk_entity_counts.get(cid, 0) + 1

        # Re-score results with entity boost
        for result in base_results:
            chunk_id = result.get("chunk_id")
            entity_boost = chunk_entity_counts.get(chunk_id, 0) * 0.1
            result["score"] = result.get("score", 0) + entity_boost

        # Sort by boosted score
        base_results.sort(key=lambda x: x.get("score", 0), reverse=True)

        # Assemble context
        context_parts = []
        sources = []

        for chunk in base_results[:max_chunks]:
            context_parts.append(chunk.get("content", ""))
            sources.append({
                "chunk_id": chunk.get("chunk_id"),
                "document_id": chunk.get("document_id"),
                "chunk_index": chunk.get("chunk_index"),
                "score": chunk.get("score"),
            })

        return {
            "context": "\n\n---\n\n".join(context_parts),
            "sources": sources,
            "chunk_count": len(sources),
        }
