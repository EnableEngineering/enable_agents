"""add ai_assistant_messages

Revision ID: b5a4777c54ef
Revises: 09a93d28ed50
Create Date: 2026-09-08 06:00:23.765008

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b5a4777c54ef'
down_revision = '09a93d28ed50'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('ai_assistant_messages',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(length=255), nullable=False),
    sa.Column('message_id', sa.String(length=64), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('tool_result', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'message_id', name='uq_ai_assistant_message')
    )
    with op.batch_alter_table('ai_assistant_messages', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_ai_assistant_messages_user_id'), ['user_id'], unique=False)
        batch_op.create_index('ix_ai_assistant_messages_user_created', ['user_id', 'created_at'], unique=False)


def downgrade():
    with op.batch_alter_table('ai_assistant_messages', schema=None) as batch_op:
        batch_op.drop_index('ix_ai_assistant_messages_user_created')
        batch_op.drop_index(batch_op.f('ix_ai_assistant_messages_user_id'))

    op.drop_table('ai_assistant_messages')
