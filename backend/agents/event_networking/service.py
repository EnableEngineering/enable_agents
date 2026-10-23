"""Event Networking Agent — service layer."""
import logging
import os
import re
import smtplib
from datetime import datetime
from email.message import EmailMessage
from typing import Any, Dict, List, Optional
from uuid import uuid4

from flask import g, jsonify, request

from core.database import db
from .models import ENEvent, ENAttendee

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"


def _owned_event_or_404(event_id):
    """Fetch the event only if it belongs to the authenticated user - a
    plain ENEvent.query.get() would let any logged-in user read/modify any
    other user's events just by guessing/enumerating event_id."""
    event = ENEvent.query.filter_by(event_id=event_id, user_id=g.user_id).first()
    return event


# =============================================================================
# Events
# =============================================================================

def list_events():
    events = ENEvent.query.filter_by(user_id=g.user_id).order_by(ENEvent.created_at.desc()).all()
    return jsonify({"success": True, "events": [e.to_dict() for e in events]}), 200


def create_event():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "Event name is required"}), 400

    event = ENEvent(
        event_id=str(uuid4()),
        user_id=g.user_id,
        name=name,
        description=data.get("description"),
        date=data.get("date"),
        location=data.get("location"),
    )
    db.session.add(event)
    db.session.commit()
    return jsonify({"success": True, "event": event.to_dict()}), 201


# =============================================================================
# Attendees
# =============================================================================

def list_attendees(event_id):
    event = _owned_event_or_404(event_id)
    if not event:
        return jsonify({"success": False, "error": "Event not found"}), 404
    return jsonify({"success": True, "attendees": [a.to_dict() for a in event.attendees]}), 200


# =============================================================================
# Embedding & Profile Serialization Helpers
# =============================================================================

def _attendee_to_embedding_text(attendee) -> str:
    """Compiles an attendee profile into a structured summary for embedding."""
    parts = []
    name = getattr(attendee, "name", None)
    if name:
        parts.append(f"Name: {name}")
    role = getattr(attendee, "role", None) or ""
    company = getattr(attendee, "company", None) or ""
    role_company = f"{role} at {company}".strip()
    if role_company and role_company != "at":
        parts.append(f"Role: {role_company}")
    interests = getattr(attendee, "interests", None)
    if isinstance(interests, list) and interests:
        parts.append(f"Interests: {', '.join(interests)}")
    notes = getattr(attendee, "notes", None)
    if notes:
        parts.append(f"Notes: {notes}")
    return "\n".join(parts) if parts else getattr(attendee, "name", "") or ""


def _embed_texts(texts: List[str], user_id: Optional[str] = None) -> List[List[float]]:
    """Generates embedding vectors via core.ai_client.ai_embeddings in batches."""
    if not texts:
        return []
    from core.ai_client import ai_embeddings

    batch_size = 100
    all_vectors = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        response = ai_embeddings(
            user_id=user_id,
            project_id=None,
            agent="event_networking",
            model=EMBEDDING_MODEL,
            input=batch,
        )
        batch_vectors = [item.embedding for item in response.data]
        all_vectors.extend(batch_vectors)
    return all_vectors


def _embed_and_save_attendees(attendees: List[ENAttendee], user_id: Optional[str] = None):
    """Generates and assigns embeddings for the given attendee objects."""
    if not attendees:
        return
    try:
        texts = [_attendee_to_embedding_text(a) for a in attendees]
        vectors = _embed_texts(texts, user_id=user_id)
        for a, vec in zip(attendees, vectors):
            a.embedding = vec
    except Exception as exc:
        logger.warning("Failed to generate embeddings for attendees: %s", exc)


def _ensure_attendees_embedded(attendees: List[ENAttendee], user_id: Optional[str] = None):
    """Backfills embeddings for attendees whose embedding is currently None."""
    missing = [a for a in attendees if getattr(a, "embedding", None) is None]
    if not missing:
        return
    try:
        texts = [_attendee_to_embedding_text(a) for a in missing]
        vectors = _embed_texts(texts, user_id=user_id)
        for a, vec in zip(missing, vectors):
            a.embedding = vec
        db.session.commit()
    except Exception as exc:
        logger.warning("Could not backfill attendee embeddings: %s", exc)


def upload_attendees(event_id):
    event = _owned_event_or_404(event_id)
    if not event:
        return jsonify({"success": False, "error": "Event not found"}), 404

    data = request.get_json(silent=True) or {}
    incoming = data.get("attendees") or []
    if not incoming:
        return jsonify({"success": False, "error": "No attendees provided"}), 400

    added_attendees = []
    for a in incoming:
        name = (a.get("name") or "").strip()
        if not name:
            continue
        attendee = ENAttendee(
            attendee_id=str(uuid4()),
            event_id=event_id,
            name=name,
            email=a.get("email"),
            company=a.get("company"),
            role=a.get("role"),
        )
        attendee.interests = a.get("interests") or []
        db.session.add(attendee)
        added_attendees.append(attendee)

    # Pre-embed and cache in DB on ingest
    _embed_and_save_attendees(added_attendees, user_id=getattr(g, "user_id", None))

    db.session.commit()
    all_attendees = ENAttendee.query.filter_by(event_id=event_id).all()
    return jsonify({
        "success": True,
        "count": len(incoming),
        "attendees": [a.to_dict() for a in all_attendees],
    }), 201


def _owned_attendee_or_404(attendee_id):
    attendee = ENAttendee.query.get(attendee_id)
    if not attendee or attendee.event.user_id != g.user_id:
        return None
    return attendee


def update_attendee_notes(attendee_id):
    attendee = _owned_attendee_or_404(attendee_id)
    if not attendee:
        return jsonify({"success": False, "error": "Attendee not found"}), 404

    data = request.get_json(silent=True) or {}
    attendee.notes = data.get("notes", attendee.notes)
    attendee.last_contact = datetime.utcnow().strftime("%Y-%m-%d")

    # Invalidate and re-embed since notes changed
    _embed_and_save_attendees([attendee], user_id=getattr(g, "user_id", None))

    db.session.commit()
    return jsonify({"success": True, "attendee": attendee.to_dict()}), 200


def update_attendee_followup_date(attendee_id):
    attendee = _owned_attendee_or_404(attendee_id)
    if not attendee:
        return jsonify({"success": False, "error": "Attendee not found"}), 404

    data = request.get_json(silent=True) or {}
    attendee.follow_up_date = data.get("followUpDate")
    db.session.commit()
    return jsonify({"success": True, "attendee": attendee.to_dict()}), 200


# =============================================================================
# Recommendations - real keyword-overlap scoring, not random/fabricated
# =============================================================================

_STOPWORDS = {"the", "a", "an", "and", "or", "in", "at", "of", "to", "for", "with", "on"}


def _terms(text: str):
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if w not in _STOPWORDS and len(w) > 2}


def get_recommendations(event_id):
    event = _owned_event_or_404(event_id)
    if not event:
        return jsonify({"success": False, "error": "Event not found"}), 404

    data = request.get_json(silent=True) or {}
    interests = data.get("interests") or []
    goals = data.get("goals") or ""

    query_terms = set()
    for interest in interests:
        query_terms |= _terms(interest)
    query_terms |= _terms(goals)

    if not query_terms:
        return jsonify({"success": True, "recommendations": []}), 200

    scored = []
    for attendee in event.attendees:
        attendee_terms = set()
        reasons = []

        interest_terms = set()
        for interest in attendee.interests:
            interest_terms |= _terms(interest)
        overlap_interests = query_terms & interest_terms
        if overlap_interests:
            reasons.append(f"Shared interest in {', '.join(sorted(overlap_interests))}")
        attendee_terms |= interest_terms

        role_company_terms = _terms(f"{attendee.role or ''} {attendee.company or ''}")
        overlap_role = query_terms & role_company_terms
        if overlap_role:
            reasons.append(f"Relevant role/company: {attendee.role or ''} at {attendee.company or ''}".strip())
        attendee_terms |= role_company_terms

        notes_terms = _terms(attendee.notes or "")
        overlap_notes = query_terms & notes_terms
        attendee_terms |= notes_terms

        overlap_count = len(query_terms & attendee_terms)
        if overlap_count == 0:
            continue

        score = min(99, 40 + overlap_count * 15)
        if not reasons:
            reasons.append("Related background based on notes")

        scored.append({
            "attendee": attendee.to_dict(),
            "score": score,
            "reasons": reasons,
        })

    scored.sort(key=lambda r: r["score"], reverse=True)
    return jsonify({"success": True, "recommendations": scored[:10]}), 200


# =============================================================================
# Follow-up email
# =============================================================================

def send_followup(event_id):
    event = _owned_event_or_404(event_id)
    if not event:
        return jsonify({"success": False, "error": "Event not found"}), 404

    data = request.get_json(silent=True) or {}
    recipient_ids = data.get("recipient_ids") or []
    subject = data.get("subject") or "Great connecting at the event!"
    body = data.get("body") or ""
    sender_email = data.get("sender_email")

    if not recipient_ids:
        return jsonify({"success": False, "error": "No recipients selected"}), 400
    if not body.strip():
        return jsonify({"success": False, "error": "Message body is required"}), 400

    attendees = ENAttendee.query.filter(ENAttendee.attendee_id.in_(recipient_ids)).all()
    recipients = [a for a in attendees if a.email]

    if not recipients:
        return jsonify({"success": False, "error": "None of the selected attendees have an email on file"}), 400

    email_host = os.getenv("EMAIL_HOST", "smtp.gmail.com")
    email_port = int(os.getenv("EMAIL_PORT", 587))
    email_user = os.getenv("EMAIL_USER")
    email_pass = os.getenv("EMAIL_PASS")

    if not email_user or not email_pass:
        return jsonify({
            "success": False,
            "error": "Email sending is not configured (EMAIL_USER/EMAIL_PASS missing).",
        }), 400

    sent_count = 0
    errors = []
    try:
        server = smtplib.SMTP(email_host, email_port, timeout=15)
        server.starttls()
        server.login(email_user, email_pass)
        for attendee in recipients:
            try:
                msg = EmailMessage()
                msg["Subject"] = subject
                msg["From"] = sender_email or email_user
                msg["To"] = attendee.email
                msg.set_content(body.replace("[Name]", attendee.name.split(" ")[0] if attendee.name else ""))
                server.send_message(msg)
                sent_count += 1
                attendee.last_contact = datetime.utcnow().strftime("%Y-%m-%d")
            except Exception as send_err:
                errors.append(f"{attendee.email}: {send_err}")
        server.quit()
    except Exception as conn_err:
        return jsonify({"success": False, "error": f"Could not connect to email server: {conn_err}"}), 500

    db.session.commit()

    message = f"Follow-up sent to {sent_count} of {len(recipients)} attendee(s)."
    if errors:
        message += f" {len(errors)} failed."

    return jsonify({"success": sent_count > 0, "message": message, "sent": sent_count, "errors": errors}), 200
