"""add_session_id_to_chat_messages

Revision ID: fcd81f18902f
Revises: ca4977d47b77
Create Date: 2026-03-31 22:51:22.174006

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = 'fcd81f18902f'
down_revision: Union[str, None] = 'ca4977d47b77'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table: str) -> bool:
    bind = op.get_bind()
    return table in inspect(bind).get_table_names()


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    return column in [c['name'] for c in inspect(bind).get_columns(table)]


def _index_exists(table: str, index: str) -> bool:
    bind = op.get_bind()
    return any(idx['name'] == index for idx in inspect(bind).get_indexes(table))


def upgrade() -> None:
    if _table_exists('chat_messages') and not _column_exists('chat_messages', 'session_id'):
        op.add_column('chat_messages', sa.Column('session_id', sa.String(), nullable=True))
    if _table_exists('chat_messages') and not _index_exists('chat_messages', op.f('ix_chat_messages_session_id')):
        op.create_index(op.f('ix_chat_messages_session_id'), 'chat_messages', ['session_id'], unique=False)


def downgrade() -> None:
    if _table_exists('chat_messages') and _index_exists('chat_messages', op.f('ix_chat_messages_session_id')):
        op.drop_index(op.f('ix_chat_messages_session_id'), table_name='chat_messages')
    if _table_exists('chat_messages') and _column_exists('chat_messages', 'session_id'):
        op.drop_column('chat_messages', 'session_id')
