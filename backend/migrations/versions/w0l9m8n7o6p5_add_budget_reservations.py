"""Reservations so concurrent AI calls can't all spend the same remaining budget.

Revision ID: w0l9m8n7o6p5
Revises: v9k8l7m6n5o4
Create Date: 2026-09-19
"""

from alembic import op
import sqlalchemy as sa

revision = 'w0l9m8n7o6p5'
down_revision = 'v9k8l7m6n5o4'
branch_labels = None
depends_on = None


def upgrade():
    insp = sa.inspect(op.get_bind())
    if "budget_reservations" in insp.get_table_names():
        return
    op.create_table(
        "budget_reservations",
        sa.Column("reservation_id", sa.String(36), primary_key=True),
        sa.Column("scope", sa.String(10), nullable=False),
        sa.Column("scope_id", sa.String(255), nullable=False),
        sa.Column("amount_usd", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_budget_reservations_scope", "budget_reservations", ["scope", "scope_id", "expires_at"])


def downgrade():
    op.drop_index("ix_budget_reservations_scope", table_name="budget_reservations")
    op.drop_table("budget_reservations")
