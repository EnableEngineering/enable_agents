"""Workflow Orchestration — Celery tasks.

Runs the Supplier Qualification Pipeline's LangGraph graph asynchronously,
the same get_flask_app()/app.app_context() pattern already proven by
agents/document_intelligence/tasks.py. Registered in both task import
lists in core/celery_app.py.
"""
import logging

from langgraph.types import Command

from core.celery_app import celery, get_flask_app

logger = logging.getLogger(__name__)


def _run(instance_id: str, resume_value=None):
    # Celery's prefork pool forks worker children from a master process
    # whose sys.path was resolved from the `celery` console-script's own
    # location (e.g. /usr/local/bin), not the backend directory - cwd/`/app`
    # is never on it. Modules eagerly imported by the master before fork
    # (agents.workflow_orchestration.tasks itself, core.*, via celery_app's
    # `imports=[...]`) are inherited fine via copy-on-write, but anything
    # imported for the first time *inside* a task - models.workflow here,
    # and every node's lazily-imported agents.*/app service in graph.py -
    # has to resolve fresh against the child's impoverished sys.path and
    # fails with ModuleNotFoundError. Confirmed 2026-09-14 restoring this:
    # every one of those lazy imports failed the same way until sys.path
    # got the backend directory back. Fixing it once here (before either
    # import below) covers this call and every later lazy import in the
    # same worker process, since sys.path is a persistent list on the
    # `sys` module, not reset per task.
    import os
    import sys
    _backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if _backend_dir not in sys.path:
        sys.path.insert(0, _backend_dir)

    from models.workflow import WorkflowInstance
    from .graph import get_compiled_graph

    app = get_flask_app()
    with app.app_context():
        instance = WorkflowInstance.query.filter_by(instance_id=instance_id).first()
        if not instance:
            logger.error(f"Workflow instance not found: {instance_id}")
            return {"error": "Instance not found"}

        graph = get_compiled_graph()
        config = {"configurable": {"thread_id": instance_id}}

        if resume_value is not None:
            graph_input = Command(resume=resume_value)
        else:
            graph_input = {
                "instance_id": instance_id,
                "user_id": instance.user_id,
                "project_id": instance.project_id,
                "current_stage_id": "",
                "initial_inputs": instance.context or {},
                "stage_outputs": {},
                "autonomy_mode": instance.autonomy_mode or "co-pilot",
                "errors": [],
            }
            instance.status = "running"
            if not instance.started_at:
                from datetime import datetime
                instance.started_at = datetime.utcnow()
            from core.database import db
            db.session.commit()

        result = graph.invoke(graph_input, config=config)

        if "__interrupt__" not in result and instance.status != "completed":
            instance.status = "completed"
            from datetime import datetime
            from core.database import db
            instance.completed_at = datetime.utcnow()
            db.session.commit()

        return {
            "instance_id": instance_id,
            "interrupted": "__interrupt__" in result,
            "errors": result.get("errors", []),
        }


@celery.task(bind=True, max_retries=2, default_retry_delay=30)
def run_workflow_graph(self, instance_id: str):
    """Start (or continue from the top of) a workflow instance's graph run."""
    try:
        return _run(instance_id)
    except Exception as e:
        logger.exception(f"Workflow graph run failed: {instance_id}")
        raise self.retry(exc=e)


@celery.task(bind=True, max_retries=2, default_retry_delay=30)
def resume_workflow_graph(self, instance_id: str, resume_value: dict):
    """Resume a workflow instance paused on interrupt() with a human
    decision: {"action": "approve"|"edit"|"skip", "data": {...}}."""
    try:
        return _run(instance_id, resume_value=resume_value)
    except Exception as e:
        logger.exception(f"Workflow graph resume failed: {instance_id}")
        raise self.retry(exc=e)
