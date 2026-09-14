"""Market Research — plain-argument core for requirements generation.

There is no `agents/market_research/service.py` extraction for this yet
(the real logic still lives only in app.py's `/generate_requirements`
route) so, unlike the other extractions in this batch, this is a new
top-level module rather than an addition to an existing service.py -
matching the pattern `agents/sales_helper_core.py` already established
this session. RESEARCH_TYPE_STRUCTURES/DEFAULT_RESEARCH_STRUCTURE are
still defined in app.py and imported lazily here rather than duplicated.
"""
from typing import Any, Dict, List, Optional, Tuple


def generate_requirements_core(
    overview: str,
    user_id: str,
    context: str = "",
    countries: str = "",
    industries: str = "",
    business_function: str = "",
    frameworks: Optional[List[str]] = None,
    response_format: str = "",
) -> Tuple[Optional[str], Optional[str]]:
    """Plain-argument core of app.py's generate_requirements - callable
    from a LangGraph node (or anywhere else outside a Flask request) with
    no request/g dependency. Returns (answer_or_None, error_message_or_None).
    """
    from app import RESEARCH_TYPE_STRUCTURES, DEFAULT_RESEARCH_STRUCTURE

    structure_instruction = RESEARCH_TYPE_STRUCTURES.get(response_format, DEFAULT_RESEARCH_STRUCTURE)

    prompt = f"""
    You are a research assistant tasked with producing high-quality, insightful, and well-structured research on business opportunitiesand growth prospects. Your output should include a curated but accessible for free list of relevant academic papers, industry articles, expert quotations, market data, and other authoritative sources.

    Base your research on the following core requirement: {overview}.

    In addition, factor in the following contextual details where applicable:

    Geographic Market: Consider the business and technology landscape in {countries}. Ignore if not specified.

    Industry Focus: Include insights, trends, and data from the following industries: {industries}. Ignore if not specified.

    Business Function: Tailor the analysis to the perspective or needs of a person working in {business_function}. Ignore if not specified.

    Strategic Frameworks: Incorporate or structure your research using the following analytical frameworks: {frameworks or []}.

    {structure_instruction}

    Your response should:

    Include direct citations or links where available.

    Be clear, logically organized, and easy to turn into a pitch or slide deck.

    Blend both technical insight (e.g., emerging technologies, R&D frontiers) and business relevance (e.g., market sizing, customer pain points, competitive dynamics).
    """

    try:
        from core.ai_client import ai_chat_completion
        response = ai_chat_completion(
            user_id=user_id, project_id=None, agent="requirements_gathering.generate",
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a research assistant."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=2000,
            temperature=0.6
        )
        return response.choices[0].message.content, None
    except Exception as e:
        return None, str(e)
