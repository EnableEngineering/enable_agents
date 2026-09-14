"""Supply Chain Audit Agent — service layer."""
from datetime import datetime
from uuid import uuid4

from flask import g, jsonify, request

from core.auth import user_can_access_project
from core.database import db
from .models import SCSupplier


def list_suppliers():
    project_id = request.args.get("project_id")
    if not project_id:
        return jsonify({"success": False, "error": "project_id is required"}), 400
    if not user_can_access_project(g.user_id, project_id):
        return jsonify({"success": False, "error": "Project not found"}), 404

    suppliers = SCSupplier.query.filter_by(project_id=project_id).order_by(SCSupplier.created_at.desc()).all()
    return jsonify({"success": True, "suppliers": [s.to_dict() for s in suppliers]}), 200


def create_supplier():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    project_id = data.get("project_id")

    if not name:
        return jsonify({"success": False, "error": "Supplier name is required"}), 400
    if not project_id:
        return jsonify({"success": False, "error": "project_id is required"}), 400
    if not user_can_access_project(g.user_id, project_id):
        return jsonify({"success": False, "error": "Project not found"}), 404

    supplier = SCSupplier(
        supplier_id=str(uuid4()),
        project_id=project_id,
        user_id=g.user_id,
        name=name,
        location=data.get("location"),
        capacity=data.get("capacity"),
        audit_status="pending",
    )
    supplier.certifications = data.get("certifications") or []
    supplier.capabilities = data.get("capabilities") or []
    db.session.add(supplier)
    db.session.commit()
    return jsonify({"success": True, "supplier": supplier.to_dict()}), 201


def submit_audit_core(supplier_id, score, user_id):
    """Plain-argument core of submit_audit - callable from a LangGraph node
    (or anywhere else outside a Flask request) with no request/g dependency.
    Returns (supplier_dict_or_None, error_message_or_None, http_status).
    """
    supplier = SCSupplier.query.get(supplier_id)
    if not supplier or not user_can_access_project(user_id, supplier.project_id):
        return None, "Supplier not found", 404

    if score is None:
        return None, "score is required", 400

    supplier.score = score
    supplier.audit_status = "passed" if score >= 70 else "failed"
    supplier.audit_date = datetime.utcnow().strftime("%Y-%m-%d")
    db.session.commit()
    return supplier.to_dict(), None, 200


def submit_audit(supplier_id):
    data = request.get_json(silent=True) or {}
    result, error, status = submit_audit_core(supplier_id, data.get("score"), g.user_id)
    if error:
        return jsonify({"success": False, "error": error}), status
    return jsonify({"success": True, "supplier": result}), status
