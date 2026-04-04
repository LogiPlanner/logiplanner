"""merge database branches

Revision ID: a834f29ee2a6
Revises: 0090822d09d0, fcd81f18902f
Create Date: 2026-04-04 10:51:36.121985

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a834f29ee2a6'
down_revision: Union[str, None] = ('0090822d09d0', 'fcd81f18902f')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
