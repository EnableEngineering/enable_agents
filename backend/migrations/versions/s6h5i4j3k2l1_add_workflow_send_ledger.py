"""Add workflow_send_ledger - durable at-most-once record of workflow email sends.

Revision ID: s6h5i4j3k2l1
Revises: r5g4h3i2j1k0
Create Date: 2026-09-18
"""

from alembic import op
import sqlalchemy as sa

revision = 's6h5i4j3k2l1'
down_revision = 'r5g4h3i2j1k0'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "workflow_send_ledger" in insp.get_table_names():
        return

    op.create_table(
        "workflow_send_ledger",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("instance_id", sa.String(36), nullable=False),
        sa.Column("stage_id", sa.String(100), nullable=False),
        sa.Column("content_hash", sa.String(16), nullable=False),
        sa.Column("recipient_email", sa.String(320), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("instance_id", "stage_id", "content_hash", "recipient_email",
                            name="uq_workflow_send_ledger_recipient"),
    )
    op.create_index("ix_workflow_send_ledger_instance_id", "workflow_send_ledger", ["instance_id"])


def downgrade():
    op.drop_index("ix_workflow_send_ledger_instance_id", table_name="workflow_send_ledger")
    op.drop_table("workflow_send_ledger")
