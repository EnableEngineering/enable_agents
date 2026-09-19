"""Composite (scope, created_at) indexes on ai_usage_log for budget sums and dashboards.

Revision ID: x1m0n9o8p7q6
Revises: w0l9m8n7o6p5
Create Date: 2026-09-19
"""

from alembic import op
import sqlalchemy as sa

revision = 'x1m0n9o8p7q6'
down_revision = 'w0l9m8n7o6p5'
branch_labels = None
depends_on = None

_INDEXES = {
    "ix_ai_usage_log_user_created": ["user_id", "created_at"],
    "ix_ai_usage_log_project_created": ["project_id", "created_at"],
    "ix_ai_usage_log_team_created": ["team_id", "created_at"],
}


def upgrade():
    existing = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("ai_usage_log")}
    for name, columns in _INDEXES.items():
        if name not in existing:
            op.create_index(name, "ai_usage_log", columns)


def downgrade():
    for name in _INDEXES:
        op.drop_index(name, table_name="ai_usage_log")
