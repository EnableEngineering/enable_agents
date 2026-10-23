"""Event Networking Agent — SQLAlchemy models."""
import json
from datetime import datetime
from typing import Any, Dict, List

from pgvector.sqlalchemy import Vector

from core.database import db


class ENEvent(db.Model):
    """A conference/event whose attendees this agent tracks."""

    __tablename__ = "en_events"

    event_id = db.Column(db.String(36), primary_key=True)
    user_id = db.Column(db.String(255), nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text)
    date = db.Column(db.String(20))
    location = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    attendees = db.relationship("ENAttendee", back_populates="event", cascade="all, delete-orphan")

    def to_dict(self) -> Dict[str, Any]:
        is_upcoming = True
        try:
            is_upcoming = (not self.date) or (self.date >= datetime.utcnow().strftime("%Y-%m-%d"))
        except Exception:
            pass
        return {
            "id": self.event_id,
            "name": self.name,
            "description": self.description,
            "date": self.date,
            "location": self.location,
            "attendee_count": len(self.attendees),
            "status": "upcoming" if is_upcoming else "past",
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class ENAttendee(db.Model):
    """A contact met at (or invited to) an event."""

    __tablename__ = "en_attendees"

    attendee_id = db.Column(db.String(36), primary_key=True)
    event_id = db.Column(db.String(36), db.ForeignKey("en_events.event_id"), nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    email = db.Column(db.String(255))
    company = db.Column(db.String(255))
    role = db.Column(db.String(255))
    linkedin = db.Column(db.String(500))
    _interests = db.Column("interests", db.Text, default="[]")
    notes = db.Column(db.Text)
    priority = db.Column(db.String(20), default="medium")
    last_contact = db.Column(db.String(20))
    follow_up_date = db.Column(db.String(20))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    embedding = db.Column(Vector(1536), nullable=True)

    event = db.relationship("ENEvent", back_populates="attendees")

    @property
    def interests(self) -> List[str]:
        try:
            return json.loads(self._interests or "[]")
        except Exception:
            return []

    @interests.setter
    def interests(self, value: List[str]):
        self._interests = json.dumps(value or [])

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.attendee_id,
            "event_id": self.event_id,
            "name": self.name,
            "email": self.email,
            "company": self.company,
            "role": self.role,
            "linkedin": self.linkedin,
            "interests": self.interests,
            "notes": self.notes,
            "priority": self.priority,
            "lastContact": self.last_contact,
            "followUpDate": self.follow_up_date,
        }
