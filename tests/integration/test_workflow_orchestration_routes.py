"""Integration tests — the /run, /pending-approval, /resume, /autonomy
routes (routes/workflows.py) added for LangGraph orchestration.

Requires Python >=3.10 (langgraph's floor), same as
test_workflow_orchestration_graph.py. Celery runs in eager mode (inline,
synchronous) so this needs no running broker/worker.

Every stage is walked via "skip" resumes rather than "approve": run_stage()
calls interrupt() *before* invoking a stage's real _core function, so a
skip never executes it - meaning this can walk the entire 6-stage pipeline
without mocking Google Places, OpenAI, Gmail, or SMTP. The one non-skip
path (supplier_discovery approved with a mocked search) is exercised
separately to prove "approve" actually calls through.
"""
import pytest

# app.py's own import unconditionally calls make_celery(app) at module level,
# which *replaces* core.celery_app's module-level `celery` singleton with a
# new Celery instance bound to the real app. If that import happens (even
# transitively, e.g. via another test module lazily importing app.py for
# send_bulk_emails_core/score_leads_core) after this file has already grabbed
# and configured `celery`, the eager settings below end up on an orphaned
# instance while routes/workflows.py's tasks bind to the new one - `.delay()`
# then silently tries to publish to a real broker and hangs waiting on a
# result nothing will ever produce. Importing app.py here first forces that
# one-time reassignment to happen before `celery` is captured, so the object
# this file configures is the same stable one every task module binds to.
import app as _app_module  # noqa: F401

from core.celery_app import celery
from core.database import db
from core.models import Project, Team
from core.session_token import issue_browser_session_token
from models.workflow import WorkflowInstance, WorkflowTemplate

celery.conf.task_always_eager = True
celery.conf.task_eager_propagates = True


def _bearer(app, user_id):
    with app.app_context():
        token = issue_browser_session_token(app.config["SECRET_KEY"], user_id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def project(flask_app):
    with flask_app.app_context():
        team = Team(team_id="team-routes-1", owner_id="user_routes", name="Routes Test Team")
        proj = Project(project_id="proj-routes-1", team_id="team-routes-1",
                        owner_id="user_routes", name="Routes Test Project")
        db.session.add(team)
        db.session.add(proj)
        db.session.commit()
        yield proj.project_id
        Project.query.filter_by(project_id="proj-routes-1").delete()
        Team.query.filter_by(team_id="team-routes-1").delete()
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
            instance_id="wf-instance-routes-1",
            template_id=template,
            user_id="user_routes",
            project_id=project,
            name="Routes test run",
            status="pending",
            current_stage_index=0,
            autonomy_mode="co-pilot",
        )
        db.session.add(inst)
        db.session.commit()
        yield inst.instance_id
        WorkflowInstance.query.filter_by(instance_id="wf-instance-routes-1").delete()
        db.session.commit()


def test_run_pauses_at_first_stage(client, flask_app, instance):
    headers = _bearer(flask_app, "user_routes")

    res = client.post(f"/api/workflows/instances/{instance}/run", headers=headers)
    assert res.status_code == 202

    res = client.get(f"/api/workflows/instances/{instance}/pending-approval", headers=headers)
    assert res.status_code == 200
    data = res.get_json()
    assert data["pending"] is True
    assert data["interrupt"]["stage_id"] == "supplier_discovery"


def test_full_pipeline_via_skip_resumes(client, flask_app, instance):
    """Walks all 6 stages by skipping each one - never calls a single real
    external API - and confirms the instance ends up completed with every
    stage recorded (as skipped) in the legacy stage_states column."""
    headers = _bearer(flask_app, "user_routes")
    stage_order = [
        "supplier_discovery", "document_analysis", "rfq_outreach",
        "response_analysis", "qualification_audit", "selection_tasks",
    ]

    res = client.post(f"/api/workflows/instances/{instance}/run", headers=headers)
    assert res.status_code == 202

    for expected_stage in stage_order:
        res = client.get(f"/api/workflows/instances/{instance}/pending-approval", headers=headers)
        data = res.get_json()
        assert data["pending"] is True, f"expected a pending interrupt at {expected_stage}"
        assert data["interrupt"]["stage_id"] == expected_stage

        res = client.post(f"/api/workflows/instances/{instance}/resume", json={"action": "skip"}, headers=headers)
        assert res.status_code == 202

    res = client.get(f"/api/workflows/instances/{instance}/pending-approval", headers=headers)
    assert res.get_json()["pending"] is False

    with flask_app.app_context():
        refreshed = WorkflowInstance.query.filter_by(instance_id=instance).first()
        assert refreshed.status == "completed"
        for stage_id in stage_order:
            assert refreshed.stage_states[stage_id]["data"] == {"skipped": True}


def test_approve_calls_through_to_real_function(client, flask_app, instance, monkeypatch):
    """Approving (rather than skipping) the first stage must actually
    invoke the underlying agent function - proven with a mocked search so
    this makes no real network call."""
    import agents.market_research.google_business_helper as gbh

    def _fake_search_businesses(self, query, location, **kwargs):
        return {"success": True, "searchQuery": query, "location": location,
                "businesses": [{"name": "Mock Supplier", "email": "mock@example.com"}]}

    monkeypatch.setattr(gbh.GoogleBusinessSearcher, "search_businesses", _fake_search_businesses)

    headers = _bearer(flask_app, "user_routes")
    client.post(f"/api/workflows/instances/{instance}/run", headers=headers)

    res = client.post(f"/api/workflows/instances/{instance}/resume", json={"action": "approve"}, headers=headers)
    assert res.status_code == 202

    with flask_app.app_context():
        refreshed = WorkflowInstance.query.filter_by(instance_id=instance).first()
        discovery = refreshed.stage_states["supplier_discovery"]["data"]
        assert discovery["businesses"] == [{"name": "Mock Supplier", "email": "mock@example.com"}]

    # Now paused at document_analysis, waiting for its own approval.
    res = client.get(f"/api/workflows/instances/{instance}/pending-approval", headers=headers)
    assert res.get_json()["interrupt"]["stage_id"] == "document_analysis"


def test_set_autonomy_mode(client, flask_app, instance):
    headers = _bearer(flask_app, "user_routes")
    res = client.patch(f"/api/workflows/instances/{instance}/autonomy", json={"mode": "autopilot"}, headers=headers)
    assert res.status_code == 200
    assert res.get_json()["instance"]["autonomyMode"] == "autopilot"

    res = client.patch(f"/api/workflows/instances/{instance}/autonomy", json={"mode": "not-a-mode"}, headers=headers)
    assert res.status_code == 400


def test_legacy_manual_routes_reject_graph_orchestrated_instance(client, flask_app, instance):
    """/start, /complete-stage, /stages/<id>/data must all reject a graph-
    orchestrated instance rather than silently writing stage_states/context
    directly - that's exactly the double-write path that used to let a
    graph-orchestrated instance desync from its own LangGraph checkpoint
    (see state.py's docstring)."""
    headers = _bearer(flask_app, "user_routes")

    res = client.post(f"/api/workflows/instances/{instance}/start", headers=headers)
    assert res.status_code == 400
    assert "graph engine" in res.get_json()["error"]

    res = client.post(f"/api/workflows/instances/{instance}/complete-stage", json={"data": {}}, headers=headers)
    assert res.status_code == 400
    assert "graph engine" in res.get_json()["error"]

    res = client.post(f"/api/workflows/instances/{instance}/stages/supplier_discovery/data",
                       json={"data": {"query": "hi"}}, headers=headers)
    assert res.status_code == 400
    assert "graph engine" in res.get_json()["error"]


def test_autopilot_runs_all_stages_with_zero_interrupts(client, flask_app, instance, monkeypatch):
    """Autopilot mode must run every stage's real function with no pause.
    document_analysis is mocked outright (its real path calls OpenAI even
    for an empty document list); every other stage naturally short-circuits
    safely on empty input (no valid emails / no requirement text / no
    audits / no tasks) without needing a mock."""
    import agents.market_research.google_business_helper as gbh
    import app as app_module

    def _fake_search_businesses(self, query, location, **kwargs):
        return {"success": True, "businesses": []}

    def _fake_process_documents(*args, **kwargs):
        return "mocked answer"

    monkeypatch.setattr(gbh.GoogleBusinessSearcher, "search_businesses", _fake_search_businesses)
    monkeypatch.setattr(app_module, "process_documents_with_kg_rag", _fake_process_documents)

    headers = _bearer(flask_app, "user_routes")
    client.patch(f"/api/workflows/instances/{instance}/autonomy", json={"mode": "autopilot"}, headers=headers)

    res = client.post(f"/api/workflows/instances/{instance}/run", headers=headers)
    assert res.status_code == 202

    res = client.get(f"/api/workflows/instances/{instance}/pending-approval", headers=headers)
    assert res.get_json()["pending"] is False

    with flask_app.app_context():
        refreshed = WorkflowInstance.query.filter_by(instance_id=instance).first()
        assert refreshed.status == "completed"
