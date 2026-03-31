"""
RAG API Routes — v2
===================
All endpoints for the AI Brain feature:
- Document ingestion (file upload + raw text)
- Knowledge base management (list, delete, stats)
- AI Chat (user-scoped: each user has private chat within a team's KB)
- Role-based access control (owner/editor/viewer)
"""

import os
import json
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.core.database import get_db
from app.models.user import User, Team, Document, ChatMessage, UserRole, Role
from app.schemas.rag import (
    IngestTextRequest,
    IngestResponse,
    DocumentResponse,
    DocumentListResponse,
    ChatRequest,
    ChatResponse,
    ChatMessageResponse,
    ChatHistoryResponse,
    KnowledgeBaseStats,
    DeleteResponse,
)
from app.rag.engine import rag_engine
from app.rag.processor import (
    process_document,
    process_text,
    validate_file,
    get_doc_type,
)

router = APIRouter()

UPLOAD_DIR = os.path.join("app", "static", "uploads", "rag")


# ──────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────

def _verify_team_access(user: User, team_id: int, db: Session) -> Team:
    """Verify that the user belongs to the specified team."""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    if user not in team.users:
        raise HTTPException(status_code=403, detail="You are not a member of this team")

    return team


def _get_user_team_role(user: User, team_id: int, db: Session) -> str:
    """
    Get the user's role for a specific team.
    Returns: 'owner', 'editor', 'viewer', or 'member' (treated as viewer).
    """
    # Check user_roles for this user
    user_roles = (
        db.query(UserRole)
        .filter(UserRole.user_id == user.id)
        .all()
    )

    for ur in user_roles:
        if ur.role:
            role_name = ur.role.name.lower()
            if role_name in ("owner", "editor", "viewer"):
                return role_name

    # Default: if they only have "member" role or no role, treat as viewer
    return "viewer"


def _require_editor_or_owner(user: User, team_id: int, db: Session) -> str:
    """Require the user to be an owner or editor. Returns the role name."""
    role = _get_user_team_role(user, team_id, db)
    if role not in ("owner", "editor"):
        raise HTTPException(
            status_code=403,
            detail="Only team owners and editors can modify the knowledge base"
        )
    return role


# ──────────────────────────────────────────────
# INGESTION ENDPOINTS
# ──────────────────────────────────────────────

def _process_and_ingest(
    doc_record_id: int,
    file_path: str,
    filename: str,
    team_id: int,
    uploader_email: str,
    db_url: str,
):
    """
    Background task: Process a document through the RAG pipeline.
    Updates the Document record status in PostgreSQL.
    """
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == doc_record_id).first()
        if not doc:
            return

        doc.status = "processing"
        db.commit()

        # Process document → chunks
        chunks = process_document(
            file_path=file_path,
            filename=filename,
            team_id=team_id,
            document_id=doc_record_id,
            uploader_email=uploader_email,
        )

        # Ingest into ChromaDB
        chunk_count = rag_engine.ingest_chunks(team_id, chunks)

        # Update record
        doc.chunk_count = chunk_count
        doc.status = "ready"
        doc.stored_path = None  # File no longer on disk
        db.commit()

        print(f"[RAG] ✅ {filename} → {chunk_count} chunks ingested for team {team_id}")

    except Exception as e:
        print(f"[RAG] ❌ Error processing {filename}: {e}")
        doc = db.query(Document).filter(Document.id == doc_record_id).first()
        if doc:
            doc.status = "error"
            doc.error_message = str(e)[:500]
            db.commit()
    finally:
        # Always delete the uploaded file — we only need the embeddings in ChromaDB
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
                print(f"[RAG] 🗑️ Deleted uploaded file: {file_path}")
            except Exception as e:
                print(f"[RAG] Warning: Could not delete {file_path}: {e}")
        db.close()


@router.post("/ingest", response_model=IngestResponse)
async def ingest_documents(
    background_tasks: BackgroundTasks,
    team_id: int = Form(...),
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Upload and ingest documents into a team's knowledge base.
    Requires owner or editor role.
    """
    team = _verify_team_access(current_user, team_id, db)
    _require_editor_or_owner(current_user, team_id, db)

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    documents = []
    total_chunks = 0

    for f in files:
        content = await f.read()
        file_size = len(content)

        is_valid, error_msg = validate_file(f.filename, file_size)
        if not is_valid:
            documents.append(DocumentResponse(
                id=0,
                team_id=team_id,
                filename=f.filename,
                doc_type="unknown",
                file_size=file_size,
                chunk_count=0,
                status="error",
                error_message=error_msg,
            ))
            continue

        safe_name = f"{uuid.uuid4().hex[:8]}_{f.filename}"
        file_path = os.path.join(UPLOAD_DIR, safe_name)
        with open(file_path, "wb") as out:
            out.write(content)

        doc_type = get_doc_type(f.filename)
        doc_record = Document(
            team_id=team_id,
            uploader_id=current_user.id,
            filename=f.filename,
            stored_path=file_path,
            doc_type=doc_type,
            file_size=file_size,
            status="pending",
        )
        db.add(doc_record)
        db.flush()

        background_tasks.add_task(
            _process_and_ingest,
            doc_record_id=doc_record.id,
            file_path=file_path,
            filename=f.filename,
            team_id=team_id,
            uploader_email=current_user.email,
            db_url=str(db.bind.url) if db.bind else "",
        )

        documents.append(DocumentResponse(
            id=doc_record.id,
            team_id=team_id,
            filename=f.filename,
            doc_type=doc_type,
            file_size=file_size,
            chunk_count=0,
            status="pending",
            uploader_email=current_user.email,
        ))

    db.commit()

    return IngestResponse(
        message=f"Queued {len(documents)} file(s) for processing.",
        documents=documents,
        total_chunks=total_chunks,
    )


@router.post("/ingest-text", response_model=IngestResponse)
async def ingest_text(
    data: IngestTextRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ingest raw text. Requires owner or editor role."""
    team = _verify_team_access(current_user, data.team_id, db)
    _require_editor_or_owner(current_user, data.team_id, db)

    doc_record = Document(
        team_id=data.team_id,
        uploader_id=current_user.id,
        filename=data.title,
        stored_path="[text_input]",
        doc_type="text",
        file_size=len(data.content.encode("utf-8")),
        status="processing",
    )
    db.add(doc_record)
    db.flush()

    try:
        chunks = process_text(
            text=data.content,
            title=data.title,
            team_id=data.team_id,
            document_id=doc_record.id,
            uploader_email=current_user.email,
        )
        chunk_count = rag_engine.ingest_chunks(data.team_id, chunks)
        doc_record.chunk_count = chunk_count
        doc_record.status = "ready"
        db.commit()

        return IngestResponse(
            message=f"Text '{data.title}' ingested successfully.",
            documents=[DocumentResponse(
                id=doc_record.id,
                team_id=data.team_id,
                filename=data.title,
                doc_type="text",
                file_size=doc_record.file_size,
                chunk_count=chunk_count,
                status="ready",
                uploader_email=current_user.email,
            )],
            total_chunks=chunk_count,
        )
    except Exception as e:
        doc_record.status = "error"
        doc_record.error_message = str(e)[:500]
        db.commit()
        raise HTTPException(status_code=500, detail=f"Error ingesting text: {str(e)}")


# ──────────────────────────────────────────────
# KNOWLEDGE BASE MANAGEMENT
# ──────────────────────────────────────────────

@router.get("/documents/{team_id}", response_model=DocumentListResponse)
async def list_documents(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all documents in a team's knowledge base. Any team member can view."""
    _verify_team_access(current_user, team_id, db)

    docs = db.query(Document).filter(Document.team_id == team_id).order_by(Document.created_at.desc()).all()

    doc_responses = []
    for doc in docs:
        doc_responses.append(DocumentResponse(
            id=doc.id,
            team_id=doc.team_id,
            filename=doc.filename,
            doc_type=doc.doc_type,
            file_size=doc.file_size,
            chunk_count=doc.chunk_count,
            status=doc.status,
            error_message=doc.error_message,
            uploader_email=doc.uploader.email if doc.uploader else None,
            created_at=doc.created_at,
        ))

    return DocumentListResponse(documents=doc_responses, total=len(doc_responses))


@router.delete("/documents/{doc_id}", response_model=DeleteResponse)
async def delete_document(
    doc_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a document. Requires owner or editor role."""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    _verify_team_access(current_user, doc.team_id, db)
    _require_editor_or_owner(current_user, doc.team_id, db)

    deleted = rag_engine.delete_document_chunks(doc.team_id, doc.id)

    if doc.stored_path and doc.stored_path != "[text_input]" and os.path.exists(doc.stored_path):
        try:
            os.remove(doc.stored_path)
        except Exception as e:
            print(f"[RAG] Warning: Could not delete file {doc.stored_path}: {e}")

    db.delete(doc)
    db.commit()

    return DeleteResponse(
        message=f"Document '{doc.filename}' deleted successfully.",
        deleted_count=deleted,
    )


@router.get("/stats/{team_id}", response_model=KnowledgeBaseStats)
async def knowledge_base_stats(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get knowledge base statistics for a team."""
    _verify_team_access(current_user, team_id, db)
    stats = rag_engine.get_stats(team_id)
    return KnowledgeBaseStats(**stats)


# ──────────────────────────────────────────────
# USER ROLE ENDPOINT
# ──────────────────────────────────────────────

@router.get("/my-role/{team_id}")
async def get_my_role(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the current user's role in a team."""
    _verify_team_access(current_user, team_id, db)
    role = _get_user_team_role(current_user, team_id, db)
    return {"role": role, "team_id": team_id, "user_id": current_user.id}


# ──────────────────────────────────────────────
# AI CHAT (user-scoped — private per user)
# ──────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
async def chat_with_brain(
    data: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Send a message to the AI Brain.
    Chat history is PRIVATE per user — each user has their own conversation
    within the shared team knowledge base.
    """
    team = _verify_team_access(current_user, data.team_id, db)

    # Get THIS USER's recent chat history (private conversation)
    history_records = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.team_id == data.team_id,
            ChatMessage.user_id == current_user.id,  # User-scoped!
        )
        .order_by(ChatMessage.created_at.desc())
        .limit(20)
        .all()
    )
    history_records.reverse()

    chat_history = [
        {"role": msg.role, "content": msg.content}
        for msg in history_records
    ]

    result = rag_engine.chat(
        team_id=data.team_id,
        query=data.message,
        chat_history=chat_history,
        filters=data.filters,
    )

    # Save user message
    user_msg = ChatMessage(
        team_id=data.team_id,
        user_id=current_user.id,
        role="user",
        content=data.message,
    )
    db.add(user_msg)

    # Save assistant response
    assistant_msg = ChatMessage(
        team_id=data.team_id,
        user_id=current_user.id,
        role="assistant",
        content=result["response"],
        sources=json.dumps(result["sources"]) if result["sources"] else None,
    )
    db.add(assistant_msg)
    db.commit()

    return ChatResponse(
        response=result["response"],
        sources=result["sources"],
        chunk_count=result["chunk_count"],
    )


@router.get("/chat/history/{team_id}", response_model=ChatHistoryResponse)
async def get_chat_history(
    team_id: int,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the CURRENT USER's private chat history for a team."""
    _verify_team_access(current_user, team_id, db)

    messages = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.team_id == team_id,
            ChatMessage.user_id == current_user.id,  # User-scoped!
        )
        .order_by(ChatMessage.created_at.asc())
        .limit(limit)
        .all()
    )

    return ChatHistoryResponse(
        messages=[
            ChatMessageResponse(
                id=msg.id,
                role=msg.role,
                content=msg.content,
                sources=msg.sources,
                created_at=msg.created_at,
            )
            for msg in messages
        ],
        total=len(messages),
    )


@router.delete("/chat/history/{team_id}", response_model=DeleteResponse)
async def clear_chat_history(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clear the CURRENT USER's private chat history for a team."""
    _verify_team_access(current_user, team_id, db)

    count = db.query(ChatMessage).filter(
        ChatMessage.team_id == team_id,
        ChatMessage.user_id == current_user.id,  # User-scoped!
    ).delete()
    db.commit()

    return DeleteResponse(
        message=f"Cleared {count} of your message(s) from chat history.",
        deleted_count=count,
    )
