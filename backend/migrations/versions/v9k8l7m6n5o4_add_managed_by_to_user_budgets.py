"""Let a team owner/admin set (and lock) a member's personal budget.

Revision ID: v9k8l7m6n5o4
Revises: u8j7k6l5m4n3
Create Date: 2026-09-19
"""

from alembic import op
import sqlalchemy as sa

revision = 'v9k8l7m6n5o4'
down_revision = 'u8j7k6l5m4n3'
branch_labels = None
depends_on = None


def upgrade():
    insp = sa.inspect(op.get_bind())
    if "managed_by" not in {c["name"] for c in insp.get_columns("user_budgets")}:
        op.add_column("user_budgets", sa.Column("managed_by", sa.String(255), nullable=True))


def downgrade():
    op.drop_column("user_budgets", "managed_by")
