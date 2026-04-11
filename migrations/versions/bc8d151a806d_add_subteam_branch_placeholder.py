"""add_subteam_branch_placeholder

Revision ID: bc8d151a806d
Revises: 3b73ea06db52
Create Date: 2026-04-11 01:59:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "bc8d151a806d"
down_revision: Union[str, None] = "3b73ea06db52"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
