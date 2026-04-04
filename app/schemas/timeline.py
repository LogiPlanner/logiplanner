from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from enum import Enum

class EntryTypeEnum(str, Enum):
    decision = "decision"
    milestone = "milestone"
    summary = "summary"
    upload = "upload"

class TimelineEntryBase(BaseModel):
    entry_type: EntryTypeEnum
    title: str
    content: str
    source_reference: Optional[str] = None
    tags: Optional[str] = None
    collaborators: Optional[str] = None
    impact_level: Optional[str] = None # Comma-separated or JSON string

class TimelineEntryCreate(TimelineEntryBase):
    project_id: int

class TimelineEntryUpdate(BaseModel):
    entry_type: Optional[EntryTypeEnum] = None
    title: Optional[str] = None
    content: Optional[str] = None
    source_reference: Optional[str] = None
    tags: Optional[str] = None
    collaborators: Optional[str] = None
    impact_level: Optional[str] = None

class TimelineEntryResponse(TimelineEntryBase):
    id: int
    project_id: int
    verified_by_id: int
    author_name: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class MemoryAnalyticsResponse(BaseModel):
    decisions_count: int
    milestones_count: int
    summaries_count: int
    uploads_count: int
    focus_distribution: dict # e.g. {"Technical Architecture": 65, "UX & Product Design": 22}
    total_entries_last_7_days: int
    active_participants_count: int