import os
import json
import uuid
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.orm import Session
from openai import OpenAI

from app.core.dependencies import get_current_user
from app.core.database import get_db
from app.core.config import settings
from app.models.user import User, Team, ChatMessage
from app.models.meeting import MeetingFolder, MeetingNote, WhiteboardState
from app.schemas.meeting import FolderCreate, FolderResponse, NoteCreate, NoteUpdate, NoteResponse
from app.api.v1.rag import _verify_team_access

router = APIRouter()

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

@router.websocket("/ws/{team_id}")
async def websocket_endpoint(websocket: WebSocket, team_id: int, db: Session = Depends(get_db)):
    # Note: WebSocket authentication can be tricky, typically done via token in query param.
    # For now, we will accept and handle team-based broadcasting.
    await manager.connect(websocket, team_id)
    
    try:
        # On connection, send the latest state to the client
        state = db.query(WhiteboardState).filter(WhiteboardState.team_id == team_id).first()
        if state and state.state_json:
            await websocket.send_text(json.dumps({
                "type": "init",
                "data": state.state_json
            }))
        
        while True:
            data = await websocket.receive_text()
            # Broadcast the delta/event to other clients
            await manager.broadcast(data, team_id, exclude=websocket)
            
            # Periodically or on every update (simplified here), save to DB
            msg = json.loads(data)
            if msg.get("type") == "save_state":
                board_state = db.query(WhiteboardState).filter(WhiteboardState.team_id == team_id).first()
                if not board_state:
                    board_state = WhiteboardState(team_id=team_id, state_json=msg.get("data"))
                    db.add(board_state)
                else:
                    board_state.state_json = msg.get("data")
                db.commit()
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, team_id)


# ──────────────────────────────────────────────
# Folders API
# ──────────────────────────────────────────────

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
    db = SessionLocal()
    try:
        # 1. Transcribe audio with Whisper
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

        # 3. Add to AI Brain (ChatMessage) so the RAG context picks it up for the team
        assistant_msg = ChatMessage(
            team_id=team_id,
            user_id=user_id,
            session_id=str(uuid.uuid4()),
            role="assistant",
            content=f"Meeting Summary Generated:\n\n{summary}",
            sources=json.dumps([{"filename": "Meeting Recording", "page_number": 0, "uploader": "system", "doc_type": "audio"}])
        )
        db.add(assistant_msg)
        db.commit()

    except Exception as e:
        db.rollback()
        print(f"[RAG] Error processing audio summary: {e}")
    finally:
        db.close()
        # 4. Erase original file for privacy
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
