from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Query
from sqlalchemy.orm import Session
from typing import List, Optional
import os
import uuid
import json

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User, Team, SubTeam, user_team
from app.models.timeline import TimelineEntry
from app.schemas.timeline import TimelineEntryCreate, TimelineEntryResponse, TimelineEntryUpdate, MemoryAnalyticsResponse
from app.core.config import settings
from pydantic import BaseModel

class AutoFillResponse(BaseModel):
    title: str
    content: str
    tags: str

router = APIRouter()


# ──────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────

def _verify_team_member(user: User, team_id: int, db: Session) -> Team:
    """Verify user is a member of the team. Returns the Team object."""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    membership = db.query(user_team).filter(
        user_team.c.user_id == user.id,
        user_team.c.team_id == team_id,
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="Not authorized")
    return team


def _verify_subteam_member(user: User, team_id: int, sub_team_id: int, db: Session) -> SubTeam:
    """Verify user can access the given subteam within the requested team."""
    _verify_team_member(user, team_id, db)
    subteam = db.query(SubTeam).filter(
        SubTeam.id == sub_team_id,
        SubTeam.team_id == team_id,
    ).first()
    if not subteam:
        raise HTTPException(status_code=404, detail="Team not found")
    if user not in subteam.users:
        raise HTTPException(status_code=403, detail="Not authorized")
    return subteam


def _ingest_timeline_entry(team_id: int, entry: TimelineEntry, user_email: str):
    """Background task to safely ingest timeline entry into RAG."""
    try:
        from langchain_core.documents import Document as LCDocument
        from app.rag.engine import rag_engine
        rich_content = (
            f"Project Timeline {entry.entry_type}:\n"
            f"Title: {entry.title}\n"
            f"Tags: {entry.tags or 'None'}\n"
            f"Impact Level: {entry.impact_level or 'Normal'}\n"
            f"Author: {entry.author_name or 'System'}\n"
            f"Collaborators: {entry.collaborators or 'None'}\n"
            f"Details: {entry.content}"
        )
        doc = LCDocument(
            page_content=rich_content,
            metadata={
                "team_id": team_id,
                "document_id": 0,
                "timeline_entry_id": entry.id,
                "sub_team_id": entry.sub_team_id,
                "filename": f"Memory: {entry.title}",
                "uploader_email": user_email,
                "doc_type": "text",
                "source": entry.source_reference or "Project Timeline"
            }
        )
        rag_engine.ingest_chunks(team_id, [doc])
        print(f"[RAG Timeline] Successfully ingested timeline entry '{entry.title}'")
    except Exception as e:
        print(f"[RAG Timeline] Failed to ingest '{entry.title}': {e}")


# ──────────────────────────────────────────────
# CRUD ENDPOINTS
# ──────────────────────────────────────────────

@router.post("/", response_model=TimelineEntryResponse)
def create_timeline_entry(
    entry: TimelineEntryCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Creates a new timeline entry scoped directly to a team."""
    _verify_team_member(current_user, entry.team_id, db)
    if not entry.sub_team_id:
        raise HTTPException(status_code=400, detail="Select a team before creating a memory entry")
    _verify_subteam_member(current_user, entry.team_id, entry.sub_team_id, db)

    db_entry = TimelineEntry(
        team_id=entry.team_id,
        sub_team_id=entry.sub_team_id,
        entry_type=entry.entry_type,
        title=entry.title,
        content=entry.content,
        source_reference=entry.source_reference,
        tags=entry.tags,
        collaborators=entry.collaborators,
        impact_level=entry.impact_level,
        author_name=current_user.full_name or current_user.email.split("@")[0],
        verified_by_id=current_user.id
    )
    db.add(db_entry)
    db.commit()
    db.refresh(db_entry)

    background_tasks.add_task(
        _ingest_timeline_entry,
        team_id=entry.team_id,
        entry=db_entry,
        user_email=current_user.email
    )
    return db_entry


@router.get("/team/{team_id}", response_model=List[TimelineEntryResponse])
def get_team_timeline(
    team_id: int,
    subteam_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Fetches all timeline entries for a team, newest first."""
    _verify_team_member(current_user, team_id, db)
    query = db.query(TimelineEntry).filter(TimelineEntry.team_id == team_id)
    if subteam_id is not None:
        _verify_subteam_member(current_user, team_id, subteam_id, db)
        query = query.filter(TimelineEntry.sub_team_id == subteam_id)
    entries = query.order_by(TimelineEntry.created_at.desc()).all()
    return entries


@router.get("/team/{team_id}/users")
def get_team_users(
    team_id: int,
    subteam_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Returns all members of the team for @mentions."""
    team = _verify_team_member(current_user, team_id, db)
    if subteam_id is not None:
        subteam = _verify_subteam_member(current_user, team_id, subteam_id, db)
        users = subteam.users
    else:
        users = team.users
    return [{"id": u.id, "email": u.email, "full_name": u.full_name or u.email.split("@")[0]} for u in users]


@router.get("/team/{team_id}/analytics", response_model=MemoryAnalyticsResponse)
def get_team_analytics(
    team_id: int,
    subteam_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Returns analytics for a team's memory timeline."""
    _verify_team_member(current_user, team_id, db)

    query = db.query(TimelineEntry).filter(TimelineEntry.team_id == team_id)
    if subteam_id is not None:
        _verify_subteam_member(current_user, team_id, subteam_id, db)
        query = query.filter(TimelineEntry.sub_team_id == subteam_id)
    entries = query.all()

    decisions = sum(1 for e in entries if e.entry_type == "decision")
    milestones = sum(1 for e in entries if e.entry_type == "milestone")
    summaries = sum(1 for e in entries if e.entry_type == "summary")
    uploads = sum(1 for e in entries if e.entry_type == "upload")

    focus = {}
    for e in entries:
        if e.tags:
            for tag in e.tags.split(","):
                tag = tag.strip()
                if tag:
                    focus[tag] = focus.get(tag, 0) + 1

    if not focus:
        focus = {"General Architecture": 100}
    else:
        total_tags = sum(focus.values())
        focus = {k: int((v / total_tags) * 100) for k, v in focus.items()}

    participants = set(e.author_name for e in entries if e.author_name)

    from datetime import datetime, timedelta, timezone
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    recent = sum(1 for e in entries if e.created_at and e.created_at >= week_ago)

    return {
        "decisions_count": decisions,
        "milestones_count": milestones,
        "summaries_count": summaries,
        "uploads_count": uploads,
        "focus_distribution": focus,
        "total_entries_last_7_days": recent,
        "active_participants_count": len(participants) if participants else 1
    }


@router.delete("/{entry_id}")
def delete_timeline_entry(
    entry_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    entry = db.query(TimelineEntry).filter(TimelineEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    _verify_team_member(current_user, entry.team_id, db)

    db.delete(entry)
    db.commit()

    from app.rag.engine import rag_engine
    background_tasks.add_task(
        rag_engine.delete_timeline_entry_chunks,
        team_id=entry.team_id,
        timeline_entry_id=entry_id
    )
    return {"message": "Timeline entry deleted successfully"}


@router.put("/{entry_id}", response_model=TimelineEntryResponse)
def update_timeline_entry(
    entry_id: int,
    update_data: TimelineEntryUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    entry = db.query(TimelineEntry).filter(TimelineEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    _verify_team_member(current_user, entry.team_id, db)

    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(entry, key, value)

    db.commit()
    db.refresh(entry)

    from app.rag.engine import rag_engine
    background_tasks.add_task(rag_engine.delete_timeline_entry_chunks, team_id=entry.team_id, timeline_entry_id=entry_id)
    background_tasks.add_task(_ingest_timeline_entry, team_id=entry.team_id, entry=entry, user_email=current_user.email)

    return entry


# ──────────────────────────────────────────────
# AUTO-FILL VIA AI
# ──────────────────────────────────────────────

@router.post("/auto-fill", response_model=AutoFillResponse)
async def auto_fill_from_document(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """Extracts text from an uploaded document and auto-fills entry inputs via LLM."""
    content = await file.read()
    file_size = len(content)

    from app.rag.processor import load_document, validate_file
    is_valid, error = validate_file(file.filename, file_size)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error)

    safe_name = f"{uuid.uuid4().hex[:8]}_{file.filename}"
    upload_dir = os.path.join("app", "static", "uploads", "temp")
    os.makedirs(upload_dir, exist_ok=True)
    file_path = os.path.join(upload_dir, safe_name)

    with open(file_path, "wb") as f:
        f.write(content)

    try:
        raw_docs = load_document(file_path, file.filename)
        text_content = "\n".join([doc.page_content for doc in raw_docs])
        if not text_content.strip():
            raise HTTPException(
                status_code=400,
                detail="No readable text found. Please upload a document with highlightable text, or try a .txt/.docx file."
            )

        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage
        llm = ChatOpenAI(
            model=settings.RAG_CHAT_MODEL,
            openai_api_key=settings.OPENAI_API_KEY,
            temperature=0.1
        )

        prompt = (
            "You are an AI assistant. Analyze the following text and extract three things:\n"
            "1. A concise 'title' (max 8 words).\n"
            "2. A 'content' summary (2-3 sentences max) capturing the core outcome or meaning.\n"
            "3. A 'tags' string of 1-4 comma-separated highly-relevant keywords.\n"
            "Respond ONLY in valid JSON format: {\"title\": \"...\", \"content\": \"...\", \"tags\": \"...\"}\n\n"
            f"TEXT TO ANALYZE:\n{text_content[:8000]}"
        )

        system = SystemMessage(content="You are a JSON-only response bot.")
        human = HumanMessage(content=prompt)

        res = llm.invoke([system, human])
        raw_response = res.content.strip()
        if raw_response.startswith('```json'):
            raw_response = raw_response[7:-3].strip()
        elif raw_response.startswith('```'):
            raw_response = raw_response[3:-3].strip()

        parsed = json.loads(raw_response)

        return AutoFillResponse(
            title=parsed.get("title", ""),
            content=parsed.get("content", ""),
            tags=parsed.get("tags", "")
        )

    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI processing error: {str(e)}")
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)


# ──────────────────────────────────────────────
# TEAMS LIST (used by memory.js to build the selector)
# ──────────────────────────────────────────────

class TeamResponse(BaseModel):
    id: int           # team_id — the single source of truth
    team_name: str

@router.get("/teams", response_model=List[TeamResponse])
def get_user_teams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Returns all teams the current user belongs to. Frontend uses this for project switching."""
    return [{"id": t.id, "team_name": t.team_name} for t in current_user.teams]