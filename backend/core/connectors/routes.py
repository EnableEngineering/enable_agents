"""
Connector API routes — expose connectors via REST endpoints.

Endpoints:
- GET  /api/connectors              — list available connectors
- GET  /api/connectors/:id/status   — check connection status
- POST /api/connectors/:id/connect  — initialize connection
- POST /api/connectors/:id/fetch    — fetch data from connector
- GET  /api/connectors/:id/auth-url — get OAuth URL (for OAuth connectors)
- POST /api/connectors/:id/callback — handle OAuth callback
"""

import logging
from datetime import datetime
from flask import Blueprint, request, jsonify, g

from core.auth import require_auth
from core.connectors import get_connector, list_connectors, ConnectorError, AuthenticationError

logger = logging.getLogger(__name__)

bp = Blueprint("connectors", __name__, url_prefix="/api/connectors")


def get_user_id() -> str:
    """Authenticated user ID, set by the @require_auth decorator."""
    return g.user_id


@bp.route("", methods=["GET"])
@require_auth
def list_all_connectors():
    """List all available connectors."""
    connectors = list_connectors()
    return jsonify({"connectors": connectors}), 200


@bp.route("/<connector_id>/status", methods=["GET"])
@require_auth
def get_connector_status(connector_id: str):
    """
    Check whether a connector is actually working right now.

    Runs health_check() rather than just connect() - for connector types
    where a stored credential doesn't guarantee it still works (e.g. an
    API key that was revoked), this does a real, minimal live call instead
    of reporting "connected" just because a value is present in settings.
    """
    try:
        user_id = get_user_id()
        connector = get_connector(connector_id, user_id=user_id)
        result = connector.health_check()

        return jsonify({
            "connector_id": connector_id,
            "connected": result["ok"],
            "error": result["error"],
            "checked_at": datetime.utcnow().isoformat(),
            "connector_type": connector.connector_type,
            "supported_resources": connector.supported_resources,
        }), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        logger.exception(f"Status check failed for {connector_id}")
        return jsonify({"error": str(e)}), 500


@bp.route("/<connector_id>/connect", methods=["POST"])
@require_auth
def connect_connector(connector_id: str):
    """Initialize/connect a connector."""
    try:
        user_id = get_user_id()
        data = request.get_json() or {}

        connector = get_connector(connector_id, user_id=user_id, config=data.get("config"))
        success = connector.connect()

        return jsonify({
            "connector_id": connector_id,
            "connected": success,
        }), 200 if success else 400

    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        logger.exception(f"Connect failed for {connector_id}")
        return jsonify({"error": str(e)}), 500


@bp.route("/<connector_id>/fetch", methods=["POST"])
@require_auth
def fetch_from_connector(connector_id: str):
    """
    Fetch data from a connector.

    Request body:
    {
        "resource": "text",           // Required: resource type
        "params": {"url": "..."},     // Resource-specific params
        "store": true                 // Optional: store to context (default true)
    }
    """
    try:
        user_id = get_user_id()
        data = request.get_json() or {}

        resource = data.get("resource")
        if not resource:
            return jsonify({"error": "resource is required"}), 400

        params = data.get("params", {})
        store = data.get("store", True)
        config = data.get("config")

        connector = get_connector(connector_id, user_id=user_id, config=config)

        if not connector.connect():
            return jsonify({
                "error": "Failed to connect",
                "connector_id": connector_id,
            }), 400

        result = connector.fetch(resource=resource, params=params, store=store)

        return jsonify({
            "connector_id": connector_id,
            "resource": resource,
            "stored": store,
            "data": result,
        }), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except ConnectorError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.exception(f"Fetch failed for {connector_id}")
        return jsonify({"error": str(e)}), 500


@bp.route("/<connector_id>/auth-url", methods=["GET"])
@require_auth
def get_auth_url(connector_id: str):
    """
    Get OAuth authorization URL (for OAuth connectors).

    Query params:
    - redirect_uri: Where to redirect after auth
    """
    try:
        user_id = get_user_id()
        redirect_uri = request.args.get("redirect_uri")

        if not redirect_uri:
            return jsonify({"error": "redirect_uri is required"}), 400

        connector = get_connector(connector_id, user_id=user_id)

        if connector.connector_type != "oauth":
            return jsonify({"error": f"{connector_id} is not an OAuth connector"}), 400

        auth_url = connector.get_authorization_url(redirect_uri=redirect_uri)

        return jsonify({
            "connector_id": connector_id,
            "auth_url": auth_url,
        }), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        logger.exception(f"Auth URL failed for {connector_id}")
        return jsonify({"error": str(e)}), 500


@bp.route("/<connector_id>/callback", methods=["POST"])
@require_auth
def handle_oauth_callback(connector_id: str):
    """
    Handle OAuth callback with authorization code.

    Request body:
    {
        "code": "...",           // Authorization code
        "redirect_uri": "..."    // Must match original redirect_uri
    }
    """
    try:
        user_id = get_user_id()
        data = request.get_json() or {}

        code = data.get("code")
        redirect_uri = data.get("redirect_uri")

        if not code or not redirect_uri:
            return jsonify({"error": "code and redirect_uri are required"}), 400

        connector = get_connector(connector_id, user_id=user_id)

        if connector.connector_type != "oauth":
            return jsonify({"error": f"{connector_id} is not an OAuth connector"}), 400

        token_data = connector.exchange_code(code=code, redirect_uri=redirect_uri)

        return jsonify({
            "connector_id": connector_id,
            "connected": True,
            "token_type": token_data.get("token_type"),
        }), 200

    except AuthenticationError as e:
        return jsonify({"error": str(e)}), 401
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        logger.exception(f"OAuth callback failed for {connector_id}")
        return jsonify({"error": str(e)}), 500
