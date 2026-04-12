"""Jadids Testing

Revision ID: dff0d6171366
Revises: a1b2c3d4e5f7
Create Date: 2026-04-11 12:37:45.681116

"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = 'dff0d6171366'
down_revision: Union[str, None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # This revision was generated from a drifted local database and does not
    # correspond to an actual schema change in the migration history.
    return None


def downgrade() -> None:
    return None
