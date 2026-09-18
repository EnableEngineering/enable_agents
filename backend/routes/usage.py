"""
AI Usage & Cost Rollup API - individual, project, and team level views over
core/models.py's AIUsageLog, which core/ai_client.py writes to on every LLM
call (see that module for the token/cost estimation and key-resolution
logic this data is a byproduct of).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func

from core.auth import require_auth, user_can_access_project
from core.database import db
from core.models import AIUsageLog, TeamMember

usage_bp = Blueprint('usage', __name__)


def _since(days: int) -> datetime:
    return datetime.utcnow() - timedelta(days=max(1, min(days, 365)))


def _summarize(base_query, group_by_user: bool = False, group_by_project: bool = False,
               group_by_workflow: bool = False) -> dict:
    """Aggregates an AIUsageLog query into totals + breakdowns by agent,
    model, day, and (optionally) user - all via SQL GROUP BY rather than
    pulling every row into Python."""
    totals = base_query.with_entities(
        func.coalesce(func.sum(AIUsageLog.prompt_tokens), 0),
        func.coalesce(func.sum(AIUsageLog.completion_tokens), 0),
        func.coalesce(func.sum(AIUsageLog.estimated_cost_usd), 0.0),
        func.count(AIUsageLog.id),
    ).first()
    prompt_tokens, completion_tokens, total_cost, request_count = totals

    by_agent = base_query.with_entities(
        AIUsageLog.agent,
        func.sum(AIUsageLog.total_tokens),
        func.sum(AIUsageLog.estimated_cost_usd),
        func.count(AIUsageLog.id),
    ).group_by(AIUsageLog.agent).order_by(func.sum(AIUsageLog.estimated_cost_usd).desc()).all()

    by_model = base_query.with_entities(
        AIUsageLog.model,
        func.sum(AIUsageLog.total_tokens),
        func.sum(AIUsageLog.estimated_cost_usd),
        func.count(AIUsageLog.id),
    ).group_by(AIUsageLog.model).order_by(func.sum(AIUsageLog.estimated_cost_usd).desc()).all()

    by_day = base_query.with_entities(
        func.date(AIUsageLog.created_at),
        func.sum(AIUsageLog.total_tokens),
        func.sum(AIUsageLog.estimated_cost_usd),
    ).group_by(func.date(AIUsageLog.created_at)).order_by(func.date(AIUsageLog.created_at)).all()

    result = {
        'totalTokens': int(prompt_tokens + completion_tokens),
        'promptTokens': int(prompt_tokens),
        'completionTokens': int(completion_tokens),
        'totalCostUsd': round(float(total_cost), 6),
        'requestCount': int(request_count),
        'byAgent': [
            {'agent': agent, 'tokens': int(tokens), 'costUsd': round(float(cost), 6), 'requestCount': int(count)}
            for agent, tokens, cost, count in by_agent
        ],
        'byModel': [
            {'model': model, 'tokens': int(tokens), 'costUsd': round(float(cost), 6), 'requestCount': int(count)}
            for model, tokens, cost, count in by_model
        ],
        'byDay': [
            {'date': str(day), 'tokens': int(tokens), 'costUsd': round(float(cost), 6)}
            for day, tokens, cost in by_day
        ],
    }

    if group_by_user:
        by_user = base_query.with_entities(
            AIUsageLog.user_id,
            func.sum(AIUsageLog.total_tokens),
            func.sum(AIUsageLog.estimated_cost_usd),
            func.count(AIUsageLog.id),
        ).group_by(AIUsageLog.user_id).order_by(func.sum(AIUsageLog.estimated_cost_usd).desc()).all()
        result['byUser'] = [
            {'userId': user_id, 'tokens': int(tokens), 'costUsd': round(float(cost), 6), 'requestCount': int(count)}
            for user_id, tokens, cost, count in by_user
        ]

    if group_by_project:
        from core.models import Project

        rows = base_query.filter(AIUsageLog.project_id.isnot(None)).with_entities(
            AIUsageLog.project_id,
            func.sum(AIUsageLog.total_tokens),
            func.sum(AIUsageLog.estimated_cost_usd),
            func.count(AIUsageLog.id),
        ).group_by(AIUsageLog.project_id).order_by(func.sum(AIUsageLog.estimated_cost_usd).desc()).all()
        names = {p.project_id: p.name for p in Project.query.filter(
            Project.project_id.in_([r[0] for r in rows])).all()} if rows else {}
        result['byProject'] = [
            {'projectId': pid, 'name': names.get(pid, pid), 'tokens': int(tokens or 0),
             'costUsd': round(float(cost), 6), 'requestCount': int(count)}
            for pid, tokens, cost, count in rows
        ]
        # Spend logged with no project at all still counts toward the user's
        # total - show it as its own line so the table adds up.
        unassigned = base_query.filter(AIUsageLog.project_id.is_(None)).with_entities(
            func.coalesce(func.sum(AIUsageLog.estimated_cost_usd), 0.0), func.count(AIUsageLog.id)).first()
        if unassigned and unassigned[1]:
            result['byProject'].append({'projectId': None, 'name': 'No project', 'tokens': 0,
                                        'costUsd': round(float(unassigned[0]), 6), 'requestCount': int(unassigned[1])})

    if group_by_workflow:
        from models.workflow import WorkflowInstance

        rows = base_query.filter(AIUsageLog.workflow_instance_id.isnot(None)).with_entities(
            AIUsageLog.workflow_instance_id,
            func.sum(AIUsageLog.total_tokens),
            func.sum(AIUsageLog.estimated_cost_usd),
            func.count(AIUsageLog.id),
        ).group_by(AIUsageLog.workflow_instance_id).order_by(func.sum(AIUsageLog.estimated_cost_usd).desc()).limit(25).all()
        names = {i.instance_id: i.name for i in WorkflowInstance.query.filter(
            WorkflowInstance.instance_id.in_([r[0] for r in rows])).all()} if rows else {}
        result['byWorkflow'] = [
            {'instanceId': iid, 'name': names.get(iid, 'Deleted workflow'), 'tokens': int(tokens or 0),
             'costUsd': round(float(cost), 6), 'requestCount': int(count)}
            for iid, tokens, cost, count in rows
        ]

    return result


@usage_bp.route('/api/usage/me', methods=['GET'])
@require_auth
def get_my_usage():
    """Current user's own AI usage/cost, across every project and agent."""
    days = request.args.get('days', default=30, type=int)
    query = AIUsageLog.query.filter(
        AIUsageLog.user_id == g.user_id,
        AIUsageLog.created_at >= _since(days),
    )
    from core.budget import user_budget_status

    return jsonify({
        'success': True,
        'days': days,
        'usage': _summarize(query, group_by_project=True, group_by_workflow=True),
        'budget': user_budget_status(g.user_id),
    })


@usage_bp.route('/api/projects/<project_id>/usage', methods=['GET'])
@require_auth
def get_project_usage(project_id):
    """AI usage/cost for a project - visible to any project member, same
    visibility rule as the project's AI key settings (members should be
    able to see what their work is costing even if they can't change the
    key)."""
    if not user_can_access_project(g.user_id, project_id):
        return jsonify({'error': 'Project not found'}), 404

    days = request.args.get('days', default=30, type=int)
    query = AIUsageLog.query.filter(
        AIUsageLog.project_id == project_id,
        AIUsageLog.created_at >= _since(days),
    )

    from core.budget import _current_month_spend_usd, project_budget_status
    from core.models import Project
    project = Project.query.filter_by(project_id=project_id).first()

    return jsonify({
        'success': True,
        'days': days,
        'usage': _summarize(query, group_by_user=True, group_by_workflow=True),
        'monthlyBudgetUsd': project.monthly_budget_usd if project else None,
        'currentMonthSpendUsd': round(_current_month_spend_usd(project_id), 6) if project else None,
        'budget': project_budget_status(project_id),
    })


@usage_bp.route('/api/team/usage', methods=['GET'])
@require_auth
def get_team_usage():
    """AI usage/cost across the current user's team. Owner/admin only -
    this rolls up every member's spend, which is billing-sensitive in a
    way individual/project views aren't."""
    member = TeamMember.query.filter_by(user_id=g.user_id).first()
    if not member:
        return jsonify({'error': 'No team found for this user'}), 404
    if member.role not in ('owner', 'admin'):
        return jsonify({'error': 'Only the team owner or an admin can view team-wide usage'}), 403

    days = request.args.get('days', default=30, type=int)
    query = AIUsageLog.query.filter(
        AIUsageLog.team_id == member.team_id,
        AIUsageLog.created_at >= _since(days),
    )
    from core.budget import team_budget_status
    return jsonify({
        'success': True,
        'days': days,
        'usage': _summarize(query, group_by_user=True),
        'budget': team_budget_status(member.team_id),
    })


@usage_bp.route('/api/usage/budget-status', methods=['GET'])
@require_auth
def get_budget_status():
    """Where the current user (and, with ?project_id=, that project) stands
    against their monthly budgets: spend, limit, percent used and a state of
    none | ok | warning | over. Cheap enough for screens to poll."""
    from core.budget import budget_overview

    project_id = request.args.get('project_id') or None
    if project_id and not user_can_access_project(g.user_id, project_id):
        return jsonify({'error': 'Project not found'}), 404
    return jsonify({'success': True, **budget_overview(g.user_id, project_id)})


@usage_bp.route('/api/usage/me/budget', methods=['GET', 'PUT'])
@require_auth
def my_budget():
    """The current user's own monthly AI budget (across every project).
    PUT { monthlyBudgetUsd?: number | null, enforcement?: "alert" | "block" }
    sets either or both; a null budget removes it. "block" makes AI requests
    fail once the budget is used up (core/budget.py)."""
    from core.budget import get_user_budget, set_user_budget, user_budget_status, validate_enforcement

    if request.method == 'PUT':
        data = request.get_json(silent=True) or {}
        try:
            enforcement = validate_enforcement(data['enforcement']) if 'enforcement' in data else None
            if 'monthlyBudgetUsd' in data:
                raw = data.get('monthlyBudgetUsd')
                set_user_budget(g.user_id, float(raw) if raw not in (None, '') else None, enforcement)
            elif enforcement is not None:
                if get_user_budget(g.user_id) is None:
                    return jsonify({'error': 'Set a monthly budget before choosing what happens when it runs out'}), 400
                set_user_budget(g.user_id, get_user_budget(g.user_id), enforcement)
        except (TypeError, ValueError) as e:
            return jsonify({'error': str(e) if 'nforcement' in str(e) else
                            'monthlyBudgetUsd must be a number of zero or more, or null'}), 400

    return jsonify({
        'success': True,
        'monthlyBudgetUsd': get_user_budget(g.user_id),
        'budget': user_budget_status(g.user_id),
    })


@usage_bp.route('/api/team/budget', methods=['GET', 'PUT'])
@require_auth
def team_budget():
    """The current user's team-wide monthly AI budget (every member, every
    project). Any member can read it - it can block their requests, so they
    should be able to see why - but only the owner or an admin can change it.
    PUT { monthlyBudgetUsd?: number | null, enforcement?: "alert" | "block" }."""
    from core.budget import set_team_budget, team_budget_status, validate_enforcement
    from core.models import Team

    member = TeamMember.query.filter_by(user_id=g.user_id).first()
    if not member:
        return jsonify({'error': 'No team found for this user'}), 404
    team = Team.query.filter_by(team_id=member.team_id).first()

    if request.method == 'PUT':
        if member.role not in ('owner', 'admin'):
            return jsonify({'error': 'Only the team owner or an admin can change the team budget'}), 403
        data = request.get_json(silent=True) or {}
        try:
            enforcement = validate_enforcement(data['enforcement']) if 'enforcement' in data else None
            if 'monthlyBudgetUsd' in data:
                raw = data.get('monthlyBudgetUsd')
                set_team_budget(team.team_id, float(raw) if raw not in (None, '') else None, enforcement)
            elif enforcement is not None:
                if team.monthly_budget_usd is None:
                    return jsonify({'error': 'Set a monthly budget before choosing what happens when it runs out'}), 400
                set_team_budget(team.team_id, team.monthly_budget_usd, enforcement)
        except (TypeError, ValueError) as e:
            return jsonify({'error': str(e) if 'nforcement' in str(e) else
                            'monthlyBudgetUsd must be a number of zero or more, or null'}), 400
        team = Team.query.filter_by(team_id=member.team_id).first()

    return jsonify({
        'success': True,
        'monthlyBudgetUsd': team.monthly_budget_usd,
        'canEdit': member.role in ('owner', 'admin'),
        'budget': team_budget_status(team.team_id),
    })
