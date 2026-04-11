"""
Onboarding API — Multi-step team creation and joining flow.
Replaces the old profile.html + team-select.html pages.
Now integrated with the RAG pipeline for document ingestion during team creation.
"""

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, BackgroundTasks, Form
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid
import os

from app.core.dependencies import get_current_user
from app.core.database import get_db
from app.models.user import User, Team, Role, UserRole
from app.schemas.onboarding import (
    CreateTeamStep1,
    CreateTeamStep2,
    CreateTeamStep3,
    CreateTeamStep4,
    CreateTeamResponse,
    JoinTeamUserDetails,
    TeamPreviewResponse,
    OnboardingBriefResponse,
    SetupProjectRequest,
    SetupProjectResponse,
    TeamNameCheckResponse,
)

router = APIRouter()

UPLOAD_DIR = os.path.join("app", "static", "uploads")


# ──────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────

def _get_or_create_role(db: Session, role_name: str) -> Role:
    role = db.query(Role).filter(Role.name == role_name).first()
    if not role:
        role = Role(name=role_name)
        db.add(role)
        db.flush()
    return role


# ──────────────────────────────────────────────
# CREATE TEAM FLOW
# ──────────────────────────────────────────────

@router.get("/check-team-name", response_model=TeamNameCheckResponse)
async def check_team_name(
    name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Check if a team name is already taken."""
    exists = db.query(Team).filter(Team.team_name == name).first() is not None
    return {"exists": exists}


@router.post("/create-team-full", response_model=CreateTeamResponse)
async def create_team_full(
    step1: CreateTeamStep1,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a new team (Step 1 of the Create flow).
    Returns team info + invite code. Subsequent steps update
    the user profile and team data.
    """
    existing = db.query(Team).filter(Team.team_name == step1.team_name).first()
    if existing:
        raise HTTPException(status_code=400, detail="A team with this name already exists")

    team = Team(team_name=step1.team_name, description=step1.description)
    db.add(team)
    db.flush()

    # Add user to team
    team.users.append(current_user)

    # Assign owner role — scoped to this specific team
    owner_role = _get_or_create_role(db, "owner")
    user_role = UserRole(user_id=current_user.id, role_id=owner_role.id, team_id=team.id)
    db.add(user_role)

    db.commit()
    db.refresh(team)

    return {
        "message": "Team created successfully!",
        "team_id": team.id,
        "team_name": team.team_name,
        "invite_code": team.invite_code,
    }


@router.post("/save-owner-details")
async def save_owner_details(
    details: CreateTeamStep2,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Step 2: Save the team owner's personal details.
    """
    user = db.query(User).filter(User.id == current_user.id).first()
    user.full_name = details.full_name
    user.job_title = details.job_title
    if details.role_preference:
        user.role_preference = details.role_preference
    db.commit()

    return {
        "message": "Profile updated!",
        "project_stage": details.project_stage,
        "project_info": details.project_info,
    }


@router.post("/save-ingestion-links")
async def save_ingestion_links(
    data: CreateTeamStep3,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Step 3: Save manual ingestion links and notes.
    In the future, this will queue items for the AI Brain.
    For now we store them and log them.
    """
    # TODO: Store links in an Ingestion/Resource table when AI Brain is implemented
    print("=" * 60)
    print(f"[INGESTION] Links from {current_user.email}:")
    for link in data.links:
        print(f"  [{link.source_type}] {link.label or 'Untitled'} → {link.url}")
    if data.notes:
        print(f"  [NOTES] {data.notes}")
    print("=" * 60)

    return {
        "message": f"Saved {len(data.links)} link(s) for AI Brain processing.",
        "link_count": len(data.links),
    }


@router.post("/upload-documents")
async def upload_documents(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    team_id: Optional[int] = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Step 3 (file upload): Accept document files for the AI Brain.
    Now integrated with the RAG pipeline — files are saved to disk AND
    processed through the RAG pipeline (chunked, embedded, stored in ChromaDB).
    """
    from app.models.user import Document
    from app.rag.engine import rag_engine
    from app.rag.processor import apply_document_summary, process_document, validate_file, get_doc_type

    RAG_UPLOAD_DIR = os.path.join("app", "static", "uploads", "rag")
    os.makedirs(RAG_UPLOAD_DIR, exist_ok=True)
    saved = []

    for f in files:
        content = await f.read()
        file_size = len(content)

        safe_name = f"{uuid.uuid4().hex[:8]}_{f.filename}"
        path = os.path.join(RAG_UPLOAD_DIR, safe_name)
        with open(path, "wb") as out:
            out.write(content)

        saved_item = {"original": f.filename, "stored_as": safe_name, "size": file_size}

        # If team_id is provided, process through RAG pipeline
        if team_id:
            is_valid, error_msg = validate_file(f.filename, file_size)
            if is_valid:
                doc_type = get_doc_type(f.filename)
                doc_record = Document(
                    team_id=team_id,
                    uploader_id=current_user.id,
                    filename=f.filename,
                    stored_path=path,
                    doc_type=doc_type,
                    file_size=file_size,
                    status="pending",
                )
                db.add(doc_record)
                db.flush()

                # Queue background processing
                def _bg_process(doc_id, fp, fn, tid, email):
                    from app.core.database import SessionLocal
                    _db = SessionLocal()
                    try:
                        _doc = _db.query(Document).filter(Document.id == doc_id).first()
                        if _doc:
                            _doc.status = "processing"
                            _db.commit()
                            chunks = process_document(fp, fn, tid, doc_id, email)
                            summary = rag_engine.generate_document_summary(chunks, fn)
                            chunks = apply_document_summary(chunks, summary)
                            chunk_count = rag_engine.ingest_chunks(tid, chunks)
                            _doc.chunk_count = chunk_count
                            _doc.status = "ready"
                            _doc.summary = summary
                            _db.commit()
                            print(f"[RAG/ONBOARDING] ✅ {fn} → {chunk_count} chunks")
                    except Exception as e:
                        print(f"[RAG/ONBOARDING] ❌ {fn}: {e}")
                        _doc = _db.query(Document).filter(Document.id == doc_id).first()
                        if _doc:
                            _doc.status = "error"
                            _doc.error_message = str(e)[:500]
                            _db.commit()
                    finally:
                        if os.path.exists(fp):
                            try:
                                os.remove(fp)
                                print(f"[RAG/ONBOARDING] Deleted uploaded file: {fp}")
                            except Exception as cleanup_error:
                                print(f"[RAG/ONBOARDING] Warning: Could not delete {fp}: {cleanup_error}")
                        _db.close()

                background_tasks.add_task(
                    _bg_process, doc_record.id, path, f.filename, team_id, current_user.email
                )
                saved_item["rag_status"] = "queued"

        saved.append(saved_item)
        print(f"[UPLOAD] {f.filename} → {path} ({file_size} bytes)")

    if team_id:
        db.commit()

    return {
        "message": f"Uploaded {len(saved)} file(s) successfully.",
        "files": saved,
    }


@router.post("/send-invites")
async def send_invites(
    data: CreateTeamStep4,
    current_user: User = Depends(get_current_user),
):
    """
    Step 4: Record invited emails.
    In the future, this will send actual invitation emails.
    """
    # TODO: Send real invitation emails when SMTP is configured
    for invite in data.invites:
        print(f"[INVITE] {invite.email} as {invite.role} — invited by {current_user.email}")

    return {
        "message": f"Invited {len(data.invites)} member(s).",
        "invited_count": len(data.invites),
    }


# ──────────────────────────────────────────────
# DEFERRED SETUP — Called from Dashboard Welcome Screen
# ──────────────────────────────────────────────

@router.post("/setup-project", response_model=SetupProjectResponse)
async def setup_project(
    data: SetupProjectRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    All-in-one project setup. Called after onboarding wizard completes.
    Creates the team, updates user profile, processes uploads/links via RAG,
    and records invites — all atomically.
    """
    from app.rag.engine import rag_engine
    from app.rag.processor import (
        apply_document_summary,
        process_document, validate_file, get_doc_type,
        process_drive_url, process_github_repo, process_github_url,
        process_text,
    )

    RAG_UPLOAD_DIR = os.path.join("app", "static", "uploads", "rag")

    # ── 1. Create Team ──
    existing = db.query(Team).filter(Team.team_name == data.team_name).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail="A project with this name already exists. Please choose a different name.",
        )

    team = Team(team_name=data.team_name, description=data.description)
    db.add(team)
    db.flush()

    team.users.append(current_user)
    owner_role = _get_or_create_role(db, "owner")
    user_role = UserRole(user_id=current_user.id, role_id=owner_role.id, team_id=team.id)
    db.add(user_role)

    # ── 2. Update Owner Profile (only missing fields) ──
    user = db.query(User).filter(User.id == current_user.id).first()
    if data.full_name and not user.full_name:
        user.full_name = data.full_name
    user.job_title = data.job_title
    if data.role_preference:
        user.role_preference = data.role_preference

    # ── 3. Link uploaded files + queue RAG processing ──
    for stored_name in data.uploaded_files:
        file_path = os.path.join(RAG_UPLOAD_DIR, stored_name)
        if not os.path.isfile(file_path):
            print(f"[SETUP] Warning: uploaded file not found: {stored_name}")
            continue

        original_name = stored_name[9:]  # strip UUID prefix "xxxxxxxx_"
        file_size = os.path.getsize(file_path)

        is_valid, _ = validate_file(original_name, file_size)
        if not is_valid:
            print(f"[SETUP] Skipping invalid file: {original_name}")
            continue

        doc_type = get_doc_type(original_name)
        doc_record = Document(
            team_id=team.id,
            uploader_id=current_user.id,
            filename=original_name,
            stored_path=file_path,
            doc_type=doc_type,
            file_size=file_size,
            status="pending",
        )
        db.add(doc_record)
        db.flush()

        def _bg_process_file(doc_id, fp, fn, tid, email):
            from app.core.database import SessionLocal
            _db = SessionLocal()
            try:
                _doc = _db.query(Document).filter(Document.id == doc_id).first()
                if _doc:
                    _doc.status = "processing"
                    _db.commit()
                    chunks = process_document(fp, fn, tid, doc_id, email)
                    summary = rag_engine.generate_document_summary(chunks, fn)
                    chunks = apply_document_summary(chunks, summary)
                    chunk_count = rag_engine.ingest_chunks(tid, chunks)
                    _doc.chunk_count = chunk_count
                    _doc.status = "ready"
                    _doc.summary = summary
                    _db.commit()
                    print(f"[SETUP/RAG] {fn} -> {chunk_count} chunks")
            except Exception as e:
                print(f"[SETUP/RAG] Error processing {fn}: {e}")
                _doc = _db.query(Document).filter(Document.id == doc_id).first()
                if _doc:
                    _doc.status = "error"
                    _doc.error_message = str(e)[:500]
                    _db.commit()
            finally:
                _db.close()

        background_tasks.add_task(
            _bg_process_file, doc_record.id, file_path, original_name, team.id, current_user.email
        )

    # ── 4. Process Links (Google Drive + GitHub) via RAG in background ──
    for link in data.links:
        doc_record = Document(
            team_id=team.id,
            uploader_id=current_user.id,
            filename=link.label or link.url[:80],
            stored_path="",
            doc_type="link",
            file_size=0,
            status="pending",
        )
        db.add(doc_record)
        db.flush()

        def _bg_process_link(doc_id, link_url, link_type, tid, email):
            from app.core.database import SessionLocal
            _db = SessionLocal()
            try:
                _doc = _db.query(Document).filter(Document.id == doc_id).first()
                if not _doc:
                    return
                _doc.status = "processing"
                _db.commit()

                chunks = []
                if link_type == "google_drive":
                    chunks, filename, d_type, size = process_drive_url(link_url, tid, doc_id, email)
                    _doc.filename = filename
                    _doc.doc_type = d_type
                    _doc.file_size = size
                elif link_type == "github":
                    if "/blob/" in link_url or "raw.githubusercontent.com" in link_url:
                        chunks, filename, size = process_github_url(link_url, tid, doc_id, email)
                    else:
                        chunks, filename, size = process_github_repo(link_url, tid, doc_id, email)
                    _doc.filename = filename
                    _doc.file_size = size

                if chunks:
                    summary = rag_engine.generate_document_summary(chunks, _doc.filename)
                    chunks = apply_document_summary(chunks, summary)
                    chunk_count = rag_engine.ingest_chunks(tid, chunks)
                    _doc.chunk_count = chunk_count
                    _doc.status = "ready"
                    _doc.summary = summary
                    _db.commit()
                    print(f"[SETUP/LINK] {link_url} -> {chunk_count} chunks")
                else:
                    _doc.status = "error"
                    _doc.error_message = "No content extracted from link"
                    _db.commit()
            except Exception as e:
                print(f"[SETUP/LINK] Error: {link_url}: {e}")
                _doc = _db.query(Document).filter(Document.id == doc_id).first()
                if _doc:
                    _doc.status = "error"
                    _doc.error_message = str(e)[:500]
                    _db.commit()
            finally:
                _db.close()

        background_tasks.add_task(
            _bg_process_link, doc_record.id, link.url, link.source_type, team.id, current_user.email
        )

    # ── 5. Process Additional Context Notes via RAG ──
    if data.notes and data.notes.strip():
        notes_doc = Document(
            team_id=team.id,
            uploader_id=current_user.id,
            filename="Onboarding Context Notes",
            stored_path="",
            doc_type="text",
            file_size=len(data.notes.encode("utf-8")),
            status="pending",
        )
        db.add(notes_doc)
        db.flush()

        def _bg_process_notes(doc_id, notes_text, tid, email):
            from app.core.database import SessionLocal
            _db = SessionLocal()
            try:
                _doc = _db.query(Document).filter(Document.id == doc_id).first()
                if _doc:
                    _doc.status = "processing"
                    _db.commit()
                    chunks = process_text(notes_text, "Onboarding Context Notes", tid, doc_id, email)
                    summary = rag_engine.generate_document_summary(chunks, "Onboarding Context Notes")
                    chunks = apply_document_summary(chunks, summary)
                    chunk_count = rag_engine.ingest_chunks(tid, chunks)
                    _doc.chunk_count = chunk_count
                    _doc.status = "ready"
                    _doc.summary = summary
                    _db.commit()
                    print(f"[SETUP/NOTES] Context notes -> {chunk_count} chunks")
            except Exception as e:
                print(f"[SETUP/NOTES] Error: {e}")
                _doc = _db.query(Document).filter(Document.id == doc_id).first()
                if _doc:
                    _doc.status = "error"
                    _doc.error_message = str(e)[:500]
                    _db.commit()
            finally:
                _db.close()

        background_tasks.add_task(
            _bg_process_notes, notes_doc.id, data.notes, team.id, current_user.email
        )

    # ── 6. Record Invites ──
    for invite in data.invites:
        print(f"[SETUP/INVITE] {invite.email} as {invite.role} — invited by {current_user.email}")

    db.commit()
    db.refresh(team)

    return {
        "message": f"Project '{team.team_name}' created successfully!",
        "team_id": team.id,
        "team_name": team.team_name,
        "invite_code": team.invite_code,
    }


# ──────────────────────────────────────────────
# JOIN TEAM FLOW
# ──────────────────────────────────────────────

@router.get("/team-preview/{invite_code}", response_model=TeamPreviewResponse)
async def team_preview(invite_code: str, db: Session = Depends(get_db)):
    """Preview a team by invite code (no auth required)."""
    team = db.query(Team).filter(Team.invite_code == invite_code).first()
    if not team:
        raise HTTPException(status_code=404, detail="Invalid invite code. Please check and try again.")

    # Find team owner
    owner_name = None
    for u in team.users:
        for ur in u.user_roles:
            if ur.role and ur.role.name == "owner":
                owner_name = u.full_name or u.email
                break
        if owner_name:
            break

    return {
        "team_name": team.team_name,
        "description": team.description,
        "member_count": len(team.users),
        "owner_name": owner_name,
    }


@router.post("/join-team-full")
async def join_team_full(
    details: JoinTeamUserDetails,
    invite_code: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Join a team and save user details in one step."""
    team = db.query(Team).filter(Team.invite_code == invite_code).first()
    if not team:
        raise HTTPException(status_code=404, detail="Invalid invite code")

    if current_user in team.users:
        raise HTTPException(status_code=400, detail="You are already a member of this team")

    # Update user profile
    user = db.query(User).filter(User.id == current_user.id).first()
    user.full_name = details.full_name
    user.job_title = details.job_title
    if details.role_preference:
        user.role_preference = details.role_preference

    # Add to team
    team.users.append(current_user)

    # Assign member role — scoped to this specific team
    member_role = _get_or_create_role(db, "member")
    user_role = UserRole(user_id=current_user.id, role_id=member_role.id, team_id=team.id)
    db.add(user_role)

    db.commit()

    return {
        "message": f"Welcome to {team.team_name}!",
        "team_name": team.team_name,
        "team_id": team.id,
    }


@router.get("/onboarding-brief/{invite_code}", response_model=OnboardingBriefResponse)
async def onboarding_brief(
    invite_code: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Generate a smart onboarding brief for a new team member.
    Placeholder — will use AI Brain in the future.
    """
    team = db.query(Team).filter(Team.invite_code == invite_code).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    return {
        "team_name": team.team_name,
        "project_info": team.description,
        "member_count": len(team.users),
        "message": f"Welcome to {team.team_name}! You're member #{len(team.users)}. "
                   f"This team is working on: {team.description or 'a new project'}. "
                   f"The AI Brain will provide a full project brief once it's initialized.",
    }


# ──────────────────────────────────────────────
# TEAM LISTING (used by AI Brain & Dashboard)
# ──────────────────────────────────────────────

@router.get("/my-teams")
async def get_my_teams(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get all teams the current user belongs to, including their role."""
    user = db.query(User).filter(User.id == current_user.id).first()
    teams = user.teams if user else []

    result = []
    for t in teams:
        # Security: only consider roles scoped to THIS team.
        role_name = "viewer"  # default
        user_roles = (
            db.query(UserRole)
            .filter(
                UserRole.user_id == current_user.id,
                UserRole.team_id == t.id,
            )
            .all()
        )
        for ur in user_roles:
            if ur.role and ur.role.name.lower() in ("owner", "editor", "viewer"):
                role_name = ur.role.name.lower()
                break

        result.append({
            "id": t.id,
            "team_name": t.team_name,
            "description": t.description,
            "invite_code": t.invite_code,
            "member_count": len(t.users),
            "role": role_name,
            "ai_sensitivity": t.ai_sensitivity,
        })

    return {"teams": result}
