"""Background chores that shouldn't run inside a user's request.

  * send_budget_alert_email - the "80% used" / "over budget" emails from
    core/budget.py. They used to be sent inline, on the AI call that happened
    to cross the threshold, so that call waited on SMTP.
  * purge_old_usage         - retention for ai_usage_log (nothing reads spend
    older than the longest dashboard window) plus leftover budget
    reservations from processes that died mid-call. Scheduled daily by
    Celery beat (core/celery_app.py).
"""
import logging
import os
from datetime import datetime, timedelta

from core.celery_app import celery, get_flask_app

logger = logging.getLogger(__name__)

# The usage dashboards look back at most 365 days (routes/usage.py), plus some
# slack; budgets only ever need the current month.
DEFAULT_USAGE_RETENTION_DAYS = 400
_DELETE_BATCH = 5000


def _ensure_backend_on_path() -> None:
    """A Celery prefork child's sys.path comes from the `celery` script's
    location, not the backend directory, so lazily importing `app` (which
    send_platform_email does) fails with ModuleNotFoundError - the same thing
    agents/workflow_orchestration/tasks.py works around."""
    import sys

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)


@celery.task(bind=True, name="budget.send_alert_email", max_retries=2, default_retry_delay=60)
def send_budget_alert_email(self, recipient: str, subject: str, body: str) -> dict:
    _ensure_backend_on_path()
    from core.email_sender import send_platform_email

    # send_platform_email reads the platform's Gmail token from the database,
    # so it needs an application context (a worker has none of its own).
    with get_flask_app().app_context():
        sent, error = send_platform_email(recipient, recipient, subject, body)
    if not sent:
        logger.warning(f"Budget alert email to {recipient} failed: {error}")
        raise self.retry(exc=RuntimeError(str(error)))
    return {"sent": True, "to": recipient}


def usage_retention_days() -> int:
    try:
        return max(30, int(os.getenv("USAGE_LOG_RETENTION_DAYS", DEFAULT_USAGE_RETENTION_DAYS)))
    except ValueError:
        return DEFAULT_USAGE_RETENTION_DAYS


def purge_old_usage(retention_days: int = None) -> dict:
    """Delete usage rows older than the retention window (in batches, so it
    never holds a long lock) and expired budget reservations. Needs an app
    context. Returns what it removed."""
    from core.database import db
    from core.models import AIUsageLog, BudgetReservation

    cutoff = datetime.utcnow() - timedelta(days=retention_days or usage_retention_days())
    removed_usage = 0
    while True:
        ids = [row[0] for row in db.session.query(AIUsageLog.id).filter(AIUsageLog.created_at < cutoff).limit(_DELETE_BATCH).all()]
        if not ids:
            break
        AIUsageLog.query.filter(AIUsageLog.id.in_(ids)).delete(synchronize_session=False)
        db.session.commit()
        removed_usage += len(ids)
    removed_reservations = BudgetReservation.query.filter(BudgetReservation.expires_at < datetime.utcnow()).delete(
        synchronize_session=False)
    db.session.commit()
    return {"usage_rows": removed_usage, "reservations": removed_reservations, "cutoff": cutoff.isoformat()}


@celery.task(name="maintenance.purge_old_usage")
def purge_old_usage_task() -> dict:
    with get_flask_app().app_context():
        result = purge_old_usage()
        logger.info(f"Usage retention: {result}")
        return result
