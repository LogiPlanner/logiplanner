# clearusers.py — Logiplanner database cleanup utility
import sys
import os
import shutil
from sqlalchemy import MetaData
from app.core.database import engine, SessionLocal
from app.core.config import settings
from app.models.user import (
    User, Company, Team, Role, UserRole, Project,
    Document, ChatMessage, user_team, user_project,
)
from app.models.calendar_task import CalendarTask, task_tagged_users
from app.models.timeline import TimelineEntry


def delete_single_user():
    """Delete a specific user by email and all their related data."""
    email = input("\nEnter user email to delete: ").strip()
    if not email:
        print("No email provided. Cancelled.")
        return

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            print(f"❌ No user found with email: {email}")
            return

        uid = user.id
        print(f"\nFound user: {user.full_name or 'N/A'} (id={uid}, email={email})")
        confirm = input("Type 'DELETE' to confirm deletion: ")
        if confirm != "DELETE":
            print("Cancelled.")
            return

        print(f"\nDeleting all data for user {email} (id={uid})...")

        # 1. task_tagged_users (M2M)
        db.execute(task_tagged_users.delete().where(task_tagged_users.c.user_id == uid))

        # 2. calendar_tasks created by user
        db.query(CalendarTask).filter(CalendarTask.user_id == uid).delete(synchronize_session=False)

        # 3. timeline_entries verified by user (set to NULL or delete)
        db.query(TimelineEntry).filter(TimelineEntry.verified_by_id == uid).delete(synchronize_session=False)

        # 4. chat_messages
        db.query(ChatMessage).filter(ChatMessage.user_id == uid).delete(synchronize_session=False)

        # 5. documents (also remove files from disk)
        docs = db.query(Document).filter(Document.uploader_id == uid).all()
        for doc in docs:
            if doc.stored_path and os.path.exists(doc.stored_path):
                try:
                    os.remove(doc.stored_path)
                    print(f"   Removed file: {doc.stored_path}")
                except OSError:
                    pass
        db.query(Document).filter(Document.uploader_id == uid).delete(synchronize_session=False)

        # 6. user_roles
        db.query(UserRole).filter(UserRole.user_id == uid).delete(synchronize_session=False)

        # 7. user_team (M2M)
        db.execute(user_team.delete().where(user_team.c.user_id == uid))

        # 8. user_project (M2M)
        db.execute(user_project.delete().where(user_project.c.user_id == uid))

        # 9. Finally delete the user
        db.query(User).filter(User.id == uid).delete(synchronize_session=False)

        db.commit()
        print(f"✅ User '{email}' and all related data deleted successfully.")
    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}")
    finally:
        db.close()


def nuke_everything():
    """Drop all tables, clear uploads folder, and wipe ChromaDB data."""
    print("\n⚠️  DANGER — FULL WIPE ⚠️")
    print(f"Database : {engine.url}")
    print(f"Uploads  : app/static/uploads/")
    print(f"ChromaDB : {settings.CHROMA_PERSIST_DIR}")
    print("\nThis will permanently destroy ALL data in Logiplanner.")

    confirm = input("\nType 'DELETE ALL' to confirm: ")
    if confirm != "DELETE ALL":
        print("Cancelled.")
        return

    # 1. Drop all database tables
    print("\n[1/3] Dropping all database tables...")
    try:
        reflected_metadata = MetaData()
        reflected_metadata.reflect(bind=engine)
        reflected_metadata.drop_all(bind=engine)
        print("  ✅ All tables dropped.")
    except Exception as e:
        print(f"  ❌ Table drop failed: {e}")

    # 2. Clear uploads folder
    uploads_dir = os.path.join("app", "static", "uploads")
    print(f"\n[2/3] Clearing uploads folder: {uploads_dir}")
    if os.path.exists(uploads_dir):
        for item in os.listdir(uploads_dir):
            item_path = os.path.join(uploads_dir, item)
            try:
                if os.path.isdir(item_path):
                    shutil.rmtree(item_path)
                else:
                    os.remove(item_path)
            except OSError as e:
                print(f"  ⚠️  Could not remove {item_path}: {e}")
        print("  ✅ Uploads folder cleared.")
    else:
        print("  ℹ️  Uploads folder does not exist, skipping.")

    # 3. Wipe ChromaDB data
    chroma_dir = settings.CHROMA_PERSIST_DIR
    print(f"\n[3/3] Wiping ChromaDB data: {chroma_dir}")
    if os.path.exists(chroma_dir):
        try:
            shutil.rmtree(chroma_dir)
            print("  ✅ ChromaDB data wiped.")
        except OSError as e:
            print(f"  ❌ ChromaDB wipe failed: {e}")
    else:
        print("  ℹ️  ChromaDB directory does not exist, skipping.")

    print("\n🧹 Full wipe complete. Run migrations to recreate the schema.")


def main():
    print("=" * 50)
    print("  LOGIPLANNER — Database Cleanup Utility")
    print("=" * 50)
    print("\n  1. Delete a single user (by email)")
    print("  2. Nuke everything (tables + uploads + RAG)")
    print("  3. Exit\n")

    choice = input("Select option [1/2/3]: ").strip()

    if choice == "1":
        delete_single_user()
    elif choice == "2":
        nuke_everything()
    else:
        print("Exiting.")


if __name__ == "__main__":
    main()