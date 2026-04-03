"""calendar_tasks_v2_time_location_color_tags

Revision ID: f94028fdde03
Revises: 8c1e42c6372f
Create Date: 2026-04-03 17:36:14.357983

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f94028fdde03'
down_revision: Union[str, None] = '8c1e42c6372f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # task_tagged_users M2M table – skip if it already exists
    conn = op.get_bind()
    if not conn.dialect.has_table(conn, 'task_tagged_users'):
        op.create_table(
            'task_tagged_users',
            sa.Column('task_id', sa.Integer(), sa.ForeignKey('calendar_tasks.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        )

    # New columns – use server_default so existing rows get a value, then drop default
    op.add_column('calendar_tasks', sa.Column('start_datetime', sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")))
    op.add_column('calendar_tasks', sa.Column('end_datetime', sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")))
    # Back-fill existing rows: set start/end from task_date
    op.execute("UPDATE calendar_tasks SET start_datetime = task_date::timestamp AT TIME ZONE 'UTC', end_datetime = task_date::timestamp AT TIME ZONE 'UTC' + interval '1 hour' WHERE start_datetime = now()")
    # Drop server defaults – model handles values going forward
    op.alter_column('calendar_tasks', 'start_datetime', server_default=None)
    op.alter_column('calendar_tasks', 'end_datetime', server_default=None)

    op.add_column('calendar_tasks', sa.Column('location', sa.String(length=500), nullable=True))
    op.add_column('calendar_tasks', sa.Column('color_tag', sa.String(length=7), nullable=True))


def downgrade() -> None:
    op.drop_column('calendar_tasks', 'color_tag')
    op.drop_column('calendar_tasks', 'location')
    op.drop_column('calendar_tasks', 'end_datetime')
    op.drop_column('calendar_tasks', 'start_datetime')
    op.drop_table('task_tagged_users')
