"""onboarding tables

Revision ID: ca4977d47b77
Revises: a29b29815d1c
Create Date: 2026-03-28 19:25:53.861980

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = 'ca4977d47b77'
down_revision: Union[str, None] = 'a29b29815d1c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table: str) -> bool:
    bind = op.get_bind()
    return table in inspect(bind).get_table_names()


def _index_exists(table: str, index: str) -> bool:
    bind = op.get_bind()
    return any(idx["name"] == index for idx in inspect(bind).get_indexes(table))


def upgrade() -> None:
    if not _table_exists('documents'):
        op.create_table(
            'documents',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('team_id', sa.Integer(), nullable=False),
            sa.Column('uploader_id', sa.Integer(), nullable=False),
            sa.Column('filename', sa.String(), nullable=False),
            sa.Column('stored_path', sa.String(), nullable=False),
            sa.Column('doc_type', sa.String(), nullable=False),
            sa.Column('file_size', sa.Integer(), nullable=True),
            sa.Column('chunk_count', sa.Integer(), nullable=True),
            sa.Column('status', sa.String(), nullable=True),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
            sa.ForeignKeyConstraint(['team_id'], ['teams.id']),
            sa.ForeignKeyConstraint(['uploader_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id'),
        )
    if _table_exists('documents') and not _index_exists('documents', op.f('ix_documents_id')):
        op.create_index(op.f('ix_documents_id'), 'documents', ['id'], unique=False)

    if not _table_exists('chat_messages'):
        op.create_table(
            'chat_messages',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('team_id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('role', sa.String(), nullable=False),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('sources', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
            sa.ForeignKeyConstraint(['team_id'], ['teams.id']),
            sa.ForeignKeyConstraint(['user_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id'),
        )
    if _table_exists('chat_messages') and not _index_exists('chat_messages', op.f('ix_chat_messages_id')):
        op.create_index(op.f('ix_chat_messages_id'), 'chat_messages', ['id'], unique=False)


def downgrade() -> None:
    if _table_exists('chat_messages'):
        if _index_exists('chat_messages', op.f('ix_chat_messages_id')):
            op.drop_index(op.f('ix_chat_messages_id'), table_name='chat_messages')
        op.drop_table('chat_messages')

    if _table_exists('documents'):
        if _index_exists('documents', op.f('ix_documents_id')):
            op.drop_index(op.f('ix_documents_id'), table_name='documents')
        op.drop_table('documents')
