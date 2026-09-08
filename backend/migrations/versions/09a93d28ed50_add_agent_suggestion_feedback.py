"""add agent_suggestion_feedback

Revision ID: 09a93d28ed50
Revises: q4f3g2h1i0j9
Create Date: 2026-09-07 12:52:19.618259

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '09a93d28ed50'
down_revision = 'q4f3g2h1i0j9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('agent_suggestion_feedback',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(length=255), nullable=False),
    sa.Column('from_agent', sa.String(length=100), nullable=False),
    sa.Column('to_agent', sa.String(length=100), nullable=False),
    sa.Column('action', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('agent_suggestion_feedback', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_agent_suggestion_feedback_user_id'), ['user_id'], unique=False)
        batch_op.create_index('ix_suggestion_feedback_user_pair', ['user_id', 'from_agent', 'to_agent'], unique=False)


def downgrade():
    with op.batch_alter_table('agent_suggestion_feedback', schema=None) as batch_op:
        batch_op.drop_index('ix_suggestion_feedback_user_pair')
        batch_op.drop_index(batch_op.f('ix_agent_suggestion_feedback_user_id'))

    op.drop_table('agent_suggestion_feedback')
