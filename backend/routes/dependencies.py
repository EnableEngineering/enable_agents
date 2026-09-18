"""
Dependencies API Routes.

Exposes dependency validation status for agents.
"""

from flask import request, Blueprint, jsonify, g
from core.auth import require_auth
from core.dependency_validator import get_dependency_status, validator

dependencies_bp = Blueprint("dependencies", __name__, url_prefix="/api/dependencies")


@dependencies_bp.route("/status/<agent_id>", methods=["GET"])
@require_auth
def check_agent_dependencies(agent_id):
    """Get dependency status for a specific agent."""
    status = get_dependency_status(agent_id, g.user_id, request.args.get("project_id") or None)
    return jsonify(status)


@dependencies_bp.route("/config", methods=["GET"])
@require_auth
def get_dependency_config():
    """Get full dependency configuration."""
    return jsonify(validator.config)


@dependencies_bp.route("/reload", methods=["POST"])
@require_auth
def reload_config():
    """Reload dependency configuration from disk."""
    validator.reload_config()
    return jsonify({"success": True, "message": "Configuration reloaded"})
