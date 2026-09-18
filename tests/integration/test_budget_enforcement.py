"""Integration tests - hard spend caps ("block" enforcement), team budgets,
and the 402 the API answers with. Only budgets explicitly set to "block"
ever refuse a call; everything else stays alert-only. Alert emails are
intercepted and no provider is ever reached.
"""
import uuid

import pytest

from core.database import db


def _uid(prefix="enf"):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@example.com"


@pytest.fixture
def emails(flask_app, monkeypatch):
    sent = []
    monkeypatch.setattr(
        "core.email_sender.send_platform_email",
        lambda sender, recipient, subject, body: (sent.append({"to": recipient, "subject": subject, "body": body}) or (True, None)),
    )
    with flask_app.app_context():
        yield sent


def _log(user_id, cost, project_id=None):
    from core.ai_client import log_external_usage

    log_external_usage(user_id, project_id, "test.agent", "test", "test-model", cost)


def _make_team(owner, members=()):
    from core.models import Team, TeamMember

    tid = f"team-{uuid.uuid4().hex[:8]}"
    db.session.add(Team(team_id=tid, owner_id=owner, name="Acme"))
    db.session.add(TeamMember(member_id=uuid.uuid4().hex, team_id=tid, user_id=owner, role="owner"))
    for m in members:
        db.session.add(TeamMember(member_id=uuid.uuid4().hex, team_id=tid, user_id=m, role="member"))
    db.session.commit()
    return tid


def _make_project(owner, team_id=None):
    from core.models import Project, Team

    pid = f"proj-{uuid.uuid4().hex[:8]}"
    if team_id is None:
        team_id = f"team-{uuid.uuid4().hex[:8]}"
        db.session.add(Team(team_id=team_id, owner_id=owner, name="T"))
    db.session.add(Project(project_id=pid, team_id=team_id, owner_id=owner, name="Launch"))
    db.session.commit()
    return pid


def _block_project(pid, limit):
    from core.models import Project

    project = Project.query.filter_by(project_id=pid).first()
    project.monthly_budget_usd, project.budget_enforcement = limit, "block"
    db.session.commit()


# ── user budgets ─────────────────────────────────────────────────────────

def test_alert_only_is_the_default_and_never_blocks(flask_app, emails):
    from core.budget import enforce_budget, set_user_budget

    user = _uid()
    set_user_budget(user, 1.0)
    _log(user, 5.0)                                   # far over
    enforce_budget(user, None)                        # no raise: nobody chose "block"


def test_a_blocking_user_budget_refuses_calls_once_used_up(flask_app, emails):
    from core.budget import BudgetExceeded, enforce_budget, set_user_budget

    user = _uid()
    set_user_budget(user, 2.0, "block")
    _log(user, 1.5)
    enforce_budget(user, None)                        # under the limit: fine

    _log(user, 0.5)                                   # exactly used up
    with pytest.raises(BudgetExceeded) as caught:
        enforce_budget(user, None)
    assert caught.value.scope == "user"
    assert "$2.00" in str(caught.value) and "block" in str(caught.value)


def test_a_zero_dollar_blocking_budget_blocks_everything(flask_app, emails):
    from core.budget import BudgetExceeded, enforce_budget, set_user_budget

    user = _uid()
    set_user_budget(user, 0.0, "block")
    with pytest.raises(BudgetExceeded):
        enforce_budget(user, None)


def test_raising_the_limit_or_switching_to_alert_lifts_the_block(flask_app, emails):
    from core.budget import BudgetExceeded, enforce_budget, set_user_budget

    user = _uid()
    set_user_budget(user, 1.0, "block")
    _log(user, 1.0)
    with pytest.raises(BudgetExceeded):
        enforce_budget(user, None)

    set_user_budget(user, 5.0)                        # enforcement stays "block", but there is room again
    enforce_budget(user, None)

    _log(user, 5.0)
    with pytest.raises(BudgetExceeded):
        enforce_budget(user, None)
    set_user_budget(user, 5.0, "alert")
    enforce_budget(user, None)


def test_no_user_means_nothing_to_enforce(flask_app):
    from core.budget import enforce_budget

    enforce_budget(None, None)


def test_a_broken_budget_lookup_fails_open(flask_app, monkeypatch):
    import core.budget as budget

    def boom(*a, **k):
        raise RuntimeError("db is down")

    monkeypatch.setattr(budget, "_applicable_budgets", boom)
    budget.enforce_budget("someone@example.com", None)   # must not raise


def test_invalid_enforcement_is_rejected(flask_app):
    from core.budget import set_user_budget

    with pytest.raises(ValueError):
        set_user_budget(_uid(), 1.0, "sometimes")


# ── project budgets ──────────────────────────────────────────────────────

def test_a_blocking_project_budget_stops_every_member_spending_on_it(flask_app, emails):
    from core.budget import BudgetExceeded, enforce_budget

    owner, teammate = _uid("owner"), _uid("mate")
    pid = _make_project(owner)
    _block_project(pid, 1.0)
    _log(owner, 0.6, project_id=pid)
    enforce_budget(teammate, pid)

    _log(teammate, 0.6, project_id=pid)
    for who in (owner, teammate):
        with pytest.raises(BudgetExceeded) as caught:
            enforce_budget(who, pid)
        assert caught.value.scope == "project" and "Launch" in str(caught.value)

    enforce_budget(owner, None)                       # work outside the project is unaffected
    enforce_budget(owner, _make_project(owner))       # ...and so is another project


def test_the_project_is_resolved_like_spend_is_attributed(flask_app, emails):
    """A call that names no project but comes from a request for one (the
    X-Project-Id header) or runs inside a workflow stage is blocked by that
    project's budget - the same one it would have been billed to."""
    from core.ai_client import enforce_budget_for_call
    from core.budget import BudgetExceeded
    from core.usage_context import usage_scope

    user = _uid()
    pid = _make_project(user)
    _block_project(pid, 0.0)

    with flask_app.test_request_context(headers={"X-Project-Id": pid}):
        with pytest.raises(BudgetExceeded):
            enforce_budget_for_call(user)
    with usage_scope("wf-1", "qualify", pid):
        with pytest.raises(BudgetExceeded):
            enforce_budget_for_call(user)
    enforce_budget_for_call(user)                     # no project in play: allowed


# ── team budgets ─────────────────────────────────────────────────────────

def test_team_spend_is_shared_across_members_and_their_projects(flask_app, emails):
    from core.budget import BudgetExceeded, enforce_budget, set_team_budget, team_budget_status

    owner, member, outsider = _uid("own"), _uid("mem"), _uid("out")
    tid = _make_team(owner, [member])
    set_team_budget(tid, 3.0, "block")

    _log(owner, 1.0)                                  # no project at all: the member's own team
    _log(member, 1.5, project_id=_make_project(member, tid))
    status = team_budget_status(tid)
    assert status["spendUsd"] == pytest.approx(2.5) and status["state"] == "warning"
    enforce_budget(member, None)

    _log(member, 0.5)
    for who in (owner, member):
        with pytest.raises(BudgetExceeded) as caught:
            enforce_budget(who, None)
        assert caught.value.scope == "team" and "Acme" in str(caught.value)
    enforce_budget(outsider, None)                    # not on the team


def test_team_spend_counts_older_rows_that_have_no_team_id(flask_app, emails):
    """Rows written before usage started falling back to the user's team have
    team_id NULL; they still belong to the team through their user."""
    from core.budget import current_month_team_spend_usd
    from core.models import AIUsageLog

    owner, member = _uid("own"), _uid("mem")
    tid = _make_team(owner, [member])
    db.session.add(AIUsageLog(user_id=member, project_id=None, team_id=None, agent="legacy", provider="openai",
                              model="m", key_source="platform", prompt_tokens=0, completion_tokens=0,
                              total_tokens=0, estimated_cost_usd=1.25))
    db.session.add(AIUsageLog(user_id=_uid("stranger"), project_id=None, team_id=None, agent="legacy",
                              provider="openai", model="m", key_source="platform", prompt_tokens=0,
                              completion_tokens=0, total_tokens=0, estimated_cost_usd=9.0))
    db.session.commit()
    assert current_month_team_spend_usd(tid) == pytest.approx(1.25)


def test_usage_rows_fall_back_to_the_users_team(flask_app, emails):
    from core.models import AIUsageLog

    user = _uid()
    tid = _make_team(user)
    _log(user, 0.1)
    assert AIUsageLog.query.filter_by(user_id=user).first().team_id == tid


def test_team_alerts_go_to_the_team_owner_and_say_when_blocking(flask_app, emails):
    from core.budget import set_team_budget

    owner, member = _uid("own"), _uid("mem")
    tid = _make_team(owner, [member])
    set_team_budget(tid, 10.0, "block")

    _log(member, 8.5)                                 # 85%
    assert [e["to"] for e in emails] == [owner]
    assert "block" in emails[0]["body"]
    _log(member, 2.0)                                 # over
    assert len(emails) == 2 and emails[1]["to"] == owner and "refused" in emails[1]["body"]
    _log(member, 1.0)
    assert len(emails) == 2


def test_alert_only_wording_when_not_blocking(flask_app, emails):
    from core.budget import set_user_budget

    user = _uid()
    set_user_budget(user, 1.0)
    _log(user, 2.0)
    assert "not blocked" in emails[0]["body"]


def test_autopilot_pauses_when_the_team_budget_is_used_up(flask_app, emails):
    from agents.workflow_orchestration.graph import _autopilot_over_budget
    from core.budget import set_team_budget

    owner, member = _uid("own"), _uid("mem")
    tid = _make_team(owner, [member])
    set_team_budget(tid, 1.0)
    state = {"user_id": member, "project_id": None}
    assert _autopilot_over_budget(state) is False
    _log(owner, 1.0)
    assert _autopilot_over_budget(state) is True


def test_overview_reports_the_team_and_what_is_blocking(flask_app, emails):
    from core.budget import budget_overview, set_team_budget, set_user_budget

    owner = _uid()
    tid = _make_team(owner)
    set_user_budget(owner, 100.0)
    set_team_budget(tid, 1.0, "block")
    _log(owner, 2.0)
    overview = budget_overview(owner)
    assert overview["team"]["state"] == "over" and overview["team"]["blocking"] is True
    assert overview["blockedBy"] == ["team"] and overview["worstState"] == "over"
    assert overview["user"]["blocking"] is False


# ── the AI chokepoints refuse before reaching a provider ─────────────────

@pytest.fixture
def provider_tripwire(monkeypatch):
    """Any attempt to actually reach OpenAI fails the test."""
    import openai

    def _boom(*a, **k):
        raise AssertionError("a provider client was constructed for a blocked call")

    monkeypatch.setattr(openai, "OpenAI", _boom)


def test_chat_embeddings_and_langchain_are_refused_when_blocked(flask_app, emails, provider_tripwire):
    from core.ai_client import ai_chat_completion, ai_embeddings, get_langchain_llm
    from core.budget import BudgetExceeded, set_user_budget

    user = _uid()
    set_user_budget(user, 0.0, "block")
    with pytest.raises(BudgetExceeded):
        ai_chat_completion(user, None, "t.chat", "gpt-4o-mini", [{"role": "user", "content": "hi"}])
    with pytest.raises(BudgetExceeded):
        ai_embeddings(user, None, "t.embed", "text-embedding-3-small", ["hi"])
    with pytest.raises(BudgetExceeded):
        get_langchain_llm(user, None)


def test_a_user_less_call_inside_a_workflow_stage_uses_the_runs_user(flask_app, emails, provider_tripwire):
    """Helpers like get_embeddings_batch pass user_id=None, and a Celery task
    has no request to fall back on - so without the stage scope's user such a
    call was neither attributed to anyone nor stopped by their budget."""
    from core.ai_client import ai_embeddings
    from core.budget import BudgetExceeded, set_user_budget
    from core.usage_context import usage_scope

    user = _uid()
    set_user_budget(user, 0.0, "block")
    with usage_scope("wf-9", "qualify", None, user_id=user):
        with pytest.raises(BudgetExceeded):
            ai_embeddings(None, None, "document_intelligence.embed_batch", "text-embedding-ada-002", ["x"])


# ── budget APIs and the 402 ──────────────────────────────────────────────

@pytest.fixture
def clean_user_1(flask_app):
    """TEST_USER_ID is shared, so undo anything a test set on it."""
    from core.models import Team, TeamMember, UserBudget

    def _clean():
        with flask_app.app_context():
            UserBudget.query.filter_by(user_id="user_1").delete()
            for m in TeamMember.query.filter_by(user_id="user_1").all():
                Team.query.filter_by(team_id=m.team_id).delete()
            db.session.commit()

    _clean()
    yield
    _clean()


def test_my_budget_api_sets_and_reports_enforcement(monolith_client, clean_user_1):
    res = monolith_client.put("/api/usage/me/budget", json={"enforcement": "block"})
    assert res.status_code == 400                     # nothing to enforce yet

    res = monolith_client.put("/api/usage/me/budget", json={"monthlyBudgetUsd": 50, "enforcement": "block"})
    body = res.get_json()
    assert res.status_code == 200 and body["budget"]["enforcement"] == "block" and body["budget"]["blocking"] is False

    res = monolith_client.put("/api/usage/me/budget", json={"enforcement": "alert"})
    assert res.get_json()["budget"]["enforcement"] == "alert" and res.get_json()["monthlyBudgetUsd"] == 50.0

    assert monolith_client.put("/api/usage/me/budget", json={"enforcement": "maybe"}).status_code == 400
    # changing only the amount keeps the chosen enforcement
    monolith_client.put("/api/usage/me/budget", json={"enforcement": "block"})
    res = monolith_client.put("/api/usage/me/budget", json={"monthlyBudgetUsd": 75})
    assert res.get_json()["budget"]["enforcement"] == "block"


def test_team_budget_api_owner_can_set_and_a_plain_member_cannot(monolith_client, flask_app, clean_user_1):
    from core.models import Team, TeamMember

    res = monolith_client.get("/api/team/budget")
    assert res.status_code == 404                     # no team yet

    with flask_app.app_context():
        tid = _make_team("user_1")
    res = monolith_client.put("/api/team/budget", json={"monthlyBudgetUsd": 200, "enforcement": "block"})
    body = res.get_json()
    assert res.status_code == 200 and body["canEdit"] is True
    assert body["monthlyBudgetUsd"] == 200.0 and body["budget"]["enforcement"] == "block"
    assert monolith_client.put("/api/team/budget", json={"enforcement": "x"}).status_code == 400
    res = monolith_client.put("/api/team/budget", json={"monthlyBudgetUsd": None})
    assert res.get_json()["budget"]["state"] == "none"
    assert monolith_client.put("/api/team/budget", json={"enforcement": "block"}).status_code == 400

    with flask_app.app_context():
        TeamMember.query.filter_by(user_id="user_1", team_id=tid).first().role = "member"
        Team.query.filter_by(team_id=tid).first().monthly_budget_usd = 9.0
        db.session.commit()
    res = monolith_client.get("/api/team/budget")
    assert res.status_code == 200 and res.get_json()["canEdit"] is False   # members can see it
    assert monolith_client.put("/api/team/budget", json={"monthlyBudgetUsd": 1}).status_code == 403


def test_team_budget_api_requires_a_session(monolith_anon_client):
    assert monolith_anon_client.get("/api/team/budget").status_code == 401
    assert monolith_anon_client.put("/api/team/budget", json={}).status_code == 401


def test_project_budget_enforcement_setting_via_api(monolith_client, flask_app):
    with flask_app.app_context():
        pid = _make_project("user_1")
    assert monolith_client.put(f"/api/projects/{pid}", json={"budgetEnforcement": "nope"}).status_code == 400
    res = monolith_client.put(f"/api/projects/{pid}", json={"monthlyBudgetUsd": 5, "budgetEnforcement": "block"})
    project = res.get_json()["project"]
    assert res.status_code == 200 and project["budgetEnforcement"] == "block" and project["monthlyBudgetUsd"] == 5.0


def test_a_blocked_paid_route_answers_402_with_the_reason(monolith_client, flask_app, clean_user_1):
    from core.budget import set_user_budget

    with flask_app.app_context():
        set_user_budget("user_1", 0.0, "block")
    res = monolith_client.post("/api/enrich-businesses-with-emails", json={"businesses": [{"name": "A", "website": "a.com"}]})
    body = res.get_json()
    assert res.status_code == 402
    assert body["code"] == "budget_exceeded" and body["scope"] == "user" and "budget" in body["error"]


def test_a_route_that_swallowed_the_block_still_answers_402(monolith_app, flask_app):
    """Plenty of routes wrap everything in `except Exception -> 500`. The
    after_request hook turns those into the 402 they should have been."""
    from flask import g

    from core.budget import BudgetExceeded, budget_state

    exc = BudgetExceeded("project", 'The project "X"', {**budget_state(5, 5), "enforcement": "block", "blocking": True})
    with monolith_app.test_request_context("/whatever"):
        g.budget_exceeded = exc
        out = monolith_app.process_response(monolith_app.make_response(({"error": str(exc)}, 500)))
        assert out.status_code == 402 and out.get_json()["code"] == "budget_exceeded"

        out = monolith_app.process_response(monolith_app.make_response(({"ok": True}, 200)))
        assert out.status_code == 200             # handled gracefully: left alone


def test_run_usage_lists_each_stages_calls(monolith_client, flask_app):
    from core.usage_context import usage_scope
    from models.workflow import WorkflowInstance, WorkflowTemplate

    with flask_app.app_context():
        template = WorkflowTemplate.query.first()
        assert template is not None
        iid = f"wf-{uuid.uuid4().hex[:8]}"
        db.session.add(WorkflowInstance(
            instance_id=iid, template_id=template.template_id, name="Run", user_id="user_1", status="running",
        ))
        db.session.commit()
        with usage_scope(iid, "qualify", None):
            _log("user_1", 0.25)
            _log("user_1", 0.25)
        with usage_scope(iid, "outreach", None):
            _log("user_1", 0.10)

    body = monolith_client.get(f"/api/workflows/instances/{iid}/usage").get_json()
    calls = {(c["stageId"], c["agent"]): c for c in body["byStageCall"]}
    assert calls[("qualify", "test.agent")]["requestCount"] == 2
    assert calls[("qualify", "test.agent")]["costUsd"] == pytest.approx(0.5)
    assert calls[("outreach", "test.agent")]["model"] == "test-model"


# ── $0 budgets ───────────────────────────────────────────────────────────

def test_a_zero_dollar_budget_is_used_up_alerts_and_pauses_autopilot(flask_app, emails):
    from agents.workflow_orchestration.graph import _autopilot_over_budget
    from core.budget import set_user_budget, user_budget_status

    user = _uid()
    set_user_budget(user, 0.0)
    assert user_budget_status(user)["state"] == "over"
    assert _autopilot_over_budget({"user_id": user, "project_id": None}) is True
    assert emails == []                                   # nothing has happened yet
    _log(user, 0.0001)
    assert len(emails) == 1 and emails[0]["to"] == user and "crossed" in emails[0]["subject"]
    _log(user, 0.0001)
    assert len(emails) == 1                               # still once a month


def test_a_zero_dollar_project_budget_alerts_its_owner(flask_app, emails):
    owner = _uid("owner")
    pid = _make_project(owner)
    from core.models import Project

    Project.query.filter_by(project_id=pid).first().monthly_budget_usd = 0.0
    db.session.commit()
    _log(_uid("someone"), 0.01, project_id=pid)
    assert [e["to"] for e in emails] == [owner]


# ── estimating a request so a cap isn't overshot ─────────────────────────

def test_request_cost_estimates_scale_with_the_request(flask_app):
    from core.ai_client import estimate_request_cost_usd

    tiny = estimate_request_cost_usd("gpt-4o-mini", messages=[{"role": "user", "content": "hi"}], max_tokens=10)
    big = estimate_request_cost_usd("gpt-4", messages=[{"role": "user", "content": "x" * 4000}], max_tokens=1000)
    assert 0 < tiny < 0.001 and big > 0.05
    assert estimate_request_cost_usd("text-embedding-ada-002", input_text=["y" * 4000]) > 0
    assert estimate_request_cost_usd("gpt-4", messages="not a list of dicts") >= 0   # never raises


def test_a_call_that_would_cross_the_cap_is_refused_but_one_that_fits_is_not(flask_app, emails):
    from core.ai_client import enforce_budget_for_call
    from core.budget import BudgetExceeded, set_user_budget

    user = _uid()
    set_user_budget(user, 1.00, "block")
    _log(user, 0.99)                                      # $0.01 left, not yet used up
    enforce_budget_for_call(user, None, 0.005)            # fits
    enforce_budget_for_call(user, None, 0.01)             # exactly fits
    with pytest.raises(BudgetExceeded) as caught:
        enforce_budget_for_call(user, None, 0.05)
    assert "$0.01 left" in str(caught.value) and "not enough" in str(caught.value)


def test_the_chat_chokepoint_refuses_an_expensive_request_near_the_cap(flask_app, emails, provider_tripwire):
    from core.ai_client import ai_chat_completion
    from core.budget import BudgetExceeded, set_user_budget

    user = _uid()
    set_user_budget(user, 1.00, "block")
    _log(user, 0.99)
    with pytest.raises(BudgetExceeded):
        ai_chat_completion(user, None, "t.chat", "gpt-4", [{"role": "user", "content": "x" * 4000}], max_tokens=1000)


# ── a block is never invisible ───────────────────────────────────────────

def _blocked_exc(scope="user"):
    from core.budget import BudgetExceeded, budget_state

    return BudgetExceeded(scope, "Your account", {**budget_state(5, 5), "enforcement": "block", "blocking": True})


def _process(monolith_app, body, status, exc=None):
    from flask import g

    with monolith_app.test_request_context("/x"):
        if exc is not None:
            g.budget_exceeded = exc
        return monolith_app.process_response(monolith_app.make_response((body, status)))


def test_a_swallowed_block_that_still_returned_200_is_flagged_in_a_header(monolith_app):
    from urllib.parse import unquote

    exc = _blocked_exc()
    out = _process(monolith_app, {"results": [], "note": "fell back"}, 200, exc)
    assert out.status_code == 200 and out.get_json() == {"results": [], "note": "fell back"}
    assert unquote(out.headers["X-Budget-Blocked"]) == str(exc)
    assert out.headers["X-Budget-Blocked-Scope"] == "user"


def test_an_error_body_carrying_the_message_becomes_402(monolith_app):
    exc = _blocked_exc()
    out = _process(monolith_app, {"success": False, "error": f"Failed: {exc}"}, 500, exc)
    assert out.status_code == 402 and out.get_json()["code"] == "budget_exceeded"
    assert "X-Budget-Blocked" in out.headers


def test_an_unrelated_failure_after_a_block_keeps_its_own_status_and_body(monolith_app):
    exc = _blocked_exc()
    out = _process(monolith_app, {"success": False, "error": "Document not found"}, 404, exc)
    assert out.status_code == 404 and out.get_json() == {"success": False, "error": "Document not found"}
    assert "X-Budget-Blocked" in out.headers              # the block is still surfaced, just not as the cause


def test_no_block_no_header(monolith_app):
    out = _process(monolith_app, {"error": "nope"}, 500)
    assert out.status_code == 500 and "X-Budget-Blocked" not in out.headers


def test_lead_scoring_does_not_swallow_a_block_in_its_refinement_step(monolith_app, monkeypatch):
    """This step used to be `except Exception: skip refinement`, so a blocked
    budget just produced lower-quality results with no explanation."""
    from agents.sales_helper_core import score_leads_core

    monkeypatch.setattr("app.get_embeddings_batch", lambda texts: [[1.0, 0.0]] * len(texts))

    def blocked(*args, **kwargs):
        raise _blocked_exc()

    monkeypatch.setattr("core.ai_client.ai_chat_completion", blocked)
    results, error, status = score_leads_core("fasteners", [{"name": "Acme", "description": "bolts"}], _uid())
    assert results is None and status == 500 and "monthly AI budget" in error


# ── owner/admin-set member budgets ───────────────────────────────────────

def _client_as(app, user):
    from core.session_token import issue_browser_session_token

    with app.app_context():
        token = issue_browser_session_token(app.config["SECRET_KEY"], user)
    client = app.test_client()
    client.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return client


def _member_id(user):
    from core.models import TeamMember

    return TeamMember.query.filter_by(user_id=user).first().member_id


@pytest.fixture
def team_of_user_1(monolith_app, flask_app, clean_user_1):
    """user_1 owns a team with a plain member and an admin."""
    from core.models import TeamMember

    with flask_app.app_context():
        member, admin, admin2 = _uid("mem"), _uid("adm"), _uid("adm")
        tid = _make_team("user_1", [member, admin, admin2])
        for who in (admin, admin2):
            TeamMember.query.filter_by(user_id=who, team_id=tid).first().role = "admin"
        db.session.commit()
        ids = {"member": member, "admin": admin, "admin2": admin2, "member_id": _member_id(member),
               "admin_id": _member_id(admin), "admin2_id": _member_id(admin2), "owner_id": _member_id("user_1")}
    return ids


def test_an_owner_can_cap_a_member_and_the_member_cannot_lift_it(monolith_app, monolith_client, flask_app, team_of_user_1):
    t = team_of_user_1
    res = monolith_client.put(f"/api/team/members/{t['member_id']}/budget", json={"monthlyBudgetUsd": 5, "enforcement": "block"})
    body = res.get_json()
    assert res.status_code == 200 and body["budget"]["limitUsd"] == 5.0
    assert body["budget"]["enforcement"] == "block" and body["budget"]["managedBy"] == "user_1"

    member = _client_as(monolith_app, t["member"])
    mine = member.get("/api/usage/me/budget").get_json()
    assert mine["budget"]["managedBy"] == "user_1"
    assert member.put("/api/usage/me/budget", json={"monthlyBudgetUsd": 999}).status_code == 403
    assert member.put("/api/usage/me/budget", json={"enforcement": "alert"}).status_code == 403
    assert member.put("/api/usage/me/budget", json={"monthlyBudgetUsd": None}).status_code == 403
    assert member.get("/api/usage/me/budget").get_json()["monthlyBudgetUsd"] == 5.0

    with flask_app.app_context():
        from core.budget import BudgetExceeded, enforce_budget

        _log(t["member"], 5.0)
        with pytest.raises(BudgetExceeded):
            enforce_budget(t["member"], None)              # the cap really applies to them

    res = monolith_client.put(f"/api/team/members/{t['member_id']}/budget", json={"monthlyBudgetUsd": None})
    assert res.status_code == 200 and res.get_json()["budget"]["state"] == "none"
    assert member.put("/api/usage/me/budget", json={"monthlyBudgetUsd": 20}).status_code == 200   # theirs again


def test_who_may_set_whose_budget(monolith_app, monolith_client, team_of_user_1):
    t = team_of_user_1
    admin, member = _client_as(monolith_app, t["admin"]), _client_as(monolith_app, t["member"])

    assert member.get("/api/team/members/budgets").status_code == 403
    assert member.put(f"/api/team/members/{t['member_id']}/budget", json={"monthlyBudgetUsd": 1}).status_code == 403

    assert admin.put(f"/api/team/members/{t['member_id']}/budget", json={"monthlyBudgetUsd": 7}).status_code == 200
    assert admin.put(f"/api/team/members/{t['owner_id']}/budget", json={"monthlyBudgetUsd": 1}).status_code == 403   # never the owner
    assert admin.put(f"/api/team/members/{t['admin_id']}/budget", json={"monthlyBudgetUsd": 1}).status_code == 400   # not yourself here
    assert admin.put(f"/api/team/members/{t['admin2_id']}/budget", json={"monthlyBudgetUsd": 1}).status_code == 403  # an admin can't cap another admin
    assert monolith_client.put(f"/api/team/members/{t['admin2_id']}/budget", json={"monthlyBudgetUsd": 30}).status_code == 200  # the owner may
    assert monolith_client.put("/api/team/members/no-such-member/budget", json={"monthlyBudgetUsd": 1}).status_code == 404


def test_a_manager_cannot_delete_a_budget_the_member_set_for_themselves(monolith_app, monolith_client, team_of_user_1):
    t = team_of_user_1
    member = _client_as(monolith_app, t["member"])
    assert member.put("/api/usage/me/budget", json={"monthlyBudgetUsd": 12}).status_code == 200

    res = monolith_client.put(f"/api/team/members/{t['member_id']}/budget", json={"monthlyBudgetUsd": None})
    assert res.status_code == 400
    assert member.get("/api/usage/me/budget").get_json()["monthlyBudgetUsd"] == 12.0

    # ...but the owner may replace it with a locked cap of their own
    assert monolith_client.put(f"/api/team/members/{t['member_id']}/budget", json={"monthlyBudgetUsd": 8}).status_code == 200
    assert member.put("/api/usage/me/budget", json={"monthlyBudgetUsd": 50}).status_code == 403


def test_member_budget_validation(monolith_client, team_of_user_1):
    t = team_of_user_1
    url = f"/api/team/members/{t['member_id']}/budget"
    assert monolith_client.put(url, json={"enforcement": "block"}).status_code == 400        # no budget yet
    assert monolith_client.put(url, json={"monthlyBudgetUsd": -1}).status_code == 400
    assert monolith_client.put(url, json={"monthlyBudgetUsd": "lots"}).status_code == 400
    assert monolith_client.put(url, json={"monthlyBudgetUsd": 3, "enforcement": "maybe"}).status_code == 400
    assert monolith_client.put(url, json={"monthlyBudgetUsd": 3}).status_code == 200
    res = monolith_client.put(url, json={"enforcement": "block"})                            # amount kept, mode changed
    assert res.status_code == 200 and res.get_json()["budget"]["limitUsd"] == 3.0 and res.get_json()["budget"]["enforcement"] == "block"


def test_member_budget_list_shows_spend_and_locks(monolith_client, flask_app, team_of_user_1):
    t = team_of_user_1
    with flask_app.app_context():
        _log(t["member"], 1.5)
    monolith_client.put(f"/api/team/members/{t['member_id']}/budget", json={"monthlyBudgetUsd": 10})
    rows = {r["userId"]: r for r in monolith_client.get("/api/team/members/budgets").get_json()["members"]}
    assert set(rows) == {"user_1", t["member"], t["admin"], t["admin2"]}
    assert rows[t["member"]]["budget"]["spendUsd"] == pytest.approx(1.5)
    assert rows[t["member"]]["budget"]["managedBy"] == "user_1"
    assert rows["user_1"]["budget"]["state"] == "none" and rows["user_1"]["role"] == "owner"


def test_removing_a_member_hands_their_budget_back(monolith_client, flask_app, team_of_user_1):
    from core.budget import get_user_budget_lock

    t = team_of_user_1
    monolith_client.put(f"/api/team/members/{t['member_id']}/budget", json={"monthlyBudgetUsd": 10})
    assert monolith_client.delete(f"/api/team/members/{t['member_id']}").status_code == 200
    with flask_app.app_context():
        assert get_user_budget_lock(t["member"]) is None


def test_the_manager_hears_about_a_members_capped_budget_too(flask_app, emails):
    from core.budget import set_user_budget

    member, boss = _uid("mem"), _uid("boss")
    set_user_budget(member, 2.0, "block", managed_by=boss)
    _log(member, 1.7)
    assert sorted(e["to"] for e in emails) == sorted([member, boss])


def test_member_budget_routes_require_a_session(monolith_anon_client):
    assert monolith_anon_client.get("/api/team/members/budgets").status_code == 401
    assert monolith_anon_client.put("/api/team/members/x/budget", json={}).status_code == 401
