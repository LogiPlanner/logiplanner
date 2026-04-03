from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from datetime import date, datetime
from typing import Optional, List

from app.core.database import get_db, SessionLocal
from app.core.dependencies import get_current_user
from app.models.user import User, Team, user_team
from app.models.calendar_task import CalendarTask, task_tagged_users
from app.schemas.calendar_task import (
    CalendarTaskCreate,
    CalendarTaskUpdate,
    CalendarTaskResponse,
    CalendarTaskList,
    TeamMemberOut,
    TaggedUserOut,
)

router = APIRouter()


# ─── helpers ───────────────────────────────────────
def _verify_team_member(db: Session, user: User, team_id: int):
    """Check user belongs to the team."""
    is_member = (
        db.query(user_team)
        .filter(user_team.c.user_id == user.id, user_team.c.team_id == team_id)
        .first()
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a member of this team")


def _task_to_response(task: CalendarTask, db: Session) -> CalendarTaskResponse:
    """Convert a CalendarTask ORM object to a response with user_name and tagged_users."""
    creator = db.query(User).get(task.user_id)
    return CalendarTaskResponse(
        id=task.id,
        team_id=task.team_id,
        user_id=task.user_id,
        user_name=creator.full_name if creator else None,
        title=task.title,
        description=task.description,
        task_date=task.task_date,
        start_datetime=task.start_datetime,
        end_datetime=task.end_datetime,
        location=task.location,
        color_tag=task.color_tag,
        priority=task.priority,
        is_completed=task.is_completed,
        tagged_users=[
            TaggedUserOut(id=u.id, full_name=u.full_name, email=u.email)
            for u in task.tagged_users
        ],
        created_at=task.created_at,
    )


def _task_to_rag_text(task: CalendarTask, creator_name: str, tagged_names: List[str]) -> str:
    """Build a plain-text representation of a task for the RAG knowledge base."""
    parts = [
        f"Calendar Task: {task.title}",
        f"Created by: {creator_name or 'Unknown'}",
        f"Period: {task.start_datetime.isoformat()} → {task.end_datetime.isoformat()}",
        f"Priority: {task.priority}",
        f"Status: {'Completed' if task.is_completed else 'Active'}",
    ]
    if task.description:
        parts.append(f"Description: {task.description}")
    if task.location:
        parts.append(f"Location: {task.location}")
    if tagged_names:
        parts.append(f"Tagged members: {', '.join(tagged_names)}")
    return "\n".join(parts)


def _sync_task_to_rag(task_id: int):
    """Ingest / update a single calendar task into the team's RAG knowledge base."""
    db = SessionLocal()
    try:
        from app.rag.engine import rag_engine
        from langchain_core.documents import Document as LCDocument

        task = (
            db.query(CalendarTask)
            .options(joinedload(CalendarTask.tagged_users), joinedload(CalendarTask.user))
            .filter(CalendarTask.id == task_id)
            .first()
        )
        if not task:
            return

        creator = task.user or db.query(User).get(task.user_id)
        creator_name = creator.full_name if creator else "Unknown"
        tagged_names = [u.full_name or u.email for u in task.tagged_users]

        # Delete old chunks for this task first (update = delete + re-ingest)
        _delete_task_from_rag(task.team_id, task.id)

        text = _task_to_rag_text(task, creator_name, tagged_names)
        chunk = LCDocument(
            page_content=text,
            metadata={
                "team_id": task.team_id,
                "document_id": f"calendar_task_{task.id}",
                "filename": f"Task: {task.title}",
                "uploader_email": creator.email if creator else "",
                "doc_type": "calendar_task",
                "chunk_index": 0,
                "page_number": 0,
                "uploaded_at": (task.created_at or datetime.utcnow()).isoformat(),
                "source": f"calendar_task_{task.id}",
            },
        )
        rag_engine.ingest_chunks(task.team_id, [chunk])
    except Exception as e:
        print(f"[Calendar→RAG] Ingest error for task {task_id}: {e}")
    finally:
        db.close()


def _delete_task_from_rag(team_id: int, task_id: int):
    """Remove a calendar task's chunks from the RAG knowledge base."""
    try:
        from app.rag.engine import rag_engine
        rag_engine._ensure_initialized()
        collection_name = rag_engine._get_collection_name(team_id)
        collection = rag_engine._chroma_client.get_collection(collection_name)
        results = collection.get(where={"document_id": f"calendar_task_{task_id}"})
        if results and results["ids"]:
            collection.delete(ids=results["ids"])
            print(f"[Calendar→RAG] Deleted {len(results['ids'])} chunks for task {task_id}")
    except Exception as e:
        print(f"[Calendar→RAG] Delete error for task {task_id}: {e}")


# ─── endpoints ─────────────────────────────────────

@router.get("/members/{team_id}", response_model=List[TeamMemberOut])
def list_team_members(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all members of a team (for @ mention autocomplete)."""
    _verify_team_member(db, current_user, team_id)
    team = db.query(Team).options(joinedload(Team.users)).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return [
        TeamMemberOut(id=u.id, full_name=u.full_name, email=u.email)
        for u in team.users
    ]


@router.get("/tasks/{team_id}", response_model=CalendarTaskList)
def list_tasks(
    team_id: int,
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List calendar tasks for a team, optionally filtered by date range."""
    _verify_team_member(db, current_user, team_id)

    q = (
        db.query(CalendarTask)
        .options(joinedload(CalendarTask.tagged_users))
        .filter(CalendarTask.team_id == team_id)
    )
    if start_date:
        q = q.filter(CalendarTask.task_date >= start_date)
    if end_date:
        q = q.filter(CalendarTask.task_date <= end_date)
    q = q.order_by(CalendarTask.start_datetime, CalendarTask.created_at)

    tasks = q.all()
    return CalendarTaskList(tasks=[_task_to_response(t, db) for t in tasks])


@router.post("/tasks/{team_id}", response_model=CalendarTaskResponse, status_code=201)
def create_task(
    team_id: int,
    payload: CalendarTaskCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new calendar task and sync to RAG."""
    _verify_team_member(db, current_user, team_id)

    task = CalendarTask(
        team_id=team_id,
        user_id=current_user.id,
        title=payload.title,
        description=payload.description,
        task_date=payload.start_datetime.date(),
        start_datetime=payload.start_datetime,
        end_datetime=payload.end_datetime,
        location=payload.location,
        color_tag=payload.color_tag,
        priority=payload.priority.value,
    )

    # Resolve tagged users
    if payload.tagged_user_ids:
        tagged = db.query(User).filter(User.id.in_(payload.tagged_user_ids)).all()
        task.tagged_users = tagged

    db.add(task)
    db.commit()
    db.refresh(task)

    # Sync to RAG in background
    background_tasks.add_task(_sync_task_to_rag, task.id)

    return _task_to_response(task, db)


@router.patch("/tasks/{team_id}/{task_id}", response_model=CalendarTaskResponse)
def update_task(
    team_id: int,
    task_id: int,
    payload: CalendarTaskUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a calendar task (partial) and re-sync to RAG."""
    _verify_team_member(db, current_user, team_id)

    task = (
        db.query(CalendarTask)
        .options(joinedload(CalendarTask.tagged_users))
        .filter(CalendarTask.id == task_id, CalendarTask.team_id == team_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    update_data = payload.model_dump(exclude_unset=True)

    # Handle tagged_user_ids separately
    tagged_ids = update_data.pop("tagged_user_ids", None)
    if tagged_ids is not None:
        tagged = db.query(User).filter(User.id.in_(tagged_ids)).all()
        task.tagged_users = tagged

    if "priority" in update_data and update_data["priority"] is not None:
        update_data["priority"] = update_data["priority"].value

    # Keep task_date in sync with start_datetime
    if "start_datetime" in update_data and update_data["start_datetime"] is not None:
        update_data["task_date"] = update_data["start_datetime"].date()

    for field, value in update_data.items():
        setattr(task, field, value)

    db.commit()
    db.refresh(task)

    # Re-sync to RAG
    background_tasks.add_task(_sync_task_to_rag, task.id)

    return _task_to_response(task, db)


@router.delete("/tasks/{team_id}/{task_id}", status_code=204)
def delete_task(
    team_id: int,
    task_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a calendar task and remove from RAG."""
    _verify_team_member(db, current_user, team_id)

    task = (
        db.query(CalendarTask)
        .filter(CalendarTask.id == task_id, CalendarTask.team_id == team_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Remove from RAG in background
    background_tasks.add_task(_delete_task_from_rag, team_id, task_id)

    db.delete(task)
    db.commit()
