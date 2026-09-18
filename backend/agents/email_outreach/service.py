"""Email Outreach Agent — service layer."""
import os
from datetime import datetime
from uuid import uuid4

from flask import g, jsonify, request

from core.database import db
from .models import EmailCampaign, EmailCampaignRecipient, EmailExtractionQuota


def create_campaign():
    data = request.get_json(silent=True) or {}
    required = ["name", "subject", "body_template"]
    missing = [k for k in required if not data.get(k)]
    if missing:
        return jsonify({"error": f"Missing fields: {missing}"}), 400

    campaign_id = str(uuid4())
    campaign = EmailCampaign(
        id=campaign_id,
        name=data["name"],
        subject=data["subject"],
        body_template=data["body_template"],
        username=g.user_id,
    )
    db.session.add(campaign)

    for r in data.get("recipients", []):
        db.session.add(EmailCampaignRecipient(
            campaign_id=campaign_id,
            receiver_email=r.get("email"),
            receiver_name=r.get("name"),
            company=r.get("company"),
        ))

    db.session.commit()
    return jsonify({"success": True, "campaign_id": campaign_id}), 201


def list_campaigns():
    campaigns = EmailCampaign.query.filter_by(username=g.user_id).order_by(EmailCampaign.created_at.desc()).all()
    return jsonify({"success": True, "campaigns": [
        {"campaign_id": c.id, "name": c.name, "status": c.status, "created_at": c.created_at.isoformat()}
        for c in campaigns
    ]})


def _owned_campaign_or_none(campaign_id: str):
    campaign = EmailCampaign.query.filter_by(id=campaign_id).first()
    if not campaign or campaign.username != g.user_id:
        return None
    return campaign


def campaign_stats(campaign_id: str):
    campaign = _owned_campaign_or_none(campaign_id)
    if not campaign:
        return jsonify({"error": "Campaign not found"}), 404
    recipients = EmailCampaignRecipient.query.filter_by(campaign_id=campaign_id).all()
    sent = sum(1 for r in recipients if r.status == "Sent")
    failed = sum(1 for r in recipients if r.status == "failed")
    return jsonify({
        "success": True,
        "campaign_id": campaign_id,
        "name": campaign.name,
        "total": len(recipients),
        "sent": sent,
        "failed": failed,
        "pending": len(recipients) - sent - failed,
        "status": campaign.status,
    })


def campaign_recipients(campaign_id: str):
    if not _owned_campaign_or_none(campaign_id):
        return jsonify({"error": "Campaign not found"}), 404
    recipients = EmailCampaignRecipient.query.filter_by(campaign_id=campaign_id).all()
    return jsonify({"success": True, "recipients": [
        {"email": r.receiver_email, "name": r.receiver_name, "company": r.company, "status": r.status}
        for r in recipients
    ]})


def send_campaign(campaign_id: str):
    # Delegate to legacy handler during migration
    try:
        from app import send_bulk_emails  # noqa
        return send_bulk_emails()
    except (ImportError, AttributeError):
        return jsonify({"error": "Send not yet migrated"}), 501


def generate_email():
    try:
        from app import generate_email as legacy  # noqa
        return legacy()
    except (ImportError, AttributeError):
        return jsonify({"error": "Generate not yet migrated"}), 501


def send_bulk_emails_core(subject, body, businesses, user_email, user_id,
                           campaign_name="Untitled Campaign", use_ai_personalization=False,
                           on_sent=None):
    """Plain-argument core of app.py's send_bulk_emails - callable from a
    LangGraph node (or anywhere else outside a Flask request) with no
    request/g dependency. `user_email` and `user_id` are the same value at
    every current call site (the verified session identity IS the sender's
    email in this codebase) - kept as two params to match the signature the
    orchestration plan calls for and in case that ever changes.

    Several helpers/models this depends on (GoogleOAuthToken, SCOPES,
    _normalize_username, _ensure_email_usage_tables,
    _ensure_campaign_reply_tracking_columns, generate_email_content) still
    live in app.py - imported lazily here rather than duplicated, same
    pattern this file already used for send_campaign/generate_email/send_bulk.

    `on_sent(recipient_email)`, if given, is called right after each
    individual email is handed to Gmail/SMTP - before this function's own
    single end-of-loop commit of recipient rows, which an exception midway
    never reaches. It exists so a caller (the workflow engine's send
    ledger) can durably record who has already been emailed and not
    re-send to them if this call errors out after a partial send.

    Returns (result_dict_or_None, error_message_or_None, http_status).
    """
    import base64
    import smtplib
    import traceback
    from email.message import EmailMessage

    from app import (
        GoogleOAuthToken,
        SCOPES,
        _ensure_campaign_reply_tracking_columns,
        _ensure_email_usage_tables,
        _normalize_username,
        generate_email_content,
    )

    try:
        username = _normalize_username(user_id)

        if not user_email or "@" not in str(user_email):
            return None, "Registered user email is required to send campaign mail.", 400

        if not use_ai_personalization and (not subject or not body):
            return None, "Subject and body are required unless using AI personalization", 400

        valid_emails = [b.get("email") for b in businesses
                         if b.get("email") and b.get("email") != "N/A" and "@" in b.get("email")]
        if not valid_emails:
            return None, "No valid emails found to send to", 400

        _ensure_email_usage_tables()
        _ensure_campaign_reply_tracking_columns()

        campaign_id = str(uuid4())
        campaign = EmailCampaign(
            id=campaign_id,
            name=campaign_name,
            subject=subject,
            username=username,
            sender_email=user_email,
        )
        db.session.add(campaign)
        db.session.commit()

        token_record = None
        if user_email:
            token_record = GoogleOAuthToken.query.filter_by(username=user_email).first()

        service = None
        server = None
        smtp_sender_email = os.getenv("EMAIL_USER") or user_email or ""

        def _connect_smtp_server():
            email_host = os.getenv("EMAIL_HOST", "smtp.gmail.com")
            email_port = int(os.getenv("EMAIL_PORT", 587))
            email_user = os.getenv("EMAIL_USER")
            email_pass = os.getenv("EMAIL_PASS")
            if not email_user or not email_pass:
                return None, None, "Email credentials are not configured. Please sign in with Google or configure system SMTP."
            smtp_server = smtplib.SMTP(email_host, email_port)
            smtp_server.starttls()
            smtp_server.login(email_user, email_pass)
            return smtp_server, email_user, None

        if token_record and token_record.token:
            from google.oauth2.credentials import Credentials
            from google.auth.transport.requests import Request
            import googleapiclient.discovery

            creds = Credentials(
                token=token_record.token,
                refresh_token=token_record.refresh_token,
                token_uri=token_record.token_uri,
                client_id=token_record.client_id,
                client_secret=token_record.client_secret,
                scopes=token_record.scopes.split(",") if token_record.scopes else SCOPES,
            )
            if creds.refresh_token and (not creds.valid or creds.expired):
                creds.refresh(Request())
                token_record.token = creds.token
                db.session.commit()
            service = googleapiclient.discovery.build("gmail", "v1", credentials=creds)
        else:
            server, email_user, smtp_err = _connect_smtp_server()
            if smtp_err:
                return None, smtp_err, 500

        sent_count = 0
        for b in businesses:
            recipient = b.get("email")
            if not recipient or recipient == "N/A" or "@" not in recipient:
                continue

            business_name = b.get("name", "Business Owner")

            current_body = body
            if use_ai_personalization:
                try:
                    result = generate_email_content(b, username, user_id=user_id)
                    current_subject = result.get("subject", subject or "Exclusive Offer")
                    current_body = result.get("body", current_body or "")
                except Exception as e:
                    print("Failed AI personalization for", business_name, e)
                    current_subject = subject or "Exclusive Offer"
            else:
                current_subject = subject.replace("{{name}}", business_name) if subject else subject
                if current_body:
                    current_body = current_body.replace("{{name}}", business_name)

            msg = EmailMessage()
            msg.set_content(current_body)
            msg["Subject"] = current_subject
            msg["To"] = recipient

            def _set_from_header(message, sender_value):
                if "From" in message:
                    del message["From"]
                message["From"] = sender_value

            def _set_reply_to_header(message, reply_to_value):
                if "Reply-To" in message:
                    del message["Reply-To"]
                message["Reply-To"] = reply_to_value

            thread_id = None
            msg_id = None
            generated_message_id = f"<{uuid4().hex}@enable-agents.local>"
            _set_from_header(msg, user_email or smtp_sender_email or recipient)
            _set_reply_to_header(msg, smtp_sender_email or user_email or recipient)
            msg["Message-ID"] = generated_message_id
            if service:
                try:
                    encoded_message = base64.urlsafe_b64encode(msg.as_bytes()).decode()
                    create_message = {"raw": encoded_message}
                    sent_msg = service.users().messages().send(userId="me", body=create_message).execute()
                    thread_id = sent_msg.get("threadId")
                    msg_id = sent_msg.get("id")
                except Exception as send_error:
                    # Any Gmail API failure (expired/invalid creds, API not
                    # enabled on the project, quota, etc.) should fall back to
                    # SMTP rather than only specific credential error strings -
                    # narrowly matching text meant only one failure mode ever
                    # got a second chance.
                    print(f"[SEND_EMAILS] Gmail API failed, falling back to SMTP: {send_error}")
                    gmail_error_summary = str(send_error).split(".", 1)[0][:200]
                    service = None
                    server, smtp_sender_email, smtp_err = _connect_smtp_server()
                    if smtp_err:
                        return None, f"Gmail send failed ({gmail_error_summary}) and SMTP fallback is unavailable: {smtp_err}", 500
                    _set_from_header(msg, user_email or smtp_sender_email or recipient)
                    _set_reply_to_header(msg, smtp_sender_email or user_email or recipient)
                    server.send_message(msg)
            else:
                _set_from_header(msg, user_email or smtp_sender_email or recipient)
                _set_reply_to_header(msg, smtp_sender_email or user_email or recipient)
                server.send_message(msg)

            sent_count += 1
            if on_sent:
                try:
                    on_sent(recipient)
                except Exception as ledger_error:
                    # Never let bookkeeping abort a send loop that has
                    # already delivered this email.
                    print(f"[SEND_EMAILS] on_sent callback failed for {recipient}: {ledger_error}")

            recipient_record = EmailCampaignRecipient(
                campaign_id=campaign_id,
                receiver_email=recipient,
                receiver_name=business_name,
                status="SENT",
                reply_status="No Reply",
                message_id=msg_id or generated_message_id,
                thread_id=thread_id,
            )
            db.session.add(recipient_record)

        db.session.commit()

        if server:
            server.quit()

        db.session.commit()

        message = "Emails successfully sent via user account!" if service else "Emails sent via system account."
        return {"success": True, "count": sent_count, "message": message}, None, 200
    except Exception as e:
        db.session.rollback()
        traceback.print_exc()
        return None, str(e), 500


def send_bulk():
    try:
        from app import send_bulk_emails as legacy  # noqa
        return legacy()
    except (ImportError, AttributeError):
        return jsonify({"error": "Bulk send not yet migrated"}), 501


def usage():
    username = g.user_id
    quota = EmailExtractionQuota.query.filter_by(username=username).first()
    if not quota:
        return jsonify({"username": username, "emails_used": 0, "monthly_limit": 500})
    return jsonify({
        "username": username,
        "emails_used": quota.emails_used_this_month,
        "monthly_limit": quota.monthly_limit,
    })
