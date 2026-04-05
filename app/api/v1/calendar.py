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


def _validate_task_time_range(start_datetime: datetime, end_datetime: datetime):
    """Reject invalid task time ranges server-side."""
    if end_datetime <= start_datetime:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end_datetime must be after start_datetime",
        )


def _resolve_team_tagged_users(db: Session, team_id: int, tagged_user_ids: List[int]) -> List[User]:
    """Resolve tagged users while enforcing team membership."""
    requested_tagged_ids = set(tagged_user_ids)
    if not requested_tagged_ids:
        return []

    tagged = (
        db.query(User)
        .join(user_team, user_team.c.user_id == User.id)
        .filter(
            User.id.in_(requested_tagged_ids),
            user_team.c.team_id == team_id,
        )
        .all()
    )
    found_tagged_ids = {user.id for user in tagged}
    invalid_tagged_ids = requested_tagged_ids - found_tagged_ids
    if invalid_tagged_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One or more tagged users are not members of this team",
        )
    return tagged


def _task_to_response(task: CalendarTask, db: Session) -> CalendarTaskResponse:
    """Convert a CalendarTask ORM object to a response with user_name and tagged_users."""
    creator = task.user or db.get(User, task.user_id)
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
        task_type=task.task_type or "regular",
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

        creator = task.user or db.get(User, task.user_id)
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
        .options(joinedload(CalendarTask.tagged_users), joinedload(CalendarTask.user))
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
    _validate_task_time_range(payload.start_datetime, payload.end_datetime)

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
        task_type=payload.task_type.value,
    )

    # Resolve tagged users
    if payload.tagged_user_ids:
        tagged = _resolve_team_tagged_users(db, team_id, payload.tagged_user_ids)
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
        .options(joinedload(CalendarTask.tagged_users), joinedload(CalendarTask.user))
        .filter(CalendarTask.id == task_id, CalendarTask.team_id == team_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    update_data = payload.model_dump(exclude_unset=True)

    # Handle tagged_user_ids separately
    tagged_ids = update_data.pop("tagged_user_ids", None)
    if tagged_ids is not None:
        tagged = _resolve_team_tagged_users(db, team_id, tagged_ids)
        task.tagged_users = tagged

    if "priority" in update_data and update_data["priority"] is not None:
        update_data["priority"] = update_data["priority"].value

    if "task_type" in update_data and update_data["task_type"] is not None:
        update_data["task_type"] = update_data["task_type"].value

    # Keep task_date in sync with start_datetime
    if "start_datetime" in update_data and update_data["start_datetime"] is not None:
        update_data["task_date"] = update_data["start_datetime"].date()

    effective_start = update_data.get("start_datetime", task.start_datetime)
    effective_end = update_data.get("end_datetime", task.end_datetime)
    _validate_task_time_range(effective_start, effective_end)

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


# ─── Conflict check ───────────────────────────────

from pydantic import BaseModel as _PydanticBase

class ConflictCheckRequest(_PydanticBase):
    start_datetime: datetime
    end_datetime: datetime
    exclude_task_id: Optional[int] = None


class ConflictCheckResponse(_PydanticBase):
    has_conflict: bool
    conflicting_tasks: List[CalendarTaskResponse] = []


@router.post("/tasks/{team_id}/check-conflicts", response_model=ConflictCheckResponse)
def check_time_conflicts(
    team_id: int,
    payload: ConflictCheckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Check if a proposed time range conflicts with existing time-based tasks (meetings/regular)."""
    _verify_team_member(db, current_user, team_id)

    q = (
        db.query(CalendarTask)
        .options(joinedload(CalendarTask.tagged_users))
        .filter(
            CalendarTask.team_id == team_id,
            CalendarTask.is_completed.is_(False),
            CalendarTask.task_type.in_(["meeting", "regular"]),
            # Overlaps: existing.start < new.end AND existing.end > new.start
            CalendarTask.start_datetime < payload.end_datetime,
            CalendarTask.end_datetime > payload.start_datetime,
        )
    )
    if payload.exclude_task_id:
        q = q.filter(CalendarTask.id != payload.exclude_task_id)

    conflicts = q.all()
    return ConflictCheckResponse(
        has_conflict=len(conflicts) > 0,
        conflicting_tasks=[_task_to_response(t, db) for t in conflicts],
    )


# ─── AI Actionable Steps ─────────────────────────

import json

class AISuggestion(_PydanticBase):
    title: str
    description: str
    proposed_deadline: Optional[str] = None
    task_type: str = "action_item"
    priority: str = "medium"
    confidence: float = 0.0
    source_context: Optional[str] = None


class AISuggestionsResponse(_PydanticBase):
    suggestions: List[AISuggestion] = []


_AI_SUGGESTIONS_PROMPT = """You are a proactive project assistant helping a team stay on track.

Today's date is {today}. All proposed deadlines MUST be on or after today.

Using the knowledge base context below, suggest up to 4 actionable tasks the team should work on.

Guidelines:
- Prefer suggestions grounded in the documents/entries in the context.
- If context is limited, suggest sensible general project-management tasks (e.g. review progress, schedule a sync, follow up on blockers).
- Only return [] if the context is completely empty or meaningless.
- Never duplicate the existing active tasks listed below.
- Keep suggestions practical and specific enough to be useful.

For each suggestion return a JSON object with these exact keys:
- "title": short task title (max 60 chars)
- "description": 1-2 sentences explaining what to do and why
- "proposed_deadline": suggested date YYYY-MM-DD (pick a sensible near-future date), or null
- "task_type": one of "meeting", "deadline", "milestone", "regular", "action_item"
- "priority": one of "low", "medium", "high"
- "confidence": 0.0-1.0 — higher when directly from context, lower for general suggestions
- "source_context": document/entry name if applicable, or "General best practice" (max 100 chars)

Return ONLY a valid JSON array. No markdown, no explanation — just the array.

Context from the team's knowledge base:
{context}

Existing active tasks (do not duplicate):
{existing_tasks}
"""


@router.get("/ai-suggestions/{team_id}", response_model=AISuggestionsResponse)
def get_ai_suggestions(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Use RAG + LLM to generate AI actionable task suggestions from the team's KB."""
    _verify_team_member(db, current_user, team_id)

    from app.rag.engine import rag_engine

    # Get relevant context from knowledge base
    try:
        chunks = rag_engine.search(team_id, "project tasks milestones deadlines action items next steps", k=10)
    except Exception:
        chunks = []

    context_text = "\n\n".join(
        f"[{c.metadata.get('filename', 'Unknown')}]: {c.page_content[:500]}"
        for c in chunks
    ) if chunks else "(No documents uploaded yet — suggest general project health tasks)"

    # Get existing active tasks to avoid duplicates
    active_tasks = (
        db.query(CalendarTask)
        .filter(CalendarTask.team_id == team_id, CalendarTask.is_completed.is_(False))
        .order_by(CalendarTask.start_datetime.desc())
        .limit(10)
        .all()
    )
    existing_text = "\n".join(f"- {t.title} ({t.task_type or 'regular'}, {t.priority})" for t in active_tasks)
    if not existing_text:
        existing_text = "(no existing tasks)"

    from datetime import date as _date
    prompt = _AI_SUGGESTIONS_PROMPT.format(
        today=_date.today().isoformat(),
        context=context_text,
        existing_tasks=existing_text,
    )

    try:
        rag_engine._ensure_initialized()
        from langchain_core.messages import HumanMessage
        result = rag_engine._invoke_llm_with_retry([HumanMessage(content=prompt)])
        raw = result.content.strip()

        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()

        suggestions_data = json.loads(raw)

        suggestions = []
        for item in suggestions_data[:4]:
            suggestions.append(AISuggestion(
                title=item.get("title", "Untitled")[:60],
                description=item.get("description", "")[:300],
                proposed_deadline=item.get("proposed_deadline"),
                task_type=item.get("task_type", "action_item"),
                priority=item.get("priority", "medium"),
                confidence=min(max(float(item.get("confidence", 0.5)), 0.0), 1.0),
                source_context=item.get("source_context", "")[:200] if item.get("source_context") else None,
            ))

        return AISuggestionsResponse(suggestions=suggestions)
    except Exception as e:
        print(f"[Calendar AI] Suggestion generation failed: {e}")
        return AISuggestionsResponse(suggestions=[])
