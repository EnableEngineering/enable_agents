"""
Settings API routes — user configuration management.

Endpoints:
- GET  /api/settings              — list all settings with definitions
- GET  /api/settings/:category    — list settings for a category
- POST /api/settings              — create/update a setting
- DELETE /api/settings/:category/:key — delete a setting
- GET  /api/settings/definitions  — get setting definitions for UI
"""

import logging
from flask import Blueprint, request, jsonify, g

from core.auth import require_auth
from core.settings import UserSettings, get_setting_definitions
from core.key_testing import test_openai_key as _test_openai_key, test_anthropic_key as _test_anthropic_key

logger = logging.getLogger(__name__)

bp = Blueprint("settings", __name__, url_prefix="/api/settings")


def get_user_id() -> str:
    """Authenticated user ID, set by the @require_auth decorator."""
    return g.user_id


@bp.route("/business-context", methods=["POST"])
@require_auth
def save_business_context():
    """Persist the user's business-context fields (industry, role, company
    size, product/service) as the `user_profile` context key other agents'
    prerequisite checks look for - agent-dependencies.json declares
    user_profile as provided_by "settings", and dependency_validator reads
    it via ContextStore.get(user_id, "settings", "user_profile"). The
    frontend previously posted this to /api/context (wrong URL - the real
    batch-entries endpoint is /api/context/save, with an incompatible body
    shape besides) so it never actually reached ContextStore, and the
    Executive Assistant's prerequisite banner could never clear."""
    try:
        user_id = get_user_id()
        content = request.get_json(silent=True) or {}
        from core.context import ContextStore

        ContextStore().set(user_id, "settings", "user_profile", content)
        return jsonify({"success": True}), 200
    except Exception as e:
        logger.exception("Failed to save business context")
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("", methods=["GET"])
@require_auth
def list_settings():
    """
    List all settings for current user.

    Query params:
    - include_values: If "true", include masked values

    Returns settings organized by category with UI metadata.
    """
    try:
        user_id = get_user_id()
        include_values = request.args.get("include_values", "").lower() == "true"

        settings = UserSettings()
        result = settings.list(user_id, include_values=include_values)

        return jsonify({
            "settings": result,
            "user_id": user_id,
        }), 200

    except Exception as e:
        logger.exception("Failed to list settings")
        return jsonify({"error": str(e)}), 500


@bp.route("/<category>", methods=["GET"])
@require_auth
def list_category_settings(category: str):
    """List settings for a specific category."""
    try:
        user_id = get_user_id()
        include_values = request.args.get("include_values", "").lower() == "true"

        settings = UserSettings()
        result = settings.list(user_id, category=category, include_values=include_values)

        if category not in result:
            return jsonify({"error": f"Unknown category: {category}"}), 404

        return jsonify({
            "category": category,
            "settings": result[category],
        }), 200

    except Exception as e:
        logger.exception(f"Failed to list settings for {category}")
        return jsonify({"error": str(e)}), 500


@bp.route("", methods=["POST"])
@require_auth
def save_setting():
    """
    Create or update a setting.

    Request body:
    {
        "category": "ai",
        "key": "openai_key",
        "value": "sk-..."
    }
    """
    try:
        user_id = get_user_id()
        data = request.get_json() or {}

        category = data.get("category")
        key = data.get("key")
        value = data.get("value")

        if not category or not key:
            return jsonify({"error": "category and key are required"}), 400

        if value is None:
            return jsonify({"error": "value is required"}), 400

        settings = UserSettings()
        settings.set(user_id, category, key, value)

        return jsonify({
            "success": True,
            "category": category,
            "key": key,
            "message": f"Setting {category}/{key} saved",
        }), 200

    except Exception as e:
        logger.exception("Failed to save setting")
        return jsonify({"error": str(e)}), 500


@bp.route("/<category>/<key>", methods=["DELETE"])
@require_auth
def delete_setting(category: str, key: str):
    """Delete a specific setting."""
    try:
        user_id = get_user_id()

        settings = UserSettings()
        deleted = settings.delete(user_id, category, key)

        if not deleted:
            return jsonify({"error": "Setting not found"}), 404

        return jsonify({
            "success": True,
            "category": category,
            "key": key,
            "message": f"Setting {category}/{key} deleted",
        }), 200

    except Exception as e:
        logger.exception(f"Failed to delete setting {category}/{key}")
        return jsonify({"error": str(e)}), 500


@bp.route("/definitions", methods=["GET"])
@require_auth
def get_definitions():
    """
    Get setting definitions for UI rendering.

    Returns all categories, settings, types, and validation rules.
    """
    return jsonify({
        "definitions": get_setting_definitions(),
    }), 200


@bp.route("/test-connection", methods=["POST"])
@require_auth
def test_connection():
    """
    Test if a setting/connection works.

    Request body:
    {
        "category": "ai",
        "key": "openai_key"
    }

    Tests the connection and returns success/failure.
    """
    try:
        user_id = get_user_id()
        data = request.get_json() or {}

        category = data.get("category")
        key = data.get("key")

        if not category or not key:
            return jsonify({"error": "category and key are required"}), 400

        settings = UserSettings()
        value = settings.get(user_id, category, key)

        if not value:
            return jsonify({
                "success": False,
                "error": "Setting not configured",
            }), 400

        # Test based on setting type
        success = False
        message = "Test not implemented for this setting"

        if category == "ai" and key == "openai_key":
            success, message = _test_openai_key(value)
        elif category == "ai" and key == "anthropic_key":
            success, message = _test_anthropic_key(value)
        elif category == "connectors" and key == "google_search_key":
            cx = settings.get(user_id, "connectors", "google_search_cx")
            success, message = _test_google_search(value, cx)

        return jsonify({
            "success": success,
            "message": message,
            "category": category,
            "key": key,
        }), 200 if success else 400

    except Exception as e:
        logger.exception("Failed to test connection")
        return jsonify({"error": str(e)}), 500


def _test_google_search(api_key: str, cx: str) -> tuple:
    """Test Google Custom Search."""
    if not cx:
        return False, "Search Engine ID (CX) not configured"

    try:
        import requests
        response = requests.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": api_key, "cx": cx, "q": "test", "num": 1},
            timeout=10,
        )
        if response.status_code == 200:
            return True, "Connected successfully!"
        else:
            return False, f"API error: {response.status_code}"
    except Exception as e:
        return False, f"Failed: {str(e)}"
