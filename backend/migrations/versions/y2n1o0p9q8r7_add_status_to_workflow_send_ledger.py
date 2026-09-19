"""Claim-before-send: a status on workflow_send_ledger rows.

Revision ID: y2n1o0p9q8r7
Revises: x1m0n9o8p7q6
Create Date: 2026-09-19
"""

from alembic import op
import sqlalchemy as sa

revision = 'y2n1o0p9q8r7'
down_revision = 'x1m0n9o8p7q6'
branch_labels = None
depends_on = None


def upgrade():
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("workflow_send_ledger")}
    if "status" not in columns:
        # server_default: every existing row was written after a confirmed send.
        op.add_column("workflow_send_ledger",
                      sa.Column("status", sa.String(10), nullable=False, server_default="sent"))


def downgrade():
    op.drop_column("workflow_send_ledger", "status")
