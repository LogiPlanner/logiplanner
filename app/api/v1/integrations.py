from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User, Team, Document
from app.models.timeline import TimelineEntry
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

from app.rag.processor import list_folder_files, parse_drive_url

router = APIRouter()

class DriveSetupRequest(BaseModel):
    folder_url: str
    sub_team_id: Optional[int] = None

@router.post("/team/{team_id}/integrations/drive-setup")
def setup_drive_polling(
    team_id: int,
    req: DriveSetupRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Saves a Google Drive folder link to be polled for new documents that auto-populate the Timeline."""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or current_user not in team.users:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    try:
        folder_id, url_type = parse_drive_url(req.folder_url)
        if url_type != "folder":
            raise ValueError()
    except Exception:
        raise HTTPException(status_code=400, detail="Must be a valid Google Drive folder link.")
        
    doc = Document(
        team_id=team_id,
        uploader_id=current_user.id,
        filename=f"Memory Sync Folder",
        doc_type="folder",
        source_url=req.folder_url,
        drive_file_id=folder_id,
        refresh_interval_hours=24,
        status="ready"
    )
    db.add(doc)
    db.commit()
    
    # In a real app run background polling logic here or via celery
    # For now, we manually trigger an immediate check
    background_tasks.add_task(_poll_folder_task, team_id, req.sub_team_id, folder_id, current_user.id)
    
    return {"message": "Drive folder connected successfully.", "document_id": doc.id}

def _poll_folder_task(team_id: int, sub_team_id: Optional[int], folder_id: str, user_id: int):
    # This simulates the polling daemon checking for new files
    try:
        files = list_folder_files(folder_id)
        db = next(get_db())
        for fid, fname, mt in files:
            # Check if this file was already uploaded to timeline by checking `source_reference`
            existing = db.query(TimelineEntry).filter(
                TimelineEntry.team_id == team_id,
                TimelineEntry.source_reference.like(f"%{fid}%")
            ).first()
            if not existing:
                # Automate UPLOAD entry
                user = db.query(User).filter(User.id == user_id).first()
                new_entry = TimelineEntry(
                    team_id=team_id,
                    sub_team_id=sub_team_id,
                    entry_type="upload",
                    title=f"New Drive Document: {fname}",
                    content="Automatically synced from tracked Google Drive folder.",
                    tags="Drive Sync, Documentation",
                    impact_level="none",
                    source_reference=f"https://drive.google.com/file/d/{fid}/view",
                    author_name=user.full_name or "System",
                    verified_by_id=user_id
                )
                db.add(new_entry)
        db.commit()
    except Exception as e:
        print(f"Polling daemon failed for folder {folder_id}: {e}")
