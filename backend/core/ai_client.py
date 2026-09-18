"""
Single shared entry point for every LLM call in the app.

Before this module, ~30 call sites across app.py and agents/*/service.py
each instantiated their own openai.OpenAI()/ChatOpenAI() client, almost
always reading OPENAI_API_KEY straight from the environment - meaning the
whole app ran on one shared platform key with no per-user or per-project
attribution, and no usage/cost tracking at all. It also only ever talked
to OpenAI - an "Anthropic API Key" field existed in the settings UI but
nothing actually used it.

This module:
  - resolves which API key AND which provider a call should use:
      - if the project's or user's "Preferred Model" setting names a
        model from the other provider (e.g. a Claude model) and a key
        is configured for it, that provider/model is used instead of
        the call site's own default - see resolve_model_and_provider()
      - otherwise resolves the key in priority order:
          1. the project's own key (core/project_settings.py), if
             project_id is given and the project has one set
          2. the calling user's personal key (core/settings.py)
          3. the platform default from environment
             (OPENAI_API_KEY / ANTHROPIC_API_KEY)
  - makes the call (OpenAI or Anthropic; Anthropic responses are wrapped
    in an OpenAI-shaped object so callers never need to branch on provider)
  - logs token usage + an estimated cost to AIUsageLog, tagged with
    user/project/team/agent so usage can be rolled up at any of those levels

Call sites that depend on an OpenAI-only feature (function calling via
`functions`/`function_call`, or `response_format={"type": "json_object"}`)
are automatically kept on OpenAI regardless of any Preferred Model
setting, since Anthropic's API doesn't support the same shapes.

Usage (raw OpenAI-client style, the majority pattern in this codebase):

    from core.ai_client import ai_chat_completion

    response = ai_chat_completion(
        user_id=g.user_id, project_id=project_id, agent="content_marketing.generate",
        model="gpt-4", messages=[{"role": "user", "content": prompt}],
    )
    text = response.choices[0].message.content

Usage (LangChain style):

    from core.ai_client import get_langchain_llm, log_langchain_usage

    llm, key_source, resolved_model = get_langchain_llm(user_id=g.user_id, project_id=project_id, model="gpt-4")
    result = llm.invoke(prompt)
    log_langchain_usage(result, user_id=g.user_id, project_id=project_id,
                         agent="content_marketing.kg_builder", model=resolved_model, key_source=key_source)
    text = result.content
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Tuple


def _current_user_id(explicit: Optional[str]) -> Optional[str]:
    """Falls back to the authenticated request's g.user_id when a call site
    doesn't have an explicit user_id handy (e.g. a helper several calls deep
    inside a request). Returns None outside a request context (e.g. Celery
    tasks) - callers there should pass user_id explicitly."""
    if explicit:
        return explicit
    try:
        from flask import g, has_request_context
        if has_request_context():
            return getattr(g, "user_id", None)
    except RuntimeError:
        pass
    return None


def infer_provider(model: str) -> str:
    """Best-effort guess of which provider a model string belongs to.
    Anthropic model names all start with "claude"; everything else in
    this codebase is OpenAI (gpt-*, o1/o3*, text-embedding-*)."""
    return "anthropic" if (model or "").lower().startswith("claude") else "openai"


# Rough, approximate USD-per-1K-token rates for cost estimation and display
# only - not wired to any provider's real billing API, so treat this as an
# order-of-magnitude estimate, not an invoice. Update as pricing changes.
_COST_PER_1K_TOKENS: Dict[str, Dict[str, float]] = {
    "gpt-4": {"prompt": 0.03, "completion": 0.06},
    "gpt-4-turbo": {"prompt": 0.01, "completion": 0.03},
    "gpt-4o": {"prompt": 0.005, "completion": 0.015},
    "gpt-4o-mini": {"prompt": 0.00015, "completion": 0.0006},
    "gpt-3.5-turbo": {"prompt": 0.0005, "completion": 0.0015},
    "claude-3-opus": {"prompt": 0.015, "completion": 0.075},
    "claude-3-sonnet": {"prompt": 0.003, "completion": 0.015},
    "claude-3-haiku": {"prompt": 0.00025, "completion": 0.00125},
    # Embedding models: input-only, no completion tokens.
    "text-embedding-ada-002": {"prompt": 0.0001, "completion": 0.0},
    "text-embedding-3-small": {"prompt": 0.00002, "completion": 0.0},
    "text-embedding-3-large": {"prompt": 0.00013, "completion": 0.0},
}
_DEFAULT_COST_PER_1K = {"prompt": 0.005, "completion": 0.015}  # unknown-model fallback


def _rates_for(model: str) -> Dict[str, float]:
    """Exact match, else the longest known model name that `model` starts
    with. Providers report dated snapshots ("gpt-4o-mini-2024-07-18",
    "gpt-4-turbo-preview") that an exact lookup missed, silently pricing
    them at the unknown-model default - the wrong rate, and for cheap models
    off by 20x+. Longest prefix wins so "gpt-4o-..." doesn't match "gpt-4"."""
    name = (model or "").lower()
    if name in _COST_PER_1K_TOKENS:
        return _COST_PER_1K_TOKENS[name]
    matches = [known for known in _COST_PER_1K_TOKENS if name.startswith(known)]
    if matches:
        return _COST_PER_1K_TOKENS[max(matches, key=len)]
    return _DEFAULT_COST_PER_1K


def estimate_cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    rates = _rates_for(model)
    return (prompt_tokens / 1000) * rates["prompt"] + (completion_tokens / 1000) * rates["completion"]


def resolve_api_key(user_id: Optional[str], project_id: Optional[str], provider: str) -> Tuple[Optional[str], str]:
    """Returns (api_key, source) where source is 'project' | 'user' | 'platform' | 'none'."""
    key_name = f"{provider}_key"

    if project_id:
        from core.project_settings import ProjectSettings
        project_key = ProjectSettings().get(project_id, key_name)
        if project_key:
            return project_key, "project"

    if user_id:
        from core.settings import UserSettings
        user_key = UserSettings().get(user_id, "ai", key_name)
        if user_key:
            return user_key, "user"

    env_var = "OPENAI_API_KEY" if provider == "openai" else "ANTHROPIC_API_KEY"
    platform_key = os.getenv(env_var)
    if platform_key:
        return platform_key, "platform"

    return None, "none"


def _preferred_model_setting(user_id: Optional[str], project_id: Optional[str]) -> Optional[str]:
    """Project's Preferred Model setting wins over the user's personal one,
    matching the same project-key-always-wins priority used for API keys."""
    if project_id:
        from core.project_settings import ProjectSettings
        value = ProjectSettings().get(project_id, "preferred_model")
        if value:
            return value
    if user_id:
        from core.settings import UserSettings
        value = UserSettings().get(user_id, "ai", "preferred_model")
        if value:
            return value
    return None


def resolve_model_and_provider(
    user_id: Optional[str],
    project_id: Optional[str],
    default_model: str,
    allow_preferred: bool = True,
) -> Tuple[str, str]:
    """Picks the model+provider a call should actually use: the project's
    or user's Preferred Model setting if one is configured AND a key
    exists for that provider, otherwise the call site's own default_model.

    allow_preferred=False is for call sites that depend on an OpenAI-only
    feature (function calling, response_format) and must stay on OpenAI
    no matter what Preferred Model is configured.
    """
    if allow_preferred:
        preferred = _preferred_model_setting(user_id, project_id)
        if preferred:
            provider = infer_provider(preferred)
            api_key, _ = resolve_api_key(user_id, project_id, provider)
            if api_key:
                return preferred, provider
    return default_model, infer_provider(default_model)


def _team_id_for_project(project_id: Optional[str]) -> Optional[str]:
    if not project_id:
        return None
    from core.models import Project
    project = Project.query.filter_by(project_id=project_id).first()
    return project.team_id if project else None


def _request_project(user_id: Optional[str]) -> Optional[str]:
    """The project named by this HTTP request's X-Project-Id header - only if
    that user can actually access it (the header is caller-controlled, so
    without the check anyone could bill spend to another team's project
    budget). None outside a request (Celery tasks) or when it isn't sent."""
    try:
        from flask import has_request_context, request

        if not has_request_context() or not user_id:
            return None
        claimed = (request.headers.get("X-Project-Id") or "").strip()[:36]
        if not claimed:
            return None
        from core.auth import user_can_access_project

        return claimed if user_can_access_project(user_id, claimed) else None
    except Exception:
        return None


def log_ai_usage(
    user_id: str,
    project_id: Optional[str],
    agent: str,
    provider: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    key_source: str,
) -> None:
    _write_usage_row(
        user_id=user_id, project_id=project_id, agent=agent, provider=provider, model=model,
        key_source=key_source, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
        cost_usd=estimate_cost_usd(model, prompt_tokens, completion_tokens),
    )


def log_external_usage(
    user_id: str,
    project_id: Optional[str],
    agent: str,
    provider: str,
    model: str,
    cost_usd: float,
    workflow_instance_id: Optional[str] = None,
    workflow_stage_id: Optional[str] = None,
) -> None:
    """Record spend that isn't LLM tokens (e.g. the paid email lookup) in
    the same log, so it counts toward per-project / per-user / per-workflow
    totals and budgets like everything else. Zero-cost calls are skipped."""
    if not cost_usd or cost_usd <= 0:
        return
    _write_usage_row(
        user_id=user_id, project_id=project_id, agent=agent, provider=provider, model=model,
        key_source="platform", prompt_tokens=0, completion_tokens=0, cost_usd=float(cost_usd),
        workflow_instance_id=workflow_instance_id, workflow_stage_id=workflow_stage_id,
    )


def _write_usage_row(
    user_id: str,
    project_id: Optional[str],
    agent: str,
    provider: str,
    model: str,
    key_source: str,
    prompt_tokens: int,
    completion_tokens: int,
    cost_usd: float,
    workflow_instance_id: Optional[str] = None,
    workflow_stage_id: Optional[str] = None,
) -> None:
    from core.database import db
    from core.models import AIUsageLog
    from core.usage_context import current_scope

    scope = current_scope()
    # Most call sites log with project_id=None. Resolve it, most specific
    # first: the call's own project, else the workflow run's project, else
    # the project the user is working in (the frontend sends it as
    # X-Project-Id) - so per-project spend and budgets see this usage.
    project_id = project_id or scope.get("project_id") or _request_project(user_id)
    entry = AIUsageLog(
        user_id=user_id or "unknown",
        project_id=project_id,
        team_id=_team_id_for_project(project_id),
        agent=agent,
        provider=provider,
        model=model,
        key_source=key_source,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=prompt_tokens + completion_tokens,
        estimated_cost_usd=cost_usd,
        workflow_instance_id=workflow_instance_id or scope.get("workflow_instance_id"),
        workflow_stage_id=workflow_stage_id or scope.get("workflow_stage_id"),
    )
    db.session.add(entry)
    db.session.commit()

    # Checked for the user too (not only when a project is set): plenty of
    # calls carry no project, and a per-user budget has to see those.
    from core.budget import check_and_maybe_alert_budget
    check_and_maybe_alert_budget(project_id, user_id)


class NoApiKeyConfigured(RuntimeError):
    """Raised when no project/user/platform key is available for a provider."""


# --- Anthropic response normalization -------------------------------------
# Callers of ai_chat_completion expect an OpenAI-shaped response
# (response.choices[0].message.content, response.usage.prompt_tokens /
# .completion_tokens) since that's the majority pattern in this codebase.
# Rather than have every one of ~15 call sites branch on provider, Anthropic
# responses get wrapped in these tiny shims so the shape is identical either way.

class _CompatMessage:
    def __init__(self, content: str):
        self.content = content


class _CompatChoice:
    def __init__(self, content: str):
        self.message = _CompatMessage(content)


class _CompatUsage:
    def __init__(self, prompt_tokens: int, completion_tokens: int):
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens


class _CompatResponse:
    def __init__(self, content: str, prompt_tokens: int, completion_tokens: int):
        self.choices = [_CompatChoice(content)]
        self.usage = _CompatUsage(prompt_tokens, completion_tokens)


# OpenAI-only request shapes that Anthropic's Messages API can't serve -
# call sites using these are forced to stay on OpenAI, see ai_chat_completion.
_OPENAI_ONLY_KWARGS = ("functions", "function_call", "response_format", "tools", "tool_choice")


def _anthropic_chat_completion(api_key: str, model: str, messages: List[Dict[str, str]], **kwargs: Any) -> _CompatResponse:
    """Calls Anthropic's Messages API and returns an OpenAI-shaped response."""
    import anthropic

    system_parts = [m["content"] for m in messages if m.get("role") == "system"]
    system = "\n\n".join(system_parts) if system_parts else None
    convo = [{"role": m["role"], "content": m["content"]} for m in messages if m.get("role") in ("user", "assistant")]
    if not convo:
        convo = [{"role": "user", "content": ""}]

    max_tokens = kwargs.get("max_tokens") or 1024
    request_kwargs: Dict[str, Any] = {"model": model, "max_tokens": max_tokens, "messages": convo}
    if system:
        request_kwargs["system"] = system
    if kwargs.get("temperature") is not None:
        request_kwargs["temperature"] = kwargs["temperature"]

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(**request_kwargs)
    text = "".join(block.text for block in response.content if getattr(block, "type", None) == "text")

    return _CompatResponse(
        content=text,
        prompt_tokens=response.usage.input_tokens,
        completion_tokens=response.usage.output_tokens,
    )


def ai_chat_completion(
    user_id: Optional[str],
    project_id: Optional[str],
    agent: str,
    model: str,
    messages: List[Dict[str, str]],
    provider: Optional[str] = None,
    **kwargs: Any,
):
    """Raw-client-style chat completion (mirrors openai's
    client.chat.completions.create signature/response shape) with key
    resolution, provider routing, and usage logging built in. user_id
    falls back to the current request's g.user_id if not given explicitly.

    `model` is treated as this call site's default - if the project/user
    has a Preferred Model set for the other provider (and a key for it),
    that's used instead, unless this call uses an OpenAI-only feature
    (functions/response_format) or an explicit `provider` is passed.
    """
    user_id = _current_user_id(user_id)

    if provider is not None:
        resolved_model, resolved_provider = model, provider
    else:
        allow_preferred = not any(k in kwargs for k in _OPENAI_ONLY_KWARGS)
        resolved_model, resolved_provider = resolve_model_and_provider(user_id, project_id, model, allow_preferred)

    api_key, key_source = resolve_api_key(user_id, project_id, resolved_provider)
    if not api_key:
        raise NoApiKeyConfigured(
            f"No {resolved_provider} API key configured for this project or user, and no platform default is set."
        )

    if resolved_provider == "anthropic":
        response = _anthropic_chat_completion(api_key, resolved_model, messages, **kwargs)
        prompt_tokens = response.usage.prompt_tokens
        completion_tokens = response.usage.completion_tokens
    else:
        import openai
        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(model=resolved_model, messages=messages, **kwargs)
        usage = getattr(response, "usage", None)
        prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
        completion_tokens = getattr(usage, "completion_tokens", 0) or 0

    log_ai_usage(
        user_id=user_id,
        project_id=project_id,
        agent=agent,
        provider=resolved_provider,
        model=resolved_model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        key_source=key_source,
    )
    return response


def ai_embeddings(
    user_id: Optional[str],
    project_id: Optional[str],
    agent: str,
    model: str,
    input: Any,
    **kwargs: Any,
):
    """Embeddings API (always OpenAI - Anthropic has no embeddings
    endpoint) with the same key resolution + usage logging as
    ai_chat_completion. Returns the raw OpenAI embeddings response."""
    import openai

    user_id = _current_user_id(user_id)
    api_key, key_source = resolve_api_key(user_id, project_id, "openai")
    if not api_key:
        raise NoApiKeyConfigured(
            "No OpenAI API key configured for this project or user, and no platform default is set."
        )

    client = openai.OpenAI(api_key=api_key)
    response = client.embeddings.create(model=model, input=input, **kwargs)

    usage = getattr(response, "usage", None)
    log_ai_usage(
        user_id=user_id,
        project_id=project_id,
        agent=agent,
        provider="openai",
        model=model,
        prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
        completion_tokens=0,
        key_source=key_source,
    )
    return response


def get_langchain_llm(
    user_id: Optional[str],
    project_id: Optional[str],
    model: str = "gpt-4",
    temperature: float = 0.7,
):
    """Returns (llm, key_source, resolved_model) - a ChatOpenAI or
    ChatAnthropic instance configured with the resolved key, honoring the
    project's/user's Preferred Model setting when one is configured.

    Caller must call log_langchain_usage(..., model=resolved_model, ...)
    after invoking it (using the returned resolved_model, not the model
    passed in here) - usage isn't logged automatically since LangChain's
    .invoke() returns before we'd have a chance to intercept.
    """
    user_id = _current_user_id(user_id)
    resolved_model, provider = resolve_model_and_provider(user_id, project_id, model)

    api_key, key_source = resolve_api_key(user_id, project_id, provider)
    if not api_key:
        raise NoApiKeyConfigured(
            f"No {provider} API key configured for this project or user, and no platform default is set."
        )

    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        llm = ChatAnthropic(model=resolved_model, temperature=temperature, api_key=api_key)
    else:
        from langchain_openai import ChatOpenAI
        llm = ChatOpenAI(model=resolved_model, temperature=temperature, api_key=api_key)

    return llm, key_source, resolved_model


def log_langchain_usage(ai_message, user_id: Optional[str], project_id: Optional[str], agent: str, model: str, key_source: str) -> None:
    """Extracts token usage from a LangChain AIMessage and logs it.
    Handles both the modern `.usage_metadata` attribute (populated by both
    ChatOpenAI and ChatAnthropic) and the older
    `.response_metadata['token_usage']` shape. `model` should be the
    resolved_model returned by get_langchain_llm - its provider is
    inferred from the name for the usage log."""
    prompt_tokens = 0
    completion_tokens = 0

    usage_metadata = getattr(ai_message, "usage_metadata", None)
    if usage_metadata:
        prompt_tokens = usage_metadata.get("input_tokens", 0) or 0
        completion_tokens = usage_metadata.get("output_tokens", 0) or 0
    else:
        token_usage = (getattr(ai_message, "response_metadata", None) or {}).get("token_usage", {})
        prompt_tokens = token_usage.get("prompt_tokens", 0) or 0
        completion_tokens = token_usage.get("completion_tokens", 0) or 0

    log_ai_usage(
        user_id=user_id,
        project_id=project_id,
        agent=agent,
        provider=infer_provider(model),
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        key_source=key_source,
    )
