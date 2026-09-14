"""LangGraph state for the Supplier Qualification Pipeline.

`stage_outputs` is namespaced per stage_id - this is the collision-free
hand-off *within* a graph run. `WorkflowInstance.context`/`stage_states`
(the flat, shallow-merged columns) are still dual-written alongside this
by the graph so nothing outside the graph (frontend, to_dict()) breaks;
that dual-write is deliberate technical debt, tracked as a fast-follow,
not an oversight - see the approved orchestration plan.
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
    # Suggest | co-pilot | autopilot. co-pilot and suggest both pause on
    # interrupt() before a stage's side effect runs; autopilot never does.
    autonomy_mode: str
    errors: List[Dict[str, Any]]
