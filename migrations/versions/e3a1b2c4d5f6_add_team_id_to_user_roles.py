"""add team_id to user_roles for proper role scoping

Revision ID: e3a1b2c4d5f6
Revises: 51c7c579f9e3
Create Date: 2026-04-04 00:00:00.000000

Security fix: UserRole records previously had no team_id, meaning queries
for a user's role in a team would return roles from ALL their teams,
enabling privilege escalation across team boundaries.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e3a1b2c4d5f6'
down_revision: Union[str, None] = '51c7c579f9e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add nullable team_id to user_roles (nullable for backwards compatibility)
    op.add_column(
        'user_roles',
        sa.Column('team_id', sa.Integer(), sa.ForeignKey('teams.id'), nullable=True)
    )
    op.create_index('ix_user_roles_team_id', 'user_roles', ['team_id'])


def downgrade() -> None:
    op.drop_index('ix_user_roles_team_id', table_name='user_roles')
    op.drop_column('user_roles', 'team_id')
