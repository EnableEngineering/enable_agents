"""Integration tests — the Lead Nurturing template's LangGraph nodes
(qualify/personalize/sequence/followup), added 2026-09-14 generalizing the
orchestration engine beyond Supplier Qualification.

Same eager-Celery, real-routes pattern as test_workflow_orchestration_routes.py
- see that file's docstring for why `import app` has to come first. The
generic guardrail mechanics (kill switch, autopilot budget cap) are already
covered by test_workflow_orchestration_graph.py against
qualification_audit_node - this file focuses on this template's own
propose()/execute() wiring and data flow instead of re-proving the
guardrails.

Note: `sequence`'s single-send approximation of the template's declared
config.sequence_length: 5 is a deliberate v1 simplification (see graph.py's
module docstring) - not tested as a "5 sends" behavior since it doesn't do
that by design.
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

STAGE_ORDER = ["qualify", "personalize", "sequence", "followup"]


def _bearer(app, user_id):
    with app.app_context():
        token = issue_browser_session_token(app.config["SECRET_KEY"], user_id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def project(flask_app):
    with flask_app.app_context():
        team = Team(team_id="team-lead-nurture-1", owner_id="user_lead_nurture", name="Lead Nurture Test Team")
        proj = Project(project_id="proj-lead-nurture-1", team_id="team-lead-nurture-1",
                        owner_id="user_lead_nurture", name="Lead Nurture Test Project")
        db.session.add(team)
        db.session.add(proj)
        db.session.commit()
        yield proj.project_id
        Project.query.filter_by(project_id="proj-lead-nurture-1").delete()
        Team.query.filter_by(team_id="team-lead-nurture-1").delete()
        db.session.commit()


@pytest.fixture
def template(flask_app):
    with flask_app.app_context():
        tpl = WorkflowTemplate.query.filter_by(template_id="lead-nurture").first()
        if not tpl:
            tpl = WorkflowTemplate(template_id="lead-nurture", name="Lead Nurturing",
                                    is_system=True, is_active=True)
            tpl.stages = [
                {"id": "qualify", "agent": "market_research"},
                {"id": "personalize", "agent": "content_marketing"},
                {"id": "sequence", "agent": "email_outreach"},
                {"id": "followup", "agent": "executive_assistant"},
            ]
            db.session.add(tpl)
            db.session.commit()
        yield tpl.template_id


@pytest.fixture
def instance(flask_app, project, template):
    with flask_app.app_context():
        inst = WorkflowInstance(
            instance_id="wf-instance-lead-nurture-1",
            template_id=template,
            user_id="user_lead_nurture",
            project_id=project,
            name="Lead nurture test run",
            status="pending",
            current_stage_index=0,
            autonomy_mode="co-pilot",
        )
        db.session.add(inst)
        db.session.commit()
        yield inst.instance_id
        WorkflowInstance.query.filter_by(instance_id="wf-instance-lead-nurture-1").delete()
        db.session.commit()


def test_full_pipeline_via_skip_resumes(client, flask_app, instance):
    """Walks all 4 stages by skipping each - interrupt() fires before any
    real _core function runs, so this needs no mocks at all."""
    headers = _bearer(flask_app, "user_lead_nurture")

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


def test_qualified_leads_flow_into_personalize_and_sequence(client, flask_app, instance, monkeypatch):
    """Approving qualify/personalize/sequence in turn must pass real data
    between stages: qualify's scored businesses feed sequence's recipient
    list, personalize's generated copy feeds sequence's email body."""
    import agents.sales_helper_core as shc
    import agents.content_marketing.service as cms

    def _fake_score_leads_core(requirement, businesses, user_id):
        return [{"index": i, "match_score": 90, "short_summary": "great fit"} for i in range(len(businesses))], None, 200

    def _fake_generate_content_core(channel, content_type, user_context, user_id, **kwargs):
        return {"content_id": "content_test123", "channel": channel, "content_type": content_type,
                "content": "Hi there - following up on your interest!", "variations": [], "metadata": {}}, None

    monkeypatch.setattr(shc, "score_leads_core", _fake_score_leads_core)
    monkeypatch.setattr(cms, "generate_content_core", _fake_generate_content_core)

    headers = _bearer(flask_app, "user_lead_nurture")
    client.post(f"/api/workflows/instances/{instance}/run", headers=headers)

    # qualify
    res = client.post(f"/api/workflows/instances/{instance}/resume", json={
        "action": "edit",
        "data": {"requirement": "mid-market SaaS companies", "businesses": [
            {"name": "Lead One", "email": "lead1@example.com"},
            {"name": "Lead Two", "email": "lead2@example.com"},
        ]},
    }, headers=headers)
    assert res.status_code == 202

    # personalize
    res = client.post(f"/api/workflows/instances/{instance}/resume", json={"action": "approve"}, headers=headers)
    assert res.status_code == 202

    # sequence - skip so no real SMTP call happens, just confirm the
    # proposed input (visible via pending-approval before this resume)
    # already carried the right businesses/body through.
    res = client.get(f"/api/workflows/instances/{instance}/pending-approval", headers=headers)
    proposed = res.get_json()["interrupt"]["proposed_input"]
    assert proposed["businesses"] == [
        {"name": "Lead One", "email": "lead1@example.com"},
        {"name": "Lead Two", "email": "lead2@example.com"},
    ]
    assert proposed["body"] == "Hi there - following up on your interest!"

    res = client.post(f"/api/workflows/instances/{instance}/resume", json={"action": "skip"}, headers=headers)
    assert res.status_code == 202
    # followup
    res = client.post(f"/api/workflows/instances/{instance}/resume", json={"action": "skip"}, headers=headers)
    assert res.status_code == 202

    with flask_app.app_context():
        refreshed = WorkflowInstance.query.filter_by(instance_id=instance).first()
        assert refreshed.status == "completed"
        assert refreshed.stage_states["qualify"]["data"]["businesses"] == [
            {"name": "Lead One", "email": "lead1@example.com"},
            {"name": "Lead Two", "email": "lead2@example.com"},
        ]
        assert refreshed.stage_states["personalize"]["data"]["content"] == "Hi there - following up on your interest!"
