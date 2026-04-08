from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class FolderCreate(BaseModel):
    name: str

class FolderResponse(BaseModel):
    id: int
    team_id: int
    name: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class NoteCreate(BaseModel):
    title: str = "Untitled Note"
    content: Optional[str] = None
    note_type: str = "document"
    folder_id: Optional[int] = None

class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    folder_id: Optional[int] = None
    is_trashed: Optional[bool] = None

class NoteResponse(BaseModel):
    id: int
    team_id: int
    folder_id: Optional[int] = None
    title: str
    content: Optional[str] = None
    note_type: str
    is_trashed: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class WhiteboardUpdate(BaseModel):
    state_json: str
