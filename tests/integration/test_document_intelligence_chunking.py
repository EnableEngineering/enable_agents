"""Regression tests for create_semantic_chunks()'s coverage bug.

Found 2026-09-14 via the eval suite (backend/eval/): 5 real facts present
in fixture documents (a percentage figure on its own short "Label: fact."
sentence, in each case) were never retrievable by document_intelligence_chat
even though it claimed to search the document. Root cause was in chunking,
not retrieval - create_semantic_chunks' stride-advance fallback could jump
`start` past a runt chunk's `end`, silently dropping every character in
between from every chunk. A secondary contributor: the sentence-boundary
lookback window degenerated to searching the *entire* chunk (not just its
last portion) whenever chunk_size <= 200, producing the runt chunks that
triggered the drop in the first place.

Pure-function tests - no Flask app, no DB, mirrors this file's own
dependency-free surface.
"""
from agents.document_intelligence.chunking import create_semantic_chunks


def _uncovered_chars(content: str, chunks: list) -> list:
    covered = [False] * len(content)
    for c in chunks:
        for i in range(c["start_char"], c["end_char"]):
            covered[i] = True
    return [i for i, hit in enumerate(covered) if not hit]


def test_no_dropped_content_at_the_documented_chunk_size():
    """chunk_size=200 is exactly the value that used to make the
    sentence-boundary lookback degenerate (search_start collapsed to
    `start`), which is what produced the runt chunks that triggered the
    drop bug - this is the regression case, not a synthetic edge case."""
    content = (
        "Company overview: this is the first paragraph, several sentences long, "
        "describing the business in general terms for context. "
        "Occupancy: portfolio-wide occupancy currently sits at 94%, with average "
        "tenant turnover time of 18 days, which we consider healthy for this market. "
        "Additional details about operations follow here, covering staffing, "
        "maintenance schedules, and other day-to-day concerns for the property. "
        "Emergency response: our team targets a 2 hour response time for urgent "
        "maintenance requests reported by tenants around the clock every day."
    )
    chunks = create_semantic_chunks(content, chunk_size=200, overlap=30)

    assert _uncovered_chars(content, chunks) == []
    assert any("94%" in c["content"] for c in chunks), "the fact-bearing sentence must survive in some chunk"


def test_no_dropped_content_across_a_range_of_chunk_sizes():
    """The stride-advance fix must hold generally, not just at the one
    chunk_size that happened to trigger the original bug."""
    content = "".join(f"Sentence number {n} contains fact {n}. " for n in range(80))

    for chunk_size, overlap in [(50, 10), (100, 15), (150, 20), (200, 30), (400, 50)]:
        chunks = create_semantic_chunks(content, chunk_size=chunk_size, overlap=overlap)
        gaps = _uncovered_chars(content, chunks)
        assert gaps == [], f"chunk_size={chunk_size} overlap={overlap} dropped chars at indices {gaps[:20]}"


def test_chunking_terminates_and_makes_forward_progress():
    """Guards against the fix accidentally reintroducing a stall (new_start
    <= start would loop forever) - every chunk's start must strictly
    increase, and the loop must finish in a bounded number of steps."""
    content = "x" * 5000
    chunks = create_semantic_chunks(content, chunk_size=200, overlap=30, preserve_sentences=False)

    assert len(chunks) < 100
    starts = [c["start_char"] for c in chunks]
    assert starts == sorted(set(starts)), "chunk starts must be strictly increasing with no duplicates"
    assert _uncovered_chars(content, chunks) == []
