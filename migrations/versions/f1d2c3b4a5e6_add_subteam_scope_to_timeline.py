"""add subteam scope to timeline

Revision ID: f1d2c3b4a5e6
Revises: c8b91f2a7d44
Create Date: 2026-04-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = 'f1d2c3b4a5e6'
down_revision: Union[str, None] = 'c8b91f2a7d44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    return column in [c["name"] for c in inspect(bind).get_columns(table)]


def _index_exists(table: str, index: str) -> bool:
    bind = op.get_bind()
    return any(idx["name"] == index for idx in inspect(bind).get_indexes(table))


def _fk_exists(table: str, referred_table: str) -> bool:
    bind = op.get_bind()
    return any(
        fk["referred_table"] == referred_table
        for fk in inspect(bind).get_foreign_keys(table)
    )


def upgrade() -> None:
    if not _column_exists('timeline_entries', 'sub_team_id'):
        op.add_column('timeline_entries', sa.Column('sub_team_id', sa.Integer(), nullable=True))
    if not _index_exists('timeline_entries', op.f('ix_timeline_entries_sub_team_id')):
        op.create_index(op.f('ix_timeline_entries_sub_team_id'), 'timeline_entries', ['sub_team_id'], unique=False)
    if not _fk_exists('timeline_entries', 'sub_teams'):
        op.create_foreign_key('fk_timeline_entries_sub_team_id_sub_teams', 'timeline_entries', 'sub_teams', ['sub_team_id'], ['id'])


def downgrade() -> None:
    if _fk_exists('timeline_entries', 'sub_teams'):
        op.drop_constraint('fk_timeline_entries_sub_team_id_sub_teams', 'timeline_entries', type_='foreignkey')
    if _index_exists('timeline_entries', op.f('ix_timeline_entries_sub_team_id')):
        op.drop_index(op.f('ix_timeline_entries_sub_team_id'), table_name='timeline_entries')
    if _column_exists('timeline_entries', 'sub_team_id'):
        op.drop_column('timeline_entries', 'sub_team_id')
