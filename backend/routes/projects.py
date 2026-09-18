"""
Projects API Routes - Platform-wide project management.

Projects are shared workspaces that can be accessed by multiple agents and team members.
Uses SQLAlchemy models for persistence.
"""

from flask import Blueprint, request, jsonify, g
from datetime import datetime
import uuid

from core.auth import require_auth, user_can_access_project, user_can_manage_project_settings
from core.database import db
from core.models import Project, Team, TeamMember
from core.project_settings import ProjectSettings, PROJECT_SETTING_KEYS

projects_bp = Blueprint('projects', __name__)


def get_user_team(user_email: str) -> Team:
    """Get user's team, creating one if needed."""
    member = TeamMember.query.filter_by(user_id=user_email).first()
    if member:
        return member.team

    # Delegates to routes.team so a fresh team/owner-member is created with
    # the same logic (and the same real-name lookup) regardless of whether
    # /api/projects or /api/team is the first endpoint to touch this user.
    from routes.team import get_or_create_team
    return get_or_create_team(user_email)


def get_user_projects(user_email: str):
    """Get all projects for a user (via their team)."""
    team = get_user_team(user_email)
    return Project.query.filter_by(team_id=team.team_id).all()


@projects_bp.route('/api/projects', methods=['GET'])
@require_auth
def list_projects():
    """List all projects for the current user."""
    user_email = g.user_id
    projects = get_user_projects(user_email)
    return jsonify({'success': True, 'projects': [p.to_dict() for p in projects]})


@projects_bp.route('/api/projects', methods=['POST'])
@require_auth
def create_project():
    """Create a new project."""
    user_email = g.user_id
    data = request.get_json()
    name = data.get('name', '').strip()
    description = data.get('description', '').strip()
    # Default to all agents if none specified
    agents = data.get('agents') or [
        'marketResearch', 'salesHelper', 'contentMarketing',
        'communityNetwork', 'eventNetworking', 'executiveAssistant', 'dataInsights'
    ]
    # Optional - industry/role/product-service, used by the AI Assistant to
    # suggest relevant agents when the user later configures a workflow for
    # this project. Not required to create a project.
    business_context = data.get('business_context') or {}

    if not name:
        return jsonify({'error': 'Project name is required'}), 400

    team = get_user_team(user_email)
    project = Project(
        project_id=str(uuid.uuid4()),
        team_id=team.team_id,
        owner_id=user_email,
        name=name,
        description=description,
    )
    project.agents = agents
    project.data = {'business_context': business_context} if business_context else {}

    db.session.add(project)
    db.session.commit()
    return jsonify({'success': True, 'project': project.to_dict()})


@projects_bp.route('/api/projects/<project_id>', methods=['GET'])
@require_auth
def get_project(project_id):
    """Get a specific project by ID."""
    if not user_can_access_project(g.user_id, project_id):
        return jsonify({'error': 'Project not found'}), 404

    project = Project.query.filter_by(project_id=project_id).first()
    return jsonify({'success': True, 'project': project.to_dict()})


@projects_bp.route('/api/projects/<project_id>', methods=['PUT'])
@require_auth
def update_project(project_id):
    """Update a project."""
    if not user_can_access_project(g.user_id, project_id):
        return jsonify({'error': 'Project not found'}), 404

    project = Project.query.filter_by(project_id=project_id).first()

    data = request.get_json()
    if 'name' in data:
        project.name = data['name'].strip()
    if 'description' in data:
        project.description = data['description'].strip()
    if 'agents' in data:
        project.agents = data['agents']
    if 'status' in data and data['status'] in ['active', 'archived', 'completed']:
        project.status = data['status']
    if 'data' in data:
        current = project.data
        current.update(data['data'])
        project.data = current
    if 'monthlyBudgetUsd' in data:
        if not user_can_manage_project_settings(g.user_id, project_id):
            return jsonify({'error': 'Only the project owner or a team admin can change the budget'}), 403
        value = data['monthlyBudgetUsd']
        try:
            budget = float(value) if value not in (None, '') else None
        except (TypeError, ValueError):
            return jsonify({'error': 'monthlyBudgetUsd must be a number'}), 400
        if budget is not None and budget < 0:
            return jsonify({'error': 'monthlyBudgetUsd must be zero or more'}), 400
        project.monthly_budget_usd = budget
        project.budget_alert_month = None  # reset so a new/raised budget can alert again if crossed
        project.budget_warn_month = None

    project.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'success': True, 'project': project.to_dict()})


@projects_bp.route('/api/projects/<project_id>', methods=['DELETE'])
@require_auth
def delete_project(project_id):
    """Delete a project (owner only)."""
    project = Project.query.filter_by(project_id=project_id).first()
    if not project or not user_can_access_project(g.user_id, project_id):
        return jsonify({'error': 'Project not found'}), 404
    if project.owner_id != g.user_id:
        return jsonify({'error': 'Only project owner can delete'}), 403

    db.session.delete(project)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Project deleted'})


@projects_bp.route('/api/projects/<project_id>/data', methods=['PUT'])
@require_auth
def update_project_data(project_id):
    """Update agent-specific data within a project."""
    if not user_can_access_project(g.user_id, project_id):
        return jsonify({'error': 'Project not found'}), 404

    data = request.get_json()
    agent_key = data.get('agent')
    agent_data = data.get('data', {})

    if not agent_key:
        return jsonify({'error': 'Agent key is required'}), 400

    project = Project.query.filter_by(project_id=project_id).first()
    if agent_key not in project.agents:
        return jsonify({'error': f'Agent {agent_key} not enabled for this project'}), 403

    project.set_agent_data(agent_key, agent_data)
    project.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'success': True, 'project': project.to_dict()})


@projects_bp.route('/api/projects/<project_id>/settings', methods=['GET'])
@require_auth
def get_project_settings(project_id):
    """
    Get this project's AI provider settings. Visible to anyone with
    project access (so members know which key their work is billed to),
    but see PUT below for who can change it.
    """
    if not user_can_access_project(g.user_id, project_id):
        return jsonify({'error': 'Project not found'}), 404

    settings = ProjectSettings().list(project_id, include_values=True)
    return jsonify({
        'success': True,
        'settings': settings,
        'canManage': user_can_manage_project_settings(g.user_id, project_id),
    })


@projects_bp.route('/api/projects/<project_id>/settings', methods=['PUT'])
@require_auth
def update_project_settings(project_id):
    """Set a project-level AI provider key. Owner/admin only - this key
    takes priority over every member's personal key for AI actions taken
    inside this project (see core/ai_client.py)."""
    if not user_can_access_project(g.user_id, project_id):
        return jsonify({'error': 'Project not found'}), 404
    if not user_can_manage_project_settings(g.user_id, project_id):
        return jsonify({'error': 'Only the project owner or a team admin can change project settings'}), 403

    data = request.get_json() or {}
    key = data.get('key')
    value = data.get('value')
    if key not in PROJECT_SETTING_KEYS:
        return jsonify({'error': f'Unsupported setting key: {key}'}), 400
    if not value:
        return jsonify({'error': 'value is required'}), 400

    ProjectSettings().set(project_id, key, value)
    return jsonify({'success': True, 'message': f'Project setting {key} saved'})


@projects_bp.route('/api/projects/<project_id>/settings/<key>', methods=['DELETE'])
@require_auth
def delete_project_setting(project_id, key):
    """Remove a project-level AI provider key. Owner/admin only - after
    this, AI actions in the project fall back to each member's personal
    key (or the platform default)."""
    if not user_can_access_project(g.user_id, project_id):
        return jsonify({'error': 'Project not found'}), 404
    if not user_can_manage_project_settings(g.user_id, project_id):
        return jsonify({'error': 'Only the project owner or a team admin can change project settings'}), 403

    deleted = ProjectSettings().delete(project_id, key)
    if not deleted:
        return jsonify({'error': 'Setting not found'}), 404
    return jsonify({'success': True, 'message': f'Project setting {key} deleted'})


@projects_bp.route('/api/projects/<project_id>/settings/test', methods=['POST'])
@require_auth
def test_project_setting(project_id):
    """Test a key before saving it - owner/admin only, same as changing
    it. Tests the value passed in the request, not whatever (if anything)
    is already saved, so this works before the first Save too."""
    if not user_can_access_project(g.user_id, project_id):
        return jsonify({'error': 'Project not found'}), 404
    if not user_can_manage_project_settings(g.user_id, project_id):
        return jsonify({'error': 'Only the project owner or a team admin can test project settings'}), 403

    data = request.get_json() or {}
    key = data.get('key')
    value = data.get('value')
    if not value:
        return jsonify({'error': 'value is required'}), 400

    from core.key_testing import test_openai_key, test_anthropic_key
    if key == 'openai_key':
        success, message = test_openai_key(value)
    elif key == 'anthropic_key':
        success, message = test_anthropic_key(value)
    else:
        return jsonify({'error': f'Testing not supported for key: {key}'}), 400

    return jsonify({'success': success, 'message': message}), 200 if success else 400
