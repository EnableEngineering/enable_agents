"""Sales Helper — plain-argument core for lead scoring.

There is no `agents/sales_helper/` package (this logic lives only in
app.py's `/api/score-leads` route today) so, unlike the other extractions
in this batch, this is a new module rather than an addition to an
existing service.py. `get_embeddings_batch` is still defined in app.py
and imported lazily here rather than duplicated, matching the lazy-import
pattern used elsewhere in this phase (agents/email_outreach/service.py).
"""
import json
import os
import re

import numpy as np
from scipy.spatial.distance import cosine


def _compact_text(value):
    if not value:
        return ''
    return re.sub(r'\s+', ' ', str(value)).strip()


def _safe_json(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _extract_lead_text(lead_obj, max_chars=1200):
    raw_data = _safe_json(lead_obj.get('raw_data'))
    lead_name = _compact_text(lead_obj.get('name') or '')

    # PRIORITY: Lead name first (ensures it's the focus for LLM)
    text_bits = []
    if lead_name:
        text_bits.append(lead_name)

    # Then add fields, EXCLUDING conflicting names from raw_data
    # This prevents raw_data descriptions (which may reference OTHER leads) from confusing the LLM
    priority_fields = [
        lead_obj.get('summary'),
        lead_obj.get('description'),
        lead_obj.get('website'),
        lead_obj.get('address'),
        lead_obj.get('phone'),
        raw_data.get('summary'),
        raw_data.get('description'),
        raw_data.get('website'),
        raw_data.get('address'),
        raw_data.get('phone'),
        raw_data.get('about'),
        raw_data.get('specialties'),
        raw_data.get('services'),
        raw_data.get('keywords'),
        raw_data.get('categories'),
        raw_data.get('category'),
        raw_data.get('industry'),
    ]

    for field in priority_fields:
        if isinstance(field, list):
            text_bits.extend([_compact_text(item) for item in field if _compact_text(item)])
        elif isinstance(field, dict):
            text_bits.extend([_compact_text(v) for v in field.values() if _compact_text(v)])
        else:
            value = _compact_text(field)
            if value:
                text_bits.append(value)

    combined = ' '.join(text_bits)
    return combined[:max_chars] if len(combined) > max_chars else combined


def _extract_two_line_summary(lead_obj):
    text = _extract_lead_text(lead_obj)
    lead_name = _compact_text(lead_obj.get('name') or '')
    if not text:
        return lead_name or 'No summary available'
    sentences = re.split(r'[\.\!\?]\s+', text)
    summary = ' '.join(sentences[:2]).strip()
    summary = re.sub(r'\s+', ' ', summary)
    summary = summary[:220].rstrip()
    if lead_name and lead_name.lower() not in summary.lower():
        return f"{lead_name} is a relevant match for your requirement."
    return summary


def _safe_llm_summary(lead_obj, candidate_summary):
    lead_name = _compact_text(lead_obj.get('name') or '')
    summary = _compact_text(candidate_summary or '')
    if not summary:
        return _extract_two_line_summary(lead_obj)
    if lead_name and lead_name.lower() not in summary.lower():
        return _extract_two_line_summary(lead_obj)
    return summary[:220]


def _coerce_lead(lead, index):
    if isinstance(lead, dict):
        return lead
    if isinstance(lead, str):
        try:
            parsed = json.loads(lead)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return {'name': str(lead), 'raw_data': {'name': str(lead)}, '_index': index}


def _similarity_score(req_vec, lead_vec):
    if req_vec is None or lead_vec is None:
        return 0
    if not np.any(req_vec) or not np.any(lead_vec):
        return 0
    sim = 1 - cosine(req_vec, lead_vec)
    if np.isnan(sim):
        return 0
    return int(max(0.0, min(1.0, sim)) * 100)


def _fallback_sort_key(item):
    return item.get('match_score', 0) or 0


def score_leads_core(requirement, businesses, user_id):
    """Plain-argument core of app.py's score_leads - callable from a
    LangGraph node (or anywhere else outside a Flask request) with no
    request/g dependency. Bypasses any session-resolution helper entirely;
    `user_id` is used only to attribute the LLM refinement call's usage log.

    Returns (results_list_or_None, error_message_or_None, http_status).
    """
    requirement = (requirement or '').strip()
    businesses = businesses or []

    if not requirement:
        return None, 'Missing requirement text', 400

    try:
        openai_key = os.getenv('OPENAI_API_KEY')
        if not openai_key:
            results = []
            for lead in businesses:
                lead_obj = _coerce_lead(lead, len(results))
                results.append({
                    'index': len(results),
                    'match_score': 0,
                    'short_summary': _extract_two_line_summary(lead_obj),
                })
            return results, None, 200

        from app import get_embeddings_batch
        from core.ai_client import ai_chat_completion

        lead_objects = [_coerce_lead(lead, index) for index, lead in enumerate(businesses)]
        lead_texts = [_extract_lead_text(lead_obj) for lead_obj in lead_objects]

        # Embeddings provide the full-list ranking; this is the fast, deterministic layer.
        embedding_inputs = [requirement] + lead_texts
        embeddings = get_embeddings_batch(embedding_inputs)

        if not embeddings or len(embeddings) != len(embedding_inputs):
            raise ValueError('Failed to generate embeddings for scoring')

        requirement_vec = np.array(embeddings[0], dtype=np.float32)
        lead_vectors = [np.array(item, dtype=np.float32) for item in embeddings[1:]]

        base_results = []
        for index, lead_obj in enumerate(lead_objects):
            base_score = _similarity_score(requirement_vec, lead_vectors[index])
            base_results.append({
                'index': index,
                'match_score': base_score,
                'short_summary': _extract_two_line_summary(lead_obj),
                'lead_obj': lead_obj,
                'lead_text': lead_texts[index],
            })

        # LLM only touches the top matches to refine ranking and produce richer summaries.
        top_k = min(int(os.getenv('LEAD_SCORE_LLM_TOP_K', '100')), len(base_results))
        if top_k > 0:
            top_candidates = sorted(base_results, key=lambda item: item['match_score'], reverse=True)[:top_k]
            compact_candidates = [
                {
                    'index': candidate['index'],
                    'name': candidate['lead_obj'].get('name') or '',
                    'current_score': candidate['match_score'],
                    'text': candidate['lead_text'][:1200],
                }
                for candidate in top_candidates
            ]

            llm_prompt = [
                {
                    'role': 'system',
                    'content': (
                        'You rank business/organization leads for a user requirement. '
                        'CRITICAL: Use the "name" field as the authoritative lead identifier. The summary must reference THIS NAME ONLY, not any other names mentioned in the text. '
                        'Use the requirement and company text to produce a final match_score from 0 to 100 and a concise two-line summary that directly references the lead name. '
                        'If the requirement implies buying, selling, or procuring, favor companies that offer that service or product. '
                        'Return only valid JSON as an array of objects with keys: index, match_score, short_summary.'
                    ),
                },
                {
                    'role': 'user',
                    'content': json.dumps({'requirement': requirement, 'companies': compact_candidates}, ensure_ascii=False),
                },
            ]

            try:
                llm_response = ai_chat_completion(
                    user_id=user_id, project_id=None, agent="sales_helper.score_leads",
                    model=os.getenv('OPENAI_MODEL', 'gpt-4o-mini'),
                    messages=llm_prompt,
                    temperature=0.0,
                    max_tokens=1200,
                )
                response_text = (llm_response.choices[0].message.content or '').strip()
                response_text = response_text.replace('```json', '').replace('```', '').strip()
                parsed = json.loads(response_text)
                if isinstance(parsed, list):
                    parsed_map = {int(item.get('index')): item for item in parsed if isinstance(item, dict) and str(item.get('index', '')).isdigit()}
                    for result in base_results:
                        item = parsed_map.get(result['index'])
                        if not item:
                            continue
                        llm_score = int(item.get('match_score') or result['match_score'])
                        llm_score = max(0, min(100, llm_score))
                        # Blend embedding ranking with LLM refinement for better buyer/seller intent handling.
                        result['match_score'] = int(round((result['match_score'] * 0.45) + (llm_score * 0.55)))
                        result['short_summary'] = _safe_llm_summary(result['lead_obj'], item.get('short_summary') or '')
            except Exception as llm_error:
                print(f"[score-leads] LLM refinement skipped: {llm_error}")

        results = [
            {
                'index': int(item['index']),
                'match_score': int(item['match_score']),
                'short_summary': item['short_summary'],
            }
            for item in sorted(base_results, key=_fallback_sort_key, reverse=True)
        ]

        return results, None, 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return None, str(e), 500
