"""Integration tests - company_profile is a scope:"project" dependency
(config/agent-dependencies.json): research recorded for one project must
not satisfy another project's prerequisites, while a check with no project
selected still reads the user-level "latest" copy.
"""
import pytest

from core.context import ContextStore
from core.dependency_validator import get_dependency_status, scoped_key

USER = "scope-test@example.com"


@pytest.fixture
def store(flask_app):
    with flask_app.app_context():
        s = ContextStore()
        yield s
        s.clear(USER)


def _missing_keys(status):
    return {m["key"] for m in status["missing"]}


def test_scoped_key_format():
    assert scoped_key("company_profile", None) == "company_profile"
    assert scoped_key("company_profile", "proj-a") == "company_profile@proj-a"


def test_project_copy_only_satisfies_its_own_project(store):
    store.set(USER, "market_research", scoped_key("company_profile", "proj-a"), {"overview": "A research"})

    for_a = get_dependency_status("executive_assistant", USER, "proj-a")
    for_b = get_dependency_status("executive_assistant", USER, "proj-b")

    assert "company_profile" in for_a["satisfied"]
    assert "company_profile" in _missing_keys(for_b)
    assert "company_profile" not in for_b["satisfied"]


def test_no_project_reads_the_user_level_latest_copy(store):
    assert "company_profile" in _missing_keys(get_dependency_status("executive_assistant", USER, None))

    store.set(USER, "market_research", scoped_key("company_profile", None), {"overview": "latest"})
    assert "company_profile" in get_dependency_status("executive_assistant", USER, None)["satisfied"]
    # ...but that user-level copy does not leak into a specific project's check
    assert "company_profile" in _missing_keys(get_dependency_status("executive_assistant", USER, "proj-a"))


def test_user_scoped_dependencies_ignore_the_project(store):
    """user_profile (Settings) is per-user: it satisfies every project."""
    store.set(USER, "settings", "user_profile", {"industry": "Manufacturing"})
    for project in (None, "proj-a", "proj-b"):
        assert "user_profile" in get_dependency_status("executive_assistant", USER, project)["satisfied"]
