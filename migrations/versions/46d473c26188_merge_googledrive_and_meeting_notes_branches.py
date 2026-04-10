"""merge googledrive and meeting_notes branches

Revision ID: 46d473c26188
Revises: d1a2b3c4d5e6, dacfc08e3ec5
Create Date: 2026-04-08 23:12:43.999008

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '46d473c26188'
down_revision: Union[str, None] = ('d1a2b3c4d5e6', 'dacfc08e3ec5')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
