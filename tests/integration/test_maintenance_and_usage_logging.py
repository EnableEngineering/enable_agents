"""Integration tests - usage-table indexes and retention, budget alert emails
going through Celery (with an inline fallback), the daily purge schedule, and
LangChain embedding calls showing up in the usage log.
"""
import uuid
from datetime import datetime, timedelta

import pytest

from core.database import db


def _uid(prefix="maint"):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@example.com"


def _usage_row(user, age_days, cost=0.01, agent="test.agent"):
    from core.models import AIUsageLog

    row = AIUsageLog(user_id=user, agent=agent, provider="openai", model="m", key_source="platform",
                     prompt_tokens=1, completion_tokens=1, total_tokens=2, estimated_cost_usd=cost,
                     created_at=datetime.utcnow() - timedelta(days=age_days))
    db.session.add(row)
    db.session.commit()
    return row.id


# ── indexes ──────────────────────────────────────────────────────────────

def test_usage_log_has_the_scope_and_time_indexes(flask_app):
    import sqlalchemy as sa

    with flask_app.app_context():
        names = {i["name"] for i in sa.inspect(db.engine).get_indexes("ai_usage_log")}
    assert {"ix_ai_usage_log_user_created", "ix_ai_usage_log_project_created", "ix_ai_usage_log_team_created"} <= names


# ── retention ────────────────────────────────────────────────────────────

def test_purge_removes_only_rows_past_the_retention_window(flask_app):
    from core.maintenance_tasks import purge_old_usage
    from core.models import AIUsageLog

    with flask_app.app_context():
        user = _uid()
        old = [_usage_row(user, 500), _usage_row(user, 401)]
        recent = [_usage_row(user, 399), _usage_row(user, 0)]
        result = purge_old_usage(retention_days=400)
        left = {r.id for r in AIUsageLog.query.filter_by(user_id=user).all()}
    assert result["usage_rows"] >= 2
    assert not (left & set(old)) and set(recent) <= left


def test_purge_works_through_a_backlog_in_batches(flask_app, monkeypatch):
    import core.maintenance_tasks as tasks
    from core.models import AIUsageLog

    monkeypatch.setattr(tasks, "_DELETE_BATCH", 3)
    with flask_app.app_context():
        user = _uid()
        for _ in range(10):
            _usage_row(user, 900)
        keep = _usage_row(user, 1)
        tasks.purge_old_usage(retention_days=400)
        assert [r.id for r in AIUsageLog.query.filter_by(user_id=user).all()] == [keep]


def test_purge_also_clears_expired_reservations(flask_app):
    from core.maintenance_tasks import purge_old_usage
    from core.models import BudgetReservation

    with flask_app.app_context():
        for name, delta in (("dead", -1), ("live", 300)):
            db.session.add(BudgetReservation(reservation_id=f"{name}-{uuid.uuid4().hex[:8]}", scope="user", scope_id=f"purge-{name}",
                                             amount_usd=0.1, expires_at=datetime.utcnow() + timedelta(seconds=delta)))
        db.session.commit()
        result = purge_old_usage()
        assert result["reservations"] >= 1
        assert BudgetReservation.query.filter_by(scope_id="purge-dead").count() == 0
        assert BudgetReservation.query.filter_by(scope_id="purge-live").count() == 1


def test_retention_window_is_configurable_but_never_shorter_than_30_days(monkeypatch):
    from core.maintenance_tasks import DEFAULT_USAGE_RETENTION_DAYS, usage_retention_days

    assert usage_retention_days() == DEFAULT_USAGE_RETENTION_DAYS
    monkeypatch.setenv("USAGE_LOG_RETENTION_DAYS", "120")
    assert usage_retention_days() == 120
    monkeypatch.setenv("USAGE_LOG_RETENTION_DAYS", "1")
    assert usage_retention_days() == 30
    monkeypatch.setenv("USAGE_LOG_RETENTION_DAYS", "soon")
    assert usage_retention_days() == DEFAULT_USAGE_RETENTION_DAYS


def test_the_purge_is_scheduled_daily_and_the_tasks_are_registered():
    import core.maintenance_tasks  # noqa: F401
    from core.celery_app import celery

    schedule = celery.conf.beat_schedule["purge-old-usage"]
    assert schedule["task"] == "maintenance.purge_old_usage"
    assert "core.maintenance_tasks" in celery.conf.imports
    assert "maintenance.purge_old_usage" in celery.tasks and "budget.send_alert_email" in celery.tasks


# ── alert emails go through Celery ───────────────────────────────────────

@pytest.fixture
def queue_mode(monkeypatch):
    """Turn off the test-suite's inline mode so _send_alert behaves as in production."""
    monkeypatch.delenv("BUDGET_ALERTS_INLINE", raising=False)


def test_alerts_are_queued_not_sent_inline(flask_app, queue_mode, monkeypatch):
    import core.maintenance_tasks as tasks
    from core.budget import _send_alert

    queued, inline = [], []
    monkeypatch.setattr(tasks.send_budget_alert_email, "apply_async", lambda **kw: queued.append(kw))
    monkeypatch.setattr("core.email_sender.send_platform_email", lambda *a: inline.append(a) or (True, None))
    with flask_app.app_context():
        _send_alert("someone@example.com", "Subject", "Body")
    assert queued and queued[0]["args"] == ["someone@example.com", "Subject", "Body"]
    assert inline == []


def test_an_unqueueable_alert_is_sent_inline_instead_of_lost(flask_app, queue_mode, monkeypatch):
    import core.maintenance_tasks as tasks
    from core.budget import _send_alert

    def _broker_down(**kw):
        raise ConnectionError("broker unreachable")

    inline = []
    monkeypatch.setattr(tasks.send_budget_alert_email, "apply_async", _broker_down)
    monkeypatch.setattr("core.email_sender.send_platform_email", lambda *a: inline.append(a) or (True, None))
    with flask_app.app_context():
        _send_alert("someone@example.com", "Subject", "Body")
    assert len(inline) == 1 and inline[0][1] == "someone@example.com"


def test_the_alert_task_runs_inside_an_app_context_with_the_backend_importable(flask_app, monkeypatch):
    """In a Celery worker there is no app context and `app` is not importable
    by default; the task has to provide both (this was a real failure)."""
    import sys

    import core.maintenance_tasks as tasks
    from flask import has_app_context

    seen = {}
    monkeypatch.setattr("core.email_sender.send_platform_email",
                        lambda *a: seen.update(ctx=has_app_context()) or (True, None))
    backend_dir = tasks.os.path.dirname(tasks.os.path.dirname(tasks.os.path.abspath(tasks.__file__)))
    monkeypatch.setattr(sys, "path", [p for p in sys.path if p != backend_dir])
    tasks.send_budget_alert_email.run("who@example.com", "Hello", "Body")
    assert seen["ctx"] is True and backend_dir in sys.path


def test_the_alert_task_sends_and_retries_when_sending_fails(flask_app, monkeypatch):
    import core.maintenance_tasks as tasks

    sent = []
    monkeypatch.setattr("core.email_sender.send_platform_email", lambda s, r, sub, body: sent.append((r, sub)) or (True, None))
    assert tasks.send_budget_alert_email.run("who@example.com", "Hello", "Body") == {"sent": True, "to": "who@example.com"}
    assert sent == [("who@example.com", "Hello")]

    monkeypatch.setattr("core.email_sender.send_platform_email", lambda *a: (False, "smtp down"))
    with pytest.raises(RuntimeError, match="smtp down"):     # outside a worker, retry() re-raises the cause
        tasks.send_budget_alert_email.run("who@example.com", "Hello", "Body")


# ── LangChain embeddings are now in the usage log ────────────────────────

def test_langchain_embedding_usage_is_logged_with_an_estimate(monolith_app, flask_app):
    import app as app_module
    from core.models import AIUsageLog

    with flask_app.app_context():
        user = _uid()
        app_module._log_langchain_embedding_usage(["x" * 400, "y" * 400], user, None, "document_intelligence.kg_rag_embed_documents")
        row = AIUsageLog.query.filter_by(user_id=user).one()
        assert row.agent == "document_intelligence.kg_rag_embed_documents" and row.model == "text-embedding-ada-002"
        assert row.prompt_tokens == 200 and row.estimated_cost_usd > 0 and row.key_source == "platform"


def test_langchain_embedding_logging_skips_unattributable_calls_and_never_raises(monolith_app, flask_app, monkeypatch):
    import app as app_module
    from core.models import AIUsageLog

    with flask_app.app_context():
        before = AIUsageLog.query.count()
        app_module._log_langchain_embedding_usage(["text"], None, None, "x")
        assert AIUsageLog.query.count() == before

        monkeypatch.setattr("core.ai_client.log_ai_usage", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db down")))
        app_module._log_langchain_embedding_usage(["text"], _uid(), None, "x")   # must not raise


def test_the_kg_rag_pipeline_logs_its_document_and_query_embeddings(monolith_app, flask_app, monkeypatch):
    import numpy as np

    import app as app_module
    from core.models import AIUsageLog

    class _FakeEmbeddings:
        def embed_query(self, q):
            return [0.1] * 8

    text = "Acme makes titanium fasteners. " * 60
    monkeypatch.setattr(app_module, "load_document_from_source", lambda *a, **k: "/fake/path")
    monkeypatch.setattr(app_module, "extract_text_from_document", lambda p: text)
    monkeypatch.setattr(app_module, "create_embeddings", lambda chunks: np.random.rand(len(chunks), 8).astype("float32"))
    monkeypatch.setattr(app_module, "OpenAIEmbeddings", lambda *a, **k: _FakeEmbeddings())
    monkeypatch.setattr(app_module, "generate_answer_with_rag", lambda *a, **k: "an answer")

    user = _uid("kg")
    docs = [{"source_type": "local", "path": f"/x/{uuid.uuid4().hex}.pdf"}]
    with flask_app.app_context():
        out = app_module.process_documents_with_kg_rag(docs, [{"id": "a"}], [], "what do they make?", user_id=user)
        assert out == {"answer": "an answer"}
        agents = sorted(r.agent for r in AIUsageLog.query.filter_by(user_id=user).all())
    assert agents == ["document_intelligence.kg_rag_embed_documents", "document_intelligence.kg_rag_embed_query"]
