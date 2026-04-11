"""merge_subteam_and_documents_branches

Revision ID: d2fdd59329fb
Revises: bc8d151a806d, d845caf777e9
Create Date: 2026-04-11 02:06:23.922403

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2fdd59329fb'
down_revision: Union[str, None] = ('bc8d151a806d', 'd845caf777e9')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
