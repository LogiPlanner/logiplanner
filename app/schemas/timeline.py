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
    impact_level: Optional[str] = None
    sub_team_id: Optional[int] = None

class TimelineEntryCreate(TimelineEntryBase):
    team_id: int  # Was project_id — now scoped directly to team

class TimelineEntryUpdate(BaseModel):
    entry_type: Optional[EntryTypeEnum] = None
    title: Optional[str] = None
    content: Optional[str] = None
    source_reference: Optional[str] = None
    tags: Optional[str] = None
    collaborators: Optional[str] = None
    impact_level: Optional[str] = None
    sub_team_id: Optional[int] = None

class TimelineEntryResponse(TimelineEntryBase):
    id: int
    team_id: int  # Was project_id
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
    focus_distribution: dict
    total_entries_last_7_days: int
    active_participants_count: int