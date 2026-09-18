"""Team budgets, and an alert-vs-block enforcement setting on every budget.

Revision ID: u8j7k6l5m4n3
Revises: t7i6j5k4l3m2
Create Date: 2026-09-19
"""

from alembic import op
import sqlalchemy as sa

revision = 'u8j7k6l5m4n3'
down_revision = 't7i6j5k4l3m2'
branch_labels = None
depends_on = None


def _add(insp, table, column):
    if column.name not in {c["name"] for c in insp.get_columns(table)}:
        op.add_column(table, column)


def upgrade():
    insp = sa.inspect(op.get_bind())
    _add(insp, "projects", sa.Column("budget_enforcement", sa.String(10), nullable=True))
    _add(insp, "user_budgets", sa.Column("enforcement", sa.String(10), nullable=True))
    _add(insp, "teams", sa.Column("monthly_budget_usd", sa.Float(), nullable=True))
    _add(insp, "teams", sa.Column("budget_enforcement", sa.String(10), nullable=True))
    _add(insp, "teams", sa.Column("budget_warn_month", sa.String(7), nullable=True))
    _add(insp, "teams", sa.Column("budget_alert_month", sa.String(7), nullable=True))


def downgrade():
    for col in ("budget_alert_month", "budget_warn_month", "budget_enforcement", "monthly_budget_usd"):
        op.drop_column("teams", col)
    op.drop_column("user_budgets", "enforcement")
    op.drop_column("projects", "budget_enforcement")
