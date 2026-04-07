import sys
from app.core.database import engine
from app.models.user import Base as ModelBase
from app.models.meeting import MeetingFolder, MeetingNote, WhiteboardState

print("Creating meeting tables if they don't exist...")
ModelBase.metadata.create_all(bind=engine)
print("Done!")
