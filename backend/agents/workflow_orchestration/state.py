"""LangGraph state for the Supplier Qualification Pipeline.

`stage_outputs` is namespaced per stage_id - this is the collision-free
hand-off *within* a graph run. `WorkflowInstance.context`/`stage_states`
(the flat, shallow-merged columns) are dual-written alongside this by the
graph (see graph.py's `_sync_legacy_state`) so nothing outside the graph
(frontend, `to_dict()`) needs to read a LangGraph checkpoint on every page
load. This was originally left as tracked technical debt because the old
manual routes (`/start`, `/complete-stage`, `/stages/<id>/data`) could
ALSO write those same flat columns directly, independently of the graph -
a graph-orchestrated instance touched by one of those would silently
desync from its own checkpoint. Closed 2026-09-14: those three routes now
reject calls on a graph-orchestrated instance (`routes/workflows.py`'s
`_is_graph_orchestrated`), so `_sync_legacy_state` is the only writer left
and the dual-write can no longer drift.
"""
from typing import Any, Dict, List, Optional, TypedDict


class SupplierQualificationState(TypedDict):
    instance_id: str
    user_id: str
    project_id: Optional[str]
    current_stage_id: str
    # Per-stage kwargs supplied at kickoff (POST .../run body) - the only
    # place this graph reads external input from, since the underlying
    # agent-manifest provides/consumes system is intentionally not wired
    # into this graph (see the plan's "What does NOT change" section).
    # Shape: {stage_id: {...kwargs for that stage's _core function...}}
    initial_inputs: Dict[str, Dict[str, Any]]
    # Namespaced per stage_id: {stage_id: {...that stage's result...}}
    stage_outputs: Dict[str, Dict[str, Any]]
    # co-pilot | autopilot. co-pilot pauses on interrupt() before every
    # stage runs. autopilot skips that for read-only stages but still
    # pauses on irreversible ones (email), on errors, and once over the
    # project's AI budget - see graph.py's run_stage. ("suggest" was a
    # third mode that never differed from co-pilot; merged 2026-09-18.)
    autonomy_mode: str
    errors: List[Dict[str, Any]]
