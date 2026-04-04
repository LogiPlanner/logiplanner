"""merge migrations

Revision ID: 9dc80657e12e
Revises: e3a1b2c4d5f6, f5acceabd724
Create Date: 2026-04-04 16:39:01.790350

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9dc80657e12e'
down_revision: Union[str, None] = ('e3a1b2c4d5f6', 'f5acceabd724')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
