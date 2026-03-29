# clear.py
import sys
from app.core.database import engine
from app.models.user import Base

def clear_database():
    print("⚠️  DANGER ⚠️")
    print("This will COMPLETELY DROP all tables from the database:")
    print(f"Target: {engine.url}")
    print("\nThis action is irreversible and will delete all users, teams, companies, and projects.")
    
    confirm = input("\nType 'DELETE ALL' to confirm (anything else will cancel): ")

    if confirm != "DELETE ALL":
        print("Operation cancelled.")
        sys.exit()

    print("\nDropping all tables...")
    try:
        # metadata.drop_all() handles foreign key constraints automatically
        Base.metadata.drop_all(bind=engine)
        print("✅ Success! All tables have been dropped.")
        print("Database is now empty. You can run your migrations to recreate the schema.")
    except Exception as e:
        print(f"❌ Error occurred: {e}")

if __name__ == "__main__":
    clear_database()