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
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, BackgroundTasks, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.core.dependencies import get_current_user
from app.core.database import get_db
from app.models.user import User, Team, Project, Document, ChatMessage, UserRole, Role, user_team
from app.models.calendar_task import CalendarTask, task_tagged_users
from app.models.timeline import TimelineEntry
from app.schemas.rag import (
    IngestTextRequest,
    IngestURLRequest,
    DriveIngestRequest,
    GitHubIngestRequest,
    IngestResponse,
    DocumentResponse,
    DocumentListResponse,
    ChatRequest,
    ChatResponse,
    ChatMessageResponse,
    ChatHistoryResponse,
    ChatSessionsListResponse,
    ChatSessionResponse,
    KnowledgeBaseStats,
    DeleteResponse,
    RecentKnowledgeItem,
    RecentKnowledgeResponse,
)
from app.rag.engine import rag_engine
from app.rag.processor import (
    process_document,
    process_text,
    process_drive_url,
    process_url,
    process_github_url,
    process_github_repo,
    parse_drive_url,
    list_folder_files,
    validate_file,
    get_doc_type,
)

router = APIRouter()

UPLOAD_DIR = os.path.join("app", "static", "uploads", "rag")


# ──────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────

def _verify_team_access(user: User, team_id: int, db: Session) -> Team:
    """Verify that the user belongs to the specified team using an explicit DB query."""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    # Explicit SQL membership check — avoids lazy-load identity-map pitfalls
    membership = db.query(user_team).filter(
        user_team.c.user_id == user.id,
        user_team.c.team_id == team_id,
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="You are not a member of this team")

    return team


def _get_user_team_role(user: User, team_id: int, db: Session) -> str:
    """
    Get the user's role for a SPECIFIC team.
    Only considers UserRole records scoped to this team (team_id matches).
    Returns: 'owner', 'editor', 'viewer', or 'member' (treated as viewer).
    """
    user_roles = (
        db.query(UserRole)
        .filter(
            UserRole.user_id == user.id,
            UserRole.team_id == team_id,
        )
        .all()
    )

    for ur in user_roles:
        if ur.role:
            role_name = ur.role.name.lower()
            if role_name in ("owner", "editor", "viewer"):
                return role_name

    # Default: member role or no role → viewer
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


# Intent words that signal "show me data" rather than a conceptual question
_RETRIEVAL_INTENTS = [
    "show me", "show my", "list my", "list me", "give me", "what are my",
    "what do i have", "what tasks", "my tasks", "my calendar", "my schedule",
    "upcoming tasks", "open tasks", "pending tasks", "assigned to me",
    "tagged to me", "calendar update", "task update", "tasks for",
    "do i have any", "any tasks", "any meetings", "what's on my", "whats on my",
]


def _is_task_query(message: str) -> bool:
    """True only when the user is clearly requesting their live task/calendar data."""
    text = (message or "").lower()
    return any(intent in text for intent in _RETRIEVAL_INTENTS)


def _is_timeline_query(message: str) -> bool:
    """True only when the user is clearly requesting their live timeline/memory data."""
    text = (message or "").lower()
    # Specific compound phrases that unambiguously mean "show me the timeline data"
    specific_phrases = [
        "timeline update", "timeline entries", "timeline entry",
        "show timeline", "show the timeline", "show my timeline",
        "memory timeline", "recent milestones", "recent decisions",
        "project history entries", "latest timeline",
    ]
    return any(p in text for p in specific_phrases)


def _build_live_timeline_summary(db: Session, team_id: int, max_items: int = 15) -> str:
    """Build a rich card response from live TimelineEntry data for a team."""
    card_payload: dict = {
        "type": "timeline",
        "heading": "Memory Timeline — Latest Entries",
        "url": "/memory",
        "items": [],
    }

    entries = (
        db.query(TimelineEntry)
        .filter(TimelineEntry.team_id == team_id)
        .order_by(TimelineEntry.created_at.desc())
        .limit(max_items)
        .all()
    )

    for e in entries:
        ts = e.created_at.strftime("%b %d, %Y") if e.created_at else "Unknown date"
        card_payload["items"].append({
            "entry_type": e.entry_type.value,
            "title": e.title,
            "date": ts,
            "content": e.content[:180] + ("..." if len(e.content) > 180 else ""),
        })

    return "__CARDS__:" + json.dumps(card_payload)


def _build_live_task_summary(db: Session, team_id: int, current_user: User, max_items: int = 12) -> str:
    """Build a direct response from live calendar task data for the current user."""
    now_utc = datetime.now(timezone.utc)

    tasks = (
        db.query(CalendarTask)
        .outerjoin(task_tagged_users, CalendarTask.id == task_tagged_users.c.task_id)
        .filter(
            CalendarTask.team_id == team_id,
            CalendarTask.is_completed.is_(False),
            or_(
                CalendarTask.user_id == current_user.id,
                task_tagged_users.c.user_id == current_user.id,
            ),
            CalendarTask.end_datetime >= now_utc,
        )
        .distinct()
        .order_by(CalendarTask.start_datetime.asc())
        .limit(max_items)
        .all()
    )

    card_payload: dict = {
        "type": "calendar",
        "heading": "Your Upcoming Tasks",
        "url": "/dashboard",
        "items": [],
    }

    if not tasks:
        return "__CARDS__:" + json.dumps(card_payload)

    for t in tasks:
        start = t.start_datetime.astimezone(timezone.utc).strftime("%b %d %I:%M %p")
        end = t.end_datetime.astimezone(timezone.utc).strftime("%b %d %I:%M %p")
        card_payload["items"].append({
            "title": t.title,
            "priority": t.priority or "medium",
            "start": start,
            "end": end,
            "location": t.location or None,
        })

    return "__CARDS__:" + json.dumps(card_payload)


# ──────────────────────────────────────────────
# INGESTION ENDPOINTS
# ──────────────────────────────────────────────

def _generate_doc_summary(chunks, filename: str, max_chunks: int = 5) -> str:
    """Generate a one-line summary from the first chunks of a document using the cheap LLM."""
    try:
        texts = []
        for i, chunk in enumerate(chunks[:max_chunks]):
            snippet = (chunk.page_content or "").strip()
            if len(snippet) > 600:
                snippet = snippet[:600] + "..."
            texts.append(snippet)

        if not texts:
            return f"Document: {filename}"

        joined = "\n\n".join(texts)

        from langchain_core.messages import SystemMessage, HumanMessage
        messages = [
            SystemMessage(content=(
                "Summarize the following document excerpt in ONE concise sentence (max 30 words). "
                "Focus on the key topic or purpose of the document. Return ONLY the summary sentence."
            )),
            HumanMessage(content=f"Document: {filename}\n\n{joined}"),
        ]

        response = rag_engine.invoke_expansion(messages)
        return response.content.strip()[:300]
    except Exception as e:
        print(f"[RAG] Summary generation failed for {filename}: {e}")
        return f"Document: {filename}"


def _update_folder_summary(doc, db):
    """Update the parent folder's summary to reflect its children's status."""
    if not doc.folder_id:
        return
    try:
        folder = db.query(Document).filter(Document.id == doc.folder_id).first()
        if not folder:
            return
        children = db.query(Document).filter(Document.folder_id == folder.id).all()
        ready_count = sum(1 for c in children if c.status == "ready")
        total_count = len(children)
        total_chunks = sum(c.chunk_count for c in children)

        folder.chunk_count = total_chunks
        folder.summary = f"{ready_count}/{total_count} files imported • {total_chunks} chunks total"
        folder.filename = folder.filename  # keep name
        db.commit()
    except Exception as e:
        print(f"[RAG] Error updating folder summary: {e}")

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

        # Generate summary BEFORE ingest so it lands on each chunk's metadata
        summary = _generate_doc_summary(chunks, filename)
        for c in chunks:
            c.metadata["doc_summary"] = summary

        # Ingest into ChromaDB
        chunk_count = rag_engine.ingest_chunks(team_id, chunks)

        # Update record
        doc.chunk_count = chunk_count
        doc.status = "ready"
        doc.summary = summary
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
        summary = _generate_doc_summary(chunks, data.title)
        for c in chunks:
            c.metadata["doc_summary"] = summary
        chunk_count = rag_engine.ingest_chunks(data.team_id, chunks)
        doc_record.chunk_count = chunk_count
        doc_record.status = "ready"
        doc_record.summary = summary
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


# ─── Background task for Drive ingestion ───

def _process_and_ingest_drive(
    doc_record_id: int,
    source_url: str,
    team_id: int,
    uploader_email: str,
):
    """Background task: Download a Google Drive file and ingest into ChromaDB."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == doc_record_id).first()
        if not doc:
            return

        doc.status = "processing"
        db.commit()

        chunks, filename, doc_type, file_size = process_drive_url(
            url=source_url,
            team_id=team_id,
            document_id=doc_record_id,
            uploader_email=uploader_email,
        )

        # Generate summary BEFORE ingest so it lands on each chunk's metadata
        summary = _generate_doc_summary(chunks, filename)
        for c in chunks:
            c.metadata["doc_summary"] = summary

        chunk_count = rag_engine.ingest_chunks(team_id, chunks)

        # Keep user-provided custom name; only overwrite generic placeholder names
        current_name = doc.filename or ""
        is_placeholder = (
            current_name.startswith("Drive import (")
            or current_name.startswith("Drive Folder (")
        )
        if is_placeholder:
            doc.filename = filename
        doc.doc_type = doc_type
        doc.file_size = file_size
        doc.chunk_count = chunk_count
        doc.status = "ready"
        doc.summary = summary
        doc.last_synced_at = datetime.now(timezone.utc)
        db.commit()

        # Update parent folder status if applicable
        _update_folder_summary(doc, db)

        print(f"[RAG] ✅ Drive doc '{filename}' → {chunk_count} chunks for team {team_id}")

    except Exception as e:
        print(f"[RAG] ❌ Error processing Drive URL: {e}")
        db.rollback()
        doc = db.query(Document).filter(Document.id == doc_record_id).first()
        if doc:
            doc.status = "error"
            doc.error_message = str(e)[:500]
            db.commit()
    finally:
        db.close()


@router.post("/ingest-drive", response_model=IngestResponse)
async def ingest_drive_document(
    data: DriveIngestRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ingest a public Google Drive document or folder. Requires owner or editor role."""
    team = _verify_team_access(current_user, data.team_id, db)
    _require_editor_or_owner(current_user, data.team_id, db)

    # Validate and parse the Drive URL
    try:
        file_id, url_type = parse_drive_url(data.drive_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Validate refresh interval
    if data.refresh_interval_hours is not None and data.refresh_interval_hours < 1:
        raise HTTPException(status_code=400, detail="Refresh interval must be at least 1 hour.")

    # Sanitize custom_name (strip to 200 chars, fallback to None)
    custom_name = (data.custom_name or "").strip()[:200] or None

    # ── Folder: create a parent folder document, then child docs for each file ──
    if url_type == "folder":
        try:
            folder_files = list_folder_files(file_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        if len(folder_files) > 50:
            raise HTTPException(
                status_code=400,
                detail=f"Folder contains {len(folder_files)} files. Maximum is 50. "
                       "Please share a smaller folder or individual files.",
            )

        # Create parent folder document
        folder_display = custom_name or f"Drive Folder ({file_id[:8]}...)"
        folder_record = Document(
            team_id=data.team_id,
            uploader_id=current_user.id,
            filename=folder_display,
            stored_path=None,
            doc_type="folder",
            file_size=0,
            status="ready",
            source_url=data.drive_url,
            drive_file_id=file_id,
            refresh_interval_hours=data.refresh_interval_hours,
        )
        db.add(folder_record)
        db.flush()

        child_responses = []
        for fid, fname, _ in folder_files:
            file_url = f"https://drive.google.com/file/d/{fid}/view"
            doc_record = Document(
                team_id=data.team_id,
                uploader_id=current_user.id,
                filename=f"Drive import ({fid[:8]}...)",
                stored_path=None,
                doc_type="text",
                file_size=0,
                status="pending",
                source_url=file_url,
                drive_file_id=fid,
                refresh_interval_hours=data.refresh_interval_hours,
                folder_id=folder_record.id,
            )
            db.add(doc_record)
            db.flush()

            background_tasks.add_task(
                _process_and_ingest_drive,
                doc_record_id=doc_record.id,
                source_url=file_url,
                team_id=data.team_id,
                uploader_email=current_user.email,
            )

            child_responses.append(DocumentResponse(
                id=doc_record.id,
                team_id=data.team_id,
                filename=doc_record.filename,
                doc_type="text",
                file_size=0,
                chunk_count=0,
                status="pending",
                uploader_email=current_user.email,
                source_url=file_url,
                folder_id=folder_record.id,
            ))

        db.commit()

        folder_response = DocumentResponse(
            id=folder_record.id,
            team_id=data.team_id,
            filename=folder_record.filename,
            doc_type="folder",
            file_size=0,
            chunk_count=0,
            status="ready",
            uploader_email=current_user.email,
            source_url=data.drive_url,
            children=child_responses,
        )

        return IngestResponse(
            message=f"Google Drive folder queued — {len(child_responses)} file(s) will be imported.",
            documents=[folder_response],
            total_chunks=0,
        )

    # ── Single file ──
    single_display = custom_name or f"Drive import ({file_id[:8]}...)"
    doc_record = Document(
        team_id=data.team_id,
        uploader_id=current_user.id,
        filename=single_display,
        stored_path=None,
        doc_type="text",
        file_size=0,
        status="pending",
        source_url=data.drive_url,
        drive_file_id=file_id,
        refresh_interval_hours=data.refresh_interval_hours,
    )
    db.add(doc_record)
    db.flush()

    background_tasks.add_task(
        _process_and_ingest_drive,
        doc_record_id=doc_record.id,
        source_url=data.drive_url,
        team_id=data.team_id,
        uploader_email=current_user.email,
    )

    db.commit()

    return IngestResponse(
        message="Google Drive document queued for import.",
        documents=[DocumentResponse(
            id=doc_record.id,
            team_id=data.team_id,
            filename=doc_record.filename,
            doc_type="text",
            file_size=0,
            chunk_count=0,
            status="pending",
            uploader_email=current_user.email,
            source_url=data.drive_url,
        )],
        total_chunks=0,
    )


@router.post("/ingest-github", response_model=IngestResponse)
async def ingest_github_document(
    data: GitHubIngestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ingest a public GitHub file or repository. Requires owner or editor role."""
    team = _verify_team_access(current_user, data.team_id, db)
    _require_editor_or_owner(current_user, data.team_id, db)

    github_url = (data.github_url or "").strip()
    if not github_url:
        raise HTTPException(status_code=400, detail="GitHub URL is required.")

    # Determine if this is a repo URL or file URL
    is_repo_url = "github.com" in github_url and "/blob/" not in github_url

    custom_name = (data.custom_name or "").strip()[:200] or None
    doc_record = Document(
        team_id=data.team_id,
        uploader_id=current_user.id,
        filename=custom_name or github_url,
        stored_path=None,
        doc_type="text",
        file_size=0,
        chunk_count=0,
        status="processing",
        source_url=github_url,
    )
    db.add(doc_record)
    db.flush()

    try:
        if is_repo_url:
            # Process entire repository
            chunks, title, file_size = process_github_repo(
                repo_url=github_url,
                team_id=data.team_id,
                document_id=doc_record.id,
                uploader_email=current_user.email,
            )
        else:
            # Process single file
            chunks, title, file_size = process_github_url(
                github_url=github_url,
                team_id=data.team_id,
                document_id=doc_record.id,
                uploader_email=current_user.email,
            )

        summary = _generate_doc_summary(chunks, title)
        for c in chunks:
            c.metadata["doc_summary"] = summary

        chunk_count = rag_engine.ingest_chunks(data.team_id, chunks)

        doc_record.filename = custom_name or title
        doc_record.file_size = file_size
        doc_record.chunk_count = chunk_count
        doc_record.status = "ready"
        doc_record.summary = summary
        db.commit()

        return IngestResponse(
            message=f"GitHub {'repository' if is_repo_url else 'file'} '{doc_record.filename}' ingested successfully.",
            documents=[DocumentResponse(
                id=doc_record.id,
                team_id=data.team_id,
                filename=doc_record.filename,
                doc_type="text",
                file_size=file_size,
                chunk_count=chunk_count,
                status="ready",
                uploader_email=current_user.email,
                source_url=github_url,
            )],
            total_chunks=chunk_count,
        )
    except ValueError as e:
        doc_record.status = "error"
        doc_record.error_message = str(e)[:500]
        db.commit()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        doc_record.status = "error"
        doc_record.error_message = str(e)[:500]
        db.commit()
        raise HTTPException(status_code=500, detail=f"Error ingesting GitHub {'repository' if is_repo_url else 'file'}: {str(e)}")


# ═══════════════════════════════════════════════════
# SINGLE DOCUMENT DETAIL + CHUNKS PREVIEW
# ═══════════════════════════════════════════════════

@router.get("/documents/{doc_id}/detail", response_model=DocumentResponse)
async def get_document_detail(
    doc_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get fresh details for a single document (used by the drawer for live polling)."""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    _verify_team_access(current_user, doc.team_id, db)

    return DocumentResponse(
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
        source_url=doc.source_url,
        last_synced_at=doc.last_synced_at,
        refresh_interval_hours=doc.refresh_interval_hours,
        folder_id=doc.folder_id,
        summary=doc.summary,
    )


@router.get("/documents/{doc_id}/chunks")
async def get_document_chunks(
    doc_id: int,
    limit: int = 20,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get indexed chunks for a document (content preview)."""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    _verify_team_access(current_user, doc.team_id, db)

    result = rag_engine.get_document_chunks(doc.team_id, doc_id, limit=limit, offset=offset)
    return result


@router.post("/documents/{doc_id}/refresh", response_model=DocumentResponse)
async def refresh_document(
    doc_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-download and re-ingest a Drive-sourced document. Requires owner or editor."""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    _verify_team_access(current_user, doc.team_id, db)
    _require_editor_or_owner(current_user, doc.team_id, db)

    if not doc.source_url:
        raise HTTPException(status_code=400, detail="This document has no source URL to refresh from.")

    # Delete old chunks from ChromaDB
    rag_engine.delete_document_chunks(doc.team_id, doc.id)

    doc.status = "processing"
    doc.error_message = None
    doc.chunk_count = 0
    db.commit()

    background_tasks.add_task(
        _process_and_ingest_drive,
        doc_record_id=doc.id,
        source_url=doc.source_url,
        team_id=doc.team_id,
        uploader_email=current_user.email,
    )

    return DocumentResponse(
        id=doc.id,
        team_id=doc.team_id,
        filename=doc.filename,
        doc_type=doc.doc_type,
        file_size=doc.file_size,
        chunk_count=0,
        status="processing",
        uploader_email=doc.uploader.email if doc.uploader else None,
        created_at=doc.created_at,
        source_url=doc.source_url,
        last_synced_at=doc.last_synced_at,
        refresh_interval_hours=doc.refresh_interval_hours,
    )


@router.post("/ingest-url", response_model=IngestResponse)
async def ingest_url(
    data: IngestURLRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ingest content from a generic URL. Requires owner or editor role."""
    team = _verify_team_access(current_user, data.team_id, db)
    _require_editor_or_owner(current_user, data.team_id, db)

    # Basic URL validation
    url = data.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")

    doc_record = Document(
        team_id=data.team_id,
        uploader_id=current_user.id,
        filename=url[:80],
        stored_path=None,
        doc_type="text",
        file_size=0,
        status="processing",
        source_url=url,
    )
    db.add(doc_record)
    db.flush()

    try:
        chunks, title, file_size = process_url(
            url=url,
            team_id=data.team_id,
            document_id=doc_record.id,
            uploader_email=current_user.email,
        )
        summary = _generate_doc_summary(chunks, title)
        for c in chunks:
            c.metadata["doc_summary"] = summary
        chunk_count = rag_engine.ingest_chunks(data.team_id, chunks)
        doc_record.filename = title
        doc_record.file_size = file_size
        doc_record.chunk_count = chunk_count
        doc_record.status = "ready"
        doc_record.summary = summary
        db.commit()

        return IngestResponse(
            message=f"URL content '{title}' ingested successfully.",
            documents=[DocumentResponse(
                id=doc_record.id,
                team_id=data.team_id,
                filename=title,
                doc_type="text",
                file_size=file_size,
                chunk_count=chunk_count,
                status="ready",
                uploader_email=current_user.email,
                source_url=url,
            )],
            total_chunks=chunk_count,
        )
    except ValueError as e:
        doc_record.status = "error"
        doc_record.error_message = str(e)[:500]
        db.commit()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        doc_record.status = "error"
        doc_record.error_message = str(e)[:500]
        db.commit()
        raise HTTPException(status_code=500, detail=f"Error ingesting URL: {str(e)}")


# ──────────────────────────────────────────────
# KNOWLEDGE BASE MANAGEMENT
# ──────────────────────────────────────────────

@router.get("/documents/{team_id}", response_model=DocumentListResponse)
async def list_documents(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all documents in a team's knowledge base. Folders include nested children."""
    _verify_team_access(current_user, team_id, db)

    docs = db.query(Document).filter(Document.team_id == team_id).order_by(Document.created_at.desc()).all()

    # Build a lookup of folder_id → children
    children_map: dict = {}
    for doc in docs:
        if doc.folder_id:
            children_map.setdefault(doc.folder_id, []).append(doc)

    doc_responses = []
    for doc in docs:
        # Skip child docs — they'll be nested inside their folder
        if doc.folder_id is not None:
            continue

        children_list = None
        if doc.doc_type == "folder":
            children_list = [
                DocumentResponse(
                    id=child.id,
                    team_id=child.team_id,
                    filename=child.filename,
                    doc_type=child.doc_type,
                    file_size=child.file_size,
                    chunk_count=child.chunk_count,
                    status=child.status,
                    error_message=child.error_message,
                    uploader_email=child.uploader.email if child.uploader else None,
                    created_at=child.created_at,
                    source_url=child.source_url,
                    last_synced_at=child.last_synced_at,
                    refresh_interval_hours=child.refresh_interval_hours,
                    folder_id=child.folder_id,
                    summary=child.summary,
                )
                for child in children_map.get(doc.id, [])
            ]

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
            source_url=doc.source_url,
            last_synced_at=doc.last_synced_at,
            refresh_interval_hours=doc.refresh_interval_hours,
            folder_id=doc.folder_id,
            summary=doc.summary,
            children=children_list,
        ))

    return DocumentListResponse(documents=doc_responses, total=len(doc_responses))


@router.delete("/documents/{doc_id}", response_model=DeleteResponse)
async def delete_document(
    doc_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a document (and all children if it's a folder). Requires owner or editor role."""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    _verify_team_access(current_user, doc.team_id, db)
    _require_editor_or_owner(current_user, doc.team_id, db)

    total_deleted = 0

    # If this is a folder, cascade delete all children first
    if doc.doc_type == "folder":
        children = db.query(Document).filter(Document.folder_id == doc.id).all()
        for child in children:
            total_deleted += rag_engine.delete_document_chunks(child.team_id, child.id)
            if child.stored_path and child.stored_path != "[text_input]" and os.path.exists(child.stored_path):
                try:
                    os.remove(child.stored_path)
                except Exception as e:
                    print(f"[RAG] Warning: Could not delete file {child.stored_path}: {e}")
            db.delete(child)

    # Delete the document's own chunks
    total_deleted += rag_engine.delete_document_chunks(doc.team_id, doc.id)

    if doc.stored_path and doc.stored_path != "[text_input]" and os.path.exists(doc.stored_path):
        try:
            os.remove(doc.stored_path)
        except Exception as e:
            print(f"[RAG] Warning: Could not delete file {doc.stored_path}: {e}")

    db.delete(doc)
    db.commit()

    return DeleteResponse(
        message=f"Document '{doc.filename}' and all contents deleted successfully.",
        deleted_count=total_deleted,
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


@router.get("/recent-chunks/{team_id}", response_model=RecentKnowledgeResponse)
async def recent_knowledge_chunks(
    team_id: int,
    limit: int = Query(6, ge=1, le=20),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get recent knowledge summaries from stored document summaries (fast, no LLM call)."""
    _verify_team_access(current_user, team_id, db)

    recent_docs = (
        db.query(Document)
        .filter(
            Document.team_id == team_id,
            Document.status == "ready",
            Document.doc_type != "folder",
            Document.folder_id.is_(None),  # Only top-level docs (not folder children)
        )
        .order_by(Document.created_at.desc())
        .limit(limit)
        .all()
    )

    items = []
    for doc in recent_docs:
        items.append(RecentKnowledgeItem(
            summary=doc.summary or f"Document: {doc.filename}",
            filename=doc.filename,
            doc_type=doc.doc_type,
            uploaded_at=doc.created_at.isoformat() if doc.created_at else "",
        ))

    # Also include summaries for folders (as a single entry per folder)
    recent_folders = (
        db.query(Document)
        .filter(
            Document.team_id == team_id,
            Document.doc_type == "folder",
        )
        .order_by(Document.created_at.desc())
        .limit(limit)
        .all()
    )

    for folder in recent_folders:
        items.append(RecentKnowledgeItem(
            summary=folder.summary or f"Folder: {folder.filename}",
            filename=folder.filename,
            doc_type="folder",
            uploaded_at=folder.created_at.isoformat() if folder.created_at else "",
        ))

    # Sort by uploaded_at descending and trim to limit
    items.sort(key=lambda x: x.uploaded_at, reverse=True)
    items = items[:limit]

    return RecentKnowledgeResponse(items=items, total=len(items))


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

    # Timeline check MUST come first — its prompts also contain retrieval intent
    # phrases (e.g. "give me") that would otherwise match _is_task_query.
    if _is_timeline_query(data.message):
        timeline_response = _build_live_timeline_summary(db, data.team_id)

        user_msg = ChatMessage(
            team_id=data.team_id,
            user_id=current_user.id,
            session_id=data.session_id,
            role="user",
            content=data.message,
        )
        db.add(user_msg)

        assistant_msg = ChatMessage(
            team_id=data.team_id,
            user_id=current_user.id,
            session_id=data.session_id,
            role="assistant",
            content=timeline_response,
            sources=json.dumps([
                {
                    "filename": "Live Memory Timeline",
                    "page_number": 0,
                    "uploader": "system",
                    "doc_type": "timeline_entry",
                }
            ]),
        )
        db.add(assistant_msg)
        db.commit()

        return ChatResponse(
            response=timeline_response,
            sources=[
                {
                    "filename": "Live Memory Timeline",
                    "page_number": 0,
                    "uploader": "system",
                    "doc_type": "timeline_entry",
                }
            ],
            chunk_count=0,
        )

    # If the user is asking about tasks/calendar, answer from live DB.
    elif _is_task_query(data.message):
        task_response = _build_live_task_summary(db, data.team_id, current_user)

        user_msg = ChatMessage(
            team_id=data.team_id,
            user_id=current_user.id,
            session_id=data.session_id,
            role="user",
            content=data.message,
        )
        db.add(user_msg)

        assistant_msg = ChatMessage(
            team_id=data.team_id,
            user_id=current_user.id,
            session_id=data.session_id,
            role="assistant",
            content=task_response,
            sources=json.dumps([
                {
                    "filename": "Live Calendar Tasks",
                    "page_number": 0,
                    "uploader": "system",
                    "doc_type": "calendar_task",
                }
            ]),
        )
        db.add(assistant_msg)
        db.commit()

        return ChatResponse(
            response=task_response,
            sources=[
                {
                    "filename": "Live Calendar Tasks",
                    "page_number": 0,
                    "uploader": "system",
                    "doc_type": "calendar_task",
                }
            ],
            chunk_count=0,
        )

    # Get THIS USER's recent chat history (private conversation)
    history_filter = [
        ChatMessage.team_id == data.team_id,
        ChatMessage.user_id == current_user.id,  # User-scoped!
    ]
    if data.session_id:
        history_filter.append(ChatMessage.session_id == data.session_id)

    history_records = (
        db.query(ChatMessage)
        .filter(*history_filter)
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
        session_id=data.session_id,
        role="user",
        content=data.message,
    )
    db.add(user_msg)

    # Save assistant response
    assistant_msg = ChatMessage(
        team_id=data.team_id,
        user_id=current_user.id,
        session_id=data.session_id,
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
    session_id: str = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the CURRENT USER's private chat history for a team."""
    _verify_team_access(current_user, team_id, db)

    filters = [
        ChatMessage.team_id == team_id,
        ChatMessage.user_id == current_user.id,  # User-scoped!
    ]
    if session_id:
        filters.append(ChatMessage.session_id == session_id)

    messages = (
        db.query(ChatMessage)
        .filter(*filters)
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
                session_id=msg.session_id,
                created_at=msg.created_at,
            )
            for msg in messages
        ],
        total=len(messages),
    )


@router.get("/chat/sessions/{team_id}", response_model=ChatSessionsListResponse)
async def get_chat_sessions(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all chat sessions for the current user in a team."""
    _verify_team_access(current_user, team_id, db)

    from sqlalchemy import func as sa_func, distinct

    # Get distinct session_ids with their first user message and counts
    sessions_raw = (
        db.query(
            ChatMessage.session_id,
            sa_func.min(ChatMessage.created_at).label("created_at"),
            sa_func.count(ChatMessage.id).label("message_count"),
        )
        .filter(
            ChatMessage.team_id == team_id,
            ChatMessage.user_id == current_user.id,
            ChatMessage.session_id.isnot(None),
        )
        .group_by(ChatMessage.session_id)
        .order_by(sa_func.min(ChatMessage.created_at).desc())
        .all()
    )

    sessions = []
    for row in sessions_raw:
        # Get the first user message as preview
        first_msg = (
            db.query(ChatMessage.content)
            .filter(
                ChatMessage.session_id == row.session_id,
                ChatMessage.role == "user",
            )
            .order_by(ChatMessage.created_at.asc())
            .first()
        )
        preview = first_msg[0][:80] if first_msg else "Chat session"

        sessions.append(ChatSessionResponse(
            session_id=row.session_id,
            preview=preview,
            message_count=row.message_count,
            created_at=row.created_at,
        ))

    return ChatSessionsListResponse(sessions=sessions, total=len(sessions))


@router.delete("/chat/history/{team_id}", response_model=DeleteResponse)
async def clear_chat_history(
    team_id: int,
    session_id: str = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clear the CURRENT USER's private chat history for a team (or a single session)."""
    _verify_team_access(current_user, team_id, db)

    filters = [
        ChatMessage.team_id == team_id,
        ChatMessage.user_id == current_user.id,  # User-scoped!
    ]
    if session_id:
        filters.append(ChatMessage.session_id == session_id)

    count = db.query(ChatMessage).filter(*filters).delete()
    db.commit()

    return DeleteResponse(
        message=f"Cleared {count} of your message(s) from chat history.",
        deleted_count=count,
    )
