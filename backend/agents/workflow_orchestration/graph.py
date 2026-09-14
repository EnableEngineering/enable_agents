"""LangGraph StateGraphs for orchestrated workflow templates.

One node per template stage, in the template's fixed order. Each node maps
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

Per the approved plan, this hardcodes its node functions directly rather
than dispatching through agents/registry.py's provides/consumes manifest
system - that system is disconnected from WorkflowTemplate today
(enforcement is warn-only, extended 2026-09-14 to also validate template
stage->agent references - see registry.py's validate_workflow_template_agents)
and driving graph execution off it is explicitly out of scope: the
manifest schema's declared shapes don't match what these nodes actually
need (see docs/todo.md's 2026-09-14 note on this).

`stage_outputs` (namespaced per stage_id) is this graph's real,
collision-free state. WorkflowInstance.stage_states/context (flat,
shallow-merged) are dual-written on every stage completion so nothing
outside the graph needs to read a LangGraph checkpoint on every page load
- see state.py's docstring. The only writer of those flat columns for a
graph-orchestrated instance is `_sync_legacy_state` below; the old manual
routes (/start, /complete-stage, /stages/<id>/data) reject graph-
orchestrated instances (routes/workflows.py's `_is_graph_orchestrated`).

One graph per template, keyed by template_id in `_TEMPLATE_GRAPHS` (built
for Supplier Qualification 2026-09-14, generalized the same day to Vendor
Evaluation and Lead Nurturing - see docs/todo.md for why New Market Launch
isn't included: its `research` stage has no real backing logic to call,
that's a missing feature, not a graph-engine gap). `build_graph(template_id)`/
`get_compiled_graph(template_id)` take the template_id explicitly rather
than defaulting to Supplier Qualification, so a caller can't silently get
the wrong template's graph.

Two guardrails, both added on top of the original (Supplier-Qualification-
only) design so Orchestration never ships without a real safety net (see
the approved orchestration plan) - both are template-agnostic, implemented
once in `run_stage`, and apply to every node in every template registered
below with no extra code:

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
from typing import Any, Callable, Dict, List

from langgraph.graph import END, StateGraph
from langgraph.types import interrupt

from .state import SupplierQualificationState as WorkflowGraphState

# =============================================================================
# Supplier Qualification Pipeline (original template, 2026-09-14)
# =============================================================================

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
    (advanced to whichever stage is furthest along) purely for display -
    looked up from _TEMPLATE_GRAPHS by the instance's own template_id,
    not a hardcoded stage order, so this works for every registered
    template."""
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

    stage_order = _TEMPLATE_GRAPHS.get(instance.template_id, {}).get("stage_order") or []
    if stage_id in stage_order:
        instance.current_stage_index = max(instance.current_stage_index, stage_order.index(stage_id) + 1)

    db.session.commit()


def _instance_paused(instance_id: str) -> bool:
    """Kill switch check: has a human paused this instance since the graph
    started (or since the last node), regardless of autonomy_mode? Re-read
    fresh from the DB, not from graph state, since a pause can land at any
    point between nodes while an autopilot run is mid-`graph.invoke()`."""
    from models.workflow import WorkflowInstance

    instance = WorkflowInstance.query.filter_by(instance_id=instance_id).first()
    return bool(instance and instance.status == "paused")


def _autopilot_over_budget(state: WorkflowGraphState) -> bool:
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
    state: WorkflowGraphState,
    stage_id: str,
    propose: Callable[[WorkflowGraphState], Dict[str, Any]],
    execute: Callable[[WorkflowGraphState, Dict[str, Any]], Dict[str, Any]],
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


def _stage_input(state: WorkflowGraphState, stage_id: str) -> Dict[str, Any]:
    return dict((state.get("initial_inputs") or {}).get(stage_id) or {})


def _businesses_from_stage(state: WorkflowGraphState, source_stage_id: str) -> list:
    """Generic version of what was `_prior_businesses` - reads a `businesses`
    list out of any earlier stage's output. Each stage's initial_inputs can
    still override this explicitly with its own `businesses` list."""
    source = (state.get("stage_outputs") or {}).get(source_stage_id) or {}
    return source.get("businesses") or []


def supplier_discovery_node(state: WorkflowGraphState) -> Dict[str, Any]:
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


def document_analysis_node(state: WorkflowGraphState) -> Dict[str, Any]:
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


def rfq_outreach_node(state: WorkflowGraphState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "rfq_outreach")
        return {
            "subject": raw.get("subject", ""),
            "body": raw.get("body", ""),
            "businesses": raw.get("businesses") or _businesses_from_stage(s, "supplier_discovery"),
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


def response_analysis_node(state: WorkflowGraphState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "response_analysis")
        discovery = (s.get("stage_outputs") or {}).get("supplier_discovery") or {}
        return {
            "requirement": raw.get("requirement") or discovery.get("searchQuery", ""),
            "businesses": raw.get("businesses") or _businesses_from_stage(s, "supplier_discovery"),
        }

    def execute(s, args):
        from agents.sales_helper_core import score_leads_core

        results, error, status = score_leads_core(args["requirement"], args["businesses"], s["user_id"])
        if error:
            raise RuntimeError(error)
        return {"results": results}

    return run_stage(state, "response_analysis", propose, execute)


def qualification_audit_node(state: WorkflowGraphState) -> Dict[str, Any]:
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


def selection_tasks_node(state: WorkflowGraphState) -> Dict[str, Any]:
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


_SUPPLIER_QUALIFICATION_NODES = {
    "supplier_discovery": supplier_discovery_node,
    "document_analysis": document_analysis_node,
    "rfq_outreach": rfq_outreach_node,
    "response_analysis": response_analysis_node,
    "qualification_audit": qualification_audit_node,
    "selection_tasks": selection_tasks_node,
}


# =============================================================================
# Vendor Evaluation (added 2026-09-14, generalizing the graph engine)
#
# Every stage maps to a real or trivially-extracted synchronous function -
# no new business logic needed here, only agents/market_research_core.py's
# generate_requirements_core extraction (same shape as this session's
# earlier _core extractions). "evaluation" has no dedicated
# vendor-decision table anywhere in the app, so it reuses the same pattern
# selection_tasks_node already established: rank with score_leads_core,
# record the outcome as a task rather than inventing new persistence.
# =============================================================================

VENDOR_EVALUATION_STAGE_ORDER = ["requirements", "vendor-search", "outreach", "evaluation"]


def requirements_node(state: WorkflowGraphState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "requirements")
        return {
            "overview": raw.get("overview") or raw.get("product_category", ""),
            "context": raw.get("context", ""),
            "countries": raw.get("countries", ""),
            "industries": raw.get("industries", ""),
            "business_function": raw.get("business_function", ""),
            "frameworks": raw.get("frameworks", []),
            "response_format": raw.get("response_format", ""),
        }

    def execute(s, args):
        from agents.market_research_core import generate_requirements_core

        answer, error = generate_requirements_core(
            args["overview"], s["user_id"],
            context=args["context"], countries=args["countries"], industries=args["industries"],
            business_function=args["business_function"], frameworks=args["frameworks"],
            response_format=args["response_format"],
        )
        if error:
            raise RuntimeError(error)
        return {"requirements": answer}

    return run_stage(state, "requirements", propose, execute)


def vendor_search_node(state: WorkflowGraphState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "vendor-search")
        query = raw.get("query")
        if not query:
            requirements_text = ((s.get("stage_outputs") or {}).get("requirements") or {}).get("requirements") or ""
            query = requirements_text[:200]
        return {"query": query, "location": raw.get("location", "")}

    def execute(s, args):
        from agents.market_research.google_business_helper import GoogleBusinessSearcher

        result = GoogleBusinessSearcher().search_businesses(args["query"], args["location"])
        if not result.get("success", True) and result.get("error"):
            raise RuntimeError(result["error"])
        return result

    return run_stage(state, "vendor-search", propose, execute)


def vendor_outreach_node(state: WorkflowGraphState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "outreach")
        return {
            "subject": raw.get("subject", ""),
            "body": raw.get("body", ""),
            "businesses": raw.get("businesses") or _businesses_from_stage(s, "vendor-search"),
            "campaign_name": raw.get("campaign_name", "Vendor Outreach"),
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

    return run_stage(state, "outreach", propose, execute)


def evaluation_node(state: WorkflowGraphState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "evaluation")
        requirements_text = ((s.get("stage_outputs") or {}).get("requirements") or {}).get("requirements") or ""
        return {
            "requirement": raw.get("requirement") or requirements_text[:500],
            "businesses": raw.get("businesses") or _businesses_from_stage(s, "vendor-search"),
        }

    def execute(s, args):
        from agents.executive_assistant.service import create_task_core
        from agents.sales_helper_core import score_leads_core

        businesses = args["businesses"]
        if not businesses:
            return {"ranked": [], "task": None}

        results, error, status = score_leads_core(args["requirement"], businesses, s["user_id"])
        if error:
            raise RuntimeError(error)

        top = max(results, key=lambda r: r.get("match_score", 0)) if results else None
        task_result, task_error = None, None
        if top is not None:
            vendor_name = businesses[top["index"]].get("name", "the top-ranked vendor")
            task_result, task_error = create_task_core(
                s["user_id"],
                f"Review and confirm vendor: {vendor_name} (match {top.get('match_score', 0)})",
                description=top.get("short_summary", ""),
                project_id=s.get("project_id"),
                priority="High",
            )
            if task_error:
                raise RuntimeError(task_error)

        return {"ranked": results, "task": task_result}

    return run_stage(state, "evaluation", propose, execute)


_VENDOR_EVALUATION_NODES = {
    "requirements": requirements_node,
    "vendor-search": vendor_search_node,
    "outreach": vendor_outreach_node,
    "evaluation": evaluation_node,
}


# =============================================================================
# Lead Nurturing (added 2026-09-14, generalizing the graph engine)
#
# 3 of 4 stages reuse existing _core functions directly. "sequence"
# approximates the template's declared config.sequence_length: 5 as a
# single send - true multi-touch scheduling over time is a materially
# different feature (would need Celery-beat style recurring sends, not a
# one-shot graph node) and is explicitly out of scope for this pass.
# =============================================================================

LEAD_NURTURE_STAGE_ORDER = ["qualify", "personalize", "sequence", "followup"]


def qualify_node(state: WorkflowGraphState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "qualify")
        return {
            "requirement": raw.get("requirement", ""),
            "businesses": raw.get("businesses") or raw.get("lead_list") or [],
        }

    def execute(s, args):
        from agents.sales_helper_core import score_leads_core

        results, error, status = score_leads_core(args["requirement"], args["businesses"], s["user_id"])
        if error:
            raise RuntimeError(error)
        return {"results": results, "businesses": args["businesses"]}

    return run_stage(state, "qualify", propose, execute)


def personalize_node(state: WorkflowGraphState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "personalize")
        return {
            "channel": raw.get("channel", "email"),
            "content_type": raw.get("content_type", "post"),
            "user_context": raw.get("user_context", ""),
            "industry": raw.get("industry", "General"),
        }

    def execute(s, args):
        from agents.content_marketing.service import generate_content_core

        result, error = generate_content_core(
            args["channel"], args["content_type"], args["user_context"], s["user_id"],
            industry=args["industry"],
        )
        if error:
            raise RuntimeError(error)
        return result

    return run_stage(state, "personalize", propose, execute)


def sequence_node(state: WorkflowGraphState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "sequence")
        content = (s.get("stage_outputs") or {}).get("personalize") or {}
        qualified = (s.get("stage_outputs") or {}).get("qualify") or {}
        return {
            "subject": raw.get("subject", ""),
            "body": raw.get("body") or content.get("content", ""),
            "businesses": raw.get("businesses") or qualified.get("businesses") or [],
            "campaign_name": raw.get("campaign_name", "Lead Nurture Sequence"),
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

    return run_stage(state, "sequence", propose, execute)


def followup_node(state: WorkflowGraphState) -> Dict[str, Any]:
    def propose(s):
        raw = _stage_input(s, "followup")
        tasks = raw.get("tasks")
        if not tasks:
            sent = ((s.get("stage_outputs") or {}).get("sequence") or {}).get("count", 0)
            tasks = [{"title": f"Follow up on lead nurture sequence ({sent} sent)"}] if sent else []
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

    return run_stage(state, "followup", propose, execute)


_LEAD_NURTURE_NODES = {
    "qualify": qualify_node,
    "personalize": personalize_node,
    "sequence": sequence_node,
    "followup": followup_node,
}


# =============================================================================
# Template registry + graph construction
# =============================================================================

_TEMPLATE_GRAPHS: Dict[str, Dict[str, Any]] = {
    "supplier-qualification": {"stage_order": STAGE_ORDER, "nodes": _SUPPLIER_QUALIFICATION_NODES},
    "vendor-evaluation": {"stage_order": VENDOR_EVALUATION_STAGE_ORDER, "nodes": _VENDOR_EVALUATION_NODES},
    "lead-nurture": {"stage_order": LEAD_NURTURE_STAGE_ORDER, "nodes": _LEAD_NURTURE_NODES},
}

_compiled_graphs: Dict[str, Any] = {}


def stage_order_for(template_id: str) -> List[str]:
    return list(_TEMPLATE_GRAPHS[template_id]["stage_order"])


def build_graph(template_id: str):
    """Builds (but does not compile) the StateGraph for one template.
    Exposed separately from get_compiled_graph() so tests can compile it
    with an in-memory checkpointer instead of PostgresSaver."""
    entry = _TEMPLATE_GRAPHS[template_id]
    stage_order = entry["stage_order"]
    nodes = entry["nodes"]

    graph = StateGraph(WorkflowGraphState)
    for stage_id in stage_order:
        graph.add_node(stage_id, nodes[stage_id])

    graph.set_entry_point(stage_order[0])
    for a, b in zip(stage_order, stage_order[1:]):
        graph.add_edge(a, b)
    graph.add_edge(stage_order[-1], END)

    return graph


def get_compiled_graph(template_id: str):
    """Process-wide singleton per template_id, compiled with the shared
    Postgres checkpointer. Uses a psycopg ConnectionPool (rather than
    PostgresSaver.from_conn_string's single kept-open connection) since
    this lives for the life of a Celery worker process and needs to
    survive individual connection drops. PostgresSaver.setup() must have
    already been run once (deploy-time step, not an Alembic migration -
    see the plan) so its checkpoint tables exist before this connects."""
    if template_id not in _TEMPLATE_GRAPHS:
        raise ValueError(f"No orchestration graph registered for template_id={template_id!r}")

    if template_id not in _compiled_graphs:
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
        # own separate deploy step after all. Shared across every
        # template's graph - the checkpoint tables aren't per-template.
        checkpointer.setup()
        _compiled_graphs[template_id] = build_graph(template_id).compile(checkpointer=checkpointer)

    return _compiled_graphs[template_id]
