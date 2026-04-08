"""Add meeting notes models

Revision ID: b5700aa37af9
Revises: 86a107e46abc
Create Date: 2026-04-07 15:33:33.689376

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b5700aa37af9'
down_revision: Union[str, None] = '86a107e46abc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # whiteboard_states — one row per team, stores Fabric.js JSON
    op.create_table(
        'whiteboard_states',
        sa.Column('team_id', sa.Integer(), nullable=False),
        sa.Column('state_json', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name=op.f('whiteboard_states_team_id_fkey')),
        sa.PrimaryKeyConstraint('team_id', name=op.f('whiteboard_states_pkey')),
    )

    # note_folders — original folder model (dropped in dacfc08e3ec5)
    op.create_table(
        'note_folders',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('team_id', sa.Integer(), nullable=False),
        sa.Column('parent_id', sa.Integer(), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['parent_id'], ['note_folders.id'], name=op.f('note_folders_parent_id_fkey')),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name=op.f('note_folders_team_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('note_folders_pkey')),
    )
    op.create_index(op.f('ix_note_folders_id'), 'note_folders', ['id'], unique=False)

    # meeting_folders — replacement folder model (referenced by dacfc08e3ec5)
    op.create_table(
        'meeting_folders',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('team_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name=op.f('meeting_folders_team_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('meeting_folders_pkey')),
    )
    op.create_index(op.f('ix_meeting_folders_id'), 'meeting_folders', ['id'], unique=False)

    # meeting_notes — initial schema; subsequent migrations add note_type, content,
    # is_trashed and drop is_deleted / canvas_data.
    op.create_table(
        'meeting_notes',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('team_id', sa.Integer(), nullable=False),
        sa.Column('folder_id', sa.Integer(), nullable=True),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), nullable=True),
        sa.Column('canvas_data', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        # Named FK so dacfc08e3ec5 can drop it by name.
        sa.ForeignKeyConstraint(['folder_id'], ['note_folders.id'], name=op.f('meeting_notes_folder_id_fkey')),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name=op.f('meeting_notes_team_id_fkey')),
        sa.PrimaryKeyConstraint('id', name=op.f('meeting_notes_pkey')),
    )
    op.create_index(op.f('ix_meeting_notes_id'), 'meeting_notes', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_meeting_notes_id'), table_name='meeting_notes')
    op.drop_table('meeting_notes')
    op.drop_index(op.f('ix_meeting_folders_id'), table_name='meeting_folders')
    op.drop_table('meeting_folders')
    op.drop_index(op.f('ix_note_folders_id'), table_name='note_folders')
    op.drop_table('note_folders')
    op.drop_table('whiteboard_states')
