from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from enum import Enum
from typing import Optional, List

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
    
    comments: List['TimelineEntryCommentResponse'] = []
    versions: List['TimelineEntryVersionResponse'] = []
    attachments: List['TimelineAttachmentResponse'] = []

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

class TimelineEntryCommentBase(BaseModel):
    content: str

class TimelineEntryCommentCreate(TimelineEntryCommentBase):
    pass

class TimelineEntryCommentResponse(TimelineEntryCommentBase):
    id: int
    entry_id: int
    user_id: int
    author_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class TimelineEntryVersionResponse(BaseModel):
    id: int
    entry_id: int
    edited_by_id: int
    previous_content: str
    created_at: datetime

    class Config:
        from_attributes = True

class TimelineAttachmentBase(BaseModel):
    file_name: str
    file_url: str
    file_type: Optional[str] = None

class TimelineAttachmentCreate(TimelineAttachmentBase):
    pass

class TimelineAttachmentResponse(TimelineAttachmentBase):
    id: int
    entry_id: int
    created_at: datetime

    class Config:
        from_attributes = True

TimelineEntryResponse.model_rebuild()