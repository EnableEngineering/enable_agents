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
              use_ai_personalization=False, on_sent=None, before_send=None, on_send_failed=None):
        calls["batches"].append([b["email"] for b in businesses])
        sent = 0
        for b in businesses:
            if calls["fail_after"] is not None and sent >= calls["fail_after"]:
                return None, "SMTP connection lost", 500
            if before_send and before_send(b["email"]) is False:
                continue
            if calls.get("crash_on") == b["email"]:
                raise RuntimeError("worker killed mid-send")   # email out, no confirmation
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

    monkeypatch.setattr(graph, "_ledger_claim", _boom)
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


# ── claim-before-send: a crash can never lead to a second email ──────────

def _rows(state, stage="sequence"):
    from models.workflow import WorkflowSendLedger

    return {r.recipient_email: r.status
            for r in WorkflowSendLedger.query.filter_by(instance_id=state["instance_id"], stage_id=stage).all()}


def test_recipients_are_claimed_then_confirmed(fake_core):
    state = _state("statuses")
    _send_bulk_emails_or_skip(state, "sequence", _args(_biz("a@x.co", "b@x.co")))
    assert _rows(state) == {"a@x.co": "sent", "b@x.co": "sent"}


def test_a_crash_between_the_send_and_its_confirmation_never_causes_a_second_email(fake_core):
    """b@'s email goes out, then the worker dies before it is confirmed. The
    claim written beforehand is what stops the retry from emailing b@ again."""
    state = _state("crash")
    args = _args(_biz("a@x.co", "b@x.co", "c@x.co"))
    fake_core["crash_on"] = "b@x.co"
    with pytest.raises(RuntimeError, match="worker killed"):
        _send_bulk_emails_or_skip(state, "sequence", args)
    assert _rows(state) == {"a@x.co": "sent", "b@x.co": "claimed"}

    fake_core["crash_on"] = None
    out = _send_bulk_emails_or_skip(state, "sequence", args)       # human re-approves
    assert out["count"] == 1
    assert fake_core["batches"][-1] == ["c@x.co"]                   # neither a@ nor b@ again
    assert _rows(state) == {"a@x.co": "sent", "b@x.co": "claimed", "c@x.co": "sent"}


def test_a_fully_handled_stage_with_unconfirmed_sends_says_so(fake_core):
    state = _state("unconfirmed")
    args = _args(_biz("a@x.co", "b@x.co"))
    fake_core["crash_on"] = "b@x.co"
    with pytest.raises(RuntimeError):
        _send_bulk_emails_or_skip(state, "sequence", args)
    fake_core["crash_on"] = None
    out = _send_bulk_emails_or_skip(state, "sequence", args)
    assert out["skipped"] is True
    assert "1 of them unconfirmed" in out["reason"] and "Sent folder" in out["reason"]


def test_an_address_someone_else_already_claimed_is_skipped_not_emailed(fake_core):
    import agents.workflow_orchestration.graph as graph

    state = _state("race")
    args = _args(_biz("a@x.co"))
    h = graph._send_content_hash(args)
    assert graph._ledger_claim(state["instance_id"], "sequence", h, "A@x.co") is True
    assert graph._ledger_claim(state["instance_id"], "sequence", h, "a@x.co") is False   # concurrent approve
    out = _send_bulk_emails_or_skip(state, "sequence", args)
    assert out["skipped"] is True and fake_core["batches"] == []


def test_a_claim_that_cannot_be_written_means_nothing_is_sent(real_core_with_fake_smtp, monkeypatch):
    import agents.workflow_orchestration.graph as graph

    def _boom(*a, **k):
        raise RuntimeError("ledger database unavailable")

    monkeypatch.setattr(graph, "_ledger_claim", _boom)
    with pytest.raises(RuntimeError) as exc:
        graph._send_bulk_emails_or_skip(_state("noclaim"), "sequence", _args(_biz("a@x.co", "b@x.co")))
    assert "not sending, so no one is emailed twice" in str(exc.value)
    assert _FakeSMTP.sent_to == []


class _FlakySMTP(_FakeSMTP):
    failures = {}   # recipient -> exception to raise instead of sending

    def send_message(self, msg):
        exc = _FlakySMTP.failures.get(msg["To"])
        if exc:
            raise exc
        super().send_message(msg)


@pytest.fixture
def flaky_smtp(real_core_with_fake_smtp, monkeypatch):
    import smtplib

    _FlakySMTP.failures = {}
    monkeypatch.setattr(smtplib, "SMTP", _FlakySMTP)
    return _FlakySMTP


def test_a_definite_refusal_releases_the_claim_so_it_can_be_retried(flaky_smtp):
    import smtplib

    state = _state("refused")
    args = _args(_biz("a@x.co", "b@x.co", "c@x.co"))
    flaky_smtp.failures["b@x.co"] = smtplib.SMTPRecipientsRefused({"b@x.co": (550, b"no such user")})
    with pytest.raises(RuntimeError):
        _send_bulk_emails_or_skip(state, "sequence", args)
    assert _rows(state) == {"a@x.co": "sent"}                       # b@'s claim was released: it never went out

    flaky_smtp.failures = {}
    out = _send_bulk_emails_or_skip(state, "sequence", args)
    assert out["count"] == 2 and _FakeSMTP.sent_to == ["a@x.co", "b@x.co", "c@x.co"]


def test_an_ambiguous_failure_keeps_the_claim_and_tells_the_user(flaky_smtp):
    """A timeout after handing the message over: it may or may not have gone out."""
    state = _state("timeout")
    args = _args(_biz("a@x.co", "b@x.co", "c@x.co"))
    flaky_smtp.failures["b@x.co"] = TimeoutError("timed out waiting for the server")
    with pytest.raises(RuntimeError) as exc:
        _send_bulk_emails_or_skip(state, "sequence", args)
    assert "isn't known whether they went out (b@x.co)" in str(exc.value) and "Sent folder" in str(exc.value)
    assert _rows(state) == {"a@x.co": "sent", "b@x.co": "claimed"}

    flaky_smtp.failures = {}
    out = _send_bulk_emails_or_skip(state, "sequence", args)
    assert out["count"] == 1 and _FakeSMTP.sent_to == ["a@x.co", "c@x.co"]   # b@ is NOT re-sent


def test_the_real_loop_honours_before_send_skips(real_core_with_fake_smtp):
    result, error, status = real_core_with_fake_smtp(
        "Hi", "Body", _biz("a@x.co", "b@x.co", "c@x.co"), "sender@example.com", "sender@example.com",
        campaign_name="Skip test", before_send=lambda r: r != "b@x.co",
    )
    assert error is None and result["count"] == 2
    assert _FakeSMTP.sent_to == ["a@x.co", "c@x.co"]
