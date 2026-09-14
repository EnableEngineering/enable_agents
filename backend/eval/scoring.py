"""Deterministic scoring for the eval harness — keyword presence and
JSON-key presence only, per the plan's "start tiny" scope. LLM-as-judge is
deliberately not built here; see backend/eval/README.md.

Every one of the 6 evaluated functions returns a real `jsonify(...)`
response, so `response.get_json()` is already a parsed Python dict/list -
no raw-string JSON extraction is needed here (the application code itself
already handles turning an LLM's raw text into structured JSON where that
matters, e.g. DomainSpecializationAnalyzer's regex extraction).
"""
from typing import Any, Dict, List, Optional


def extract_text(response_json: Dict[str, Any], fields: List[str]) -> str:
    """Concatenates the named top-level fields into one string for keyword
    checking. A field whose value is a list (e.g. keyFacts,
    recommendations) is joined; a missing field contributes nothing rather
    than raising, so a scoring bug shows up as a failed keyword check with
    a visible actual-text diff, not a crash."""
    parts = []
    for field in fields:
        value = response_json.get(field)
        if value is None:
            continue
        if isinstance(value, list):
            parts.append(" ".join(str(v) for v in value))
        else:
            parts.append(str(value))
    return " ".join(parts)


def check_keywords(text: str, keywords: List[str]) -> Dict[str, Any]:
    """Case-insensitive substring presence - every keyword must appear
    somewhere in text. Returns {"passed": bool, "missing": [...]}."""
    lower_text = text.lower()
    missing = [kw for kw in keywords if kw.lower() not in lower_text]
    return {"passed": not missing, "missing": missing}


def _resolve_path(response_json: Dict[str, Any], path: Optional[str]) -> Any:
    if not path:
        return response_json
    node = response_json
    for segment in path.split("."):
        if not isinstance(node, dict) or segment not in node:
            return None
        node = node[segment]
    return node


def check_json_keys(response_json: Dict[str, Any], path: Optional[str], keys: List[str]) -> Dict[str, Any]:
    """Every key in `keys` must be present in the dict found at `path`
    (dotted, e.g. "domain_specialization") - or at the response root if
    `path` is None. Returns {"passed": bool, "missing": [...]}."""
    node = _resolve_path(response_json, path)
    if not isinstance(node, dict):
        return {"passed": False, "missing": list(keys), "error": f"expected a dict at path {path!r}, got {type(node).__name__}"}
    missing = [k for k in keys if k not in node]
    return {"passed": not missing, "missing": missing}


def score_case(response_json: Dict[str, Any], text_fields: List[str], expect: Dict[str, Any], json_keys_path: Optional[str] = None) -> Dict[str, Any]:
    """Runs every check declared in a fixture case's `expect` block against
    one response. Returns a result dict with an overall `passed` plus the
    detail from each sub-check, for the report to render."""
    result: Dict[str, Any] = {"passed": True, "checks": {}}

    if "keywords" in expect:
        text = extract_text(response_json, text_fields)
        keyword_result = check_keywords(text, expect["keywords"])
        result["checks"]["keywords"] = keyword_result
        result["passed"] = result["passed"] and keyword_result["passed"]

    if "json_keys" in expect:
        json_result = check_json_keys(response_json, json_keys_path, expect["json_keys"])
        result["checks"]["json_keys"] = json_result
        result["passed"] = result["passed"] and json_result["passed"]

    return result
