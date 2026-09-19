"""
Core SQLAlchemy models.

Only models that are unique to the agent registry / context system live here.
The primary application models (User, GoogleOAuthToken, EmailCampaign, etc.)
are defined in app.py alongside the routes that own them, using the same db
instance created there.

Platform-wide models (Team, Project) also live here as they are shared
across all agents and the core system.
"""
from datetime import datetime
import json
from typing import Dict, Any, List
from core.database import db


class AgentContext(db.Model):
    """
    Persistent cross-agent context store (the "context lake").

    Each row is one key-value pair scoped to a user (and optionally a session).
    The agent_id column records which agent wrote the value so the registry can
    enforce manifest-declared 'provides' / 'consumes' contracts.

    Use ContextStore (core/context.py) to read and write — do not query this
    table directly from agent code.
    """
    __tablename__ = "agent_context"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.String(255), nullable=False, index=True)
    session_id = db.Column(db.String(36), index=True)
    agent_id = db.Column(db.String(100), nullable=False)
    key = db.Column(db.String(255), nullable=False)
    value = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("user_id", "agent_id", "key", name="uq_agent_context"),
        db.Index("ix_agent_context_user_key", "user_id", "key"),
    )


class UserSettingModel(db.Model):
    """
    Encrypted per-user settings storage.

    Stores API keys, OAuth tokens, connector configurations, etc.
    All sensitive values are encrypted at rest.

    Use UserSettings (core/settings.py) to read/write — provides
    encryption/decryption automatically.
    """
    __tablename__ = "user_settings"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.String(255), nullable=False, index=True)
    category = db.Column(db.String(50), nullable=False)  # ai, connectors, scraping, oauth
    key = db.Column(db.String(100), nullable=False)
    value_encrypted = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("user_id", "category", "key", name="uq_user_setting"),
        db.Index("ix_user_settings_user_category", "user_id", "category"),
    )


class AgentSuggestionFeedback(db.Model):
    """
    One row per accept/dismiss on a proactive "recommended next step" card
    (see frontend/src/hooks/useAgentCompletion.js and AiAssistantPanel.js).
    The most recent row for a given (user_id, from_agent, to_agent) triple
    decides whether that pairing is currently suppressed - a later 'accepted'
    un-suppresses a pair that was previously 'dismissed'.
    """
    __tablename__ = "agent_suggestion_feedback"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.String(255), nullable=False, index=True)
    from_agent = db.Column(db.String(100), nullable=False)
    to_agent = db.Column(db.String(100), nullable=False)
    action = db.Column(db.String(20), nullable=False)  # 'accepted' | 'dismissed'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.Index("ix_suggestion_feedback_user_pair", "user_id", "from_agent", "to_agent"),
    )


class AiAssistantMessage(db.Model):
    """
    Server-side copy of the AI Assistant chat log (see AiAssistantPanel.js).
    Was localStorage-only ('aiAssistantMessages' key) - fine for surviving a
    reload, but invisible on any other browser/device and gone the moment
    site data is cleared. This table is now the source of truth; localStorage
    stays only as an instant-paint cache for repeat visits in the same
    browser. message_id is the client-generated id already used as the React
    key, so accept/dismiss can update a message in place via upsert instead
    of duplicating it.

    Scoped per project (project_id = the ?project= a message was sent/fired
    under) so switching projects shows that project's own conversation, not
    one account-wide log - matches how Market Research results, documents,
    suppliers etc. are already isolated per project. project_id is nullable:
    NULL is the "general" bucket for pages with no project context (Dashboard,
    Team, Settings, ...).
    """
    __tablename__ = "ai_assistant_messages"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.String(255), nullable=False, index=True)
    project_id = db.Column(db.String(36), nullable=True)
    message_id = db.Column(db.String(64), nullable=False)
    role = db.Column(db.String(20), nullable=False)  # 'user' | 'assistant'
    text = db.Column(db.Text, nullable=False)
    tool_result = db.Column(db.Text, nullable=True)  # JSON-serialized toolResult, if any
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("user_id", "message_id", name="uq_ai_assistant_message"),
        db.Index("ix_ai_assistant_messages_user_project_created", "user_id", "project_id", "created_at"),
    )


# =============================================================================
# Platform-wide models: Team, TeamMember, Project
# =============================================================================

class Team(db.Model):
    """
    Team represents a group of users who can share projects and collaborate.
    """
    __tablename__ = "teams"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    team_id = db.Column(db.String(36), nullable=False, unique=True, index=True)
    owner_id = db.Column(db.String(255), nullable=False, index=True)
    name = db.Column(db.String(255), nullable=True)
    # Team-wide monthly AI budget across every member and project (core/budget.py).
    monthly_budget_usd = db.Column(db.Float, nullable=True)
    budget_enforcement = db.Column(db.String(10), nullable=True)  # "alert" | "block"
    budget_warn_month = db.Column(db.String(7), nullable=True)
    budget_alert_month = db.Column(db.String(7), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    members = db.relationship("TeamMember", back_populates="team", cascade="all, delete-orphan")
    projects = db.relationship("Project", back_populates="team", cascade="all, delete-orphan")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "team_id": self.team_id,
            "owner_id": self.owner_id,
            "name": self.name,
            "members": [m.to_dict() for m in self.members],
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class TeamMember(db.Model):
    """TeamMember links a user to a team with a role (owner/admin/member/viewer)."""
    __tablename__ = "team_members"
    __table_args__ = (db.UniqueConstraint("team_id", "user_id", name="uq_team_member"),)

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    member_id = db.Column(db.String(36), nullable=False, unique=True, index=True)
    team_id = db.Column(db.String(36), db.ForeignKey("teams.team_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = db.Column(db.String(255), nullable=False, index=True)
    name = db.Column(db.String(255), nullable=True)
    role = db.Column(db.String(50), nullable=False, default="member")
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)

    team = db.relationship("Team", back_populates="members")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.member_id,
            "email": self.user_id,
            "name": self.name or self.user_id.split("@")[0],
            "role": self.role,
            "joined_at": self.joined_at.isoformat() if self.joined_at else None,
        }


class Project(db.Model):
    """Project is a shared workspace with multiple agents enabled."""
    __tablename__ = "projects"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    project_id = db.Column(db.String(36), nullable=False, unique=True, index=True)
    team_id = db.Column(db.String(36), db.ForeignKey("teams.team_id", ondelete="CASCADE"), nullable=False, index=True)
    owner_id = db.Column(db.String(255), nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(50), nullable=False, default="active", index=True)
    _agents = db.Column("agents", db.Text, nullable=False, default="[]")
    _data = db.Column("data", db.Text, nullable=False, default="{}")
    monthly_budget_usd = db.Column(db.Float, nullable=True)
    # "YYYY-MM" of the last month a budget-exceeded alert was sent, so we
    # only email once per month even though usage is logged on every call.
    budget_alert_month = db.Column(db.String(7), nullable=True)
    # Same, for the earlier "80% of budget used" warning (core/budget.py).
    budget_warn_month = db.Column(db.String(7), nullable=True)
    # "alert" (default: warn/email only) | "block" (AI calls are refused once
    # this budget is used up) - see core/budget.py's BudgetExceeded.
    budget_enforcement = db.Column(db.String(10), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    team = db.relationship("Team", back_populates="projects")

    @property
    def agents(self) -> List[str]:
        return json.loads(self._agents or "[]")

    @agents.setter
    def agents(self, value: List[str]):
        self._agents = json.dumps(value)

    @property
    def data(self) -> Dict[str, Any]:
        return json.loads(self._data or "{}")

    @data.setter
    def data(self, value: Dict[str, Any]):
        self._data = json.dumps(value, default=str)

    def get_agent_data(self, agent_key: str) -> Dict[str, Any]:
        return self.data.get(agent_key, {})

    def set_agent_data(self, agent_key: str, agent_data: Dict[str, Any]):
        current = self.data
        current[agent_key] = agent_data
        self.data = current

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.project_id,
            "name": self.name,
            "description": self.description,
            "owner": self.owner_id,
            "team_id": self.team_id,
            "agents": self.agents,
            "status": self.status,
            "data": self.data,
            "monthlyBudgetUsd": self.monthly_budget_usd,
            "budgetEnforcement": self.budget_enforcement or "alert",
            "createdAt": self.created_at.strftime("%Y-%m-%d") if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


# =============================================================================
# Workflow Tasks and Notifications
# =============================================================================

class WorkflowTask(db.Model):
    """Task/checklist item within a workflow stage."""
    __tablename__ = "workflow_tasks"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    task_id = db.Column(db.String(36), nullable=False, unique=True, index=True)
    instance_id = db.Column(db.String(36), nullable=False, index=True)  # workflow instance
    stage_id = db.Column(db.String(100), nullable=False, index=True)  # e.g., "requirement_capture"

    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)

    assigned_to = db.Column(db.String(255), nullable=True, index=True)  # user email
    status = db.Column(db.String(20), nullable=False, default="pending")  # pending, in_progress, done
    is_required = db.Column(db.Boolean, nullable=False, default=True)  # blocks stage completion if True
    source = db.Column(db.String(20), nullable=False, default="manual")  # manual, agent

    created_by = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime, nullable=True)
    completed_by = db.Column(db.String(255), nullable=True)

    __table_args__ = (
        db.Index("ix_workflow_tasks_instance_stage", "instance_id", "stage_id"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.task_id,
            "instance_id": self.instance_id,
            "stage_id": self.stage_id,
            "title": self.title,
            "description": self.description,
            "assigned_to": self.assigned_to,
            "status": self.status,
            "is_required": self.is_required,
            "source": self.source,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "completed_by": self.completed_by,
        }


class Notification(db.Model):
    """In-app notification for a user."""
    __tablename__ = "notifications"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    notification_id = db.Column(db.String(36), nullable=False, unique=True, index=True)
    user_id = db.Column(db.String(255), nullable=False, index=True)  # recipient email

    type = db.Column(db.String(50), nullable=False)  # task_assigned, task_completed, stage_completed, etc.
    title = db.Column(db.String(255), nullable=False)
    message = db.Column(db.Text, nullable=True)
    link = db.Column(db.String(500), nullable=True)  # e.g., /workflows/instance-123

    is_read = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Related entity references (optional)
    workflow_id = db.Column(db.String(36), nullable=True)
    task_id = db.Column(db.String(36), nullable=True)

    __table_args__ = (
        db.Index("ix_notifications_user_unread", "user_id", "is_read"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.notification_id,
            "type": self.type,
            "title": self.title,
            "message": self.message,
            "link": self.link,
            "is_read": self.is_read,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class PendingInvite(db.Model):
    """Pending team invitation."""
    __tablename__ = "pending_invites"
    __table_args__ = (db.UniqueConstraint("team_id", "email", name="uq_pending_invite"),)

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    invite_id = db.Column(db.String(36), nullable=False, unique=True, index=True)
    team_id = db.Column(db.String(36), db.ForeignKey("teams.team_id", ondelete="CASCADE"), nullable=False, index=True)
    email = db.Column(db.String(255), nullable=False, index=True)
    role = db.Column(db.String(50), nullable=False, default="member")
    invited_by = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.invite_id,
            "email": self.email,
            "role": self.role,
            "invited_by": self.invited_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# =============================================================================
# Project-scoped AI settings and usage tracking
# =============================================================================

class ProjectSettingModel(db.Model):
    """
    Encrypted project-scoped settings - currently used for per-project AI
    provider keys (see core/project_settings.py). Mirrors UserSettingModel's
    shape/encryption so the two can share the same crypto helpers and a
    near-identical read/write API.
    """
    __tablename__ = "project_settings"
    __table_args__ = (
        db.UniqueConstraint("project_id", "category", "key", name="uq_project_setting"),
        db.Index("ix_project_settings_project_category", "project_id", "category"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    project_id = db.Column(db.String(36), db.ForeignKey("projects.project_id", ondelete="CASCADE"), nullable=False, index=True)
    category = db.Column(db.String(50), nullable=False)  # currently only "ai"
    key = db.Column(db.String(100), nullable=False)
    value_encrypted = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AIUsageLog(db.Model):
    """
    One row per LLM call, written by core/ai_client.py. Denormalizes
    team_id alongside project_id/user_id so team-level rollups don't need
    a join through projects/teams for every query.
    """
    __tablename__ = "ai_usage_log"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.String(255), nullable=False, index=True)
    project_id = db.Column(db.String(36), nullable=True, index=True)
    team_id = db.Column(db.String(36), nullable=True, index=True)
    agent = db.Column(db.String(100), nullable=False, index=True)  # e.g. "content_marketing.generate_content"
    provider = db.Column(db.String(20), nullable=False)  # "openai" | "anthropic"
    model = db.Column(db.String(100), nullable=False)
    key_source = db.Column(db.String(20), nullable=False)  # "project" | "user" | "platform"
    prompt_tokens = db.Column(db.Integer, nullable=False, default=0)
    completion_tokens = db.Column(db.Integer, nullable=False, default=0)
    total_tokens = db.Column(db.Integer, nullable=False, default=0)
    estimated_cost_usd = db.Column(db.Float, nullable=False, default=0.0)
    # Set when the call happened inside a workflow stage (core/usage_context.py),
    # so a workflow run's cost can be totalled and broken down by stage.
    workflow_instance_id = db.Column(db.String(36), nullable=True, index=True)
    workflow_stage_id = db.Column(db.String(100), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    # Every budget check sums "this scope, this month" on each usage write, and
    # every usage dashboard filters the same way: these make that a range scan
    # instead of a scan of the scope's whole history.
    __table_args__ = (
        db.Index("ix_ai_usage_log_user_created", "user_id", "created_at"),
        db.Index("ix_ai_usage_log_project_created", "project_id", "created_at"),
        db.Index("ix_ai_usage_log_team_created", "team_id", "created_at"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "userId": self.user_id,
            "workflowInstanceId": self.workflow_instance_id,
            "workflowStageId": self.workflow_stage_id,
            "projectId": self.project_id,
            "teamId": self.team_id,
            "agent": self.agent,
            "provider": self.provider,
            "model": self.model,
            "keySource": self.key_source,
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
            "totalTokens": self.total_tokens,
            "estimatedCostUsd": round(self.estimated_cost_usd, 6),
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class BudgetReservation(db.Model):
    """Money set aside for an AI call that has started but whose real cost
    isn't logged yet (core/budget.py reserve_budget). It exists so several
    calls in flight at the same moment can't each pass the budget check on
    the same remaining balance. Rows live for the length of one call and are
    deleted when it finishes; expires_at is only the safety net for a process
    that died mid-call - expired rows are ignored and purged."""
    __tablename__ = "budget_reservations"

    reservation_id = db.Column(db.String(36), primary_key=True)
    scope = db.Column(db.String(10), nullable=False)        # "user" | "project" | "team"
    scope_id = db.Column(db.String(255), nullable=False)
    amount_usd = db.Column(db.Float, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)

    __table_args__ = (
        db.Index("ix_budget_reservations_scope", "scope", "scope_id", "expires_at"),
    )


class UserBudget(db.Model):
    """A user's own monthly spend limit across every project and agent -
    the per-user counterpart of Project.monthly_budget_usd (core/budget.py
    evaluates both). One row per user; no row = no budget."""
    __tablename__ = "user_budgets"

    user_id = db.Column(db.String(255), primary_key=True)
    monthly_budget_usd = db.Column(db.Float, nullable=True)
    # "YYYY-MM" of the last month each alert was sent (once per month each).
    enforcement = db.Column(db.String(10), nullable=True)  # "alert" | "block"
    # Set when a team owner/admin (their user id) put this cap on the member:
    # the member can then no longer change or remove it themselves.
    managed_by = db.Column(db.String(255), nullable=True)
    warn_month = db.Column(db.String(7), nullable=True)
    over_month = db.Column(db.String(7), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
