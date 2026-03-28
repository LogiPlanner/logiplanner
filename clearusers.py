
# Run this to COMPLETELY wipe all users + relations for Postgres Database

import sys
from sqlalchemy import text
from app.core.database import engine

print("⚠️  WARNING ⚠️")
print("This will DELETE ALL users and their relationships!")
print("Teams, projects, and roles connected to users will also be affected.\n")

confirm = input("Type 'YES' to continue (anything else will cancel): ")

if confirm != "YES":
    print("Cancelled.")
    sys.exit()

print("\nDeleting all users and related data...\n")

with engine.connect() as conn:
    # 1. Delete relationships first (important order!)
    conn.execute(text("DELETE FROM user_roles;"))
    conn.execute(text("DELETE FROM user_team;"))
    conn.execute(text("DELETE FROM user_project;"))

    # 2. Delete users
    result = conn.execute(text("DELETE FROM users;"))
    conn.commit()

    print(f"✅ Done! {result.rowcount} users were deleted.")
    print("Database is now clean.")

print("\nYou can now create fresh users again.")