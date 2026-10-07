"""Canonical Flask routes for the Content Marketing agent."""
from flask import Blueprint

from core.auth import require_auth
from . import service

content_marketing_bp = Blueprint(
    "content_marketing",
    __name__,
    url_prefix="/api/content-marketing",
)


@content_marketing_bp.post("/projects")
@require_auth
def create_content_marketing_project():
    return service.create_project()


@content_marketing_bp.get("/projects/<project_id>")
@require_auth
def get_content_marketing_project(project_id: str):
    return service.get_project(project_id)


@content_marketing_bp.post("/documents/upload")
@require_auth
def upload_content_marketing_documents():
    return service.upload_documents()


@content_marketing_bp.get("/documents/<project_id>")
@require_auth
def list_content_marketing_documents(project_id: str):
    return service.list_documents(project_id)


@content_marketing_bp.delete("/documents/item/<doc_id>")
@require_auth
def delete_content_marketing_document(doc_id: str):
    return service.delete_document(doc_id)


@content_marketing_bp.post("/generate-content")
@require_auth
def generate_content_marketing():
    return service.generate_content()


@content_marketing_bp.post("/chat")
@require_auth
def content_marketing_chat():
    return service.chat()


@content_marketing_bp.get("/knowledge-graph/<project_id>")
@require_auth
def get_content_marketing_knowledge_graph(project_id: str):
    return service.get_knowledge_graph(project_id)
