"""add folder_id and summary to documents

Revision ID: d1a2b3c4d5e6
Revises: b7e3d1f4a289, e3a1b2c4d5f6
Create Date: 2026-04-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1a2b3c4d5e6'
down_revision: Union[str, None] = ('b7e3d1f4a289', 'e3a1b2c4d5f6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('documents', sa.Column('folder_id', sa.Integer(), sa.ForeignKey('documents.id'), nullable=True))
    op.add_column('documents', sa.Column('summary', sa.Text(), nullable=True))
    op.create_index('ix_documents_folder_id', 'documents', ['folder_id'])


def downgrade() -> None:
    op.drop_index('ix_documents_folder_id', table_name='documents')
    op.drop_column('documents', 'summary')
    op.drop_column('documents', 'folder_id')
