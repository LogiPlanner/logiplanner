"""add_calendar_tasks_table

Revision ID: 8c1e42c6372f
Revises: 83b3d2023447
Create Date: 2026-04-03 17:08:39.077349

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8c1e42c6372f'
down_revision: Union[str, None] = '83b3d2023447'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'calendar_tasks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('team_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('task_date', sa.Date(), nullable=False),
        sa.Column('priority', sa.String(), nullable=True),
        sa.Column('is_completed', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_calendar_tasks_id'), 'calendar_tasks', ['id'], unique=False)
    op.create_index(op.f('ix_calendar_tasks_task_date'), 'calendar_tasks', ['task_date'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_calendar_tasks_task_date'), table_name='calendar_tasks')
    op.drop_index(op.f('ix_calendar_tasks_id'), table_name='calendar_tasks')
    op.drop_table('calendar_tasks')
