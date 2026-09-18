"""Integration tests — the Vendor Evaluation template's LangGraph nodes
(requirements/vendor-search/outreach/evaluation), added 2026-09-14
generalizing the orchestration engine beyond Supplier Qualification.

Same eager-Celery, real-routes pattern as test_workflow_orchestration_routes.py
- see that file's docstring for why `import app` has to come first. The
generic guardrail mechanics (kill switch, autopilot budget cap) are
already covered by test_workflow_orchestration_graph.py against
qualification_audit_node - run_stage() is shared code, so this file
focuses on this template's own propose()/execute() wiring and data flow
instead of re-proving the guardrails.
"""
import pytest

import app as _app_module  # noqa: F401

from core.celery_app import celery
from core.database import db
from core.models import Project, Team
from core.session_token import issue_browser_session_token
from models.workflow import WorkflowInstance, WorkflowTemplate

celery.conf.task_always_eager = True
celery.conf.task_eager_propagates = True

STAGE_ORDER = ["requirements", "vendor-search", "outreach", "evaluation"]


def _bearer(app, user_id):
    with app.app_context():
        token = issue_browser_session_token(app.config["SECRET_KEY"], user_id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def project(flask_app):
    with flask_app.app_context():
        team = Team(team_id="team-vendor-eval-1", owner_id="user_vendor_eval", name="Vendor Eval Test Team")
        proj = Project(project_id="proj-vendor-eval-1", team_id="team-vendor-eval-1",
                        owner_id="user_vendor_eval", name="Vendor Eval Test Project")
        db.session.add(team)
        db.session.add(proj)
        db.session.commit()
        yield proj.project_id
        Project.query.filter_by(project_id="proj-vendor-eval-1").delete()
        Team.query.filter_by(team_id="team-vendor-eval-1").delete()
        db.session.commit()


@pytest.fixture
def template(flask_app):
    with flask_app.app_context():
        tpl = WorkflowTemplate.query.filter_by(template_id="vendor-evaluation").first()
        if not tpl:
            tpl = WorkflowTemplate(template_id="vendor-evaluation", name="Vendor Evaluation",
                                    is_system=True, is_active=True)
            tpl.stages = [
                {"id": "requirements", "agent": "market_research"},
                {"id": "vendor-search", "agent": "market_research"},
                {"id": "outreach", "agent": "email_outreach"},
                {"id": "evaluation", "agent": "executive_assistant"},
            ]
            db.session.add(tpl)
            db.session.commit()
        yield tpl.template_id


@pytest.fixture
def instance(flask_app, project, template):
    with flask_app.app_context():
        inst = WorkflowInstance(
            instance_id="wf-instance-vendor-eval-1",
            template_id=template,
            user_id="user_vendor_eval",
            project_id=project,
            name="Vendor eval test run",
            status="pending",
            current_stage_index=0,
            autonomy_mode="co-pilot",
        )
        db.session.add(inst)
        db.session.commit()
        yield inst.instance_id
        WorkflowInstance.query.filter_by(instance_id="wf-instance-vendor-eval-1").delete()
        db.session.commit()


def test_full_pipeline_via_skip_resumes(client, flask_app, instance):
    """Walks all 4 stages by skipping each - interrupt() fires before any
    real _core function runs, so this needs no mocks at all."""
    headers = _bearer(flask_app, "user_vendor_eval")

    res = client.post(f"/api/workflows/instances/{instance}/run", headers=headers)
    assert res.status_code == 202

    for expected_stage in STAGE_ORDER:
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
        for stage_id in STAGE_ORDER:
            assert refreshed.stage_states[stage_id]["data"] == {"skipped": True}


def test_requirements_flows_into_vendor_search_and_evaluation(client, flask_app, instance, monkeypatch):
    """Approving each stage in turn must actually call through and pass
    real data between stages: requirements' answer feeds vendor-search's
    query, vendor-search's businesses feed evaluation's ranking, and the
    top-ranked vendor gets a real ExecTask created."""
    import agents.market_research_core as mrc
    import agents.market_research.google_business_helper as gbh
    import agents.sales_helper_core as shc

    # evaluation's execute() runs the real score_leads_core, which calls
    # OpenAI whenever OPENAI_API_KEY is set: with a real key (a dev
    # container) this test silently spent money on every run, and with the
    # stub key CI uses it 401'd and the stage re-paused instead of
    # completing. Mocked like test_workflow_orchestration_lead_nurture.py.
    def _fake_score_leads_core(requirement, businesses, user_id):
        return [{"index": i, "match_score": 90 - 10 * i, "short_summary": "fit"} for i in range(len(businesses))], None, 200

    def _fake_generate_requirements_core(overview, user_id, **kwargs):
        return "Need a reliable CNC machining vendor with ISO 9001 certification.", None

    def _fake_search_businesses(self, query, location, **kwargs):
        assert "CNC machining" in query or "ISO 9001" in query, f"query did not carry requirements text: {query!r}"
        return {
            "success": True,
            "businesses": [
                {"name": "Acme CNC", "email": "sales@acmecnc.example.com"},
                {"name": "Beta Machining", "email": "info@betamachining.example.com"},
            ],
        }

    monkeypatch.setattr(mrc, "generate_requirements_core", _fake_generate_requirements_core)
    monkeypatch.setattr(shc, "score_leads_core", _fake_score_leads_core)
    monkeypatch.setattr(gbh.GoogleBusinessSearcher, "search_businesses", _fake_search_businesses)

    headers = _bearer(flask_app, "user_vendor_eval")
    client.post(f"/api/workflows/instances/{instance}/run", headers=headers)

    # requirements
    res = client.post(f"/api/workflows/instances/{instance}/resume", json={"action": "approve"}, headers=headers)
    assert res.status_code == 202
    # vendor-search
    res = client.post(f"/api/workflows/instances/{instance}/resume", json={"action": "approve"}, headers=headers)
    assert res.status_code == 202
    # outreach - skip, no SMTP/Gmail mocking needed
    res = client.post(f"/api/workflows/instances/{instance}/resume", json={"action": "skip"}, headers=headers)
    assert res.status_code == 202
    # evaluation - approve, ranks the 2 businesses and creates a task for the top one
    res = client.post(f"/api/workflows/instances/{instance}/resume", json={"action": "approve",
                       "data": {"requirement": "Need a reliable CNC machining vendor with ISO 9001 certification."}},
                       headers=headers)
    assert res.status_code == 202

    with flask_app.app_context():
        refreshed = WorkflowInstance.query.filter_by(instance_id=instance).first()
        assert refreshed.status == "completed"

        vendor_search_data = refreshed.stage_states["vendor-search"]["data"]
        assert len(vendor_search_data["businesses"]) == 2

        evaluation_data = refreshed.stage_states["evaluation"]["data"]
        assert len(evaluation_data["ranked"]) == 2
        # evaluation_node's execute() creates exactly one task (for the
        # top-ranked vendor) via create_task_core, which returns the task
        # dict directly - not per-task {result, error} pairs, since there's
        # only ever one here (unlike selection_tasks_node's multi-task loop).
        assert evaluation_data["task"] is not None
        assert "Review and confirm vendor" in evaluation_data["task"]["title"]
