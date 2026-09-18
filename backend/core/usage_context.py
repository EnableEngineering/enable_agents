"""Who/what an AI call is being made *for*, beyond the user and project.

core/ai_client.py's log_ai_usage() is called from ~a dozen places with no
knowledge of workflows. Rather than thread workflow ids through every call
signature, the workflow engine wraps a stage's execute() in `usage_scope()`
and log_ai_usage() reads the current scope when it writes the row - so a
workflow run's cost can be totalled by instance and broken down by stage.

A ContextVar (not a global) so concurrent Celery tasks / threads each see
only their own scope.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Dict, Iterator, Optional

_scope: ContextVar[Optional[Dict[str, str]]] = ContextVar("ai_usage_scope", default=None)


@contextmanager
def usage_scope(workflow_instance_id: Optional[str] = None, workflow_stage_id: Optional[str] = None) -> Iterator[None]:
    token = _scope.set({
        "workflow_instance_id": workflow_instance_id,
        "workflow_stage_id": workflow_stage_id,
    })
    try:
        yield
    finally:
        _scope.reset(token)


def current_scope() -> Dict[str, Optional[str]]:
    return dict(_scope.get() or {"workflow_instance_id": None, "workflow_stage_id": None})
