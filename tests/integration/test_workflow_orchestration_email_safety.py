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
    # Unique per call: the send ledger table (workflow_send_ledger) can
    # outlive a test run on a reused database, so a fixed instance id could
    # see a previous run's "already emailed" rows.
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


def test_sent_addresses_are_persisted_in_the_ledger_table(fake_core):
    from models.workflow import WorkflowSendLedger

    state = _state("table")
    _send_bulk_emails_or_skip(state, "sequence", _args(_biz("A@x.co", "b@x.co")))
    rows = WorkflowSendLedger.query.filter_by(instance_id=state["instance_id"], stage_id="sequence").all()
    assert sorted(r.recipient_email for r in rows) == ["a@x.co", "b@x.co"]  # normalized lowercase


def test_a_failed_ledger_write_stops_the_send_loudly(fake_core, monkeypatch):
    """If the send record can't be saved, the loop must stop - not carry on
    emailing people it can no longer protect from a duplicate on retry."""
    import agents.workflow_orchestration.graph as graph

    def _boom(*args, **kwargs):
        raise RuntimeError("ledger database unavailable")

    monkeypatch.setattr(graph, "_ledger_record", _boom)
    with pytest.raises(RuntimeError, match="ledger database unavailable"):
        graph._send_bulk_emails_or_skip(_state("boom"), "sequence", _args(_biz("a@x.co", "b@x.co")))
    assert len(fake_core["batches"]) == 1  # attempted once; nothing quietly retried


# ── The REAL send loop (send_bulk_emails_core), against a fake SMTP server ──
# Everything above replaces send_bulk_emails_core; these two run the actual
# function so the on_sent contract is proven, not assumed. smtplib.SMTP is
# swapped for a recorder - no network, no real mail.

class _FakeSMTP:
    sent_to = []

    def __init__(self, *args, **kwargs):
        pass

    def starttls(self):
        pass

    def login(self, *args):
        pass

    def send_message(self, msg):
        _FakeSMTP.sent_to.append(msg["To"])

    def quit(self):
        pass


@pytest.fixture
def real_core_with_fake_smtp(flask_app, monkeypatch):
    import smtplib
    import app as _app_module  # noqa: F401  (send_bulk_emails_core imports helpers from app.py)

    _FakeSMTP.sent_to = []
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)
    monkeypatch.setenv("EMAIL_USER", "sender@example.com")
    monkeypatch.setenv("EMAIL_PASS", "not-a-real-password")
    with flask_app.app_context():
        yield email_service.send_bulk_emails_core


def _call_real(core, businesses, on_sent):
    return core("Hi", "Body", businesses, "sender@example.com", "sender@example.com",
                campaign_name="Real loop test", on_sent=on_sent)


def test_real_loop_reports_each_recipient_as_it_is_sent(real_core_with_fake_smtp):
    recorded = []
    result, error, status = _call_real(real_core_with_fake_smtp, _biz("a@x.co", "b@x.co", "c@x.co"), recorded.append)
    assert error is None and result["count"] == 3
    assert recorded == ["a@x.co", "b@x.co", "c@x.co"]
    assert _FakeSMTP.sent_to == ["a@x.co", "b@x.co", "c@x.co"]


def test_real_loop_stops_when_the_send_record_cannot_be_saved(real_core_with_fake_smtp):
    """The 2nd email goes out but its record fails: the loop must stop
    before emailing the 3rd, and say so - not carry on unprotected."""
    def _on_sent(recipient):
        if recipient == "b@x.co":
            raise RuntimeError("ledger database unavailable")

    result, error, status = _call_real(real_core_with_fake_smtp, _biz("a@x.co", "b@x.co", "c@x.co"), _on_sent)
    assert result is None and status == 500
    assert "Emailed b@x.co but couldn't save the send record" in error
    assert "ledger database unavailable" in error
    assert _FakeSMTP.sent_to == ["a@x.co", "b@x.co"]  # c@ was never emailed
