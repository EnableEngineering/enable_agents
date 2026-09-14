"""
Celery factory.

Usage (in app factory):
    from core.celery_app import make_celery
    celery = make_celery(app)

Usage (in worker command):
    celery -A core.celery_app worker

The celery instance is created lazily when make_celery is called, or
when the module is imported by a worker (which triggers app import).
"""
import os
from typing import Optional
from celery import Celery
from flask import Flask

celery: Optional[Celery] = None
_flask_app: Optional[Flask] = None


def get_flask_app() -> Flask:
    """Get or create a minimal Flask app for Celery tasks that need DB access."""
    global _flask_app
    if _flask_app is not None:
        return _flask_app

    _flask_app = Flask(__name__)

    # Database config - PostgreSQL required
    database_url = os.environ.get("DATABASE_URL") or os.environ.get("DATABASE_URI")
    if not database_url:
        raise ValueError("DATABASE_URL or DATABASE_URI environment variable is required.")
    _flask_app.config["SQLALCHEMY_DATABASE_URI"] = database_url
    _flask_app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    # Initialize database
    from core.database import db
    db.init_app(_flask_app)

    return _flask_app


def _create_standalone_celery() -> Celery:
    """Create a standalone Celery instance for workers without Flask app context."""
    broker = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
    backend = os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")

    c = Celery(
        "enable_agents",
        broker=broker,
        backend=backend,
    )
    c.conf.update(
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        timezone="UTC",
        enable_utc=True,
        task_track_started=True,
        imports=[
            "agents.document_intelligence.tasks",
            "agents.content_marketing.tasks",
            "agents.workflow_orchestration.tasks",
        ],
    )
    return c


def make_celery(app) -> Celery:
    global celery
    broker = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
    backend = os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")

    celery = Celery(
        app.import_name,
        broker=broker,
        backend=backend,
    )
    celery.conf.update(
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        timezone="UTC",
        enable_utc=True,
        task_track_started=True,
        # Auto-discover tasks from agents
        imports=[
            "agents.document_intelligence.tasks",
            "agents.content_marketing.tasks",
            "agents.workflow_orchestration.tasks",
        ],
    )

    class ContextTask(celery.Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)

    celery.Task = ContextTask
    return celery


# Create standalone celery instance for workers started with `celery -A core.celery_app worker`
# This is needed because the worker doesn't import app.py which would call make_celery
if celery is None:
    celery = _create_standalone_celery()
