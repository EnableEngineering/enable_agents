"""
Monthly spend budgets - per project (Project.monthly_budget_usd) and per user
(UserBudget) - and the checks around them.

Spend is always read from AIUsageLog (one row per LLM call, plus non-token
costs like email lookups via log_external_usage), for the current UTC
calendar month, so a budget covers every agent and every workflow.

What a budget does:
  * status  - "none" (no budget set) | "ok" | "warning" (>= 80% used) |
              "over" (>= 100%). Surfaced by /api/usage/budget-status and the
              Usage / Workflow screens so overspend is visible *before*
              anyone reads an email.
  * alerts  - one email when a budget first reaches 80%, one when it's
              exceeded, each at most once per calendar month (per budget).
              Project alerts go to the project owner, user alerts to the user.
  * autopilot - an over-budget project OR user makes Autopilot hand the next
              stage to a human (graph.py's run_stage).

What it deliberately does NOT do: block AI calls. Blocking a shared key
mid-workflow is a confusing, hard-to-diagnose failure for whoever hits it
next, and there's no way here to explain it to them at that moment. Callers
who want a hard stop can build on is_over_budget().
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# A budget is "warning" once this fraction of it has been spent.
WARN_FRACTION = 0.8


def _month_start() -> datetime:
    now = datetime.utcnow()
    return datetime(now.year, now.month, 1)


def _month_key() -> str:
    return datetime.utcnow().strftime("%Y-%m")


# ── Spend ────────────────────────────────────────────────────────────────

def _sum_spend(*filters) -> float:
    from sqlalchemy import func
    from core.database import db
    from core.models import AIUsageLog

    total = (
        db.session.query(func.coalesce(func.sum(AIUsageLog.estimated_cost_usd), 0.0))
        .filter(AIUsageLog.created_at >= _month_start(), *filters)
        .scalar()
    )
    return float(total or 0.0)


def _current_month_spend_usd(project_id: str) -> float:
    """This month's spend on one project (kept under this name - the
    workflow engine and usage routes import it)."""
    from core.models import AIUsageLog

    return _sum_spend(AIUsageLog.project_id == project_id)


def current_month_user_spend_usd(user_id: str) -> float:
    """This month's spend by one user across every project (and calls made
    with no project at all)."""
    from core.models import AIUsageLog

    return _sum_spend(AIUsageLog.user_id == user_id)


# ── Status ───────────────────────────────────────────────────────────────

def budget_state(spend: float, limit: Optional[float]) -> Dict[str, Any]:
    """Pure function: spend + limit -> the status dict the API/UI show."""
    spend = round(float(spend or 0.0), 6)
    if limit is None:
        return {"limitUsd": None, "spendUsd": spend, "remainingUsd": None, "percentUsed": None, "state": "none"}

    limit = float(limit)
    percent = (spend / limit * 100.0) if limit > 0 else (100.0 if spend > 0 else 0.0)
    if spend >= limit and (limit > 0 or spend > 0):
        state = "over"
    elif limit > 0 and spend >= limit * WARN_FRACTION:
        state = "warning"
    else:
        state = "ok"
    return {
        "limitUsd": limit,
        "spendUsd": spend,
        "remainingUsd": round(max(limit - spend, 0.0), 6),
        "percentUsed": round(percent, 1),
        "state": state,
    }


def get_user_budget(user_id: str) -> Optional[float]:
    from core.models import UserBudget

    row = UserBudget.query.filter_by(user_id=user_id).first()
    return row.monthly_budget_usd if row else None


def set_user_budget(user_id: str, monthly_budget_usd: Optional[float]) -> Optional[float]:
    """Set (or, with None, remove) a user's monthly budget. Resets the
    per-month alert markers so a new/raised budget can alert again."""
    from core.database import db
    from core.models import UserBudget

    if monthly_budget_usd is not None and monthly_budget_usd < 0:
        raise ValueError("Budget must be zero or more")

    row = UserBudget.query.filter_by(user_id=user_id).first()
    if monthly_budget_usd is None:
        if row:
            db.session.delete(row)
            db.session.commit()
        return None
    if not row:
        row = UserBudget(user_id=user_id)
        db.session.add(row)
    row.monthly_budget_usd = float(monthly_budget_usd)
    row.warn_month = None
    row.over_month = None
    db.session.commit()
    return row.monthly_budget_usd


def user_budget_status(user_id: str) -> Dict[str, Any]:
    return budget_state(current_month_user_spend_usd(user_id), get_user_budget(user_id))


def project_budget_status(project_id: str) -> Dict[str, Any]:
    from core.models import Project

    project = Project.query.filter_by(project_id=project_id).first()
    limit = project.monthly_budget_usd if project else None
    return budget_state(_current_month_spend_usd(project_id), limit)


def budget_overview(user_id: str, project_id: Optional[str] = None) -> Dict[str, Any]:
    """Both budgets that apply to a user working (optionally) in a project,
    plus the worst state of the two - what a screen needs to decide whether
    to show a warning."""
    user = user_budget_status(user_id)
    project = project_budget_status(project_id) if project_id else None
    rank = {"none": 0, "ok": 1, "warning": 2, "over": 3}
    worst = max((user["state"], (project or {}).get("state", "none")), key=lambda s: rank[s])
    return {"user": user, "project": project, "worstState": worst}


def is_over_budget(user_id: Optional[str], project_id: Optional[str]) -> bool:
    """True if the project's OR the user's monthly budget is used up."""
    if project_id and project_budget_status(project_id)["state"] == "over":
        return True
    if user_id and user_budget_status(user_id)["state"] == "over":
        return True
    return False


# ── Alerts ───────────────────────────────────────────────────────────────

def _send_alert(recipient: str, subject: str, body: str) -> None:
    try:
        from core.email_sender import send_platform_email

        sent, error = send_platform_email(recipient, recipient, subject, body)
        if not sent:
            logger.warning(f"Budget alert email to {recipient} failed: {error}")
    except Exception as e:
        logger.warning(f"Budget alert email to {recipient} failed: {e}")


def _alert_for(label: str, recipient: str, status: Dict[str, Any], month: str, warned: Optional[str], over: Optional[str]):
    """Decide which alert (if any) a budget is due, send it, and return the
    updated (warn_month, over_month). A budget that jumps straight past its
    limit gets only the "over" email, and counts as warned too."""
    state = status["state"]
    if state == "over" and over != month:
        _send_alert(
            recipient,
            f'{label} has crossed its AI budget for {month}',
            f'{label} has spent an estimated ${status["spendUsd"]:.2f} on AI usage this month, '
            f'crossing the ${status["limitUsd"]:.2f} budget.\n\n'
            'AI actions are not blocked, but Autopilot workflows will now pause for your review. '
            'See the full breakdown by agent, project and workflow in the Usage dashboard.',
        )
        return month, month
    if state == "warning" and warned != month:
        _send_alert(
            recipient,
            f'{label} has used {status["percentUsed"]:.0f}% of its AI budget for {month}',
            f'{label} has spent an estimated ${status["spendUsd"]:.2f} of its ${status["limitUsd"]:.2f} '
            'monthly AI budget. This is a heads-up - nothing is blocked. '
            'See the Usage dashboard for what is driving it.',
        )
        return month, over
    return warned, over


def check_and_maybe_alert_budget(project_id: Optional[str] = None, user_id: Optional[str] = None) -> None:
    """Called after every usage log write. A cheap no-op unless the project
    or the user has a budget; each budget sends at most one "80% used" and
    one "over budget" email per calendar month. Never raises - a budget
    check must not break the AI call that triggered it."""
    try:
        from core.database import db
        from core.models import Project, UserBudget

        month = _month_key()

        if project_id:
            project = Project.query.filter_by(project_id=project_id).first()
            if project and project.monthly_budget_usd:
                status = budget_state(_current_month_spend_usd(project_id), project.monthly_budget_usd)
                warned, over = _alert_for(
                    f'"{project.name}"', project.owner_id, status, month,
                    project.budget_warn_month, project.budget_alert_month,
                )
                if (warned, over) != (project.budget_warn_month, project.budget_alert_month):
                    project.budget_warn_month, project.budget_alert_month = warned, over
                    db.session.commit()

        if user_id:
            row = UserBudget.query.filter_by(user_id=user_id).first()
            if row and row.monthly_budget_usd:
                status = budget_state(current_month_user_spend_usd(user_id), row.monthly_budget_usd)
                warned, over = _alert_for(
                    "Your account", user_id, status, month, row.warn_month, row.over_month,
                )
                if (warned, over) != (row.warn_month, row.over_month):
                    row.warn_month, row.over_month = warned, over
                    db.session.commit()
    except Exception as e:
        logger.warning(f"Budget check failed (ignored): {e}")
        try:
            from core.database import db
            db.session.rollback()
        except Exception:
            pass
