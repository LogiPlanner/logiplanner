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

class TimelineEntryCreate(TimelineEntryBase):
    project_id: int

class TimelineEntryResponse(TimelineEntryBase):
    id: int
    project_id: int
    verified_by_id: int
    created_at: datetime

    class Config:
        from_attributes = True