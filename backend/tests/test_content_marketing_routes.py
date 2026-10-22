import ast
from pathlib import Path

from flask import Flask

from agents.content_marketing.routes import content_marketing_bp


def test_content_marketing_routes_are_registered_once_to_live_handlers():
    expected_routes = {
        ("/api/content-marketing/projects", "POST"): "content_marketing.create_content_marketing_project",
        ("/api/content-marketing/projects/<project_id>", "GET"): "content_marketing.get_content_marketing_project",
        ("/api/content-marketing/documents/upload", "POST"): "content_marketing.upload_content_marketing_documents",
        ("/api/content-marketing/documents/<project_id>", "GET"): "content_marketing.list_content_marketing_documents",
        ("/api/content-marketing/documents/item/<doc_id>", "DELETE"): "content_marketing.delete_content_marketing_document",
        ("/api/content-marketing/generate-content", "POST"): "content_marketing.generate_content_marketing",
        ("/api/content-marketing/chat", "POST"): "content_marketing.content_marketing_chat",
        ("/api/content-marketing/knowledge-graph/<project_id>", "GET"): "content_marketing.get_content_marketing_knowledge_graph",
    }

    app = Flask(__name__)
    app.register_blueprint(content_marketing_bp)

    for (path, method), expected_endpoint in expected_routes.items():
        matching_rules = [
            rule
            for rule in app.url_map.iter_rules()
            if rule.rule == path and method in rule.methods
        ]

        assert len(matching_rules) == 1, f"Expected one registered rule for {method} {path}"
        assert matching_rules[0].endpoint == expected_endpoint

    app_source = Path(__file__).parents[1].joinpath("app.py").read_text(encoding="utf-8-sig")
    app_tree = ast.parse(app_source)
    duplicate_routes = []
    for node in ast.walk(app_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call) or not decorator.args:
                continue
            if not isinstance(decorator.func, ast.Attribute) or decorator.func.attr != "route":
                continue
            route_path = decorator.args[0]
            if isinstance(route_path, ast.Constant) and str(route_path.value).startswith(
                "/api/content-marketing"
            ):
                duplicate_routes.append(route_path.value)

    assert not duplicate_routes, f"Duplicate Content Marketing routes remain in app.py: {duplicate_routes}"