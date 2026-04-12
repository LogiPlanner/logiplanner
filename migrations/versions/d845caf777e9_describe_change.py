"""describe change

Revision ID: d845caf777e9
Revises: 3b73ea06db52
Create Date: 2026-04-09 19:02:53.755140

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = 'd845caf777e9'
down_revision: Union[str, None] = '3b73ea06db52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    return column in [c['name'] for c in inspect(bind).get_columns(table)]


def _fk_exists(table: str, referred_table: str, constrained_columns: list[str]) -> bool:
    bind = op.get_bind()
    return any(
        fk.get('referred_table') == referred_table and fk.get('constrained_columns') == constrained_columns
        for fk in inspect(bind).get_foreign_keys(table)
    )


def upgrade() -> None:
    if not _column_exists('documents', 'source_url'):
        op.add_column('documents', sa.Column('source_url', sa.String(), nullable=True))
    if not _column_exists('documents', 'drive_file_id'):
        op.add_column('documents', sa.Column('drive_file_id', sa.String(), nullable=True))
    if not _column_exists('documents', 'last_synced_at'):
        op.add_column('documents', sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True))
    if not _column_exists('documents', 'refresh_interval_hours'):
        op.add_column('documents', sa.Column('refresh_interval_hours', sa.Integer(), nullable=True))
    if not _column_exists('documents', 'folder_id'):
        op.add_column('documents', sa.Column('folder_id', sa.Integer(), nullable=True))
    if not _column_exists('documents', 'summary'):
        op.add_column('documents', sa.Column('summary', sa.Text(), nullable=True))
    if not _fk_exists('documents', 'documents', ['folder_id']):
        op.create_foreign_key('fk_documents_folder_id_documents', 'documents', 'documents', ['folder_id'], ['id'])


def downgrade() -> None:
    if _fk_exists('documents', 'documents', ['folder_id']):
        op.drop_constraint('fk_documents_folder_id_documents', 'documents', type_='foreignkey')
    if _column_exists('documents', 'summary'):
        op.drop_column('documents', 'summary')
    if _column_exists('documents', 'folder_id'):
        op.drop_column('documents', 'folder_id')
    if _column_exists('documents', 'refresh_interval_hours'):
        op.drop_column('documents', 'refresh_interval_hours')
    if _column_exists('documents', 'last_synced_at'):
        op.drop_column('documents', 'last_synced_at')
    if _column_exists('documents', 'drive_file_id'):
        op.drop_column('documents', 'drive_file_id')
    if _column_exists('documents', 'source_url'):
        op.drop_column('documents', 'source_url')
