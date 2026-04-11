"""add is_protected to meeting_folders

Revision ID: g2h3i4j5k6l7
Revises: a1b2c3d4e5f7
Create Date: 2026-04-11 13:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = 'g2h3i4j5k6l7'
down_revision: Union[str, None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # Check if column already exists
    columns = [col['name'] for col in inspector.get_columns('meeting_folders')]
    if 'is_protected' not in columns:
        op.add_column('meeting_folders', sa.Column('is_protected', sa.Boolean(), nullable=False, server_default='false'))

        # Mark existing "AI Generated" folders as protected
        bind.execute(
            sa.text("UPDATE meeting_folders SET is_protected = true WHERE name = 'AI Generated'")
        )


def downgrade() -> None:
    op.drop_column('meeting_folders', 'is_protected')
