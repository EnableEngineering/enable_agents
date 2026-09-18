"""
Agent Dependency Validator.

Reports whether an agent's required context data exists (per user, and per
project for scope:"project" dependencies) - see get_dependency_status and
the /api/dependencies routes. (A require_dependencies route decorator that
trusted an X-User-Id header for identity used to live here; nothing used it
and it was deleted rather than left as a spoofable-auth footgun.)
"""

import json
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from core.context import ContextStore

CONFIG_PATH = Path(__file__).parent.parent / "config" / "agent-dependencies.json"


def scoped_key(dep_key: str, project_id: Optional[str]) -> str:
    """ContextStore key for a dependency. ContextStore rows are identified
    by (user_id, agent_id, key) only, so project scope has to live in the
    key itself: "company_profile@<project_id>" for one project's copy,
    plain "company_profile" for the user-level "latest" copy. Writers and
    the validator both go through here so the format lives in one place."""
    return f"{dep_key}@{project_id}" if project_id else dep_key


class DependencyValidator:
    """Validates agent dependencies against available context data."""

    def __init__(self):
        self._config: Optional[Dict[str, Any]] = None
        self._loaded = False

    @property
    def config(self) -> Dict[str, Any]:
        if not self._loaded:
            self._load_config()
        return self._config or {}

    def _load_config(self):
        """Load dependency configuration from JSON file."""
        try:
            if CONFIG_PATH.exists():
                self._config = json.loads(CONFIG_PATH.read_text())
            else:
                self._config = {"dependencies": {}, "enforcement": {"mode": "warn"}}
        except Exception as e:
            print(f"[dependency_validator] Error loading config: {e}")
            self._config = {"dependencies": {}, "enforcement": {"mode": "warn"}}
        self._loaded = True

    def reload_config(self):
        """Force reload of configuration."""
        self._loaded = False
        self._load_config()

    def get_agent_requirements(self, agent_id: str) -> List[str]:
        """Get list of dependency keys required by an agent."""
        deps = self.config.get("dependencies", {})
        requirements = []
        for dep_key, dep_info in deps.items():
            if agent_id in dep_info.get("required_by", []):
                requirements.append(dep_key)
        return requirements

    def get_providers(self, dep_key: str) -> List[str]:
        """Get list of agents that provide a dependency."""
        deps = self.config.get("dependencies", {})
        dep_info = deps.get(dep_key, {})
        return dep_info.get("provided_by", [])

    def check_dependencies(
        self, agent_id: str, user_id: str, project_id: Optional[str] = None
    ) -> Tuple[bool, List[Dict[str, Any]]]:
        """
        Check if all dependencies for an agent are satisfied.

        Returns:
            Tuple of (all_satisfied: bool, missing: List[{key, description, providers}])
        """
        requirements = self.get_agent_requirements(agent_id)
        if not requirements:
            return True, []

        missing = []
        context_store = ContextStore()
        deps = self.config.get("dependencies", {})

        for dep_key in requirements:
            # Check if data exists in context store - try each agent that's
            # configured to provide this key (ContextStore rows are keyed by
            # the actual agent_id that wrote them, there's no real wildcard).
            dep_info = deps.get(dep_key, {})
            providers = dep_info.get("provided_by") or []
            # A "scope": "project" dependency is only satisfied by *this*
            # project's copy - research done for project A must not clear
            # project B's prerequisite banner. With no project selected
            # there's nothing to scope by, so it falls back to the
            # user-level "latest" copy.
            lookup_key = scoped_key(dep_key, project_id if dep_info.get("scope") == "project" else None)
            value = None
            for provider in providers:
                value = context_store.get(user_id, provider, lookup_key)
                if value:
                    break
            if not value:
                missing.append({
                    "key": dep_key,
                    "description": dep_info.get("description", ""),
                    "providers": dep_info.get("provided_by", []),
                    "fallback_provider": dep_info.get("fallback_provider"),
                })

        return len(missing) == 0, missing

    def get_enforcement_mode(self) -> str:
        """Get current enforcement mode: 'warn', 'strict', or 'off'."""
        return self.config.get("enforcement", {}).get("mode", "warn")

    def is_strict_for_agent(self, agent_id: str) -> bool:
        """Check if strict enforcement applies to a specific agent."""
        enforcement = self.config.get("enforcement", {})
        if enforcement.get("mode") == "strict":
            return True
        return agent_id in enforcement.get("strict_agents", [])


# Global validator instance
validator = DependencyValidator()


def get_dependency_status(agent_id: str, user_id: str, project_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Get full dependency status for an agent.

    Returns dict with:
        - requirements: List of required dependency keys
        - satisfied: List of satisfied dependencies
        - missing: List of missing dependencies with details
        - ready: Boolean if agent can run
    """
    requirements = validator.get_agent_requirements(agent_id)
    satisfied, missing = validator.check_dependencies(agent_id, user_id, project_id)

    satisfied_keys = [r for r in requirements if r not in [m["key"] for m in missing]]

    return {
        "agent_id": agent_id,
        "project_id": project_id,
        "requirements": requirements,
        "satisfied": satisfied_keys,
        "missing": missing,
        "ready": satisfied,
        "enforcement_mode": validator.get_enforcement_mode(),
    }
