"""
Content Marketing Agent — service layer.

Uses SQLAlchemy models for all DB operations.
All SQLite code has been migrated to PostgreSQL.
"""
from datetime import datetime
from uuid import uuid4
import json
import os

from flask import g, jsonify, request, current_app
from werkzeug.utils import secure_filename

from core.auth import user_can_access_project
from core.database import db
from .models import CMProject, CMDocument, CMKnowledgeGraph, CMGeneratedContent, CMConversation


def _owned_cm_project_or_none(project_id: str):
    """A CMProject only counts as accessible if it belongs to the caller -
    otherwise any authenticated user could pass another user's project_id
    and read/generate/chat against their documents."""
    if not project_id:
        return None
    project = CMProject.query.filter_by(project_id=project_id).first()
    if not project or project.user_id != g.user_id:
        return None
    return project


# =============================================================================
# Project Operations
# =============================================================================

def create_project():
    """Create a new content marketing project.

    If a `platform_project_id` is supplied (the platform-wide Project the
    user picked via the header ProjectSelector), this is idempotent: the
    content-marketing project is derived deterministically from it, so
    repeated calls (e.g. on every page load) reuse the same CMProject
    instead of piling up duplicates.
    """
    data = request.get_json(silent=True) or {}

    user_id = g.user_id
    project_name = data.get('project_name', 'Untitled Project')
    platform_project_id = data.get('platform_project_id')

    if platform_project_id and not user_can_access_project(user_id, platform_project_id):
        return jsonify({"success": False, "error": "Project not found"}), 404

    if platform_project_id:
        derived_id = f"cmp_{platform_project_id.replace('-', '')[:28]}"
        existing = CMProject.query.filter_by(project_id=derived_id).first()
        if existing:
            if existing.user_id != user_id:
                return jsonify({"success": False, "error": "Project not found"}), 404
            return jsonify({
                "success": True,
                "project_id": existing.project_id,
                "message": "Existing project reused",
            }), 200
        new_project_id = derived_id
    else:
        new_project_id = f"project_{uuid4().hex[:12]}"

    project = CMProject(
        project_id=new_project_id,
        user_id=user_id,
        platform_project_id=platform_project_id,
        project_name=project_name,
        description=data.get("description"),
        industry=data.get("industry"),
        sector=data.get("sector"),
        function=data.get("function"),
        role=data.get("role"),
    )
    db.session.add(project)
    try:
        db.session.commit()
    except Exception:
        # Two near-simultaneous requests (e.g. React effects firing twice)
        # can both pass the "existing" check above before either commits -
        # fall back to the row the other request just created instead of 500ing.
        db.session.rollback()
        existing = CMProject.query.filter_by(project_id=new_project_id).first()
        if existing:
            return jsonify({
                "success": True,
                "project_id": existing.project_id,
                "message": "Existing project reused",
            }), 200
        raise

    # Store in context lake
    try:
        from core.context import ContextStore
        ContextStore().set(
            user_id,
            "content_marketing",
            f"project:{project.project_id}",
            {
                "project_id": project.project_id,
                "project_name": project.project_name,
                "industry": project.industry,
                "updated_at": datetime.utcnow().isoformat(),
            },
        )
    except Exception:
        pass

    return jsonify({
        "success": True,
        "project_id": project.project_id,
        "message": f'Project "{project_name}" created successfully'
    }), 201


def get_project(project_id: str):
    """Get project details with statistics."""
    project = _owned_cm_project_or_none(project_id)
    if not project:
        return jsonify({"success": False, "error": "Project not found"}), 404

    doc_count = CMDocument.query.filter_by(project_id=project_id).count()
    kg = CMKnowledgeGraph.query.filter_by(project_id=project_id).first()

    return jsonify({
        "success": True,
        "project": project.to_dict(),
        "statistics": {
            "documents": doc_count,
            "has_knowledge_graph": kg is not None
        }
    })


# =============================================================================
# Document Operations
# =============================================================================

def upload_documents(analyzer=None, upload_folder=None):
    """
    Upload documents to project.
    Extracts text and creates initial knowledge graph.

    Args:
        analyzer: DomainSpecializationAnalyzer instance (passed from app.py)
        upload_folder: Path to upload folder (passed from app.py)
    """
    project_id = request.form.get('project_id')
    if not project_id:
        return jsonify({'success': False, 'error': 'project_id required'}), 400

    uploaded_files = request.files.getlist('files')
    if not uploaded_files:
        return jsonify({'success': False, 'error': 'No files provided'}), 400

    # Verify project exists and belongs to the caller
    project = _owned_cm_project_or_none(project_id)
    if not project:
        return jsonify({'success': False, 'error': 'Project not found'}), 404

    extracted_documents = []
    doc_ids = []

    for file in uploaded_files:
        if not file.filename:
            continue

        filename = secure_filename(file.filename)
        file_type = filename.split('.')[-1].lower()

        # Save file
        file_path = os.path.join(upload_folder, project_id, filename)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        file.save(file_path)

        # Extract content
        extracted_content = ""
        if analyzer:
            try:
                extracted_content = analyzer.extract_text(file_path)
            except Exception:
                pass

        # Create document record
        doc_id = f"doc_{uuid4().hex[:12]}"
        doc = CMDocument(
            doc_id=doc_id,
            project_id=project_id,
            file_name=filename,
            file_type=file_type,
            file_path=file_path,
            file_size=os.path.getsize(file_path),
            document_type=file_type,
            extracted_content=extracted_content
        )
        db.session.add(doc)
        doc_ids.append(doc_id)
        extracted_documents.append({
            'doc_id': doc_id,
            'file_name': filename,
            'content_preview': extracted_content[:500] if extracted_content else ''
        })

    db.session.commit()

    # Build knowledge graph if we have documents
    if extracted_documents and analyzer:
        try:
            all_content = "\n\n".join([d.get('content_preview', '') for d in extracted_documents])
            kg_data = analyzer.build_knowledge_graph(all_content) if hasattr(analyzer, 'build_knowledge_graph') else {}

            kg = CMKnowledgeGraph(
                kg_id=f"kg_{uuid4().hex[:12]}",
                project_id=project_id,
            )
            kg.kg_data = kg_data
            kg.entities = len(kg_data.get('entities', []))
            kg.relationships = len(kg_data.get('relationships', []))
            db.session.add(kg)
            db.session.commit()
        except Exception:
            pass

    return jsonify({
        'success': True,
        'uploaded_count': len(doc_ids),
        'documents': extracted_documents
    })


def list_documents(project_id: str):
    """List all documents in a project."""
    if not _owned_cm_project_or_none(project_id):
        return jsonify({"success": False, "error": "Project not found"}), 404
    docs = CMDocument.query.filter_by(project_id=project_id).all()
    return jsonify({
        "success": True,
        "documents": [d.to_dict() for d in docs]
    })


# =============================================================================
# Knowledge Graph
# =============================================================================

def get_knowledge_graph(project_id: str):
    """Retrieve knowledge graph for visualization."""
    if not _owned_cm_project_or_none(project_id):
        return jsonify({"success": False, "error": "Knowledge graph not found"}), 404
    kg = CMKnowledgeGraph.query.filter_by(project_id=project_id).first()
    if not kg:
        return jsonify({"success": False, "error": "Knowledge graph not found"}), 404

    return jsonify({
        "success": True,
        "kg_id": kg.kg_id,
        "kg_data": kg.kg_data,
        "entities": kg.entities,
        "relationships": kg.relationships,
        "created_at": kg.created_at.isoformat() if kg.created_at else None
    })


# =============================================================================
# Plain-argument core (LangGraph orchestration)
# =============================================================================

_CHANNEL_CONFIG = {
    'linkedin': {'tone': 'professional', 'max_length': 3000},
    'email': {'tone': 'persuasive', 'max_length': 500},
    'social': {'tone': 'casual', 'max_length': 280},
    'google_ads': {'tone': 'direct', 'max_length': 150},
}


def generate_content_core(channel, content_type, user_context, user_id,
                           industry="General", doc_texts=None, cm_project_id=None,
                           source_doc_ids=None):
    """Plain-argument core of app.py's generate_content_marketing - callable
    from a LangGraph node (or anywhere else outside a Flask request) with no
    request/g dependency.

    Unlike the interactive route (which hard-requires an existing CMProject
    with uploaded CMDocuments), `doc_texts` is optional here - a workflow
    node has no human-uploaded documents to draw on, so this degrades to
    generating from `user_context`/`industry` alone. `cm_project_id` is also
    optional: CMGeneratedContent.project_id is a NOT NULL foreign key to
    cm_projects, so a generated-content row is only persisted when a real
    CMProject id is given; otherwise the content is returned but not saved
    anywhere, the same way graph.py's document_analysis_node returns its RAG
    answer without creating a permanent record.

    Returns (result_dict_or_None, error_message_or_None).
    """
    doc_texts = doc_texts or []
    config = _CHANNEL_CONFIG.get(channel, _CHANNEL_CONFIG['linkedin'])

    from core.settings import get_response_language_instruction
    prompt = f"""Generate marketing content for {channel} channel.
Industry: {industry or 'General'}
Tone: {config['tone']}
Max Length: {config['max_length']} characters
Content Type: {content_type}
User Context: {user_context}
Documents Summary: {' '.join([doc[:200] for doc in doc_texts[:3]])}

Language level: {get_response_language_instruction(user_id)}

Generate compelling marketing {content_type} content."""

    try:
        from core.ai_client import get_langchain_llm, log_langchain_usage

        ai_project_id = None
        if cm_project_id:
            project = CMProject.query.filter_by(project_id=cm_project_id).first()
            ai_project_id = project.platform_project_id if project else None

        llm, key_source, resolved_model = get_langchain_llm(user_id, ai_project_id, model="gpt-4", temperature=0.7)
        result = llm.invoke(prompt)
        log_langchain_usage(result, user_id, ai_project_id, "content_marketing.generate_content", resolved_model, key_source)
        response = result.content

        content_id = f"content_{uuid4().hex[:12]}"
        if cm_project_id and CMProject.query.filter_by(project_id=cm_project_id).first():
            content = CMGeneratedContent(
                content_id=content_id,
                project_id=cm_project_id,
                channel=channel,
                content_type=content_type,
                content=response,
            )
            content.source_docs = source_doc_ids or []
            content.domain_context = {"industry": industry, "prompt": user_context}
            db.session.add(content)
            db.session.commit()

        return {
            "content_id": content_id,
            "channel": channel,
            "content_type": content_type,
            "content": response,
            "variations": [response],
            "metadata": config,
        }, None
    except Exception as e:
        db.session.rollback()
        return None, str(e)
