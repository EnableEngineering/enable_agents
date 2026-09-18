"""Integration tests — /health (defined in app.py, so via the monolith app)."""


def test_health_returns_200(monolith_anon_client):
    res = monolith_anon_client.get("/health")
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "healthy"
    assert "timestamp" in data


def test_health_needs_no_auth(monolith_anon_client):
    """Docker/load-balancer probes carry no session token."""
    assert monolith_anon_client.get("/health").status_code == 200
