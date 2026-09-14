"""Integration tests — the LangGraph StateGraph itself (state.py/graph.py).

Requires Python >=3.10 (langgraph's floor) - run with a separate venv from
the rest of tests/integration/, e.g.:
    /path/to/py311venv/bin/python3 -m pytest tests/integration/test_workflow_orchestration_graph.py

Exercises supplier_discovery and qualification_audit/selection_tasks end
to end (real DB writes via their already-tested _core functions) since
those three don't lazily import the app.py monolith - document_analysis
and rfq_outreach do (see agents/email_outreach/service.py's docstring)
and are covered at the _core level in test_workflow_orchestration_core.py
instead. Uses an in-memory checkpointer here (interrupt/resume semantics
already verified against a real PostgresSaver+ConnectionPool by hand -
see graph.py's get_compiled_graph() docstring) to keep this fast and
independent of Postgres checkpoint-table setup.
"""
import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from core.database import db
from core.models import Project, Team
from models.workflow import WorkflowInstance, WorkflowTemplate


@pytest.fixture
def project(flask_app):
    with flask_app.app_context():
        team = Team(team_id="team-graph-1", owner_id="user_graph", name="Graph Test Team")
        proj = Project(project_id="proj-graph-1", team_id="team-graph-1",
                        owner_id="user_graph", name="Graph Test Project")
        db.session.add(team)
        db.session.add(proj)
        db.session.commit()
        yield proj.project_id
        Project.query.filter_by(project_id="proj-graph-1").delete()
        Team.query.filter_by(team_id="team-graph-1").delete()
        db.session.commit()


@pytest.fixture
def template(flask_app):
    with flask_app.app_context():
        tpl = WorkflowTemplate.query.filter_by(template_id="supplier-qualification").first()
        if not tpl:
            tpl = WorkflowTemplate(template_id="supplier-qualification", name="Supplier Qualification Pipeline",
                                    is_system=True, is_active=True)
            tpl.stages = [
                {"id": "supplier_discovery", "agent": "market_research"},
                {"id": "document_analysis", "agent": "data_insights"},
                {"id": "rfq_outreach", "agent": "email_outreach"},
                {"id": "response_analysis", "agent": "sales_helper"},
                {"id": "qualification_audit", "agent": "supply_chain"},
                {"id": "selection_tasks", "agent": "executive_assistant"},
            ]
            db.session.add(tpl)
            db.session.commit()
        yield tpl.template_id


@pytest.fixture
def instance(flask_app, project, template):
    with flask_app.app_context():
        inst = WorkflowInstance(
            instance_id="wf-instance-graph-1",
            template_id=template,
            user_id="user_graph",
            project_id=project,
            name="Graph test run",
            status="pending",
            current_stage_index=0,
            autonomy_mode="autopilot",
        )
        db.session.add(inst)
        db.session.commit()
        yield inst.instance_id
        WorkflowInstance.query.filter_by(instance_id="wf-instance-graph-1").delete()
        db.session.commit()


def test_build_graph_structure():
    """Pure LangGraph wiring check - no DB, no backend deps beyond state.py.
    Covers all 3 registered templates, not just Supplier Qualification."""
    from agents.workflow_orchestration.graph import build_graph, stage_order_for

    for template_id in ["supplier-qualification", "vendor-evaluation", "lead-nurture"]:
        compiled = build_graph(template_id).compile(checkpointer=InMemorySaver())
        node_names = set(compiled.get_graph().nodes.keys())
        for stage_id in stage_order_for(template_id):
            assert stage_id in node_names, f"{template_id}: missing node for stage {stage_id}"


def test_get_compiled_graph_rejects_unregistered_template(flask_app):
    """market-launch has no orchestration graph (its `research` stage has
    no real backing logic - see docs/todo.md) - get_compiled_graph must
    fail loudly rather than silently running the wrong template's graph
    against it (which the pre-2026-09-14 single-graph design would have
    done for ANY template_id, a real latent bug closed by this check)."""
    from agents.workflow_orchestration.graph import get_compiled_graph

    with flask_app.app_context():
        with pytest.raises(ValueError):
            get_compiled_graph("market-launch")


def test_qualification_audit_and_selection_tasks_autopilot(flask_app, instance, project):
    """Runs just the last two stages directly (not via the full 6-stage
    graph, to avoid needing supplier_discovery's real Google Places call)
    to prove run_stage()'s autopilot dispatch + _sync_legacy_state's
    dual-write both work against a real WorkflowInstance row."""
    from agents.workflow_orchestration.graph import (
        qualification_audit_node,
        selection_tasks_node,
    )

    with flask_app.app_context():
        from agents.supply_chain.models import SCSupplier

        supplier = SCSupplier(
            supplier_id="supplier-graph-1", project_id=project,
            user_id="user_graph", name="Acme Graph Supplier",
        )
        db.session.add(supplier)
        db.session.commit()

        state = {
            "instance_id": instance,
            "user_id": "user_graph",
            "project_id": project,
            "current_stage_id": "",
            "initial_inputs": {
                "qualification_audit": {"audits": [{"supplier_id": "supplier-graph-1", "score": 85}]},
            },
            "stage_outputs": {},
            "autonomy_mode": "autopilot",
            "errors": [],
        }

        audit_update = qualification_audit_node(state)
        assert audit_update["errors"] == []
        audited = audit_update["stage_outputs"]["qualification_audit"]["audited"]
        assert audited[0]["result"]["auditStatus"] == "passed"

        state["stage_outputs"].update(audit_update["stage_outputs"])

        tasks_update = selection_tasks_node(state)
        assert tasks_update["errors"] == []
        created = tasks_update["stage_outputs"]["selection_tasks"]["created"]
        assert len(created) == 1
        assert created[0]["result"]["title"] == "Follow up with supplier Acme Graph Supplier"

        # Dual-write into the legacy flat columns must be keyed by the
        # actual stage_id each node ran, not by call order - these two
        # stages are indices 4 and 5 in STAGE_ORDER, so current_stage_index
        # (the furthest stage reached) ends at 6 even though only 2 of the
        # 6 nodes actually ran in this test.
        refreshed = WorkflowInstance.query.filter_by(instance_id=instance).first()
        assert refreshed.current_stage_index == 6
        assert "qualification_audit" in refreshed.stage_states
        assert "selection_tasks" in refreshed.stage_states
        assert "supplier_discovery" not in refreshed.stage_states

        SCSupplier.query.filter_by(supplier_id="supplier-graph-1").delete()
        db.session.commit()


def test_qualification_audit_interrupt_and_resume(flask_app, instance, project):
    """Co-pilot mode: the node must pause via interrupt() before auditing,
    then apply the human's edited score on resume."""
    from typing import TypedDict
    from langgraph.graph import StateGraph, END
    from agents.workflow_orchestration.graph import qualification_audit_node

    with flask_app.app_context():
        from agents.supply_chain.models import SCSupplier

        supplier = SCSupplier(
            supplier_id="supplier-graph-2", project_id=project,
            user_id="user_graph", name="Acme Graph Supplier 2",
        )
        db.session.add(supplier)
        db.session.commit()

        class S(TypedDict):
            instance_id: str
            user_id: str
            project_id: str
            current_stage_id: str
            initial_inputs: dict
            stage_outputs: dict
            autonomy_mode: str
            errors: list

        g = StateGraph(S)
        g.add_node("qualification_audit", qualification_audit_node)
        g.set_entry_point("qualification_audit")
        g.add_edge("qualification_audit", END)
        compiled = g.compile(checkpointer=InMemorySaver())

        config = {"configurable": {"thread_id": f"{instance}-copilot"}}
        initial_state = {
            "instance_id": instance,
            "user_id": "user_graph",
            "project_id": project,
            "current_stage_id": "",
            "initial_inputs": {
                "qualification_audit": {"audits": [{"supplier_id": "supplier-graph-2", "score": 40}]},
            },
            "stage_outputs": {},
            "autonomy_mode": "co-pilot",
            "errors": [],
        }

        result = compiled.invoke(initial_state, config=config)
        assert "__interrupt__" in result
        proposed = result["__interrupt__"][0].value["proposed_input"]
        assert proposed["audits"][0]["score"] == 40

        resumed = compiled.invoke(
            Command(resume={"action": "edit", "data": {"audits": [{"supplier_id": "supplier-graph-2", "score": 95}]}}),
            config=config,
        )
        audited = resumed["stage_outputs"]["qualification_audit"]["audited"]
        assert audited[0]["result"]["score"] == 95
        assert audited[0]["result"]["auditStatus"] == "passed"

        SCSupplier.query.filter_by(supplier_id="supplier-graph-2").delete()
        db.session.commit()


# ── Guardrails (approved orchestration plan, added on top of the restored
# branch) ─────────────────────────────────────────────────────────────────

def test_kill_switch_forces_skip_regardless_of_autonomy_mode(flask_app, instance, project):
    """A human pausing the instance (WorkflowInstance.status == "paused")
    must stop real side effects even in autopilot mode - run_stage() must
    never reach execute() once paused, and must never call interrupt()
    either (there's no one left to resume it)."""
    from agents.workflow_orchestration.graph import qualification_audit_node

    with flask_app.app_context():
        from agents.supply_chain.models import SCSupplier

        supplier = SCSupplier(
            supplier_id="supplier-graph-killswitch", project_id=project,
            user_id="user_graph", name="Should Not Be Audited",
        )
        db.session.add(supplier)
        db.session.commit()

        inst = WorkflowInstance.query.filter_by(instance_id=instance).first()
        inst.status = "paused"
        db.session.commit()

        state = {
            "instance_id": instance,
            "user_id": "user_graph",
            "project_id": project,
            "current_stage_id": "",
            "initial_inputs": {
                "qualification_audit": {"audits": [{"supplier_id": "supplier-graph-killswitch", "score": 85}]},
            },
            "stage_outputs": {},
            "autonomy_mode": "autopilot",
            "errors": [],
        }

        update = qualification_audit_node(state)
        assert update["stage_outputs"]["qualification_audit"] == {"skipped": True, "reason": "paused"}

        # The real side effect must never have run.
        refreshed_supplier = SCSupplier.query.filter_by(supplier_id="supplier-graph-killswitch").first()
        assert refreshed_supplier.audit_status == "pending"
        assert refreshed_supplier.score is None

        SCSupplier.query.filter_by(supplier_id="supplier-graph-killswitch").delete()
        db.session.commit()


def test_autopilot_over_budget_falls_back_to_interrupt(flask_app, instance, project):
    """Autopilot mode normally auto-approves with no interrupt() call. If
    the project's monthly_budget_usd is already met or exceeded by this
    month's spend, the node must fall back to a real interrupt() instead -
    one human checkpoint on the node that would have gone over, not a
    silent auto-approve and not a hard block on the whole run."""
    from typing import TypedDict
    from langgraph.graph import StateGraph, END
    from langgraph.checkpoint.memory import InMemorySaver
    from agents.workflow_orchestration.graph import qualification_audit_node

    with flask_app.app_context():
        from core.models import AIUsageLog, Project
        from agents.supply_chain.models import SCSupplier

        supplier = SCSupplier(
            supplier_id="supplier-graph-budget", project_id=project,
            user_id="user_graph", name="Over Budget Supplier",
        )
        db.session.add(supplier)

        proj = Project.query.filter_by(project_id=project).first()
        proj.monthly_budget_usd = 1.0
        db.session.add(AIUsageLog(
            user_id="user_graph", project_id=project, agent="test.seed",
            provider="openai", model="gpt-4o-mini", key_source="platform",
            estimated_cost_usd=5.0,
        ))
        db.session.commit()

        class S(TypedDict):
            instance_id: str
            user_id: str
            project_id: str
            current_stage_id: str
            initial_inputs: dict
            stage_outputs: dict
            autonomy_mode: str
            errors: list

        g = StateGraph(S)
        g.add_node("qualification_audit", qualification_audit_node)
        g.set_entry_point("qualification_audit")
        g.add_edge("qualification_audit", END)
        compiled = g.compile(checkpointer=InMemorySaver())

        config = {"configurable": {"thread_id": f"{instance}-budget"}}
        initial_state = {
            "instance_id": instance,
            "user_id": "user_graph",
            "project_id": project,
            "current_stage_id": "",
            "initial_inputs": {
                "qualification_audit": {"audits": [{"supplier_id": "supplier-graph-budget", "score": 85}]},
            },
            "stage_outputs": {},
            "autonomy_mode": "autopilot",
            "errors": [],
        }

        result = compiled.invoke(initial_state, config=config)
        assert "__interrupt__" in result, "autopilot should have fallen back to interrupt() over budget"

        # The real side effect must not have run yet - it's parked pending a
        # human decision, same as suggest/co-pilot would be.
        refreshed_supplier = SCSupplier.query.filter_by(supplier_id="supplier-graph-budget").first()
        assert refreshed_supplier.audit_status == "pending"

        resumed = compiled.invoke(Command(resume={"action": "approve"}), config=config)
        audited = resumed["stage_outputs"]["qualification_audit"]["audited"]
        assert audited[0]["result"]["auditStatus"] == "passed"

        AIUsageLog.query.filter_by(project_id=project, agent="test.seed").delete()
        SCSupplier.query.filter_by(supplier_id="supplier-graph-budget").delete()
        db.session.commit()
