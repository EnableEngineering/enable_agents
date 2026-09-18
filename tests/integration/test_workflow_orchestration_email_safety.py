"""Integration tests - the guards around the workflow engine's one
irreversible action, sending email (graph.py's _send_bulk_emails_or_skip):
skip-visibility, at-most-once per recipient across partial failures, and
the per-stage recipient cap. send_bulk_emails_core is replaced with a fake
so no test here can send real mail.
"""
import uuid

import pytest

import agents.email_outreach.service as email_service
from agents.workflow_orchestration.graph import _send_bulk_emails_or_skip


def _state(label="x"):
    # Unique per call: the send ledger lives in ContextStore (Redis + PG),
    # which outlives a test run, so a fixed instance id would see the
    # previous run's "already emailed" entries.
    return {"instance_id": f"wf-safety-{label}-{uuid.uuid4().hex[:8]}", "user_id": "safety@test.com"}


def _args(businesses, subject="Hi", body="Body"):
    return {
        "subject": subject, "body": body, "businesses": businesses,
        "campaign_name": "Safety", "use_ai_personalization": False,
    }


def _biz(*emails):
    return [{"name": f"Biz {i}", "email": e} for i, e in enumerate(emails)]


@pytest.fixture
def fake_core(flask_app, monkeypatch):
    """Records what would have been emailed; can be told to fail after N."""
    calls = {"batches": [], "fail_after": None}

    def _fake(subject, body, businesses, user_email, user_id, campaign_name="x",
              use_ai_personalization=False, on_sent=None):
        calls["batches"].append([b["email"] for b in businesses])
        sent = 0
        for b in businesses:
            if calls["fail_after"] is not None and sent >= calls["fail_after"]:
                return None, "SMTP connection lost", 500
            if on_sent:
                on_sent(b["email"])
            sent += 1
        return {"success": True, "count": sent}, None, 200

    monkeypatch.setattr(email_service, "send_bulk_emails_core", _fake)
    with flask_app.app_context():
        yield calls


def test_no_emails_is_a_visible_skip_with_a_reason(fake_core):
    out = _send_bulk_emails_or_skip(_state("skip"), "rfq_outreach", _args([{"name": "A"}, {"name": "B", "email": "N/A"}]))
    assert out["skipped"] is True
    assert out["reason"] == "none of the 2 businesses has an email address"
    assert fake_core["batches"] == []


def test_partial_failure_then_reapprove_only_sends_to_the_rest(fake_core):
    state = _state("partial")
    args = _args(_biz("a@x.co", "b@x.co", "c@x.co"))

    fake_core["fail_after"] = 1  # a@ goes out, then the connection drops
    with pytest.raises(RuntimeError) as exc:
        _send_bulk_emails_or_skip(state, "rfq_outreach", args)
    assert "SMTP connection lost" in str(exc.value)
    assert "1 were sent before it failed and won't be re-sent" in str(exc.value)

    fake_core["fail_after"] = None  # human re-approves, unchanged message
    out = _send_bulk_emails_or_skip(state, "rfq_outreach", args)
    assert out["count"] == 2
    # first attempt got all three; the retry got only b@ and c@ - never a@ twice
    assert fake_core["batches"] == [["a@x.co", "b@x.co", "c@x.co"], ["b@x.co", "c@x.co"]]


def test_reapproving_a_fully_sent_stage_sends_nothing(fake_core):
    state = _state("replay")
    args = _args(_biz("a@x.co", "b@x.co"))
    _send_bulk_emails_or_skip(state, "sequence", args)
    out = _send_bulk_emails_or_skip(state, "sequence", args)  # replay / double approve
    assert out["skipped"] is True
    assert out["reason"] == "all 2 recipients were already emailed by this stage"
    assert len(fake_core["batches"]) == 1


def test_changing_the_message_starts_a_fresh_ledger(fake_core):
    state = _state("edit")
    _send_bulk_emails_or_skip(state, "sequence", _args(_biz("a@x.co"), body="v1"))
    out = _send_bulk_emails_or_skip(state, "sequence", _args(_biz("a@x.co"), body="a different email"))
    assert out["count"] == 1
    assert len(fake_core["batches"]) == 2


def test_recipient_cap_blocks_an_oversized_send(fake_core, monkeypatch):
    monkeypatch.setenv("WORKFLOW_MAX_EMAIL_RECIPIENTS", "2")
    with pytest.raises(RuntimeError) as exc:
        _send_bulk_emails_or_skip(_state("cap"), "outreach", _args(_biz("a@x.co", "b@x.co", "c@x.co")))
    assert "over the per-stage limit of 2" in str(exc.value)
    assert fake_core["batches"] == []
