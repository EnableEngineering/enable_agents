"""
Document Intelligence Agent — Semantic chunking utilities.

Adapted from DDA patterns with simplifications for Enable Agents.
"""

import logging
import re
from typing import Dict, List, Optional, Tuple, Any

logger = logging.getLogger(__name__)


class ChunkingConfig:
    """Chunking configuration with reasonable defaults."""

    # Default chunk sizes (characters)
    DEFAULT_CHUNK_SIZE = 1000  # ~250 tokens
    DEFAULT_OVERLAP = 200  # 20% overlap

    # Size ranges
    MIN_CHUNK_SIZE = 200
    MAX_CHUNK_SIZE = 4000

    # Sentence boundary markers
    SENTENCE_ENDINGS = re.compile(r"[.!?]\s+")


def create_semantic_chunks(
    content: str,
    chunk_size: int = ChunkingConfig.DEFAULT_CHUNK_SIZE,
    overlap: int = ChunkingConfig.DEFAULT_OVERLAP,
    preserve_sentences: bool = True,
) -> List[Dict[str, Any]]:
    """
    Create overlapping chunks with semantic awareness.

    Args:
        content: Full text content to chunk
        chunk_size: Target size per chunk (characters)
        overlap: Overlap between chunks (characters)
        preserve_sentences: Try to break at sentence boundaries

    Returns:
        List of chunk dicts with 'content', 'start_char', 'end_char'
    """
    if not content or not content.strip():
        return []

    # Validate parameters
    chunk_size = max(ChunkingConfig.MIN_CHUNK_SIZE, min(chunk_size, ChunkingConfig.MAX_CHUNK_SIZE))
    overlap = min(overlap, chunk_size // 2)

    # Handle small documents
    if len(content) <= chunk_size:
        return [{"content": content.strip(), "start_char": 0, "end_char": len(content), "chunk_index": 0}]

    chunks = []
    start = 0
    chunk_index = 0

    while start < len(content):
        # Calculate end position
        end = min(start + chunk_size, len(content))

        # Try to preserve sentence boundaries
        if preserve_sentences and end < len(content):
            # Look for sentence ending in the last portion of the chunk.
            # The lookback window must stay smaller than chunk_size, or it
            # degenerates into searching the *entire* prospective chunk
            # (chunk_size <= 200 used to hit exactly this, since 200 was
            # hardcoded here too) - matching the first sentence ending
            # anywhere in the chunk instead of near its end, producing tiny
            # "runt" chunks that then feed the stride bug fixed below.
            search_start = max(start, end - min(200, chunk_size // 2))
            search_text = content[search_start:end]

            # Find last sentence ending
            matches = list(ChunkingConfig.SENTENCE_ENDINGS.finditer(search_text))
            if matches:
                last_match = matches[-1]
                # Adjust end to after the sentence ending
                end = search_start + last_match.end()

        # Extract chunk content
        chunk_content = content[start:end].strip()

        if chunk_content:
            chunks.append({
                "content": chunk_content,
                "start_char": start,
                "end_char": end,
                "chunk_index": chunk_index,
            })
            chunk_index += 1

        # Move start with overlap. A short/runt chunk (sentence-boundary
        # snap landed close to `start`) can make `end - overlap` fall at or
        # before `start` - the old fallback then advanced from `start`
        # rather than `end`, which could jump *past* `end` and silently
        # drop every character in between from every chunk. Advancing from
        # `end` instead guarantees full coverage: overlap can shrink to
        # zero for this one step, but nothing between chunks is ever lost.
        new_start = end - overlap
        if new_start <= start:
            new_start = end
        start = new_start

        # Safety check
        if chunk_index > 10000:
            logger.warning("Chunking safety limit reached, stopping")
            break

    logger.info(f"Created {len(chunks)} chunks from {len(content)} characters")
    return chunks


def create_paragraph_chunks(
    content: str,
    min_chunk_size: int = 200,
    max_chunk_size: int = 2000,
) -> List[Dict[str, Any]]:
    """
    Create chunks based on paragraph boundaries.

    Args:
        content: Full text content
        min_chunk_size: Minimum characters per chunk
        max_chunk_size: Maximum characters per chunk

    Returns:
        List of chunk dicts
    """
    if not content or not content.strip():
        return []

    # Split by double newlines (paragraphs)
    paragraphs = re.split(r"\n\s*\n", content)
    paragraphs = [p.strip() for p in paragraphs if p.strip()]

    chunks = []
    current_chunk = []
    current_size = 0
    chunk_index = 0
    start_char = 0

    for para in paragraphs:
        para_size = len(para)

        # If single paragraph exceeds max, split it
        if para_size > max_chunk_size:
            # Flush current chunk first
            if current_chunk:
                chunk_content = "\n\n".join(current_chunk)
                chunks.append({
                    "content": chunk_content,
                    "start_char": start_char,
                    "end_char": start_char + len(chunk_content),
                    "chunk_index": chunk_index,
                })
                chunk_index += 1
                start_char += len(chunk_content) + 2
                current_chunk = []
                current_size = 0

            # Split large paragraph using sentence chunking
            sub_chunks = create_semantic_chunks(para, chunk_size=max_chunk_size, overlap=100)
            for sub in sub_chunks:
                sub["chunk_index"] = chunk_index
                sub["start_char"] = start_char + sub["start_char"]
                sub["end_char"] = start_char + sub["end_char"]
                chunks.append(sub)
                chunk_index += 1
            start_char += para_size + 2
            continue

        # Check if adding this paragraph would exceed max
        if current_size + para_size + 2 > max_chunk_size and current_size >= min_chunk_size:
            # Flush current chunk
            chunk_content = "\n\n".join(current_chunk)
            chunks.append({
                "content": chunk_content,
                "start_char": start_char,
                "end_char": start_char + len(chunk_content),
                "chunk_index": chunk_index,
            })
            chunk_index += 1
            start_char += len(chunk_content) + 2
            current_chunk = []
            current_size = 0

        # Add paragraph to current chunk
        current_chunk.append(para)
        current_size += para_size + 2

    # Flush remaining
    if current_chunk:
        chunk_content = "\n\n".join(current_chunk)
        chunks.append({
            "content": chunk_content,
            "start_char": start_char,
            "end_char": start_char + len(chunk_content),
            "chunk_index": chunk_index,
        })

    logger.info(f"Created {len(chunks)} paragraph-based chunks")
    return chunks


def estimate_token_count(text: str) -> int:
    """
    Estimate token count for text (rough approximation).

    Uses ~4 characters per token heuristic for English text.
    """
    return len(text) // 4


def get_adaptive_chunk_config(
    document_size: int,
    target_chunks: int = 20,
) -> Tuple[int, int]:
    """
    Calculate adaptive chunk size based on document size.

    Args:
        document_size: Document size in characters
        target_chunks: Target number of chunks

    Returns:
        Tuple of (chunk_size, overlap)
    """
    if document_size <= 0:
        return ChunkingConfig.DEFAULT_CHUNK_SIZE, ChunkingConfig.DEFAULT_OVERLAP

    # Calculate ideal chunk size
    ideal_size = document_size // target_chunks

    # Clamp to valid range
    chunk_size = max(
        ChunkingConfig.MIN_CHUNK_SIZE,
        min(ideal_size, ChunkingConfig.MAX_CHUNK_SIZE)
    )

    # Overlap is 15-20% of chunk size
    overlap = int(chunk_size * 0.15)

    return chunk_size, overlap
