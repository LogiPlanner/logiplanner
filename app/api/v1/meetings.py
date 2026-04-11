import html as html_lib
import os
import json
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, UploadFile, File, Form, BackgroundTasks
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.core.database import get_db
from app.core.config import settings
from app.models.user import User, Team
from app.models.meeting import MeetingBoard, MeetingFolder, MeetingNote
from app.schemas.meeting import BoardActionResponse, BoardCreate, BoardResponse, BoardUpdate, FolderCreate, FolderResponse, NoteCreate, NoteUpdate, NoteResponse
from app.api.v1.rag import _verify_team_access

router = APIRouter()

AI_GENERATED_FOLDER_NAME = "AI Generated"

# ──────────────────────────────────────────────
# WebSocket Connection Manager
# ──────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        # Dictionary mapping team_id to list of active WebSocket connections
        self.active_connections: dict[int, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, team_id: int):
        await websocket.accept()
        if team_id not in self.active_connections:
            self.active_connections[team_id] = []
        self.active_connections[team_id].append(websocket)

    def disconnect(self, websocket: WebSocket, team_id: int):
        if team_id in self.active_connections:
            if websocket in self.active_connections[team_id]:
                self.active_connections[team_id].remove(websocket)
            if not self.active_connections[team_id]:
                del self.active_connections[team_id]

    async def broadcast(self, message: str, team_id: int, exclude: WebSocket = None):
        if team_id in self.active_connections:
            for connection in self.active_connections[team_id]:
                if connection != exclude:
                    try:
                        await connection.send_text(message)
                    except Exception:
                        pass

manager = ConnectionManager()


def _get_or_create_default_board(db: Session, team_id: int) -> MeetingBoard:
    board = (
        db.query(MeetingBoard)
        .filter(MeetingBoard.team_id == team_id)
        .order_by(MeetingBoard.created_at.asc(), MeetingBoard.id.asc())
        .first()
    )
    if board:
        return board

    board = MeetingBoard(team_id=team_id, name="Main Board", state_json=None)
    db.add(board)
    db.commit()
    db.refresh(board)
    return board


def _get_board_or_404(db: Session, team_id: int, board_id: int) -> MeetingBoard:
    board = (
        db.query(MeetingBoard)
        .filter(MeetingBoard.id == board_id, MeetingBoard.team_id == team_id)
        .first()
    )
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    return board

@router.websocket("/ws/{team_id}")
async def websocket_endpoint(websocket: WebSocket, team_id: int, token: str = Query(None), board_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    # Authenticate before accepting the WebSocket connection.
    if not token:
        await websocket.close(code=1008)
        return

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        email: str = payload.get("sub")
        token_type: str = payload.get("token_type")
        if email is None or token_type != "access":
            await websocket.close(code=1008)
            return
    except JWTError:
        await websocket.close(code=1008)
        return

    user = db.query(User).filter(User.email == email).first()
    if not user:
        await websocket.close(code=1008)
        return

    # Verify the authenticated user is a member of the requested team.
    try:
        _verify_team_access(user, team_id, db)
    except HTTPException:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, team_id)
    
    try:
        # On connection, send the latest state to the client
        board = None
        if board_id:
            board = (
                db.query(MeetingBoard)
                .filter(MeetingBoard.id == board_id, MeetingBoard.team_id == team_id)
                .first()
            )
        if not board:
            board = _get_or_create_default_board(db, team_id)
        if board and board.state_json:
            await websocket.send_text(json.dumps({
                "type": "init",
                "board_id": board.id,
                "data": board.state_json
            }))
        else:
            await websocket.send_text(json.dumps({
                "type": "init",
                "board_id": board.id,
                "data": json.dumps({"version": "5.3.1", "objects": []})
            }))
        
        while True:
            data = await websocket.receive_text()
            # Broadcast the delta/event to other clients
            await manager.broadcast(data, team_id, exclude=websocket)
            
            # Periodically or on every update (simplified here), save to DB
            msg = json.loads(data)
            msg_board_id = msg.get("board_id") or board.id
            if msg.get("type") == "save_state":
                board_state = (
                    db.query(MeetingBoard)
                    .filter(MeetingBoard.id == msg_board_id, MeetingBoard.team_id == team_id)
                    .first()
                )
                if not board_state:
                    board_state = MeetingBoard(team_id=team_id, name=msg.get("board_name") or "Main Board", state_json=msg.get("data"))
                    db.add(board_state)
                else:
                    board_state.state_json = msg.get("data")
                    if msg.get("board_name"):
                        board_state.name = msg.get("board_name")
                db.commit()
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, team_id)


# ──────────────────────────────────────────────
# Folders API
# ──────────────────────────────────────────────

@router.get("/boards/{team_id}", response_model=List[BoardResponse])
def get_boards(team_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _verify_team_access(current_user, team_id, db)
    _get_or_create_default_board(db, team_id)
    return (
        db.query(MeetingBoard)
        .filter(MeetingBoard.team_id == team_id)
        .order_by(MeetingBoard.created_at.asc(), MeetingBoard.id.asc())
        .all()
    )


@router.post("/boards/{team_id}", response_model=BoardResponse)
def create_board(team_id: int, data: BoardCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _verify_team_access(current_user, team_id, db)
    board = MeetingBoard(team_id=team_id, name=data.name.strip() or "Main Board", state_json=data.state_json)
    db.add(board)
    db.commit()
    db.refresh(board)
    return board


@router.get("/boards/{team_id}/{board_id}", response_model=BoardResponse)
def get_board(team_id: int, board_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _verify_team_access(current_user, team_id, db)
    return _get_board_or_404(db, team_id, board_id)


@router.put("/boards/{team_id}/{board_id}", response_model=BoardResponse)
def update_board(team_id: int, board_id: int, data: BoardUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _verify_team_access(current_user, team_id, db)
    board = _get_board_or_404(db, team_id, board_id)
    if data.name is not None:
        board.name = data.name.strip() or board.name
    if data.state_json is not None:
        board.state_json = data.state_json
    db.commit()
    db.refresh(board)
    return board


@router.delete("/boards/{team_id}/{board_id}", response_model=BoardActionResponse)
def delete_board(team_id: int, board_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _verify_team_access(current_user, team_id, db)
    board = _get_board_or_404(db, team_id, board_id)
    db.delete(board)
    db.commit()
    _get_or_create_default_board(db, team_id)
    return {"message": "Board deleted"}

@router.get("/folders/{team_id}", response_model=List[FolderResponse])
def get_folders(team_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _verify_team_access(current_user, team_id, db)
    return db.query(MeetingFolder).filter(MeetingFolder.team_id == team_id).order_by(MeetingFolder.created_at.desc()).all()

@router.post("/folders/{team_id}", response_model=FolderResponse)
def create_folder(team_id: int, data: FolderCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _verify_team_access(current_user, team_id, db)
    folder = MeetingFolder(team_id=team_id, name=data.name)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder

@router.delete("/folders/{team_id}/{folder_id}")
def delete_folder(team_id: int, folder_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _verify_team_access(current_user, team_id, db)
    folder = db.query(MeetingFolder).filter(MeetingFolder.id == folder_id, MeetingFolder.team_id == team_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    if folder.is_protected:
        raise HTTPException(status_code=403, detail="This folder is protected and cannot be deleted")
    db.delete(folder)
    db.commit()
    return {"message": "Folder deleted"}


# ──────────────────────────────────────────────
# Notes API
# ──────────────────────────────────────────────

@router.get("/notes/{team_id}", response_model=List[NoteResponse])
def get_notes(team_id: int, folder_id: int = None, trashed: bool = False, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _verify_team_access(current_user, team_id, db)
    query = db.query(MeetingNote).filter(MeetingNote.team_id == team_id, MeetingNote.is_trashed == trashed)
    if folder_id is not None:
        if folder_id == 0:
            query = query.filter(MeetingNote.folder_id.is_(None))
        else:
            query = query.filter(MeetingNote.folder_id == folder_id)
    return query.order_by(MeetingNote.updated_at.desc()).all()

@router.post("/notes/{team_id}", response_model=NoteResponse)
def create_note(team_id: int, data: NoteCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _verify_team_access(current_user, team_id, db)
    note = MeetingNote(
        team_id=team_id,
        folder_id=data.folder_id if data.folder_id != 0 else None,
        title=data.title,
        content=data.content,
        note_type=data.note_type
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note

@router.put("/notes/{team_id}/{note_id}", response_model=NoteResponse)
def update_note(team_id: int, note_id: int, data: NoteUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _verify_team_access(current_user, team_id, db)
    note = db.query(MeetingNote).filter(MeetingNote.id == note_id, MeetingNote.team_id == team_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    if data.title is not None: note.title = data.title
    if data.content is not None: note.content = data.content
    if data.folder_id is not None: note.folder_id = data.folder_id if data.folder_id != 0 else None
    if data.is_trashed is not None: note.is_trashed = data.is_trashed

    db.commit()
    db.refresh(note)
    return note

@router.delete("/notes/{team_id}/{note_id}")
def delete_note(team_id: int, note_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Hard delete
    _verify_team_access(current_user, team_id, db)
    note = db.query(MeetingNote).filter(MeetingNote.id == note_id, MeetingNote.team_id == team_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()
    return {"message": "Note permanently deleted"}


# ──────────────────────────────────────────────
# AI Summary API (Whisper + GPT)
# ──────────────────────────────────────────────

UPLOAD_DIR = os.path.join("app", "static", "uploads", "audio")

def _process_audio_summary(file_path: str, team_id: int, user_id: int, db_url: str):
    from app.core.database import SessionLocal
    from app.models.user import Document
    from app.rag.processor import process_text, apply_document_summary
    from app.rag.engine import rag_engine

    db = SessionLocal()
    try:
        # 1. Transcribe audio with Whisper
        from openai import OpenAI
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        with open(file_path, "rb") as audio_file:
            print(f"[RAG] Transcribing audio file {file_path} for team {team_id}")
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file
            )

        transcription_text = transcript.text

        # 2. Summarize with GPT-4
        prompt = f"""
You are an AI meeting assistant for LogiPlanner.
A meeting recording was just uploaded. Here is the exact transcript:
---
{transcription_text}
---

Please provide a structured summary containing:
1. Executive Summary
2. Key Takeaways (bullet points)
3. Actionable Items (checkbox-style tasks)
"""
        response = client.chat.completions.create(
            model="gpt-4o",
            temperature=0.3,
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": prompt}
            ]
        )

        summary = response.choices[0].message.content

        # 3. Convert plain-text summary to basic HTML for the Quill editor
        html_lines = []
        for line in summary.splitlines():
            stripped = line.strip()
            html_lines.append("<p><br></p>" if not stripped else f"<p>{html_lib.escape(stripped)}</p>")
        html_content = "".join(html_lines)

        # 4. Save to Meeting Notes inside an "AI Generated" folder
        ai_folder = (
            db.query(MeetingFolder)
            .filter(MeetingFolder.team_id == team_id, MeetingFolder.name == AI_GENERATED_FOLDER_NAME)
            .first()
        )
        if not ai_folder:
            ai_folder = MeetingFolder(team_id=team_id, name=AI_GENERATED_FOLDER_NAME, is_protected=True)
            db.add(ai_folder)
            db.flush()

        note_title = f"Meeting Summary – {datetime.now(timezone.utc).strftime('%b %d, %Y %H:%M')} UTC"
        note = MeetingNote(
            team_id=team_id,
            folder_id=ai_folder.id,
            title=note_title,
            content=html_content,
            note_type="document",
        )
        db.add(note)
        db.flush()

        # 5. Ingest the summary into RAG system for AI Brain access
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            doc_record = Document(
                team_id=team_id,
                uploader_id=user_id,
                filename=note_title,
                stored_path="[meeting_summary]",
                doc_type="text",
                file_size=len(summary.encode("utf-8")),
                status="processing",
            )
            db.add(doc_record)
            db.flush()

            try:
                # Process text and ingest into RAG
                chunks = process_text(
                    text=f"Meeting Summary\n\nTranscript:\n{transcription_text}\n\nSummary:\n{summary}",
                    title=note_title,
                    team_id=team_id,
                    document_id=doc_record.id,
                    uploader_email=user.email,
                )

                # Generate document summary for RAG
                doc_summary = f"Meeting summary generated from audio recording on {datetime.now(timezone.utc).strftime('%b %d, %Y')}. Contains transcript and structured summary with key takeaways and action items."
                chunks = apply_document_summary(chunks, doc_summary)

                chunk_count = rag_engine.ingest_chunks(team_id, chunks)
                doc_record.chunk_count = chunk_count
                doc_record.status = "ready"
                doc_record.summary = doc_summary
                print(f"[RAG] Ingested meeting summary into AI Brain: {chunk_count} chunks")
            except Exception as e:
                doc_record.status = "failed"
                print(f"[RAG] Error ingesting meeting summary into RAG: {e}")

        db.commit()

    except Exception as e:
        db.rollback()
        import traceback
        print(f"[RAG] Error processing audio summary: {e}")
        traceback.print_exc()
    finally:
        db.close()
        # 6. Erase original file for privacy
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception as e:
                print(f"[RAG] Failed to delete temp file {file_path}: {e}")

@router.post("/upload-audio")
async def upload_audio_recording(
    background_tasks: BackgroundTasks,
    team_id: int = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _verify_team_access(current_user, team_id, db)

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    # Strip any path components from the client-supplied filename to prevent
    # path traversal, then further restrict to safe characters only.
    raw_name = os.path.basename(file.filename or "upload")
    safe_name = f"{uuid.uuid4().hex[:8]}_{raw_name}"
    file_path = os.path.join(UPLOAD_DIR, safe_name)
    
    content = await file.read()
    with open(file_path, "wb") as out:
        out.write(content)
        
    background_tasks.add_task(
        _process_audio_summary,
        file_path=file_path,
        team_id=team_id,
        user_id=current_user.id,
        db_url=str(db.bind.url) if db.bind else ""
    )
    
    return {"message": "Audio recording uploaded. AI is processing the summary and will insert it into the Brain shortly."}
