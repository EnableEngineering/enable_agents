"""
Monthly spend budgets - per project (Project.monthly_budget_usd), per user
(UserBudget) and per team (Team.monthly_budget_usd) - and the checks around
them.

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
              Project alerts go to the project owner, user alerts to the
              user, team alerts to the team owner.
  * autopilot - an over-budget project, user OR team makes Autopilot hand the
              next stage to a human (graph.py's run_stage).
  * enforcement - opt-in, per budget: "alert" (default - warn, never block)
              or "block". A "block" budget that is used up makes
              enforce_budget() raise BudgetExceeded before the next paid AI
              call (core/ai_client.py's chokepoints call it); the API turns
              that into HTTP 402 with a message saying which budget and how
              to lift it. It is opt-in because blocking a shared key
              mid-workflow is disruptive - whoever turns it on has chosen
              that trade-off. Failures reading budgets fail OPEN: a broken
              budget lookup must never take AI features down.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# A budget is "warning" once this fraction of it has been spent.
WARN_FRACTION = 0.8

ENFORCEMENTS = ("alert", "block")


def _usd(amount: float) -> str:
    """$1.20, but $0.0004 rather than a misleading $0.00 for fractions of a cent."""
    amount = float(amount or 0.0)
    return f"${amount:.2f}" if amount >= 0.01 or amount == 0 else f"${amount:.4f}"


class BudgetExceeded(Exception):
    """A budget set to "block" is used up. str(e) is written for the person
    who hits it: which budget, and what to do about it."""

    def __init__(self, scope: str, label: str, status: Dict[str, Any], estimated_usd: float = 0.0,
                 reserved_usd: float = 0.0):
        self.scope = scope  # "user" | "project" | "team"
        self.label = label
        self.status = status
        self.estimated_usd = estimated_usd
        self.reserved_usd = reserved_usd  # set aside for other calls still in flight
        limit = status.get("limitUsd") or 0.0
        spent = status.get("spendUsd") or 0.0
        fix = {
            "user": "Raise your budget or switch it to alert-only on the Usage page",
            "project": "Raise the project's budget or switch it to alert-only in the project's AI settings (Projects page)",
            "team": "Ask a team owner or admin to raise the team budget (Usage page, Team tab)",
        }.get(scope, "Raise the budget")
        in_flight = f", with {_usd(reserved_usd)} more in requests still running" if reserved_usd > 0 else ""
        if spent >= limit:
            head = (f"{label} has used its {_usd(limit)} monthly AI budget ({_usd(spent)} spent) and is set to "
                    f"block further AI requests.")
        elif estimated_usd <= 0:
            head = (f"{label} has used its {_usd(limit)} monthly AI budget ({_usd(spent)} spent{in_flight}) and is "
                    f"set to block further AI requests.")
        else:
            head = (f"{label} has only {_usd(max(limit - spent - reserved_usd, 0.0))} left of its {_usd(limit)} "
                    f"monthly AI budget{' after requests still running' if reserved_usd > 0 else ''}, not enough for "
                    f"this request (about {_usd(estimated_usd)}), and is set to block AI requests that would "
                    f"exceed it.")
        super().__init__(f"{head} {fix}, or wait for the new month.")

    def to_dict(self) -> Dict[str, Any]:
        return {"error": str(self), "code": "budget_exceeded", "scope": self.scope, "budget": self.status}


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


def _team_member_ids(team_id: str) -> list:
    from core.models import TeamMember

    return [m.user_id for m in TeamMember.query.filter_by(team_id=team_id).all()]


def current_month_team_spend_usd(team_id: str) -> float:
    """This month's spend by everyone on the team, plus anything logged
    against the team's projects (rows written before team_id fell back to the
    user's team have no team_id, so members are matched by user too)."""
    from sqlalchemy import or_
    from core.models import AIUsageLog

    conditions = [AIUsageLog.team_id == team_id]
    members = _team_member_ids(team_id)
    if members:
        conditions.append(AIUsageLog.user_id.in_(members))
    return _sum_spend(or_(*conditions))


def team_id_for_user(user_id: Optional[str]) -> Optional[str]:
    if not user_id:
        return None
    from core.models import TeamMember

    member = TeamMember.query.filter_by(user_id=user_id).first()
    return member.team_id if member else None


def applicable_team_ids(user_id: Optional[str], project_id: Optional[str]) -> list:
    """Teams whose budget covers this call: the user's own team and the
    project's team (usually the same one), in that order."""
    ids = [team_id_for_user(user_id)]
    if project_id:
        from core.models import Project

        project = Project.query.filter_by(project_id=project_id).first()
        ids.append(project.team_id if project else None)
    out: list = []
    for tid in ids:
        if tid and tid not in out:
            out.append(tid)
    return out


# ── Status ───────────────────────────────────────────────────────────────

def budget_state(spend: float, limit: Optional[float]) -> Dict[str, Any]:
    """Pure function: spend + limit -> the status dict the API/UI show."""
    spend = round(float(spend or 0.0), 6)
    if limit is None:
        return {"limitUsd": None, "spendUsd": spend, "remainingUsd": None, "percentUsed": None, "state": "none"}

    limit = float(limit)
    # A $0 budget means "spend nothing": it is used up from the start (so it
    # blocks, alerts and pauses Autopilot consistently) rather than only once
    # something has been spent.
    percent = (spend / limit * 100.0) if limit > 0 else 100.0
    if spend >= limit:
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


def _clean_enforcement(value: Optional[str]) -> str:
    return value if value in ENFORCEMENTS else "alert"


def validate_enforcement(value: Any) -> str:
    if value not in ENFORCEMENTS:
        raise ValueError('Enforcement must be "alert" or "block"')
    return value


def _with_enforcement(status: Dict[str, Any], enforcement: Optional[str]) -> Dict[str, Any]:
    """Add the alert/block setting, and whether that setting is blocking right
    now, to a budget_state() dict."""
    enforcement = _clean_enforcement(enforcement)
    limit, spend = status.get("limitUsd"), status.get("spendUsd") or 0.0
    status["enforcement"] = enforcement
    status["blocking"] = bool(enforcement == "block" and limit is not None and spend >= limit)
    return status


def get_user_budget(user_id: str) -> Optional[float]:
    from core.models import UserBudget

    row = UserBudget.query.filter_by(user_id=user_id).first()
    return row.monthly_budget_usd if row else None


def set_user_budget(user_id: str, monthly_budget_usd: Optional[float], enforcement: Optional[str] = None,
                    managed_by: Optional[str] = None) -> Optional[float]:
    """Set (or, with None, remove) a user's monthly budget. Resets the
    per-month alert markers so a new/raised budget can alert again.
    `enforcement` ("alert" | "block") is left as it was when None.
    `managed_by` is the team owner/admin setting it on the member's behalf,
    which locks it against the member changing it; pass None to leave the
    lock as it was (callers check the lock before letting a member edit)."""
    from core.database import db
    from core.models import UserBudget

    if monthly_budget_usd is not None and monthly_budget_usd < 0:
        raise ValueError("Budget must be zero or more")
    if enforcement is not None:
        validate_enforcement(enforcement)

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
    if enforcement is not None:
        row.enforcement = enforcement
    if managed_by is not None:
        row.managed_by = managed_by
    row.warn_month = None
    row.over_month = None
    db.session.commit()
    return row.monthly_budget_usd


def get_user_budget_lock(user_id: str) -> Optional[str]:
    """The team owner/admin who set this user's budget, if it is locked."""
    from core.models import UserBudget

    row = UserBudget.query.filter_by(user_id=user_id).first()
    return row.managed_by if row else None


def release_user_budget_lock(user_id: str) -> None:
    """Hand a member's budget back to them (e.g. they left the team)."""
    from core.database import db
    from core.models import UserBudget

    row = UserBudget.query.filter_by(user_id=user_id).first()
    if row and row.managed_by:
        row.managed_by = None
        db.session.commit()


def user_budget_status(user_id: str) -> Dict[str, Any]:
    from core.models import UserBudget

    row = UserBudget.query.filter_by(user_id=user_id).first()
    status = budget_state(current_month_user_spend_usd(user_id), row.monthly_budget_usd if row else None)
    status = _with_enforcement(status, row.enforcement if row else None)
    status["managedBy"] = row.managed_by if row else None
    return status


def project_budget_status(project_id: str) -> Dict[str, Any]:
    from core.models import Project

    project = Project.query.filter_by(project_id=project_id).first()
    limit = project.monthly_budget_usd if project else None
    status = budget_state(_current_month_spend_usd(project_id), limit)
    return _with_enforcement(status, project.budget_enforcement if project else None)


def team_budget_status(team_id: str) -> Dict[str, Any]:
    from core.models import Team

    team = Team.query.filter_by(team_id=team_id).first()
    limit = team.monthly_budget_usd if team else None
    status = budget_state(current_month_team_spend_usd(team_id) if limit is not None else 0.0, limit)
    return _with_enforcement(status, team.budget_enforcement if team else None)


def set_team_budget(team_id: str, monthly_budget_usd: Optional[float], enforcement: Optional[str] = None) -> Optional[float]:
    """Set (or, with None, remove) a team's monthly budget; same rules as
    set_user_budget."""
    from core.database import db
    from core.models import Team

    if monthly_budget_usd is not None and monthly_budget_usd < 0:
        raise ValueError("Budget must be zero or more")
    if enforcement is not None:
        validate_enforcement(enforcement)

    team = Team.query.filter_by(team_id=team_id).first()
    if not team:
        raise ValueError("Team not found")
    team.monthly_budget_usd = None if monthly_budget_usd is None else float(monthly_budget_usd)
    if monthly_budget_usd is None:
        team.budget_enforcement = None
    elif enforcement is not None:
        team.budget_enforcement = enforcement
    team.budget_warn_month = None
    team.budget_alert_month = None
    db.session.commit()
    return team.monthly_budget_usd


_RANK = {"none": 0, "ok": 1, "warning": 2, "over": 3}


def budget_overview(user_id: str, project_id: Optional[str] = None) -> Dict[str, Any]:
    """Every budget that applies to a user working (optionally) in a project,
    plus the worst state among them and any that are blocking right now -
    what a screen needs to decide whether to show a warning."""
    user = user_budget_status(user_id)
    project = project_budget_status(project_id) if project_id else None
    team = None
    for tid in applicable_team_ids(user_id, project_id):
        candidate = team_budget_status(tid)
        if team is None or (candidate["state"] != "none" and team["state"] == "none"):
            team = candidate
    statuses = {"user": user, "project": project, "team": team}
    worst = max((s["state"] for s in statuses.values() if s), key=lambda st: _RANK[st], default="none")
    return {
        "user": user,
        "project": project,
        "team": team,
        "worstState": worst,
        "blockedBy": [scope for scope, s in statuses.items() if s and s["blocking"]],
    }


def _applicable_budgets(user_id: Optional[str], project_id: Optional[str]):
    """(scope, scope_id, label, enforcement, limit, spend_fn) for every budget with a
    limit that covers this call. Cheap: reads only the budget rows; spend is
    computed lazily by the caller, and only for budgets it cares about."""
    from core.models import Project, Team, UserBudget

    budgets = []
    if project_id:
        project = Project.query.filter_by(project_id=project_id).first()
        if project and project.monthly_budget_usd is not None:
            budgets.append((
                "project", project_id, f'The project "{project.name}"', project.budget_enforcement,
                project.monthly_budget_usd, lambda pid=project_id: _current_month_spend_usd(pid),
            ))
    if user_id:
        row = UserBudget.query.filter_by(user_id=user_id).first()
        if row and row.monthly_budget_usd is not None:
            budgets.append((
                "user", user_id, "Your account", row.enforcement,
                row.monthly_budget_usd, lambda uid=user_id: current_month_user_spend_usd(uid),
            ))
    for tid in applicable_team_ids(user_id, project_id):
        team = Team.query.filter_by(team_id=tid).first()
        if team and team.monthly_budget_usd is not None:
            budgets.append((
                "team", tid, f'Your team "{team.name or "Team"}"', team.budget_enforcement,
                team.monthly_budget_usd, lambda t=tid: current_month_team_spend_usd(t),
            ))
    return budgets


def _remember_for_response(exc: "BudgetExceeded") -> None:
    """Note on the current request that a budget blocked something, so the
    after_request hook in app.py can answer 402 even when a route's own
    `except Exception` turned the error into a generic 500."""
    try:
        from flask import g, has_request_context

        if has_request_context():
            g.budget_exceeded = exc
    except Exception:
        pass


# ── Reservations ─────────────────────────────────────────────────────────
#
# Checking "is there room?" and then making the call are two steps, so N calls
# in flight at once could each see the same remaining balance and together
# overshoot a cap by up to N x their cost. reserve_budget() closes that: under
# a per-budget Postgres advisory lock it checks spend + what other in-flight
# calls have reserved + this call's estimate, and records its own reservation
# before the call starts. The reservation is deleted when the call finishes
# (its real cost is in the usage log by then). Only budgets set to "block" are
# ever locked or reserved against - alert-only usage pays nothing for this.

RESERVATION_TTL_SECONDS = 600  # safety net for a process that died mid-call


def _active_reserved_usd(scope: str, scope_id: str) -> float:
    from sqlalchemy import func
    from core.database import db
    from core.models import BudgetReservation

    total = (
        db.session.query(func.coalesce(func.sum(BudgetReservation.amount_usd), 0.0))
        .filter(
            BudgetReservation.scope == scope,
            BudgetReservation.scope_id == scope_id,
            BudgetReservation.expires_at > datetime.utcnow(),
        )
        .scalar()
    )
    return float(total or 0.0)


def _lock_budget(scope: str, scope_id: str) -> None:
    """Serialize check-and-reserve for one budget across every worker
    process. Held until the current transaction commits."""
    from sqlalchemy import text
    from core.database import db

    db.session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"budget:{scope}:{scope_id}"})


def release_reservations(reservation_ids) -> None:
    """Drop reservations made by reserve_budget. Never raises: it runs in a
    `finally` after a paid call, and a leftover row simply expires."""
    if not reservation_ids:
        return
    try:
        from core.database import db
        from core.models import BudgetReservation

        BudgetReservation.query.filter(BudgetReservation.reservation_id.in_(list(reservation_ids))).delete(
            synchronize_session=False)
        db.session.commit()
    except Exception as e:
        logger.warning(f"Could not release budget reservations (they will expire): {e}")
        try:
            from core.database import db
            db.session.rollback()
        except Exception:
            pass


def _check_budgets(user_id: Optional[str], project_id: Optional[str], estimated_cost_usd: float, reserve: bool) -> list:
    """Shared by enforce_budget (check only) and reserve_budget (check, then
    reserve). Returns the reservation ids made. Fails open on any error other
    than BudgetExceeded."""
    if not user_id:
        return []
    made: list = []
    try:
        import uuid
        from datetime import timedelta
        from core.database import db
        from core.models import BudgetReservation

        estimate = max(float(estimated_cost_usd or 0.0), 0.0)
        for scope, scope_id, label, enforcement, limit, spend_fn in _applicable_budgets(user_id, project_id):
            if _clean_enforcement(enforcement) != "block":
                continue
            locked = reserve and estimate > 0
            if locked:
                _lock_budget(scope, scope_id)
            spend = spend_fn()
            reserved = _active_reserved_usd(scope, scope_id)
            if spend + reserved >= float(limit) or (estimate > 0 and spend + reserved + estimate > float(limit)):
                if locked:
                    db.session.commit()  # end the transaction: releases the advisory lock
                status = _with_enforcement(budget_state(spend, limit), enforcement)
                exc = BudgetExceeded(scope, label, status, estimate, reserved)
                _remember_for_response(exc)
                raise exc
            if locked:
                reservation_id = str(uuid.uuid4())
                BudgetReservation.query.filter(BudgetReservation.expires_at < datetime.utcnow()).delete(
                    synchronize_session=False)  # leftovers of processes that died mid-call
                db.session.add(BudgetReservation(
                    reservation_id=reservation_id, scope=scope, scope_id=scope_id, amount_usd=estimate,
                    expires_at=datetime.utcnow() + timedelta(seconds=RESERVATION_TTL_SECONDS),
                ))
                db.session.commit()  # visible to the next caller; releases the lock
                made.append(reservation_id)
        return made
    except BudgetExceeded:
        release_reservations(made)
        raise
    except Exception as e:
        logger.warning(f"Budget enforcement check failed - allowing the call: {e}")
        try:
            from core.database import db
            db.session.rollback()
        except Exception:
            pass
        release_reservations(made)
        return []


def enforce_budget(user_id: Optional[str], project_id: Optional[str] = None, estimated_cost_usd: float = 0.0) -> None:
    """Raise BudgetExceeded if a budget set to "block" that covers this call
    is used up - or, when the caller can estimate what this request will cost,
    would be exceeded by it - counting what other in-flight calls have already
    reserved. Check only: nothing is reserved, so it is for paths that can't
    bracket the call (LangChain, side doors). A no-op (no spend query at all)
    unless a covering budget is set to block, and it fails open: only
    BudgetExceeded ever escapes."""
    _check_budgets(user_id, project_id, estimated_cost_usd, reserve=False)


def reserve_budget(user_id: Optional[str], project_id: Optional[str], estimated_cost_usd: float) -> list:
    """enforce_budget, plus: set the estimated cost aside for the duration of
    the call so concurrent calls see it. Returns reservation ids to hand to
    release_reservations() in a `finally` once the call is done. Raises
    BudgetExceeded exactly like enforce_budget."""
    return _check_budgets(user_id, project_id, estimated_cost_usd, reserve=True)


def is_over_budget(user_id: Optional[str], project_id: Optional[str]) -> bool:
    """True if the project's, the user's OR their team's monthly budget is used
    up (whether or not it is set to block)."""
    if project_id and project_budget_status(project_id)["state"] == "over":
        return True
    if user_id and user_budget_status(user_id)["state"] == "over":
        return True
    return any(team_budget_status(t)["state"] == "over" for t in applicable_team_ids(user_id, project_id))


# ── Alerts ───────────────────────────────────────────────────────────────

def _send_alert(recipient: str, subject: str, body: str) -> None:
    try:
        from core.email_sender import send_platform_email

        sent, error = send_platform_email(recipient, recipient, subject, body)
        if not sent:
            logger.warning(f"Budget alert email to {recipient} failed: {error}")
    except Exception as e:
        logger.warning(f"Budget alert email to {recipient} failed: {e}")


def _send_alerts(recipients, subject: str, body: str) -> None:
    for recipient in dict.fromkeys(r for r in recipients if r):
        _send_alert(recipient, subject, body)


def _alert_for(label: str, recipient: str, status: Dict[str, Any], month: str, warned: Optional[str], over: Optional[str],
               enforcement: Optional[str] = None, cc: Optional[str] = None):
    """Decide which alert (if any) a budget is due, send it, and return the
    updated (warn_month, over_month). A budget that jumps straight past its
    limit gets only the "over" email, and counts as warned too."""
    state = status["state"]
    blocking = _clean_enforcement(enforcement) == "block"
    if state == "over" and over != month:
        consequence = (
            'This budget is set to block, so new AI requests are now refused until it is raised or the month rolls over. '
            if blocking else
            'AI actions are not blocked, but Autopilot workflows will now pause for your review. '
        )
        _send_alerts(
            [recipient, cc],
            f'{label} has crossed its AI budget for {month}',
            f'{label} has spent an estimated ${status["spendUsd"]:.2f} on AI usage this month, '
            f'crossing the ${status["limitUsd"]:.2f} budget.\n\n'
            f'{consequence}'
            'See the full breakdown by agent, project and workflow in the Usage dashboard.',
        )
        return month, month
    if state == "warning" and warned != month:
        consequence = (
            'This budget is set to block: new AI requests will be refused once it is used up.'
            if blocking else
            'This is a heads-up - nothing is blocked.'
        )
        _send_alerts(
            [recipient, cc],
            f'{label} has used {status["percentUsed"]:.0f}% of its AI budget for {month}',
            f'{label} has spent an estimated ${status["spendUsd"]:.2f} of its ${status["limitUsd"]:.2f} '
            f'monthly AI budget. {consequence} '
            'See the Usage dashboard for what is driving it.',
        )
        return month, over
    return warned, over


def check_and_maybe_alert_budget(project_id: Optional[str] = None, user_id: Optional[str] = None) -> None:
    """Called after every usage log write. A cheap no-op unless the project,
    the user or their team has a budget; each budget sends at most one "80%
    used" and one "over budget" email per calendar month. Never raises - a
    budget check must not break the AI call that triggered it."""
    try:
        from core.database import db
        from core.models import Project, Team, UserBudget

        month = _month_key()

        if project_id:
            project = Project.query.filter_by(project_id=project_id).first()
            if project and project.monthly_budget_usd is not None:
                status = budget_state(_current_month_spend_usd(project_id), project.monthly_budget_usd)
                warned, over = _alert_for(
                    f'"{project.name}"', project.owner_id, status, month,
                    project.budget_warn_month, project.budget_alert_month, project.budget_enforcement,
                )
                if (warned, over) != (project.budget_warn_month, project.budget_alert_month):
                    project.budget_warn_month, project.budget_alert_month = warned, over
                    db.session.commit()

        if user_id:
            row = UserBudget.query.filter_by(user_id=user_id).first()
            if row and row.monthly_budget_usd is not None:
                status = budget_state(current_month_user_spend_usd(user_id), row.monthly_budget_usd)
                warned, over = _alert_for(
                    "Your account", user_id, status, month, row.warn_month, row.over_month, row.enforcement,
                    cc=row.managed_by,
                )
                if (warned, over) != (row.warn_month, row.over_month):
                    row.warn_month, row.over_month = warned, over
                    db.session.commit()

        for team_id in applicable_team_ids(user_id, project_id):
            team = Team.query.filter_by(team_id=team_id).first()
            if team and team.monthly_budget_usd is not None:
                status = budget_state(current_month_team_spend_usd(team_id), team.monthly_budget_usd)
                warned, over = _alert_for(
                    f'Team "{team.name or "Team"}"', team.owner_id, status, month,
                    team.budget_warn_month, team.budget_alert_month, team.budget_enforcement,
                )
                if (warned, over) != (team.budget_warn_month, team.budget_alert_month):
                    team.budget_warn_month, team.budget_alert_month = warned, over
                    db.session.commit()
    except Exception as e:
        logger.warning(f"Budget check failed (ignored): {e}")
        try:
            from core.database import db
            db.session.rollback()
        except Exception:
            pass
