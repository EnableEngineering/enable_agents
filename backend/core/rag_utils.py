"""Shared RAG utilities for document chunking, embedding, and FAISS retrieval."""

from typing import Any, Callable, Dict, List, Optional

import faiss
import numpy as np


def split_documents(
    documents: List[str],
    chunk_size: int = 1000,
    overlap: int = 200,
    track_source: bool = False,
) -> List[Dict[str, Any]]:
    """Split documents into chunks with optional source tracking.

    Args:
        documents: List of text documents to chunk
        chunk_size: Target chunk size in characters
        overlap: Overlap between consecutive chunks in characters
        track_source: If True, include document_index metadata for each chunk

    Returns:
        List of chunk dictionaries with 'content' and optional 'document_index'
    """
    chunks = []
    for document_index, text in enumerate(documents):
        text = (text or "").strip()
        start = 0
        while start < len(text):
            end = min(start + chunk_size, len(text))
            if end < len(text):
                # Try to break at word boundary
                boundary = text.rfind(" ", start + int(chunk_size * 0.67), end)
                if boundary > start:
                    end = boundary
            chunk = text[start:end].strip()
            if chunk:
                chunk_dict = {"content": chunk}
                if track_source:
                    chunk_dict["document_index"] = document_index
                chunks.append(chunk_dict)
            if end >= len(text):
                break
            start = max(end - overlap, start + 1)
    return chunks


def create_embeddings(
    chunks: List[str],
    user_id: Optional[str] = None,
    project_id: Optional[str] = None,
    agent: str = "rag_embeddings",
    batch_size: int = 500,
    embedding_fn: Optional[Callable[[List[str]], List[List[float]]]] = None,
) -> np.ndarray:
    """Generate embeddings for text chunks.

    Args:
        chunks: List of text chunks to embed
        user_id: User ID for ai_embeddings calls (uses core.ai_client if provided)
        project_id: Project ID for ai_embeddings calls
        agent: Agent name for usage logging
        batch_size: Batch size for ai_embeddings (only used when user_id is provided)
        embedding_fn: Custom embedding function. If None and user_id is provided,
                      uses core.ai_client.ai_embeddings; otherwise uses LangChain's
                      OpenAIEmbeddings

    Returns:
        2D numpy array of embeddings (float32)
    """
    if embedding_fn is not None:
        embeddings = embedding_fn(chunks)
        return np.asarray(embeddings, dtype="float32")

    if user_id is not None:
        # Use ai_embeddings with batching for better cost tracking
        from core.ai_client import ai_embeddings

        all_embeddings = []
        for batch_start in range(0, len(chunks), batch_size):
            batch_end = min(batch_start + batch_size, len(chunks))
            batch = chunks[batch_start:batch_end]
            response = ai_embeddings(
                user_id=user_id,
                project_id=project_id,
                agent=agent,
                model="text-embedding-ada-002",
                input=batch,
            )
            all_embeddings.extend([item.embedding for item in response.data])
        return np.asarray(all_embeddings, dtype="float32")
    else:
        # Fall back to LangChain for backward compatibility
        from langchain_openai import OpenAIEmbeddings

        embeddings_model = OpenAIEmbeddings()
        embeddings = embeddings_model.embed_documents(chunks)
        return np.asarray(embeddings, dtype="float32")


def build_faiss_index(
    embeddings: np.ndarray,
    index_type: str = "L2",
    normalize: bool = False,
) -> faiss.Index:
    """Build a FAISS index from embeddings.

    Args:
        embeddings: 2D numpy array of embeddings (float32)
        index_type: "L2" for L2 distance or "IP" for inner product
        normalize: If True, normalize vectors before building index (required for IP)

    Returns:
        FAISS index ready for search
    """
    embeddings = embeddings.astype("float32")

    if normalize:
        faiss.normalize_L2(embeddings)

    dimension = embeddings.shape[1]
    if index_type == "IP":
        index = faiss.IndexFlatIP(dimension)
    else:
        index = faiss.IndexFlatL2(dimension)

    index.add(embeddings)
    return index


def retrieve_relevant_chunks(
    query: str,
    index: faiss.Index,
    chunks: List[Dict[str, Any]],
    embedding_fn: Callable[[List[str]], List[List[float]]],
    top_k: int = 5,
    normalize: bool = False,
) -> List[Dict[str, Any]]:
    """Retrieve the most relevant chunks using FAISS similarity search.

    Args:
        query: Query string to search for
        index: FAISS index built from document chunks
        chunks: Original chunk dictionaries (with 'content' key)
        embedding_fn: Function to embed the query string
        top_k: Number of results to retrieve
        normalize: If True, normalize query vector (must match index building)

    Returns:
        List of top-k relevant chunks from the original chunk list
    """
    # Embed the query
    query_embedding = embedding_fn([query])[0]
    query_vector = np.asarray([query_embedding], dtype="float32")

    if normalize:
        faiss.normalize_L2(query_vector)

    # Search the index
    _, indices = index.search(query_vector, min(top_k, len(chunks)))

    # Return matching chunks
    return [chunks[idx] for idx in indices[0] if idx >= 0]
