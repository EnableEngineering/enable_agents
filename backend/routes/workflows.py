"""
Workflow Templates API Routes.

Handles workflow template CRUD, instance management, and stage transitions.
"""
from flask import Blueprint, request, jsonify, g
from sqlalchemy import or_

from core.auth import require_auth, user_can_access_project
from datetime import datetime
import uuid
import json
from pathlib import Path

from core.database import db
from models.workflow import WorkflowTemplate, WorkflowInstance
from core.models import WorkflowTask, Notification, Project, TeamMember

workflows_bp = Blueprint('workflows', __name__)

TEMPLATES_DIR = Path(__file__).parent.parent / "config" / "workflow-templates"


def get_user_id() -> str:
    return g.user_id


def get_accessible_instance(instance_id: str, user_id: str):
    """Fetch a workflow instance the user can access - either the owner, or
    (if it's linked to a project) a member of that project's team, matching
    the same owner-or-team-member model Projects already use via
    user_can_access_project. Returns None if not found or not accessible
    (caller should 404, not 403, to avoid confirming existence of other
    users' instances)."""
    instance = WorkflowInstance.query.filter_by(instance_id=instance_id).first()
    if not instance:
        return None
    if instance.user_id == user_id:
        return instance
    if instance.project_id and user_can_access_project(user_id, instance.project_id):
        return instance
    return None


# Templates whose instances run through agents/workflow_orchestration/graph.py
# instead of the plain manual start/complete-stage flow below. Kept as a set
# (not a single constant) so generalizing the graph engine to more templates
# is a one-line addition here.
GRAPH_ORCHESTRATED_TEMPLATE_IDS = {"supplier-qualification", "vendor-evaluation", "lead-nurture"}


def _is_graph_orchestrated(instance: WorkflowInstance) -> bool:
    return instance.template_id in GRAPH_ORCHESTRATED_TEMPLATE_IDS


def user_can_assign_task(user_id: str, assignee: str, instance: WorkflowInstance) -> bool:
    """True if assignee can actually access this instance once assigned -
    either they own it, or they're on the team of the instance's project.
    Prevents creating a task_assigned notification that just 404s for the
    assignee (no project link, or a project they're not a member of)."""
    if assignee == user_id:
        return True
    if not instance.project_id:
        return False
    return user_can_access_project(assignee, instance.project_id)


def load_system_templates():
    """Load system templates from JSON files on startup."""
    if not TEMPLATES_DIR.exists():
        return

    for json_file in TEMPLATES_DIR.glob("*.json"):
        try:
            data = json.loads(json_file.read_text())
            template_id = data.get("id")
            if not template_id:
                continue

            existing = WorkflowTemplate.query.filter_by(template_id=template_id).first()
            if existing:
                # Update if system template
                if existing.is_system:
                    existing.name = data.get("name", existing.name)
                    existing.description = data.get("description", existing.description)
                    existing.category = data.get("category", existing.category)
                    existing.icon = data.get("icon", existing.icon)
                    existing.stages = data.get("stages", [])
                continue

            template = WorkflowTemplate(
                template_id=template_id,
                name=data.get("name", template_id),
                description=data.get("description", ""),
                category=data.get("category", "general"),
                icon=data.get("icon", "workflow"),
                is_system=True,
                is_active=True,
            )
            template.stages = data.get("stages", [])
            db.session.add(template)
        except Exception as e:
            print(f"[workflows] Error loading template {json_file}: {e}")

    db.session.commit()


# =============================================================================
# Templates
# =============================================================================

@workflows_bp.route('/api/workflows/templates', methods=['GET'])
@require_auth
def list_templates():
    """List all active workflow templates."""
    category = request.args.get("category")
    query = WorkflowTemplate.query.filter_by(is_active=True)
    if category:
        query = query.filter_by(category=category)

    templates = query.order_by(WorkflowTemplate.name.asc()).all()
    return jsonify({"success": True, "templates": [t.to_dict() for t in templates]})


@workflows_bp.route('/api/workflows/templates/<template_id>', methods=['GET'])
@require_auth
def get_template(template_id: str):
    """Get a single template with full stage details."""
    template = WorkflowTemplate.query.filter_by(template_id=template_id).first()
    if not template:
        return jsonify({"error": "Template not found"}), 404
    return jsonify({"success": True, "template": template.to_dict()})


@workflows_bp.route('/api/workflows/templates', methods=['POST'])
@require_auth
def create_template():
    """Create a custom workflow template."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400

    template_id = data.get("id") or f"custom-{uuid.uuid4().hex[:8]}"

    template = WorkflowTemplate(
        template_id=template_id,
        name=name,
        description=data.get("description", ""),
        category=data.get("category", "custom"),
        icon=data.get("icon", "workflow"),
        is_system=False,
        is_active=True,
    )
    template.stages = data.get("stages", [])

    db.session.add(template)
    db.session.commit()
    return jsonify({"success": True, "template": template.to_dict()})


@workflows_bp.route('/api/workflows/templates/<template_id>', methods=['DELETE'])
@require_auth
def delete_template(template_id: str):
    """Delete a custom template (not system templates)."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    template = WorkflowTemplate.query.filter_by(template_id=template_id).first()
    if not template:
        return jsonify({"error": "Template not found"}), 404
    if template.is_system:
        return jsonify({"error": "Cannot delete system templates"}), 403

    db.session.delete(template)
    db.session.commit()
    return jsonify({"success": True, "message": "Template deleted"})


# =============================================================================
# Instances
# =============================================================================

@workflows_bp.route('/api/workflows/instances', methods=['GET'])
@require_auth
def list_instances():
    """List workflow instances for the current user."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    status = request.args.get("status")
    project_id = request.args.get("project_id")

    # Instances the user owns, plus instances linked to a project whose team
    # they're a member of - matching the owner-or-team-member model
    # get_accessible_instance() uses for a single instance.
    member_team_ids = [m.team_id for m in TeamMember.query.filter_by(user_id=user_id).all()]
    accessible_project_ids = (
        [p.project_id for p in Project.query.filter(Project.team_id.in_(member_team_ids)).all()]
        if member_team_ids else []
    )
    query = WorkflowInstance.query.filter(
        or_(
            WorkflowInstance.user_id == user_id,
            WorkflowInstance.project_id.in_(accessible_project_ids),
        )
    )
    if status:
        query = query.filter_by(status=status)
    if project_id:
        query = query.filter_by(project_id=project_id)

    instances = query.order_by(WorkflowInstance.updated_at.desc()).all()
    return jsonify({"success": True, "instances": [i.to_dict() for i in instances]})


@workflows_bp.route('/api/workflows/instances', methods=['POST'])
@require_auth
def create_instance():
    """Start a new workflow instance from a template."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    data = request.get_json()
    template_id = data.get("templateId")
    if not template_id:
        return jsonify({"error": "templateId is required"}), 400

    template = WorkflowTemplate.query.filter_by(template_id=template_id).first()
    if not template or not template.is_active:
        return jsonify({"error": "Template not found or inactive"}), 404

    instance = WorkflowInstance(
        instance_id=str(uuid.uuid4()),
        template_id=template_id,
        user_id=user_id,
        project_id=data.get("projectId"),
        name=data.get("name", f"{template.name} - {datetime.utcnow().strftime('%Y-%m-%d')}"),
        status="pending",
        current_stage_index=0,
    )

    # Initialize context with any provided inputs
    if data.get("inputs"):
        instance.context = data["inputs"]

    db.session.add(instance)
    db.session.commit()
    return jsonify({"success": True, "instance": instance.to_dict()})


@workflows_bp.route('/api/workflows/instances/<instance_id>', methods=['GET'])
@require_auth
def get_instance(instance_id: str):
    """Get a workflow instance with full state."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    return jsonify({"success": True, "instance": instance.to_dict()})


@workflows_bp.route('/api/workflows/instances/<instance_id>/start', methods=['POST'])
@require_auth
def start_instance(instance_id: str):
    """Start a pending workflow instance."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    if _is_graph_orchestrated(instance):
        return jsonify({"error": "This workflow runs through the graph engine - use POST .../run instead of .../start"}), 400

    if instance.status not in ["pending", "paused"]:
        return jsonify({"error": f"Cannot start instance with status '{instance.status}'"}), 400

    instance.status = "running"
    if not instance.started_at:
        instance.started_at = datetime.utcnow()

    db.session.commit()
    return jsonify({"success": True, "instance": instance.to_dict()})


@workflows_bp.route('/api/workflows/instances/<instance_id>/complete-stage', methods=['POST'])
@require_auth
def complete_stage(instance_id: str):
    """Complete the current stage and advance to next."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    if _is_graph_orchestrated(instance):
        return jsonify({"error": "This workflow runs through the graph engine - use POST .../resume instead of .../complete-stage"}), 400

    if instance.status != "running":
        return jsonify({"error": "Instance is not running"}), 400

    data = request.get_json() or {}
    stage_data = data.get("data", {})

    # Get current stage ID from template
    template = WorkflowTemplate.query.filter_by(template_id=instance.template_id).first()
    if template and template.stages:
        current_stage = template.stages[instance.current_stage_index]
        stage_id = current_stage.get("stage_id") or current_stage.get("id", "")

        # Check required tasks are complete
        pending_required = WorkflowTask.query.filter_by(
            instance_id=instance_id,
            stage_id=stage_id,
            is_required=True
        ).filter(WorkflowTask.status != "done").all()

        if pending_required:
            return jsonify({
                "error": "Cannot complete stage with pending required tasks",
                "pending_tasks": [t.to_dict() for t in pending_required]
            }), 400

        # Check the stage's required_inputs are actually present - either
        # already in context (e.g. produced by an earlier stage), persisted
        # mid-stage via save_stage_data, or submitted in this request. This
        # was never checked before: the frontend renders required_inputs as
        # form fields, but nothing stopped completing the stage with them
        # left blank.
        required_inputs = current_stage.get("required_inputs") or []
        if required_inputs:
            existing_stage_data = instance.stage_states.get(stage_id, {}).get("data") or {}
            available = {**instance.context, **existing_stage_data, **stage_data}
            missing_inputs = [key for key in required_inputs if not available.get(key)]
            if missing_inputs:
                return jsonify({
                    "error": "Missing required input(s) for this stage",
                    "missing_inputs": missing_inputs,
                }), 400

    instance.advance_stage(stage_data)
    db.session.commit()

    return jsonify({"success": True, "instance": instance.to_dict()})


@workflows_bp.route('/api/workflows/instances/<instance_id>/stages/<stage_id>/data', methods=['POST', 'PATCH'])
@require_auth
def save_stage_data(instance_id: str, stage_id: str):
    """
    Save data for a specific stage without completing it.
    Agents call this to persist their outputs back to the workflow.
    PATCH merges with existing data, POST replaces.
    """
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    if _is_graph_orchestrated(instance):
        return jsonify({"error": "This workflow runs through the graph engine - stage data is written automatically as each stage completes"}), 400

    # Verify stage exists in template
    template = instance.template
    if not template:
        return jsonify({"error": "Template not found"}), 404

    stage_ids = [s.get("stage_id") or s.get("id") for s in template.stages]
    if stage_id not in stage_ids:
        return jsonify({"error": f"Stage '{stage_id}' not found in template"}), 404

    data = request.get_json() or {}
    stage_data = data.get("data", {})

    if not stage_data:
        return jsonify({"error": "No data provided"}), 400

    # Get current stage states
    states = instance.stage_states

    # A completed stage's inputs/outputs are locked - reject writes even if the
    # client-side UI guard was bypassed (stale tab, race condition, direct API call).
    if states.get(stage_id, {}).get("status") == "completed":
        return jsonify({"error": "This stage is already completed and its data cannot be changed"}), 400

    # Initialize stage state if not exists
    if stage_id not in states:
        states[stage_id] = {"status": "in_progress", "data": {}}

    # PATCH merges, POST replaces
    if request.method == 'PATCH':
        existing_data = states[stage_id].get("data", {})
        existing_data.update(stage_data)
        states[stage_id]["data"] = existing_data
    else:
        states[stage_id]["data"] = stage_data

    states[stage_id]["updatedAt"] = datetime.utcnow().isoformat()
    instance.stage_states = states

    # Also update context with the new data for downstream stages
    ctx = instance.context
    ctx.update(stage_data)
    instance.context = ctx

    db.session.commit()

    return jsonify({
        "success": True,
        "stageId": stage_id,
        "data": states[stage_id]["data"],
        "message": "Stage data saved successfully"
    })


@workflows_bp.route('/api/workflows/instances/<instance_id>/pause', methods=['POST'])
@require_auth
def pause_instance(instance_id: str):
    """Pause a running workflow."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    if instance.status != "running":
        return jsonify({"error": "Can only pause running instances"}), 400

    instance.status = "paused"
    db.session.commit()
    return jsonify({"success": True, "instance": instance.to_dict()})


# =============================================================================
# LangGraph orchestration (Supplier Qualification Pipeline only - see
# agents/workflow_orchestration/). Other templates keep running through the
# plain start/complete-stage bookkeeping above.
# =============================================================================

@workflows_bp.route('/api/workflows/instances/<instance_id>/run', methods=['POST'])
@require_auth
def run_instance(instance_id: str):
    """Kick off (or continue) the instance's LangGraph run asynchronously."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    if not _is_graph_orchestrated(instance):
        return jsonify({"error": "This workflow template has no orchestration graph - use POST .../start instead"}), 400

    if instance.status not in ("pending", "paused"):
        return jsonify({"error": f"Cannot run instance with status '{instance.status}'"}), 400

    from agents.workflow_orchestration.tasks import run_workflow_graph
    task = run_workflow_graph.delay(instance_id)
    return jsonify({"success": True, "taskId": task.id, "instance": instance.to_dict()}), 202


@workflows_bp.route('/api/workflows/instances/<instance_id>/pending-approval', methods=['GET'])
@require_auth
def get_pending_approval(instance_id: str):
    """Read the current interrupt (if any) the graph is paused on."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    if not _is_graph_orchestrated(instance):
        return jsonify({"success": True, "pending": False})

    from agents.workflow_orchestration.graph import get_compiled_graph
    snapshot = get_compiled_graph(instance.template_id).get_state({"configurable": {"thread_id": instance_id}})

    if not snapshot.next:
        return jsonify({"success": True, "pending": False})

    interrupts = [i for task in snapshot.tasks for i in task.interrupts]
    if not interrupts:
        return jsonify({"success": True, "pending": False})

    return jsonify({"success": True, "pending": True, "interrupt": interrupts[0].value})


@workflows_bp.route('/api/workflows/instances/<instance_id>/resume', methods=['POST'])
@require_auth
def resume_instance(instance_id: str):
    """Resume a graph paused on interrupt() with a human decision.
    Expects JSON: { action: "approve"|"edit"|"skip", data: {...} }"""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    if not _is_graph_orchestrated(instance):
        return jsonify({"error": "This workflow template has no orchestration graph - use POST .../complete-stage instead"}), 400

    data = request.get_json() or {}
    action = data.get("action")
    if action not in ("approve", "edit", "skip"):
        return jsonify({"error": "action must be one of: approve, edit, skip"}), 400

    resume_value = {"action": action, "data": data.get("data", {})}

    from agents.workflow_orchestration.tasks import resume_workflow_graph
    task = resume_workflow_graph.delay(instance_id, resume_value)
    return jsonify({"success": True, "taskId": task.id}), 202


@workflows_bp.route('/api/workflows/instances/<instance_id>/autonomy', methods=['PATCH'])
@require_auth
def set_autonomy_mode(instance_id: str):
    """Set the instance's autonomy mode. Expects JSON: { mode: "suggest"|"co-pilot"|"autopilot" }"""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    mode = (request.get_json() or {}).get("mode")
    if mode not in ("suggest", "co-pilot", "autopilot"):
        return jsonify({"error": "mode must be one of: suggest, co-pilot, autopilot"}), 400

    instance.autonomy_mode = mode
    db.session.commit()
    return jsonify({"success": True, "instance": instance.to_dict()})


@workflows_bp.route('/api/workflows/instances/<instance_id>', methods=['DELETE'])
@require_auth
def delete_instance(instance_id: str):
    """Delete a workflow instance."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    db.session.delete(instance)
    db.session.commit()
    return jsonify({"success": True, "message": "Instance deleted"})


# =============================================================================
# Tasks
# =============================================================================

def create_notification(user_id: str, notif_type: str, title: str, message: str = None,
                        link: str = None, workflow_id: str = None, task_id: str = None):
    """Helper to create in-app notification."""
    notification = Notification(
        notification_id=str(uuid.uuid4()),
        user_id=user_id,
        type=notif_type,
        title=title,
        message=message,
        link=link,
        workflow_id=workflow_id,
        task_id=task_id,
    )
    db.session.add(notification)
    return notification


@workflows_bp.route('/api/workflows/instances/<instance_id>/tasks', methods=['GET'])
@require_auth
def list_tasks(instance_id: str):
    """List all tasks for a workflow instance."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    stage_id = request.args.get("stage_id")
    query = WorkflowTask.query.filter_by(instance_id=instance_id)
    if stage_id:
        query = query.filter_by(stage_id=stage_id)

    tasks = query.order_by(WorkflowTask.created_at.asc()).all()
    return jsonify({"success": True, "tasks": [t.to_dict() for t in tasks]})


@workflows_bp.route('/api/workflows/instances/<instance_id>/stages/<stage_id>/tasks', methods=['GET'])
@require_auth
def list_stage_tasks(instance_id: str, stage_id: str):
    """List tasks for a specific stage."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    tasks = WorkflowTask.query.filter_by(
        instance_id=instance_id,
        stage_id=stage_id
    ).order_by(WorkflowTask.created_at.asc()).all()

    # Count stats
    total = len(tasks)
    done = sum(1 for t in tasks if t.status == "done")
    required_pending = sum(1 for t in tasks if t.is_required and t.status != "done")

    return jsonify({
        "success": True,
        "tasks": [t.to_dict() for t in tasks],
        "stats": {
            "total": total,
            "done": done,
            "required_pending": required_pending,
            "can_complete": required_pending == 0
        }
    })


@workflows_bp.route('/api/workflows/instances/<instance_id>/tasks', methods=['POST'])
@require_auth
def create_task(instance_id: str):
    """Create a new task for a workflow stage."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    data = request.get_json()
    title = data.get("title", "").strip()
    if not title:
        return jsonify({"error": "Title is required"}), 400

    stage_id = data.get("stage_id")
    if not stage_id:
        return jsonify({"error": "stage_id is required"}), 400

    assignee = data.get("assigned_to")
    if assignee and not user_can_assign_task(user_id, assignee, instance):
        return jsonify({"error": "That person doesn't have access to this workflow's project"}), 400

    task = WorkflowTask(
        task_id=str(uuid.uuid4()),
        instance_id=instance_id,
        stage_id=stage_id,
        title=title,
        description=data.get("description"),
        assigned_to=assignee,
        is_required=data.get("is_required", True),
        source=data.get("source", "manual"),
        created_by=user_id,
    )
    db.session.add(task)

    # Notify assignee if different from creator
    if task.assigned_to and task.assigned_to != user_id:
        create_notification(
            user_id=task.assigned_to,
            notif_type="task_assigned",
            title="New task assigned to you",
            message=f"Task: {title}",
            link=f"/workflows/{instance_id}",
            workflow_id=instance_id,
            task_id=task.task_id,
        )

    db.session.commit()
    return jsonify({"success": True, "task": task.to_dict()})


@workflows_bp.route('/api/workflows/instances/<instance_id>/tasks/<task_id>', methods=['PATCH'])
@require_auth
def update_task(instance_id: str, task_id: str):
    """Update a task (status, assignee, etc.)."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    task = WorkflowTask.query.filter_by(task_id=task_id, instance_id=instance_id).first()
    if not task:
        return jsonify({"error": "Task not found"}), 404

    data = request.get_json()
    old_status = task.status
    old_assignee = task.assigned_to

    # Update fields
    if "title" in data:
        task.title = data["title"].strip()
    if "description" in data:
        task.description = data["description"]
    if "is_required" in data:
        task.is_required = data["is_required"]
    if "assigned_to" in data:
        new_assignee = data["assigned_to"]
        if new_assignee and not user_can_assign_task(user_id, new_assignee, instance):
            return jsonify({"error": "That person doesn't have access to this workflow's project"}), 400
        task.assigned_to = new_assignee
    if "status" in data:
        task.status = data["status"]
        if data["status"] == "done" and old_status != "done":
            task.completed_at = datetime.utcnow()
            task.completed_by = user_id

    # Notify on assignment change
    if task.assigned_to and task.assigned_to != old_assignee and task.assigned_to != user_id:
        create_notification(
            user_id=task.assigned_to,
            notif_type="task_assigned",
            title="Task assigned to you",
            message=f"Task: {task.title}",
            link=f"/workflows/{instance_id}",
            workflow_id=instance_id,
            task_id=task.task_id,
        )

    # Notify creator on completion (if different from completer)
    if task.status == "done" and old_status != "done" and task.created_by != user_id:
        create_notification(
            user_id=task.created_by,
            notif_type="task_completed",
            title="Task completed",
            message=f"Task '{task.title}' was marked complete",
            link=f"/workflows/{instance_id}",
            workflow_id=instance_id,
            task_id=task.task_id,
        )

    db.session.commit()
    return jsonify({"success": True, "task": task.to_dict()})


@workflows_bp.route('/api/workflows/instances/<instance_id>/tasks/<task_id>', methods=['DELETE'])
@require_auth
def delete_task(instance_id: str, task_id: str):
    """Delete a task."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    instance = get_accessible_instance(instance_id, user_id)
    if not instance:
        return jsonify({"error": "Instance not found"}), 404

    task = WorkflowTask.query.filter_by(task_id=task_id, instance_id=instance_id).first()
    if not task:
        return jsonify({"error": "Task not found"}), 404

    db.session.delete(task)
    db.session.commit()
    return jsonify({"success": True, "message": "Task deleted"})


# =============================================================================
# Notifications
# =============================================================================

@workflows_bp.route('/api/notifications', methods=['GET'])
@require_auth
def list_notifications():
    """List notifications for current user."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    unread_only = request.args.get("unread_only", "false").lower() == "true"
    query = Notification.query.filter_by(user_id=user_id)
    if unread_only:
        query = query.filter_by(is_read=False)

    notifications = query.order_by(Notification.created_at.desc()).limit(50).all()
    unread_count = Notification.query.filter_by(user_id=user_id, is_read=False).count()

    return jsonify({
        "success": True,
        "notifications": [n.to_dict() for n in notifications],
        "unread_count": unread_count
    })


@workflows_bp.route('/api/notifications/<notification_id>/read', methods=['POST'])
@require_auth
def mark_notification_read(notification_id: str):
    """Mark a notification as read."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    notification = Notification.query.filter_by(
        notification_id=notification_id,
        user_id=user_id
    ).first()
    if not notification:
        return jsonify({"error": "Notification not found"}), 404

    notification.is_read = True
    db.session.commit()
    return jsonify({"success": True})


@workflows_bp.route('/api/notifications/read-all', methods=['POST'])
@require_auth
def mark_all_notifications_read():
    """Mark all notifications as read."""
    user_id = get_user_id()
    if not user_id:
        return jsonify({"error": "Not authenticated"}), 401

    Notification.query.filter_by(user_id=user_id, is_read=False).update({"is_read": True})
    db.session.commit()
    return jsonify({"success": True})
