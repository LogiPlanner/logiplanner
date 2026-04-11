"""add meeting boards

Revision ID: a1b2c3d4e5f7
Revises: f1d2c3b4a5e6
Create Date: 2026-04-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, None] = 'f1d2c3b4a5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'meeting_boards',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('team_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('state_json', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name=op.f('meeting_boards_team_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('meeting_boards_pkey')),
    )
    op.create_index(op.f('ix_meeting_boards_id'), 'meeting_boards', ['id'], unique=False)
    op.create_index(op.f('ix_meeting_boards_team_id'), 'meeting_boards', ['team_id'], unique=False)

    bind = op.get_bind()
    inspector = inspect(bind)
    if 'whiteboard_states' in inspector.get_table_names():
        rows = bind.execute(sa.text('SELECT team_id, state_json FROM whiteboard_states')).mappings().all()
        for row in rows:
            bind.execute(
                sa.text(
                    'INSERT INTO meeting_boards (team_id, name, state_json, created_at) '
                    'VALUES (:team_id, :name, :state_json, now())'
                ),
                {
                    'team_id': row['team_id'],
                    'name': 'Main Board',
                    'state_json': row['state_json'],
                },
            )


def downgrade() -> None:
    op.drop_index(op.f('ix_meeting_boards_team_id'), table_name='meeting_boards')
    op.drop_index(op.f('ix_meeting_boards_id'), table_name='meeting_boards')
    op.drop_table('meeting_boards')
