from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Text, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.models.user import Base

class WhiteboardState(Base):
    __tablename__ = "whiteboard_states"

    team_id = Column(Integer, ForeignKey("teams.id"), primary_key=True)
    state_json = Column(Text, nullable=True) # Serialized Fabric.js JSON
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    team = relationship("Team", backref="whiteboard")

class MeetingFolder(Base):
    __tablename__ = "meeting_folders"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    name = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    team = relationship("Team", backref="meeting_folders")
    notes = relationship("MeetingNote", back_populates="folder", cascade="all, delete-orphan")

class MeetingNote(Base):
    __tablename__ = "meeting_notes"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    folder_id = Column(Integer, ForeignKey("meeting_folders.id"), nullable=True)
    title = Column(String, nullable=False, default="Untitled Note")
    content = Column(Text, nullable=True) # Stored as HTML from Quill
    note_type = Column(String, nullable=False, default="document")
    is_trashed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    team = relationship("Team", backref="meeting_notes")
    folder = relationship("MeetingFolder", back_populates="notes")
