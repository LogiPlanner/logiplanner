"""
RAG Pydantic Schemas
====================
Request/response models for all RAG API endpoints.
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from datetime import datetime


# ── Ingestion ──

class IngestTextRequest(BaseModel):
    """Request to ingest raw text directly into the knowledge base."""
    team_id: int
    title: str                          # Name for this text entry
    content: str                        # The text content to ingest


class IngestURLRequest(BaseModel):
    """Request to ingest content from a URL."""
    team_id: int
    url: str


class DriveIngestRequest(BaseModel):
    """Request to ingest a public Google Drive document."""
    team_id: int
    drive_url: str
    custom_name: Optional[str] = None     # User-provided display name
    refresh_interval_hours: Optional[int] = None  # None = no auto-refresh


class GitHubIngestRequest(BaseModel):
    """Request to ingest a public GitHub file into the knowledge base."""
    team_id: int
    github_url: str
    custom_name: Optional[str] = None     # User-provided display name


class DocumentResponse(BaseModel):
    """Response model for a single document."""
    id: int
    team_id: int
    filename: str
    doc_type: str
    file_size: int
    chunk_count: int
    status: str
    error_message: Optional[str] = None
    uploader_email: Optional[str] = None
    created_at: Optional[datetime] = None
    source_url: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    refresh_interval_hours: Optional[int] = None
    folder_id: Optional[int] = None
    summary: Optional[str] = None
    children: Optional[List["DocumentResponse"]] = None

    class Config:
        from_attributes = True


class IngestResponse(BaseModel):
    """Response after ingesting documents."""
    message: str
    documents: List[DocumentResponse] = []
    total_chunks: int = 0


class DocumentListResponse(BaseModel):
    """List of documents in a team's knowledge base."""
    documents: List[DocumentResponse]
    total: int


# ── Chat ──

class ChatRequest(BaseModel):
    """Request to send a message to the AI Brain."""
    team_id: int
    message: str
    session_id: Optional[str] = None            # Groups messages into a conversation
    filters: Optional[Dict[str, Any]] = None   # Optional metadata filters


class SourceReference(BaseModel):
    """A source reference from the knowledge base."""
    filename: str
    page_number: int = 0
    uploader: str = "Unknown"
    doc_type: str = "unknown"


class ChatResponse(BaseModel):
    """Response from the AI Brain chat."""
    response: str
    sources: List[SourceReference] = []
    chunk_count: int = 0


class ChatMessageResponse(BaseModel):
    """A single chat message for history display."""
    id: int
    role: str
    content: str
    sources: Optional[str] = None       # JSON string of sources
    session_id: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ChatHistoryResponse(BaseModel):
    """Chat history for a team."""
    messages: List[ChatMessageResponse]
    total: int


class ChatSessionResponse(BaseModel):
    """A single chat session summary."""
    session_id: str
    preview: str                         # First user message as preview
    message_count: int
    created_at: Optional[datetime] = None


class ChatSessionsListResponse(BaseModel):
    """List of chat sessions for a team."""
    sessions: List[ChatSessionResponse]
    total: int


# ── Stats ──

class KnowledgeBaseStats(BaseModel):
    """Knowledge base statistics for a team."""
    total_chunks: int = 0
    document_count: int = 0
    doc_types: Dict[str, int] = {}
    collection_name: str = ""


class DeleteResponse(BaseModel):
    """Response for delete operations."""
    message: str
    deleted_count: int = 0


class RecentKnowledgeItem(BaseModel):
    """A summarized recent knowledge chunk."""
    summary: str
    filename: str
    doc_type: str = "unknown"
    uploaded_at: str = ""


class RecentKnowledgeResponse(BaseModel):
    """Response for recent knowledge summaries."""
    items: List[RecentKnowledgeItem]
    total: int
