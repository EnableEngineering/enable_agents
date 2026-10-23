"""Add embedding vector column to en_attendees table.

Revision ID: z3o2p1q0r9s8
Revises: y2n1o0p9q8r7
Create Date: 2026-10-23
"""

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = 'z3o2p1q0r9s8'
down_revision = 'y2n1o0p9q8r7'
branch_labels = None
depends_on = None


def upgrade():
    # Ensure pgvector extension exists before altering table
    op.execute('CREATE EXTENSION IF NOT EXISTS vector')

    # Safe inspect check prevents duplicate column errors across environments
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("en_attendees")}
    if "embedding" not in columns:
        op.add_column("en_attendees", sa.Column("embedding", Vector(1536), nullable=True))


def downgrade():
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("en_attendees")}
    if "embedding" in columns:
        op.drop_column("en_attendees", "embedding")
