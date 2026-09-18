"""Integration tests — Content Marketing agent (routes live in app.py, so these
go through the monolith app - the blueprint is intentionally empty)."""
import pytest


@pytest.fixture
def project_id(monolith_client):
    res = monolith_client.post("/api/content-marketing/projects", json={
        "user_id": "user_1",
        "project_name": "Test Project",
        "industry": "Technology",
    })
    assert res.status_code == 201
    return res.get_json()["project_id"]


def test_create_project_success(monolith_client):
    res = monolith_client.post("/api/content-marketing/projects", json={
        "user_id": "user_1",
        "project_name": "My Project",
    })
    assert res.status_code == 201
    assert "project_id" in res.get_json()


def test_create_project_defaults_the_name_when_none_given(monolith_client):
    """No field is required: create_project() deliberately falls back to
    "Untitled Project" (the frontend derives projects from the platform
    project, not from a form), so an empty body is a valid create."""
    res = monolith_client.post("/api/content-marketing/projects", json={})
    assert res.status_code == 201
    project_id = res.get_json()["project_id"]

    got = monolith_client.get(f"/api/content-marketing/projects/{project_id}")
    assert got.get_json()["project"]["project_name"] == "Untitled Project"


def test_projects_require_a_session(monolith_anon_client):
    res = monolith_anon_client.post("/api/content-marketing/projects", json={"project_name": "x"})
    assert res.status_code == 401


def test_get_project(monolith_client, project_id):
    res = monolith_client.get(f"/api/content-marketing/projects/{project_id}")
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True
    assert data["project"]["project_id"] == project_id


def test_get_project_not_found(monolith_client):
    res = monolith_client.get("/api/content-marketing/projects/nonexistent-id")
    assert res.status_code == 404


def test_list_documents_empty(monolith_client, project_id):
    res = monolith_client.get(f"/api/content-marketing/documents/{project_id}")
    assert res.status_code == 200
    assert res.get_json()["documents"] == []
