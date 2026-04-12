"""reconcile documents columns after stamp drift

Revision ID: c8b91f2a7d44
Revises: d2fdd59329fb
Create Date: 2026-04-11 03:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "c8b91f2a7d44"
down_revision: Union[str, None] = "d2fdd59329fb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(inspector, table_name: str, column_name: str) -> bool:
    return any(col["name"] == column_name for col in inspector.get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if not _has_column(inspector, "documents", "source_url"):
        op.add_column("documents", sa.Column("source_url", sa.String(), nullable=True))

    if not _has_column(inspector, "documents", "drive_file_id"):
        op.add_column("documents", sa.Column("drive_file_id", sa.String(), nullable=True))

    if not _has_column(inspector, "documents", "last_synced_at"):
        op.add_column("documents", sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True))

    if not _has_column(inspector, "documents", "refresh_interval_hours"):
        op.add_column("documents", sa.Column("refresh_interval_hours", sa.Integer(), nullable=True))

    if not _has_column(inspector, "documents", "folder_id"):
        op.add_column("documents", sa.Column("folder_id", sa.Integer(), nullable=True))

    if not _has_column(inspector, "documents", "summary"):
        op.add_column("documents", sa.Column("summary", sa.Text(), nullable=True))

    # Refresh inspector after potential schema changes before checking indexes/FKs.
    inspector = inspect(bind)

    index_names = {idx["name"] for idx in inspector.get_indexes("documents")}
    if "ix_documents_folder_id" not in index_names:
        op.create_index("ix_documents_folder_id", "documents", ["folder_id"])

    has_folder_fk = any(
        fk.get("constrained_columns") == ["folder_id"] and fk.get("referred_table") == "documents"
        for fk in inspector.get_foreign_keys("documents")
    )
    if not has_folder_fk:
        op.create_foreign_key(
            "fk_documents_folder_id_documents",
            "documents",
            "documents",
            ["folder_id"],
            ["id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    fk_names = {
        fk.get("name")
        for fk in inspector.get_foreign_keys("documents")
        if fk.get("constrained_columns") == ["folder_id"] and fk.get("referred_table") == "documents"
    }
    for fk_name in fk_names:
        if fk_name:
            op.drop_constraint(fk_name, "documents", type_="foreignkey")

    index_names = {idx["name"] for idx in inspector.get_indexes("documents")}
    if "ix_documents_folder_id" in index_names:
        op.drop_index("ix_documents_folder_id", table_name="documents")

    # Drop in reverse order when present.
    inspector = inspect(bind)
    if _has_column(inspector, "documents", "summary"):
        op.drop_column("documents", "summary")

    inspector = inspect(bind)
    if _has_column(inspector, "documents", "folder_id"):
        op.drop_column("documents", "folder_id")

    inspector = inspect(bind)
    if _has_column(inspector, "documents", "refresh_interval_hours"):
        op.drop_column("documents", "refresh_interval_hours")

    inspector = inspect(bind)
    if _has_column(inspector, "documents", "last_synced_at"):
        op.drop_column("documents", "last_synced_at")

    inspector = inspect(bind)
    if _has_column(inspector, "documents", "drive_file_id"):
        op.drop_column("documents", "drive_file_id")

    inspector = inspect(bind)
    if _has_column(inspector, "documents", "source_url"):
        op.drop_column("documents", "source_url")
