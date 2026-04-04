
"""add timeline table

Revision ID: 0090822d09d0
Revises: ca4977d47b77
Create Date: 2026-04-03 01:39:43.553273

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0090822d09d0'
down_revision: Union[str, None] = 'ca4977d47b77'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Create enum type only if it doesn't already exist (create_all may have already created it)
    conn.execute(sa.text(
        "DO $$ BEGIN "
        "CREATE TYPE entrytype AS ENUM ('DECISION', 'MILESTONE', 'SUMMARY', 'UPLOAD'); "
        "EXCEPTION WHEN duplicate_object THEN null; "
        "END $$;"
    ))

    # Create table only if it doesn't already exist
    table_exists = conn.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name='timeline_entries')"
    )).scalar()

    if not table_exists:
        op.create_table('timeline_entries',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('project_id', sa.Integer(), nullable=False),
            sa.Column('entry_type', sa.Enum('DECISION', 'MILESTONE', 'SUMMARY', 'UPLOAD', name='entrytype', create_type=False), nullable=False),
            sa.Column('title', sa.String(), nullable=False),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('source_reference', sa.String(), nullable=True),
            sa.Column('verified_by_id', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
            sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
            sa.ForeignKeyConstraint(['verified_by_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_timeline_entries_id'), 'timeline_entries', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_timeline_entries_id'), table_name='timeline_entries')
    op.drop_table('timeline_entries')
    op.execute(sa.text("DROP TYPE IF EXISTS entrytype"))
