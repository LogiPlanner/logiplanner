"""timeline_project_id_to_team_id

Revision ID: 9b870d98ae44
Revises: 9dc80657e12e
Create Date: 2026-04-05 23:52:41.286231

Migrates timeline_entries from being scoped by project_id to team_id directly.
This removes the intermediate Projects table dependency and enforces
clean 1-Team = 1-Isolated-Space data architecture.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9b870d98ae44'
down_revision: Union[str, None] = '9dc80657e12e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: Add nullable team_id column
    op.add_column('timeline_entries', sa.Column('team_id', sa.Integer(), nullable=True))

    # Step 2: Populate team_id from the projects table
    op.execute("""
        UPDATE timeline_entries te
        SET team_id = p.team_id
        FROM projects p
        WHERE te.project_id = p.id
    """)

    # Step 3: Make team_id NOT NULL now that it's populated
    op.alter_column('timeline_entries', 'team_id', nullable=False)

    # Step 4: Add FK constraint to teams
    op.create_foreign_key(
        'fk_timeline_entries_team_id',
        'timeline_entries', 'teams',
        ['team_id'], ['id']
    )

    # Step 5: Create index for faster team-scoped queries
    op.create_index('ix_timeline_entries_team_id', 'timeline_entries', ['team_id'])

    # Step 6: Drop the old project_id FK and column
    op.drop_constraint('timeline_entries_project_id_fkey', 'timeline_entries', type_='foreignkey')
    op.drop_column('timeline_entries', 'project_id')


def downgrade() -> None:
    # Reverse: add project_id back (nullable — we can't perfectly restore old data)
    op.add_column('timeline_entries', sa.Column('project_id', sa.Integer(), nullable=True))

    # Attempt to restore project_id by finding a project for each team
    op.execute("""
        UPDATE timeline_entries te
        SET project_id = (
            SELECT p.id FROM projects p WHERE p.team_id = te.team_id LIMIT 1
        )
    """)

    op.create_foreign_key(
        'timeline_entries_project_id_fkey',
        'timeline_entries', 'projects',
        ['project_id'], ['id']
    )

    op.drop_index('ix_timeline_entries_team_id', 'timeline_entries')
    op.drop_constraint('fk_timeline_entries_team_id', 'timeline_entries', type_='foreignkey')
    op.drop_column('timeline_entries', 'team_id')
