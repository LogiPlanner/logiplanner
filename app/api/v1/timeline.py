from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User, Project
from app.models.timeline import TimelineEntry
from app.schemas.timeline import TimelineEntryCreate, TimelineEntryResponse

from langchain_core.documents import Document as LCDocument
from app.rag.engine import rag_engine

router = APIRouter()

def _ingest_timeline_entry(team_id: int, entry: TimelineEntry, user_email: str):
    """Background task to safely ingest timeline entry into RAG."""
    try:
        # Give the AI explicit context in the text payload so it understands *what* this is
        rich_content = (
            f"Project Timeline {entry.entry_type.title()}:\n"
            f"Title: {entry.title}\n"
            f"Details: {entry.content}"
        )
        
        doc = LCDocument(
            page_content=rich_content,
            metadata={
                "team_id": team_id,
                "document_id": 0,
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