"""empty message

Revision ID: 3b73ea06db52
Revises: 46d473c26188
Create Date: 2026-04-08 23:18:25.100233

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3b73ea06db52'
down_revision: Union[str, None] = '46d473c26188'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Intentionally no-op: the previous migration in this PR creates
    # ix_documents_folder_id, and this revision should not immediately
    # remove that index.
    pass


def downgrade() -> None:
    # Intentionally no-op to match the no-op upgrade.
    pass
