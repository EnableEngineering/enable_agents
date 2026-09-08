"""
Team Management API Routes.

Handles team CRUD, member management, and invitations.
Uses SQLAlchemy models for persistence.
"""

from flask import Blueprint, request, jsonify, g

from core.auth import require_auth
from datetime import datetime
import uuid

from core.database import db
from core.models import Team, TeamMember, PendingInvite
from core.email_sender import send_platform_email

team_bp = Blueprint('team', __name__)


def _display_name_for_email(user_email: str) -> str:
    """Registered user's full name if available, else the email's local part."""
    from app import User
    user = User.query.filter_by(email=user_email).first()
    if user:
        full = f"{(user.first_name or '').strip()} {(user.last_name or '').strip()}".strip()
        if full:
            return full
    return user_email.split('@')[0]


def get_or_create_team(user_email: str) -> Team:
    """Get existing team or create new one with user as owner."""
    member = TeamMember.query.filter_by(user_id=user_email).first()
    if member:
        return member.team

    team_id = str(uuid.uuid4())
    team = Team(
        team_id=team_id,
        owner_id=user_email,
        name=f"{user_email.split('@')[0]}'s Team"
    )
    db.session.add(team)

    member = TeamMember(
        member_id=str(uuid.uuid4()),
        team_id=team_id,
        user_id=user_email,
        name=_display_name_for_email(user_email),
        role='owner'
    )
    db.session.add(member)
    db.session.commit()
    return team


@team_bp.route('/api/team', methods=['GET'])
@require_auth
def get_team():
    """Get current user's team."""
    user_email = g.user_id

    team = get_or_create_team(user_email)
    pending = PendingInvite.query.filter_by(team_id=team.team_id).all()

    return jsonify({
        'team_id': team.team_id,
        'members': [m.to_dict() for m in team.members],
        'pending_invites': [i.to_dict() for i in pending],
    })


@team_bp.route('/api/team/invite', methods=['POST'])
@require_auth
def invite_member():
    """Invite a new member to the team."""
    user_email = g.user_id

    data = request.get_json()
    invite_email = data.get('email', '').lower().strip()
    role = data.get('role', 'member')

    if not invite_email:
        return jsonify({'error': 'Email is required'}), 400
    if role not in ['admin', 'member', 'viewer']:
        return jsonify({'error': 'Invalid role'}), 400

    team = get_or_create_team(user_email)

    # Check permission
    current = TeamMember.query.filter_by(team_id=team.team_id, user_id=user_email).first()
    if not current or current.role not in ['owner', 'admin']:
        return jsonify({'error': 'Not authorized to invite members'}), 403

    # Check if already member
    if TeamMember.query.filter_by(team_id=team.team_id, user_id=invite_email).first():
        return jsonify({'error': 'Already a team member'}), 400

    # Auto-accept for now (no invite-acceptance flow yet), but still send a
    # real notification email - member creation and email delivery are
    # reported separately so the caller never sees a false "sent" status.
    new_member = TeamMember(
        member_id=str(uuid.uuid4()),
        team_id=team.team_id,
        user_id=invite_email,
        name=_display_name_for_email(invite_email),
        role=role
    )
    db.session.add(new_member)
    db.session.commit()

    inviter_name = user_email.split('@')[0]
    subject = f"{inviter_name} added you to their team on Enable Agents"
    body = (
        f"Hi,\n\n"
        f"{inviter_name} ({user_email}) has added you as a {role} on their "
        f"team \"{team.name}\" on Enable Agents.\n\n"
        f"Sign in at https://agents.enableyou.co with this email address "
        f"({invite_email}) to get started.\n\n"
        f"Best regards,\nEnable Agents"
    )
    email_sent, email_error = send_platform_email(user_email, invite_email, subject, body)

    return jsonify({
        'message': 'Member added' + ('' if email_sent else ' (invite email could not be sent)'),
        'member': new_member.to_dict(),
        'emailSent': email_sent,
        'emailError': email_error,
    })


@team_bp.route('/api/team/members/<member_id>', methods=['DELETE'])
@require_auth
def remove_member(member_id):
    """Remove a member from the team."""
    user_email = g.user_id

    member = TeamMember.query.filter_by(user_id=user_email).first()
    if not member:
        return jsonify({'error': 'Team not found'}), 404

    team = member.team
    current = TeamMember.query.filter_by(team_id=team.team_id, user_id=user_email).first()
    if not current or current.role not in ['owner', 'admin']:
        return jsonify({'error': 'Not authorized'}), 403

    to_remove = TeamMember.query.filter_by(member_id=member_id, team_id=team.team_id).first()
    if not to_remove:
        return jsonify({'error': 'Member not found'}), 404
    if to_remove.role == 'owner':
        return jsonify({'error': 'Cannot remove owner'}), 400
    if to_remove.user_id == user_email:
        return jsonify({'error': 'Cannot remove yourself'}), 400

    db.session.delete(to_remove)
    db.session.commit()
    return jsonify({'message': 'Member removed'})


@team_bp.route('/api/team/members/<member_id>/role', methods=['PUT'])
@require_auth
def update_member_role(member_id):
    """Update a member's role (owner only)."""
    user_email = g.user_id

    data = request.get_json()
    new_role = data.get('role')
    if new_role not in ['admin', 'member', 'viewer']:
        return jsonify({'error': 'Invalid role'}), 400

    member = TeamMember.query.filter_by(user_id=user_email).first()
    if not member:
        return jsonify({'error': 'Team not found'}), 404

    team = member.team
    current = TeamMember.query.filter_by(team_id=team.team_id, user_id=user_email).first()
    if not current or current.role != 'owner':
        return jsonify({'error': 'Only owner can change roles'}), 403

    target = TeamMember.query.filter_by(member_id=member_id, team_id=team.team_id).first()
    if not target:
        return jsonify({'error': 'Member not found'}), 404
    if target.role == 'owner':
        return jsonify({'error': 'Cannot change owner role'}), 400

    target.role = new_role
    db.session.commit()
    return jsonify({'message': 'Role updated', 'member': target.to_dict()})
