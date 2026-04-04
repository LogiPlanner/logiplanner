from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User, Project
from app.models.timeline import TimelineEntry
from app.schemas.timeline import TimelineEntryCreate, TimelineEntryResponse, TimelineEntryUpdate, MemoryAnalyticsResponse

from langchain_core.documents import Document as LCDocument
from app.rag.engine import rag_engine

router = APIRouter()

def _ingest_timeline_entry(team_id: int, entry: TimelineEntry, user_email: str):
    """Background task to safely ingest timeline entry into RAG."""
    try:
        # Give the AI explicit context in the text payload so it understands *what* this is
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
                "filename": f"Memory: {entry.title}", 
                "uploader_email": user_email,
                "doc_type": "text",
                "source": entry.source_reference or "Project Timeline"
            }
        )
        # RAG engine ingest chunks creates embeddings via OpenAI.
        rag_engine.ingest_chunks(team_id, [doc])
        print(f"[RAG Timeline] Successfully ingested timeline entry '{entry.title}'")
    except Exception as e:
        print(f"[RAG Timeline] Failed to ingest '{entry.title}': {e}")

@router.post("/", response_model=TimelineEntryResponse)
def create_timeline_entry(
    entry: TimelineEntryCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Creates a new timeline entry.
    Automatically assigns the 'verified_by_id' based on the logged-in user.
    """
    db_entry = TimelineEntry(
        project_id=entry.project_id,
        entry_type=entry.entry_type,
        title=entry.title,
        content=entry.content,
        source_reference=entry.source_reference,
        tags=entry.tags,
        collaborators=entry.collaborators,
        impact_level=entry.impact_level,
        author_name=current_user.full_name or current_user.email.split("@")[0],
        verified_by_id=current_user.id  # The crucial Human Verification layer!
    )
    db.add(db_entry)
    db.commit()
    db.refresh(db_entry)
    
    # Send entry to RAG engine via background task
    project = db.query(Project).filter(Project.id == entry.project_id).first()
    if project:
        background_tasks.add_task(
            _ingest_timeline_entry,
            team_id=project.team_id,
            entry=db_entry,
            user_email=current_user.email
        )
        
    return db_entry

@router.get("/project/{project_id}", response_model=List[TimelineEntryResponse])
def get_project_timeline(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Fetches all timeline entries for a specific project, newest first.
    """
    entries = db.query(TimelineEntry)\
                .filter(TimelineEntry.project_id == project_id)\
                .order_by(TimelineEntry.created_at.desc())\
                .all()
    return entries

@router.get("/project/{project_id}/users")
def get_project_users(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project or current_user not in project.users:
        raise HTTPException(status_code=403, detail="Not authorized")
    return [{"id": u.id, "email": u.email, "full_name": u.full_name or u.email.split("@")[0]} for u in project.users]

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
        
    project = db.query(Project).filter(Project.id == entry.project_id).first()
    if not project or current_user not in project.users:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    db.delete(entry)
    db.commit()
    
    background_tasks.add_task(rag_engine.delete_timeline_entry_chunks, team_id=project.team_id, timeline_entry_id=entry_id)
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
        
    project = db.query(Project).filter(Project.id == entry.project_id).first()
    if not project or current_user not in project.users:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(entry, key, value)
        
    db.commit()
    db.refresh(entry)
    
    # Re-ingest
    background_tasks.add_task(rag_engine.delete_timeline_entry_chunks, team_id=project.team_id, timeline_entry_id=entry_id)
    background_tasks.add_task(_ingest_timeline_entry, team_id=project.team_id, entry=entry, user_email=current_user.email)
    
    return entry

from datetime import datetime, timedelta

@router.get("/project/{project_id}/analytics", response_model=MemoryAnalyticsResponse)
def get_project_analytics(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project or current_user not in project.users:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    entries = db.query(TimelineEntry).filter(TimelineEntry.project_id == project_id).all()
    
    decisions = sum(1 for e in entries if e.entry_type == "decision")
    milestones = sum(1 for e in entries if e.entry_type == "milestone")
    summaries = sum(1 for e in entries if e.entry_type == "summary")
    uploads = sum(1 for e in entries if e.entry_type == "upload")
    
    # Calculate focus distribution (mocked partially based on tags)
    focus = {}
    for e in entries:
        if e.tags:
            for tag in e.tags.split(","):
                tag = tag.strip()
                if tag:
                    focus[tag] = focus.get(tag, 0) + 1
    
    if not focus:
        focus = {"General Architecture": 100} # prevent empty
    else:
        total_tags = sum(focus.values())
        focus = {k: int((v / total_tags) * 100) for k, v in focus.items()}
    
    # Get active participants
    participants = set(e.author_name for e in entries if e.author_name)
    
    # Get entries from last 7 days
    # Need timezone aware datetime if db uses timezone aware
    from datetime import timezone
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    recent = sum(1 for e in entries if e.created_at and e.created_at >= week_ago)
    
    return {
        "decisions_count": decisions,
        "milestones_count": milestones,
        "summaries_count": summaries,
        "uploads_count": uploads,
        "focus_distribution": focus,
        "total_entries_last_7_days": recent,
        "active_participants_count": len(participants) if participants else 1 # default to 1
    }

from app.models.user import Project, Team, user_project
from pydantic import BaseModel

class ProjectResponse(BaseModel):
    id: int
    project_name: str
    team_id: int

@router.get("/projects", response_model=List[ProjectResponse])
def get_user_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Fetches projects for the current user. If none exist but the user has a team,
    creates a default project so the timeline can be tested.
    """
    if not current_user.projects:
        if current_user.teams:
            default_team = current_user.teams[0]
            default_project = Project(project_name=f"{default_team.team_name} Project", team_id=default_team.id)
            default_project.users.append(current_user)
            db.add(default_project)
            db.commit()
            db.refresh(default_project)
            current_user.projects.append(default_project)
            
    return [{"id": p.id, "project_name": p.project_name, "team_id": p.team_id} for p in current_user.projects]