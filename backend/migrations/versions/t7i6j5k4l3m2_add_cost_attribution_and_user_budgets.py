"""Cost tracking: attribute usage to workflow runs, per-user budgets, warn alerts.

Revision ID: t7i6j5k4l3m2
Revises: s6h5i4j3k2l1
Create Date: 2026-09-19
"""

from alembic import op
import sqlalchemy as sa

revision = 't7i6j5k4l3m2'
down_revision = 's6h5i4j3k2l1'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)

    usage_cols = {c["name"] for c in insp.get_columns("ai_usage_log")}
    if "workflow_instance_id" not in usage_cols:
        op.add_column("ai_usage_log", sa.Column("workflow_instance_id", sa.String(36), nullable=True))
        op.create_index("ix_ai_usage_log_workflow_instance_id", "ai_usage_log", ["workflow_instance_id"])
    if "workflow_stage_id" not in usage_cols:
        op.add_column("ai_usage_log", sa.Column("workflow_stage_id", sa.String(100), nullable=True))

    project_cols = {c["name"] for c in insp.get_columns("projects")}
    if "budget_warn_month" not in project_cols:
        op.add_column("projects", sa.Column("budget_warn_month", sa.String(7), nullable=True))

    if "user_budgets" not in insp.get_table_names():
        op.create_table(
            "user_budgets",
            sa.Column("user_id", sa.String(255), primary_key=True),
            sa.Column("monthly_budget_usd", sa.Float(), nullable=True),
            sa.Column("warn_month", sa.String(7), nullable=True),
            sa.Column("over_month", sa.String(7), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )


def downgrade():
    op.drop_table("user_budgets")
    op.drop_column("projects", "budget_warn_month")
    op.drop_column("ai_usage_log", "workflow_stage_id")
    op.drop_index("ix_ai_usage_log_workflow_instance_id", table_name="ai_usage_log")
    op.drop_column("ai_usage_log", "workflow_instance_id")
