"""Integration tests — plain-argument "_core" functions extracted for
LangGraph node use (agents/workflow_orchestration/). These preserve the
original Flask-route behavior with no request/g dependency, so each is
tested both as a direct call and via its still-existing HTTP route.
"""
import pytest

from core.database import db
from core.models import Project, Team
from core.session_token import issue_browser_session_token


def _bearer(app, user_id):
    with app.app_context():
        token = issue_browser_session_token(app.config["SECRET_KEY"], user_id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def project(flask_app):
    """A core.models.Project owned by 'user_1' — the row
    user_can_access_project() checks against for supply_chain."""
    with flask_app.app_context():
        team = Team(team_id="team-core-1", owner_id="user_1", name="Test Team")
        proj = Project(project_id="proj-core-1", team_id="team-core-1",
                        owner_id="user_1", name="Test Project")
        db.session.add(team)
        db.session.add(proj)
        db.session.commit()
        yield proj.project_id
        Project.query.filter_by(project_id="proj-core-1").delete()
        Team.query.filter_by(team_id="team-core-1").delete()
        db.session.commit()


@pytest.fixture
def supplier_id(client, flask_app, project):
    res = client.post("/api/supply-chain/suppliers", json={
        "name": "Acme Supplies",
        "project_id": project,
    }, headers=_bearer(flask_app, "user_1"))
    assert res.status_code == 201
    return res.get_json()["supplier"]["id"]


# ── submit_audit_core ────────────────────────────────────────────────────────

def test_submit_audit_core_passes(flask_app, project, supplier_id):
    from agents.supply_chain.service import submit_audit_core

    with flask_app.app_context():
        result, error, status = submit_audit_core(supplier_id, 85, "user_1")

    assert error is None
    assert status == 200
    assert result["auditStatus"] == "passed"
    assert result["score"] == 85


def test_submit_audit_core_fails_below_threshold(flask_app, project, supplier_id):
    from agents.supply_chain.service import submit_audit_core

    with flask_app.app_context():
        result, error, status = submit_audit_core(supplier_id, 40, "user_1")

    assert error is None
    assert result["auditStatus"] == "failed"


def test_submit_audit_core_missing_score(flask_app, project, supplier_id):
    from agents.supply_chain.service import submit_audit_core

    with flask_app.app_context():
        result, error, status = submit_audit_core(supplier_id, None, "user_1")

    assert result is None
    assert error == "score is required"
    assert status == 400


def test_submit_audit_core_wrong_user_denied(flask_app, project, supplier_id):
    """A user who is neither the project owner nor a team member must not
    be able to audit a supplier on that project."""
    from agents.supply_chain.service import submit_audit_core

    with flask_app.app_context():
        result, error, status = submit_audit_core(supplier_id, 85, "someone_else")

    assert result is None
    assert error == "Supplier not found"
    assert status == 404


def test_submit_audit_route_regression(client, flask_app, project, supplier_id):
    """The original HTTP route must still behave the same after the
    submit_audit/submit_audit_core split."""
    res = client.put(f"/api/supply-chain/suppliers/{supplier_id}/audit",
                      json={"score": 90}, headers=_bearer(flask_app, "user_1"))
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True
    assert data["supplier"]["auditStatus"] == "passed"


# ── create_task_core ─────────────────────────────────────────────────────────

def test_create_task_core_minimal(flask_app):
    from agents.executive_assistant.service import create_task_core

    with flask_app.app_context():
        result, error = create_task_core("user_1", "Follow up with supplier")

    assert error is None
    assert result["title"] == "Follow up with supplier"
    assert result["status"] == "Pending"
    assert result["priority"] == "Medium"


def test_create_task_core_missing_title(flask_app):
    from agents.executive_assistant.service import create_task_core

    with flask_app.app_context():
        result, error = create_task_core("user_1", "   ")

    assert result is None
    assert error == "Title is required"


def test_create_task_core_with_due_date(flask_app):
    from agents.executive_assistant.service import create_task_core

    with flask_app.app_context():
        result, error = create_task_core(
            "user_1", "Finalize contract", due_date="2026-09-10", priority="High",
        )

    assert error is None
    assert result["dueDate"] == "2026-09-10"
    assert result["priority"] == "High"


def test_create_task_route_regression(client, flask_app):
    """The original HTTP route must still behave the same after the
    create_task/create_task_core split."""
    res = client.post("/api/executive-assistant/tasks", json={
        "title": "Schedule kickoff call",
    }, headers=_bearer(flask_app, "user_1"))
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True
    assert data["task"]["title"] == "Schedule kickoff call"


# ── send_bulk_emails_core ────────────────────────────────────────────────────
# Note: send_bulk_emails_core lazily imports helpers still owned by app.py
# (GoogleOAuthToken, SCOPES, etc.) - matching this file's pre-existing
# lazy-import pattern for send_campaign/generate_email/send_bulk. Calling it
# for the first time in a process therefore imports the full app.py module
# (chromadb/faiss/selenium and all), which conftest.py's minimal test app
# otherwise deliberately avoids. That's an accepted cost of this extraction,
# not a defect - it mirrors what already happens in production, where app.py
# is the running module and the import is a free self-reference.

def test_send_bulk_emails_core_missing_subject_body(flask_app):
    from agents.email_outreach.service import send_bulk_emails_core

    with flask_app.app_context():
        result, error, status = send_bulk_emails_core(
            None, None, [{"email": "a@b.com", "name": "A"}],
            "sender@example.com", "sender@example.com",
        )

    assert result is None
    assert status == 400
    assert "Subject and body" in error


def test_send_bulk_emails_core_no_valid_emails(flask_app):
    from agents.email_outreach.service import send_bulk_emails_core

    with flask_app.app_context():
        result, error, status = send_bulk_emails_core(
            "Hi", "Body", [{"email": "N/A", "name": "A"}],
            "sender@example.com", "sender@example.com",
        )

    assert result is None
    assert status == 400
    assert "No valid emails" in error


def test_send_bulk_emails_core_missing_user_email(flask_app):
    from agents.email_outreach.service import send_bulk_emails_core

    with flask_app.app_context():
        result, error, status = send_bulk_emails_core(
            "Hi", "Body", [{"email": "a@b.com"}], "", "",
        )

    assert result is None
    assert status == 400
    assert "Registered user email" in error


def test_send_bulk_emails_core_smtp_fallback(flask_app, monkeypatch):
    """No GoogleOAuthToken row for this sender -> falls back to SMTP.
    smtplib.SMTP is faked out entirely so this never touches the network."""
    from agents.email_outreach.service import send_bulk_emails_core

    monkeypatch.setenv("EMAIL_HOST", "smtp.test.local")
    monkeypatch.setenv("EMAIL_PORT", "587")
    monkeypatch.setenv("EMAIL_USER", "system@enable-agents.local")
    monkeypatch.setenv("EMAIL_PASS", "test-pass")

    sent_messages = []

    class _FakeSMTP:
        def __init__(self, host, port):
            pass

        def starttls(self):
            pass

        def login(self, user, password):
            pass

        def send_message(self, msg):
            sent_messages.append(msg)

        def quit(self):
            pass

    monkeypatch.setattr("smtplib.SMTP", _FakeSMTP)

    with flask_app.app_context():
        result, error, status = send_bulk_emails_core(
            "Hello {{name}}", "Body for {{name}}",
            [{"email": "lead@example.com", "name": "Lead Co"}],
            "sender-smtp-test@example.com", "sender-smtp-test@example.com",
        )

    assert error is None
    assert status == 200
    assert result["success"] is True
    assert result["count"] == 1
    assert len(sent_messages) == 1
    assert sent_messages[0]["Subject"] == "Hello Lead Co"


# ── score_leads_core ─────────────────────────────────────────────────────────

def test_score_leads_core_missing_requirement(flask_app):
    from agents.sales_helper_core import score_leads_core

    with flask_app.app_context():
        results, error, status = score_leads_core("   ", [{"name": "Acme"}], "user_1")

    assert results is None
    assert error == "Missing requirement text"
    assert status == 400


def test_score_leads_core_no_openai_key_fallback(flask_app, monkeypatch):
    """With no OPENAI_API_KEY configured, scoring degrades to a
    zero-score/no-embeddings fallback rather than erroring - and must not
    make any network call."""
    from agents.sales_helper_core import _extract_two_line_summary, score_leads_core

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    lead = {"name": "Acme Cleaning", "summary": "Commercial cleaning services"}

    with flask_app.app_context():
        results, error, status = score_leads_core(
            "Need a commercial cleaning supplier", [lead], "user_1",
        )

    assert error is None
    assert status == 200
    assert results == [{"index": 0, "match_score": 0, "short_summary": _extract_two_line_summary(lead)}]


def test_score_leads_core_embedding_and_llm_blend(flask_app, monkeypatch):
    """Full path with OPENAI_API_KEY set: embeddings rank the list, then
    the (mocked) LLM refines the top candidates and its score is blended
    in. Both app.get_embeddings_batch and ai_chat_completion are faked out
    so this never calls a real API."""
    import json as _json

    import app as app_module
    import core.ai_client as ai_client_module
    from agents.sales_helper_core import score_leads_core

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    def _fake_get_embeddings_batch(phrases):
        # requirement first, then one vector per lead - identical vectors
        # give a deterministic, maximal cosine similarity (=100).
        return [[1.0, 0.0]] * len(phrases)

    class _FakeChoice:
        def __init__(self, content):
            self.message = type("M", (), {"content": content})()

    class _FakeLLMResponse:
        def __init__(self, content):
            self.choices = [_FakeChoice(content)]

    def _fake_ai_chat_completion(user_id, project_id, agent, model, messages, **kwargs):
        return _FakeLLMResponse(_json.dumps([
            {"index": 0, "match_score": 90, "short_summary": "Acme Cleaning is a strong match."},
        ]))

    monkeypatch.setattr(app_module, "get_embeddings_batch", _fake_get_embeddings_batch)
    monkeypatch.setattr(ai_client_module, "ai_chat_completion", _fake_ai_chat_completion)

    with flask_app.app_context():
        results, error, status = score_leads_core(
            "Need a commercial cleaning supplier",
            [{"name": "Acme Cleaning", "summary": "Commercial cleaning services"}],
            "user_1",
        )

    assert error is None
    assert status == 200
    assert len(results) == 1
    # base_score=100 (identical embedding vectors) blended with llm_score=90:
    # round(100*0.45 + 90*0.55) = round(94.5) = 94 (Python's round-half-to-even)
    assert results[0]["match_score"] == 94
    assert results[0]["short_summary"] == "Acme Cleaning is a strong match."
