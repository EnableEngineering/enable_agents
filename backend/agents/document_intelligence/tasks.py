"""
Document Intelligence Agent — Celery tasks.

Background processing tasks for document analysis.
"""

import logging

from core.celery_app import celery, get_flask_app

logger = logging.getLogger(__name__)


@celery.task(bind=True, max_retries=3, default_retry_delay=60)
def process_document_task(self, document_id: str):
    """
    Process a document asynchronously.

    Stages:
    1. Extract text
    2. Chunk content
    3. Generate embeddings
    4. Extract entities

    Sends SSE notifications for progress updates.
    """
    from flask import current_app
    from agents.document_intelligence.service import DocumentService
    from agents.document_intelligence.notifications import send_document_notification

    logger.info(f"Processing document: {document_id}")

    try:
        # Get Flask app context for database access
        app = get_flask_app()

        with app.app_context():
            service = DocumentService()

            # Get document for user_id
            from agents.document_intelligence.models import ProcessedDocument

            doc = ProcessedDocument.query.get(document_id)
            if not doc:
                logger.error(f"Document not found: {document_id}")
                return {"error": "Document not found"}

            user_id = doc.uploaded_by

            # Send start notification
            send_document_notification(
                user_id=user_id,
                document_id=document_id,
                stage="started",
                progress=0.0,
                message="Processing started",
            )

            # Process document
            result = service.process_document(document_id)

            # Send completion notification
            send_document_notification(
                user_id=user_id,
                document_id=document_id,
                stage="completed",
                progress=1.0,
                message=f"Processing complete: {result['chunk_count']} chunks, {result['entity_count']} entities",
            )

            logger.info(f"Document processed: {document_id}")
            return result

    except Exception as e:
        logger.exception(f"Document processing failed: {document_id}")

        # Send error notification
        try:
            app = get_flask_app()
            with app.app_context():
                from agents.document_intelligence.models import ProcessedDocument

                doc = ProcessedDocument.query.get(document_id)
                if doc:
                    send_document_notification(
                        user_id=doc.uploaded_by,
                        document_id=document_id,
                        stage="failed",
                        progress=0.0,
                        message=f"Processing failed: {str(e)}",
                    )
        except Exception:
            pass

        # Retry on transient errors
        raise self.retry(exc=e)


@celery.task
def reprocess_document_task(document_id: str):
    """
    Reprocess a document (delete existing chunks and re-extract).
    """
    app = get_flask_app()
    with app.app_context():
        from core.vector_store import VectorStore
        from core.database import db
        from agents.document_intelligence.models import ProcessedDocument, DocumentEntity

        doc = ProcessedDocument.query.get(document_id)
        if not doc:
            return {"error": "Document not found"}

        # Delete existing chunks and entities
        vector_store = VectorStore()
        vector_store.delete_document_chunks(document_id)
        try:
            from agents.document_intelligence.retrieval import invalidate_retrieval_cache
            invalidate_retrieval_cache(document_id)
        except Exception:
            pass

        DocumentEntity.query.filter_by(document_id=document_id).delete()
        db.session.commit()

        # Reset status
        doc.status = "pending"
        doc.chunk_count = 0
        doc.entity_count = 0
        doc.processing_progress = 0
        db.session.commit()

        # Trigger reprocessing
        process_document_task.delay(document_id)

        return {"status": "reprocessing", "document_id": document_id}


@celery.task
def batch_process_documents_task(document_ids: list):
    """
    Process multiple documents in sequence.
    """
    results = []
    for doc_id in document_ids:
        try:
            result = process_document_task.delay(doc_id)
            results.append({"document_id": doc_id, "task_id": result.id})
        except Exception as e:
            results.append({"document_id": doc_id, "error": str(e)})

    return results
