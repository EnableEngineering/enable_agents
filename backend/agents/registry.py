"""
Agent registry.

Scans backend/agents/ at startup, reads each manifest.json, and registers
enabled agents' Flask Blueprints. Also exposes /api/v1/agents endpoints for
listing, health-checking, and toggling agents at runtime.

To add a new agent:
  1. Create backend/agents/<name>/
  2. Add manifest.json (see _MANIFEST_SCHEMA below for required keys)
  3. Add routes.py with a Blueprint named `<name>_bp`
  4. Restart the backend (or call reload_registry() in tests)

To disable an agent:
  - Set "enabled": false in manifest.json, or
  - PATCH /api/v1/agents/<id>  {"enabled": false}
"""

import importlib
import json
import os
from pathlib import Path
from typing import Any

from flask import Blueprint, Flask, g, jsonify, request

from core.auth import require_auth

AGENTS_DIR = Path(__file__).parent
registry_bp = Blueprint("agent_registry", __name__, url_prefix="/api/v1/agents")

# In-memory registry: {agent_id: manifest_dict}
_registry: dict[str, dict[str, Any]] = {}

_REQUIRED_MANIFEST_KEYS = {"id", "name", "description", "enabled", "routes_prefix"}

# Keys satisfied by app surfaces that aren't Flask-blueprint agents (so they
# can never appear in a manifest's "provides") - user_profile comes from the
# Settings page, not an agent. Without this, every agent that consumes it
# trips the "no enabled agent provides it" warning on every boot, forever.
_EXTERNAL_PROVIDERS = {"user_profile"}


def _load_manifests() -> None:
    """Read every agents/<name>/manifest.json and populate _registry."""
    _registry.clear()
    for agent_dir in sorted(AGENTS_DIR.iterdir()):
        if not agent_dir.is_dir():
            continue
        manifest_path = agent_dir / "manifest.json"
        if not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text())
        except json.JSONDecodeError as exc:
            print(f"[registry] Bad manifest JSON at {manifest_path}: {exc}")
            continue
        missing = _REQUIRED_MANIFEST_KEYS - manifest.keys()
        if missing:
            print(f"[registry] Manifest {manifest_path} missing keys: {missing}")
            continue
        _registry[manifest["id"]] = manifest


def _validate_dependencies() -> None:
    """
    Warn if any enabled agent declares a 'consumes' key that no other
    enabled agent 'provides'.  Logs a warning (not an error) so a missing
    dependency never prevents startup — it just surfaces clearly in logs.
    """
    provided_keys: set[str] = set(_EXTERNAL_PROVIDERS)
    for manifest in _registry.values():
        if manifest.get("enabled"):
            provided_keys.update(manifest.get("provides", {}).keys())

    for agent_id, manifest in _registry.items():
        if not manifest.get("enabled"):
            continue
        for needed in manifest.get("consumes", []):
            if needed not in provided_keys:
                print(
                    f"[registry] WARNING: agent '{agent_id}' consumes '{needed}' "
                    f"but no enabled agent provides it."
                )


def register_agents(app: Flask) -> None:
    """Import and register Blueprints for all enabled agents."""
    _load_manifests()
    _validate_dependencies()
    registered = []
    for agent_id, manifest in _registry.items():
        if not manifest.get("enabled", False):
            continue
        dir_name = agent_dir_for(agent_id)
        module_name = f"agents.{dir_name}.routes"
        try:
            module = importlib.import_module(module_name)
            # Blueprint variable name can be <dir>_bp or any Blueprint instance
            bp = None
            for attr_name in dir(module):
                obj = getattr(module, attr_name)
                from flask import Blueprint as _BP
                if isinstance(obj, _BP) and obj.name != "agent_registry":
                    bp = obj
                    break
            if bp is None:
                raise AttributeError(f"No Blueprint found in {module_name}")
            app.register_blueprint(bp)
            registered.append(agent_id)
        except (ImportError, AttributeError) as exc:
            app.logger.warning("[registry] Could not load agent %s: %s", agent_id, exc)

    app.register_blueprint(registry_bp)
    app.logger.info("[registry] Registered agents: %s", registered)


def agent_dir_for(agent_id: str) -> str:
    """Convert agent id to the directory/module name (hyphens → underscores)."""
    return agent_id.replace("-", "_")


# ── Registry API endpoints ────────────────────────────────────────────────────

@registry_bp.get("/")
@require_auth
def list_agents():
    """Return all agents with their current enabled status."""
    return jsonify(list(_registry.values()))


@registry_bp.get("/context-graph")
@require_auth
def context_graph():
    """
    Return the provides/consumes dependency graph across all enabled agents.
    Useful for debugging and for a future visual dependency map in the frontend.
    """
    nodes = []
    edges = []
    for manifest in _registry.values():
        if not manifest.get("enabled"):
            continue
        agent_id = manifest["id"]
        nodes.append({
            "id": agent_id,
            "name": manifest["name"],
            "provides": list(manifest.get("provides", {}).keys()),
            "consumes": manifest.get("consumes", []),
        })
        for key in manifest.get("consumes", []):
            # Find the agent that provides this key
            for other in _registry.values():
                if other.get("enabled") and key in other.get("provides", {}):
                    edges.append({
                        "from": other["id"],
                        "to": agent_id,
                        "context_key": key,
                    })
                    break
            else:
                edges.append({
                    "from": None,
                    "to": agent_id,
                    "context_key": key,
                    "warning": "no provider found",
                })
    return jsonify({"nodes": nodes, "edges": edges})


@registry_bp.get("/<agent_id>/health")
@require_auth
def agent_health(agent_id: str):
    manifest = _registry.get(agent_id)
    if not manifest:
        return jsonify({"error": "agent not found"}), 404
    return jsonify({"id": agent_id, "enabled": manifest.get("enabled"), "status": "ok"})


@registry_bp.get("/<agent_id>/dependencies")
@require_auth
def agent_dependencies(agent_id: str):
    """Check dependency status for an agent."""
    from core.dependency_validator import get_dependency_status

    manifest = _registry.get(agent_id)
    if not manifest:
        return jsonify({"error": "agent not found"}), 404

    status = get_dependency_status(agent_id, g.user_id)
    return jsonify(status)


@registry_bp.patch("/<agent_id>")
@require_auth
def toggle_agent(agent_id: str):
    """Toggle an agent's enabled flag at runtime and persist to manifest.json.

    NOTE: requires a valid session but does not yet check for an admin
    role (no such role is modeled in the User model today) - any logged-in
    user can currently toggle agents platform-wide. Flagged for follow-up.
    """
    manifest = _registry.get(agent_id)
    if not manifest:
        return jsonify({"error": "agent not found"}), 404
    data = request.get_json(force=True, silent=True) or {}
    if "enabled" in data:
        manifest["enabled"] = bool(data["enabled"])
        # Persist to disk so the change survives a restart
        manifest_path = AGENTS_DIR / agent_dir_for(agent_id) / "manifest.json"
        try:
            manifest_path.write_text(
                __import__("json").dumps(manifest, indent=2)
            )
        except OSError as exc:
            return jsonify({"warning": f"In-memory toggle OK but disk write failed: {exc}", **manifest}), 200
    return jsonify(manifest)
