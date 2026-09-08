"""add project_id to ai_assistant_messages

Revision ID: c7b943044112
Revises: b5a4777c54ef
Create Date: 2026-09-08 06:18:43.016498

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c7b943044112'
down_revision = 'b5a4777c54ef'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('ai_assistant_messages', schema=None) as batch_op:
        batch_op.add_column(sa.Column('project_id', sa.String(length=36), nullable=True))
        batch_op.drop_index(batch_op.f('ix_ai_assistant_messages_user_created'))
        batch_op.create_index('ix_ai_assistant_messages_user_project_created', ['user_id', 'project_id', 'created_at'], unique=False)


def downgrade():
    with op.batch_alter_table('ai_assistant_messages', schema=None) as batch_op:
        batch_op.drop_index('ix_ai_assistant_messages_user_project_created')
        batch_op.create_index(batch_op.f('ix_ai_assistant_messages_user_created'), ['user_id', 'created_at'], unique=False)
        batch_op.drop_column('project_id')
