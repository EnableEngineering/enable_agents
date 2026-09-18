"""Integration tests - cost tracking and budgets: attribution of AI usage to
workflow runs, per-user and per-project monthly budgets (status + once-a-month
80% / over alerts), the usage/budget APIs, autopilot's budget pause, and the
/ready probe. Alert emails are always intercepted - nothing is ever sent.
"""
import uuid

import pytest

from core.database import db


def _uid(prefix="cost"):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@example.com"


@pytest.fixture
def emails(flask_app, monkeypatch):
    """Capture budget alert emails instead of sending them."""
    sent = []

    def _fake_send(sender, recipient, subject, body):
        sent.append({"to": recipient, "subject": subject, "body": body})
        return True, None

    monkeypatch.setattr("core.email_sender.send_platform_email", _fake_send)
    with flask_app.app_context():
        yield sent


def _log(user_id, cost, project_id=None, agent="test.agent", **kwargs):
    """Write one usage row through the real logging path (which also runs the
    budget check), with a known cost."""
    from core.ai_client import log_external_usage

    log_external_usage(user_id, project_id, agent, "test", "test-model", cost, **kwargs)


# ── pure status logic ────────────────────────────────────────────────────

def test_budget_state_thresholds():
    from core.budget import budget_state

    assert budget_state(5, None)["state"] == "none"
    assert budget_state(0, 10)["state"] == "ok"
    assert budget_state(7.99, 10)["state"] == "ok"
    assert budget_state(8.0, 10)["state"] == "warning"    # 80% is the boundary
    assert budget_state(9.99, 10)["state"] == "warning"
    assert budget_state(10.0, 10)["state"] == "over"
    over = budget_state(12.5, 10)
    assert over["state"] == "over" and over["percentUsed"] == 125.0 and over["remainingUsd"] == 0.0
    # a $0 budget means "spend nothing": any spend is over, no spend is fine
    assert budget_state(0, 0)["state"] == "ok"
    assert budget_state(0.01, 0)["state"] == "over"


def test_dated_model_names_use_their_base_models_price():
    from core.ai_client import estimate_cost_usd

    exact = estimate_cost_usd("gpt-4o-mini", 1000, 1000)
    assert estimate_cost_usd("gpt-4o-mini-2024-07-18", 1000, 1000) == exact
    # longest prefix wins: gpt-4o-* must not be priced as plain gpt-4
    assert estimate_cost_usd("gpt-4o-2024-08-06", 1000, 0) == estimate_cost_usd("gpt-4o", 1000, 0)
    assert estimate_cost_usd("gpt-4o-2024-08-06", 1000, 0) != estimate_cost_usd("gpt-4", 1000, 0)
    # unknown models still fall back to the default rate instead of erroring
    assert estimate_cost_usd("some-new-model", 1000, 0) > 0


# ── attribution to workflow runs ─────────────────────────────────────────

def test_usage_inside_a_stage_scope_is_attributed_to_the_run_and_stage(flask_app, emails):
    from core.models import AIUsageLog
    from core.usage_context import usage_scope

    user = _uid("attr")
    _log(user, 0.10)  # outside any workflow
    with usage_scope("wf-instance-x", "qualify"):
        _log(user, 0.25)
        with usage_scope("wf-instance-y", "sequence"):  # nested scope wins, then restores
            _log(user, 0.05)
        _log(user, 0.02)

    rows = AIUsageLog.query.filter_by(user_id=user).order_by(AIUsageLog.id).all()
    assert [(r.workflow_instance_id, r.workflow_stage_id) for r in rows] == [
        (None, None), ("wf-instance-x", "qualify"), ("wf-instance-y", "sequence"), ("wf-instance-x", "qualify"),
    ]


def test_zero_cost_external_usage_is_not_logged(flask_app, emails):
    from core.models import AIUsageLog

    user = _uid("zero")
    _log(user, 0.0)
    assert AIUsageLog.query.filter_by(user_id=user).count() == 0


# ── budgets and alerts ───────────────────────────────────────────────────

def test_user_budget_alerts_once_at_80_percent_and_once_when_over(flask_app, emails):
    from core.budget import set_user_budget, user_budget_status

    user = _uid("ubudget")
    set_user_budget(user, 10.0)

    _log(user, 5.0)
    assert emails == []                                   # 50%: silent

    _log(user, 3.5)                                       # 85%: heads-up
    assert len(emails) == 1 and emails[0]["to"] == user
    assert "85%" in emails[0]["subject"]
    assert user_budget_status(user)["state"] == "warning"

    _log(user, 0.5)                                       # 90%: no second heads-up
    assert len(emails) == 1

    _log(user, 2.0)                                       # 110%: over
    assert len(emails) == 2 and "crossed" in emails[1]["subject"]
    assert user_budget_status(user)["state"] == "over"

    _log(user, 1.0)                                       # still over: no repeat
    assert len(emails) == 2


def test_jumping_straight_past_the_limit_sends_only_the_over_email(flask_app, emails):
    from core.budget import set_user_budget

    user = _uid("jump")
    set_user_budget(user, 1.0)
    _log(user, 5.0)
    assert len(emails) == 1 and "crossed" in emails[0]["subject"]
    _log(user, 0.1)
    assert len(emails) == 1  # counts as warned too - no belated 80% email


def test_changing_the_budget_rearms_the_alerts(flask_app, emails):
    from core.budget import set_user_budget

    user = _uid("rearm")
    set_user_budget(user, 1.0)
    _log(user, 2.0)
    assert len(emails) == 1
    set_user_budget(user, 3.0)   # raised: 2/3 = 67%, fine
    _log(user, 0.5)              # 83%: warns again under the new budget
    assert len(emails) == 2 and "83%" in emails[1]["subject"]


def test_removing_a_user_budget(flask_app, emails):
    from core.budget import get_user_budget, set_user_budget, user_budget_status

    user = _uid("remove")
    set_user_budget(user, 5.0)
    assert get_user_budget(user) == 5.0
    set_user_budget(user, None)
    assert get_user_budget(user) is None
    assert user_budget_status(user)["state"] == "none"
    with pytest.raises(ValueError):
        set_user_budget(user, -1)


def test_project_budget_alerts_go_to_the_owner_and_count_all_members_spend(flask_app, emails):
    from core.models import Project, Team

    owner, member = _uid("owner"), _uid("member")
    pid, tid = f"proj-{uuid.uuid4().hex[:8]}", f"team-{uuid.uuid4().hex[:8]}"
    db.session.add(Team(team_id=tid, owner_id=owner, name="T"))
    db.session.add(Project(project_id=pid, team_id=tid, owner_id=owner, name="Budgeted", monthly_budget_usd=10.0))
    db.session.commit()

    _log(member, 4.0, project_id=pid)   # a member's spend...
    _log(owner, 4.5, project_id=pid)    # ...plus the owner's: 8.5 = 85%
    assert len(emails) == 1
    assert emails[0]["to"] == owner and "Budgeted" in emails[0]["subject"]

    _log(member, 2.0, project_id=pid)
    assert len(emails) == 2 and "crossed" in emails[1]["subject"]


def test_spend_with_no_project_still_counts_toward_the_user_budget(flask_app, emails):
    from core.budget import is_over_budget, set_user_budget

    user = _uid("noproj")
    set_user_budget(user, 1.0)
    _log(user, 2.0, project_id=None)
    assert is_over_budget(user, None) is True
    assert is_over_budget(_uid("someone-else"), None) is False


def test_a_broken_budget_check_never_breaks_the_ai_call(flask_app, emails, monkeypatch):
    from core.models import AIUsageLog

    def _boom(*args, **kwargs):
        raise RuntimeError("budget backend exploded")

    monkeypatch.setattr("core.budget.budget_state", _boom)
    from core.budget import set_user_budget

    user = _uid("boom")
    set_user_budget(user, 1.0)
    _log(user, 5.0)  # must not raise
    assert AIUsageLog.query.filter_by(user_id=user).count() == 1


# ── autopilot ────────────────────────────────────────────────────────────

def test_autopilot_pauses_when_the_users_own_budget_is_used_up(flask_app, emails):
    from agents.workflow_orchestration.graph import _autopilot_over_budget
    from core.budget import set_user_budget

    user = _uid("auto")
    state = {"user_id": user, "project_id": None}
    assert _autopilot_over_budget(state) is False
    set_user_budget(user, 1.0)
    _log(user, 0.5)
    assert _autopilot_over_budget(state) is False
    _log(user, 1.0)
    assert _autopilot_over_budget(state) is True


# ── APIs (via the monolith app, where the usage routes are registered) ────

def test_my_budget_api_roundtrip_and_validation(monolith_client):
    res = monolith_client.get("/api/usage/me/budget")
    assert res.status_code == 200 and res.get_json()["monthlyBudgetUsd"] is None

    res = monolith_client.put("/api/usage/me/budget", json={"monthlyBudgetUsd": 25})
    assert res.status_code == 200
    assert res.get_json()["monthlyBudgetUsd"] == 25.0 and res.get_json()["budget"]["state"] in ("ok", "warning", "over")

    assert monolith_client.put("/api/usage/me/budget", json={"monthlyBudgetUsd": -5}).status_code == 400
    assert monolith_client.put("/api/usage/me/budget", json={"monthlyBudgetUsd": "lots"}).status_code == 400

    res = monolith_client.put("/api/usage/me/budget", json={"monthlyBudgetUsd": None})
    assert res.get_json()["monthlyBudgetUsd"] is None and res.get_json()["budget"]["state"] == "none"


def test_budget_apis_require_a_session(monolith_anon_client):
    for method, path in (("get", "/api/usage/budget-status"), ("get", "/api/usage/me/budget"),
                         ("put", "/api/usage/me/budget"), ("get", "/api/usage/me")):
        assert getattr(monolith_anon_client, method)(path).status_code == 401, path


def test_budget_status_hides_projects_the_user_cannot_access(monolith_client):
    res = monolith_client.get("/api/usage/budget-status?project_id=someone-elses-project")
    assert res.status_code == 404


def test_my_usage_breaks_down_by_project_and_workflow(monolith_client, flask_app, emails):
    from core.models import Project, Team
    from core.usage_context import usage_scope
    from models.workflow import WorkflowInstance, WorkflowTemplate

    me = "user_1"   # the identity monolith_client is signed in as
    pid, tid = f"proj-{uuid.uuid4().hex[:8]}", f"team-{uuid.uuid4().hex[:8]}"
    iid = f"wf-{uuid.uuid4().hex[:8]}"
    db.session.add(Team(team_id=tid, owner_id=me, name="T"))
    db.session.add(Project(project_id=pid, team_id=tid, owner_id=me, name="Cost Project"))
    template = WorkflowTemplate.query.first()
    if template:
        db.session.add(WorkflowInstance(instance_id=iid, template_id=template.template_id, user_id=me,
                                        project_id=pid, name="Costly run", status="running"))
    db.session.commit()

    with usage_scope(iid, "qualify"):
        _log(me, 0.30, project_id=pid)
    _log(me, 0.10, project_id=pid)
    _log(me, 0.07, project_id=None)

    usage = monolith_client.get("/api/usage/me?days=1").get_json()["usage"]
    by_project = {row["name"]: row["costUsd"] for row in usage["byProject"]}
    assert by_project["Cost Project"] >= 0.40 and "No project" in by_project
    if template:
        assert any(w["instanceId"] == iid and abs(w["costUsd"] - 0.30) < 1e-9 for w in usage["byWorkflow"])

        run = monolith_client.get(f"/api/workflows/instances/{iid}/usage").get_json()
        assert run["totalCostUsd"] == pytest.approx(0.30) and run["requestCount"] == 1
        assert run["byStage"][0]["stageId"] == "qualify"

    proj_usage = monolith_client.get(f"/api/projects/{pid}/usage?days=1").get_json()
    assert proj_usage["budget"]["state"] == "none"   # no budget set on this project


def test_run_usage_is_404_for_someone_elses_workflow(monolith_client):
    assert monolith_client.get("/api/workflows/instances/does-not-exist/usage").status_code == 404


# ── /ready ───────────────────────────────────────────────────────────────

def test_ready_reports_database_and_schema_revision(monolith_client, monolith_anon_client, flask_app):
    """200 only when the DB answers AND its alembic revision is this build's
    head; a database behind (or ahead of) the code is not ready."""
    import os

    from alembic.config import Config
    from alembic.script import ScriptDirectory

    import app as app_module

    cfg = Config()
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(os.path.abspath(app_module.__file__)), "migrations"))
    head = ScriptDirectory.from_config(cfg).get_current_head()

    with flask_app.app_context():
        db.session.execute(db.text("CREATE TABLE IF NOT EXISTS alembic_version (version_num varchar(32) NOT NULL PRIMARY KEY)"))
        db.session.execute(db.text("DELETE FROM alembic_version"))
        db.session.execute(db.text("INSERT INTO alembic_version VALUES (:v)"), {"v": head})
        db.session.commit()

    ok = monolith_anon_client.get("/ready")   # a probe carries no session
    assert ok.status_code == 200
    body = ok.get_json()
    assert body["status"] == "ready" and body["checks"]["db"] == "ok"
    assert body["checks"]["schema"] == {"current": head, "expected": head, "ok": True}

    with flask_app.app_context():
        db.session.execute(db.text("UPDATE alembic_version SET version_num = 'not_a_real_revision'"))
        db.session.commit()
    behind = monolith_anon_client.get("/ready")
    assert behind.status_code == 503
    assert behind.get_json()["checks"]["schema"]["ok"] is False

    with flask_app.app_context():
        db.session.execute(db.text("DROP TABLE alembic_version"))
        db.session.commit()


# ── project attribution for calls that don't name a project ──────────────

def _make_project(owner):
    from core.models import Project, Team

    pid, tid = f"proj-{uuid.uuid4().hex[:8]}", f"team-{uuid.uuid4().hex[:8]}"
    db.session.add(Team(team_id=tid, owner_id=owner, name="T"))
    db.session.add(Project(project_id=pid, team_id=tid, owner_id=owner, name="P"))
    db.session.commit()
    return pid


def _project_of_last_row(user):
    from core.models import AIUsageLog

    return AIUsageLog.query.filter_by(user_id=user).order_by(AIUsageLog.id.desc()).first().project_id


def test_unattributed_spend_goes_to_the_project_the_request_is_for(flask_app, emails):
    """Most agent code logs AI calls with project_id=None. The frontend sends
    the project the user is working in as X-Project-Id, so that spend still
    reaches the project's cost view and budget."""
    user = _uid("hdr")
    pid = _make_project(user)
    with flask_app.test_request_context(headers={"X-Project-Id": pid}):
        _log(user, 0.10)                                    # no project given -> header's project
    assert _project_of_last_row(user) == pid

    other = _make_project(_uid("other-owner"))
    with flask_app.test_request_context(headers={"X-Project-Id": pid}):
        _log(user, 0.10, project_id=other)                  # an explicit project always wins
    assert _project_of_last_row(user) == other


def test_a_claimed_project_the_user_cannot_access_is_ignored(flask_app, emails):
    """The header is caller-controlled: without an access check anyone could
    bill their spend to someone else's project budget."""
    user = _uid("spoof")
    victims_project = _make_project(_uid("victim"))
    with flask_app.test_request_context(headers={"X-Project-Id": victims_project}):
        _log(user, 0.50)
    assert _project_of_last_row(user) is None

    with flask_app.test_request_context(headers={"X-Project-Id": "no-such-project"}):
        _log(user, 0.50)
    assert _project_of_last_row(user) is None


def test_workflow_stage_spend_goes_to_the_runs_project(flask_app, emails):
    from core.usage_context import usage_scope

    user = _uid("wfproj")
    pid = _make_project(user)
    with usage_scope("wf-x", "qualify", pid):
        _log(user, 0.20)          # e.g. score_leads_core, which logs project_id=None
    assert _project_of_last_row(user) == pid
