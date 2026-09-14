"""LangGraph StateGraph for the Supplier Qualification Pipeline.

One node per template stage (backend/config/workflow-templates/
supplier-qualification.json), in the same fixed order. Each node maps
onto the design canvas's Approve/Edit/Skip pattern via `run_stage`:

  1. Build `proposed_input` - the arguments about to be passed to the
     stage's already-extracted `_core` function. No side effect yet.
  2. In "suggest"/"co-pilot" autonomy_mode, call `interrupt(...)` with
     that proposal and pause (checkpointed) until a human resumes with
     `Command(resume={"action": "approve"|"edit"|"skip", "data": {...}})`.
     In "autopilot" mode, skip the interrupt and approve automatically -
     unless one of the two guardrails below forces a pause anyway.
  3. "skip" never calls the real function. "approve" calls it with
     `proposed_input` unchanged. "edit" calls it with `proposed_input`
     overridden by the resume decision's `data`.

Per the approved plan, this hardcodes its 6 node functions directly
rather than dispatching through agents/registry.py's provides/consumes
manifest system - that system is disconnected from WorkflowTemplate
today (enforcement is warn-only) and fixing that is explicitly out of
scope for this phase.

`stage_outputs` (namespaced per stage_id) is this graph's real,
collision-free state. WorkflowInstance.stage_states/context (flat,
shallow-merged) are dual-written on every stage completion so nothing
outside the graph breaks - see state.py's docstring.

Two guardrails, both added on top of the original branch's design so
Orchestration never ships without a real safety net (see the approved
orchestration plan):

  - Kill switch: `run_stage` re-checks WorkflowInstance.status at the top
    of every node, before `propose` even runs. A human calling the
    existing POST .../pause endpoint between nodes now actually stops the
    run, instead of that endpoint only ever flipping a DB flag a Celery
    task already mid-`graph.invoke()` never looks at.
  - Autopilot budget cap: only reached in "autopilot" mode (suggest/
    co-pilot already get a human checkpoint on every node). If the
    instance's project has a monthly_budget_usd set and this month's
    spend is already at or over it, the node falls back to interrupt()
    instead of silently auto-approving - one human checkpoint on the
    node that would have gone over, not a hard block on the whole run.
    Reuses core.budget's own spend/cap numbers; does not call
    check_and_maybe_alert_budget itself and does not touch that
    function's alert-only behavior anywhere else in the app.
"""
from datetime import datetime
from typing import Any, Callable, Dict

from langgraph.graph import END, StateGraph
from langgraph.types import interrupt

from .state import SupplierQualificationState

STAGE_ORDER = [
    "supplier_discovery",
    "document_analysis",
    "rfq_outreach",
    "response_analysis",
    "qualification_audit",
    "selection_tasks",
]


def _sync_legacy_state(instance_id: str, stage_id: str, output: Dict[str, Any]) -> None:
    """Dual-write into WorkflowInstance.stage_states/context so the
    pre-existing frontend/to_dict() contract keeps working unchanged.

    Writes directly by stage_id rather than delegating to
    WorkflowInstance.advance_stage() (which infers the stage from
    current_stage_index) - that index only reflects the *previous*
    dual-write, so it can't be trusted to already match the stage this
    node just ran, e.g. after a resume, a retried task, or a stage run
    out of template order. current_stage_index is still kept in sync
    (advanced to whichever stage is furthest along) purely for display."""
    from core.database import db
    from models.workflow import WorkflowInstance

    instance = WorkflowInstance.query.filter_by(instance_id=instance_id).first()
    if not instance:
        return

    data = output if isinstance(output, dict) else {}
    states = instance.stage_states
    states[stage_id] = {
        "status": "completed",
        "data": data,
        "completedAt": datetime.utcnow().isoformat(),
    }
    instance.stage_states = states

    if data:
        ctx = instance.context
        ctx.update(data)
        instance.context = ctx

    if stage_id in STAGE_ORDER:
        instance.current_stage_index = max(instance.current_stage_index, STAGE_ORDER.index(stage_id) + 1)

    db.session.commit()


def _instance_paused(instance_id: str) -> bool:
    """Kill switch check: has a human paused this instance since the graph
    started (or since the last node), regardless of autonomy_mode? Re-read
    fresh from the DB, not from graph state, since a pause can land at any
    point between nodes while an autopilot run is mid-`graph.invoke()`."""
    from models.workflow import WorkflowInstance

    instance = WorkflowInstance.query.filter_by(instance_id=instance_id).first()
    return bool(instance and instance.status == "paused")


def _autopilot_over_budget(state: SupplierQualificationState) -> bool:
    """Budget guardrail check, autopilot mode only. Reuses core.budget's
    own spend/cap numbers rather than duplicating the query; deliberately
    does not call check_and_maybe_alert_budget (that function's email side
    effect is a separate concern from this guardrail and this stays scoped
    to reading the same numbers)."""
    project_id = state.get("project_id")
    if not project_id:
        return False

    from core.budget import _current_month_spend_usd
    from core.models import Project

    project = Project.query.filter_by(project_id=project_id).first()
    if not project or not project.monthly_budget_usd:
        return False

    return _current_month_spend_usd(project_id) >= project.monthly_budget_usd


def run_stage(
    state: SupplierQualificationState,
    stage_id: str,
    propose: Callable[[SupplierQualificationState], Dict[str, Any]],
    execute: Callable[[SupplierQualificationState, Dict[str, Any]], Dict[str, Any]],
) -> Dict[str, Any]:
    if _instance_paused(state["instance_id"]):
        stage_outputs = dict(state.get("stage_outputs") or {})
        stage_outputs[stage_id] = {"skipped": True, "reason": "paused"}
        _sync_legacy_state(state["instance_id"], stage_id, stage_outputs[stage_id])
        return {
            "current_stage_id": stage_id,
            "stage_outputs": stage_outputs,
            "errors": list(state.get("errors") or []),
        }

    proposed_input = propose(state)

    autonomy_mode = state.get("autonomy_mode")
    if autonomy_mode == "autopilot" and not _autopilot_over_budget(state):
        decision = {"action": "approve"}
    else:
        decision = interrupt({"stage_id": stage_id, "proposed_input": proposed_input})

    errors = list(state.get("errors") or [])
    action = (decision or {}).get("action", "approve")

    if action == "skip":
        output = {"skipped": True}
    else:
        final_input = dict(proposed_input)
        if action == "edit":
            final_input.update(decision.get("data") or {})
        try:
            output = execute(state, final_input)
        except Exception as exc:
            output = {"error": str(exc)}
            errors.append({"stage_id": stage_id, "error": str(exc)})

    stage_outputs = dict(state.get("stage_outputs") or {})
    stage_outputs[stage_id] = output

    _sync_legacy_state(state["instance_id"], stage_id, output)

    return {
        "current_stage_id": stage_id,
        "stage_outputs": stage_outputs,
        "errors": errors,
    }


def _stage_input(state: SupplierQualificationState, stage_id: str) -> Dict[str, Any]:
    return dict((state.get("initial_inputs") or {}).get(stage_id) or {})


def _prior_businesses(state: SupplierQualificationState) -> list:
    """Businesses flow supplier_discovery -> rfq_outreach -> response_analysis
    by default; each stage's initial_inputs can still override this
    explicitly with its own `businesses` list."""
    discovery = (state.get("stage_outputs") or {}).get("supplier_discovery") or {}
    return discovery.get("businesses") or []


def supplier_discovery_node(state: SupplierQualificationState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "supplier_discovery")
        return {"query": raw.get("query", ""), "location": raw.get("location", "")}

    def execute(s, args):
        from agents.market_research.google_business_helper import GoogleBusinessSearcher

        result = GoogleBusinessSearcher().search_businesses(args["query"], args["location"])
        if not result.get("success", True) and result.get("error"):
            raise RuntimeError(result["error"])
        return result

    return run_stage(state, "supplier_discovery", propose, execute)


def document_analysis_node(state: SupplierQualificationState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "document_analysis")
        return {
            "documents": raw.get("documents", []),
            "nodes": raw.get("nodes", []),
            "edges": raw.get("edges", []),
            "query": raw.get("query", ""),
        }

    def execute(s, args):
        from app import process_documents_with_kg_rag

        answer = process_documents_with_kg_rag(
            args["documents"], args["nodes"], args["edges"], args["query"],
            user_id=s["user_id"], project_id=s.get("project_id"),
        )
        return {"answer": answer}

    return run_stage(state, "document_analysis", propose, execute)


def rfq_outreach_node(state: SupplierQualificationState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "rfq_outreach")
        return {
            "subject": raw.get("subject", ""),
            "body": raw.get("body", ""),
            "businesses": raw.get("businesses") or _prior_businesses(s),
            "campaign_name": raw.get("campaign_name", "RFQ Outreach"),
            "use_ai_personalization": raw.get("use_ai_personalization", False),
        }

    def execute(s, args):
        from agents.email_outreach.service import send_bulk_emails_core

        result, error, status = send_bulk_emails_core(
            args["subject"], args["body"], args["businesses"],
            s["user_id"], s["user_id"],
            campaign_name=args["campaign_name"],
            use_ai_personalization=args["use_ai_personalization"],
        )
        if error:
            raise RuntimeError(error)
        return result

    return run_stage(state, "rfq_outreach", propose, execute)


def response_analysis_node(state: SupplierQualificationState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "response_analysis")
        discovery = (s.get("stage_outputs") or {}).get("supplier_discovery") or {}
        return {
            "requirement": raw.get("requirement") or discovery.get("searchQuery", ""),
            "businesses": raw.get("businesses") or _prior_businesses(s),
        }

    def execute(s, args):
        from agents.sales_helper_core import score_leads_core

        results, error, status = score_leads_core(args["requirement"], args["businesses"], s["user_id"])
        if error:
            raise RuntimeError(error)
        return {"results": results}

    return run_stage(state, "response_analysis", propose, execute)


def qualification_audit_node(state: SupplierQualificationState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "qualification_audit")
        return {"audits": raw.get("audits", [])}

    def execute(s, args):
        from agents.supply_chain.service import submit_audit_core

        audited = []
        for audit in args["audits"]:
            result, error, status = submit_audit_core(audit.get("supplier_id"), audit.get("score"), s["user_id"])
            audited.append({"supplier_id": audit.get("supplier_id"), "result": result, "error": error})
        return {"audited": audited}

    return run_stage(state, "qualification_audit", propose, execute)


def selection_tasks_node(state: SupplierQualificationState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "selection_tasks")
        tasks = raw.get("tasks")
        if not tasks:
            # Default: one follow-up task per supplier that passed audit.
            audited = ((s.get("stage_outputs") or {}).get("qualification_audit") or {}).get("audited") or []
            tasks = [
                {"title": f"Follow up with supplier {(a.get('result') or {}).get('name') or a['supplier_id']}"}
                for a in audited
                if (a.get("result") or {}).get("auditStatus") == "passed"
            ]
        return {"tasks": tasks}

    def execute(s, args):
        from agents.executive_assistant.service import create_task_core

        created = []
        for task in args["tasks"]:
            result, error = create_task_core(
                s["user_id"], task.get("title", ""),
                description=task.get("description", ""),
                project_id=s.get("project_id"),
                due_date=task.get("due_date"),
                priority=task.get("priority", "Medium"),
            )
            created.append({"result": result, "error": error})
        return {"created": created}

    return run_stage(state, "selection_tasks", propose, execute)


_NODE_FUNCS = {
    "supplier_discovery": supplier_discovery_node,
    "document_analysis": document_analysis_node,
    "rfq_outreach": rfq_outreach_node,
    "response_analysis": response_analysis_node,
    "qualification_audit": qualification_audit_node,
    "selection_tasks": selection_tasks_node,
}

_compiled_graph = None


def build_graph(checkpointer=None):
    """Builds (but does not compile) the StateGraph. Exposed separately
    from get_compiled_graph() so tests can compile it with an in-memory
    checkpointer instead of PostgresSaver."""
    graph = StateGraph(SupplierQualificationState)
    for stage_id in STAGE_ORDER:
        graph.add_node(stage_id, _NODE_FUNCS[stage_id])

    graph.set_entry_point(STAGE_ORDER[0])
    for a, b in zip(STAGE_ORDER, STAGE_ORDER[1:]):
        graph.add_edge(a, b)
    graph.add_edge(STAGE_ORDER[-1], END)

    return graph


def get_compiled_graph():
    """Process-wide singleton compiled with the Postgres checkpointer.
    Uses a psycopg ConnectionPool (rather than PostgresSaver.from_conn_string's
    single kept-open connection) since this lives for the life of a Celery
    worker process and needs to survive individual connection drops.
    PostgresSaver.setup() must have already been run once (deploy-time
    step, not an Alembic migration - see the plan) so its checkpoint
    tables exist before this connects."""
    global _compiled_graph
    if _compiled_graph is None:
        import os
        import re
        from langgraph.checkpoint.postgres import PostgresSaver
        from psycopg_pool import ConnectionPool
        from psycopg.rows import dict_row

        conn_string = os.environ.get("DATABASE_URI") or os.environ.get("DATABASE_URL")
        # This app's DATABASE_URI is a SQLAlchemy-style URL (e.g.
        # postgresql+psycopg2://...) - psycopg (v3) only understands the
        # bare "postgresql://" scheme, so the "+driver" part must come off
        # before this reaches ConnectionPool. Caught 2026-09-14 restoring
        # this: every real dev/CI DATABASE_URI in this codebase carries
        # +psycopg2, so this isn't hypothetical - it broke every call here
        # without the strip.
        conn_string = re.sub(r'^postgresql\+\w+://', 'postgresql://', conn_string)
        pool = ConnectionPool(
            conn_string,
            open=True,
            min_size=1,
            max_size=5,
            kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
        )
        checkpointer = PostgresSaver(pool)
        # Idempotent (version-tracked migrations table) and cheap enough to
        # call on every first-compile-per-process, so this doesn't need its
        # own separate deploy step after all.
        checkpointer.setup()
        _compiled_graph = build_graph().compile(checkpointer=checkpointer)
    return _compiled_graph
