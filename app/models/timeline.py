from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, Enum
from sqlalchemy.sql import func
import enum
from app.models.user import Base 

class EntryType(str, enum.Enum):
    DECISION = "decision"
    MILESTONE = "milestone"
    SUMMARY = "summary"
    UPLOAD = "upload"

class TimelineEntry(Base):
    __tablename__ = "timeline_entries"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    
    entry_type = Column(Enum(EntryType), nullable=False)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False) 
    source_reference = Column(String, nullable=True) 
    
    verified_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    author_name = Column(String, nullable=True)
    collaborators = Column(String, nullable=True)
    tags = Column(String, nullable=True)
    impact_level = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())