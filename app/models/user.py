from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Text, Table
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy.sql import func
import uuid
from datetime import datetime

Base = declarative_base()

# Many-to-Many association tables (from your ERD)
user_team = Table(
    "user_team", Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id")),
    Column("team_id", Integer, ForeignKey("teams.id"))
)

user_project = Table(
    "user_project", Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id")),
    Column("project_id", Integer, ForeignKey("projects.id"))
)

# === MAIN MODELS (exact from Login&user info.pdf ERD + auth flow) ===

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    avatar = Column(String, nullable=True)                    # for later profile
    job_title = Column(String, nullable=True)
    role_preference = Column(String, nullable=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)              # for email verification (auth.pdf)
    verification_token = Column(String, nullable=True, unique=True)
    last_verification_sent = Column(DateTime(timezone=True), nullable=True)
    notify_email = Column(Boolean, default=True)
    notify_dashboard = Column(Boolean, default=True)
    notify_deadline = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships (from ERD)
    company = relationship("Company", back_populates="users")
    teams = relationship("Team", secondary=user_team, back_populates="users")
    projects = relationship("Project", secondary=user_project, back_populates="users")
    user_roles = relationship("UserRole", back_populates="user")

    def __repr__(self):
        return f"<User {self.email}>"

class Company(Base):
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, index=True)
    company_name = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    users = relationship("User", back_populates="company")
    teams = relationship("Team", back_populates="company")   # if you want company owns teams

class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    team_name = Column(String, unique=True, nullable=False)
    description = Column(Text, nullable=True)
    invite_code = Column(String, unique=True, default=lambda: str(uuid.uuid4())[:8])
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)
    ai_sensitivity = Column(Integer, default=84)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    company = relationship("Company", back_populates="teams")
    users = relationship("User", secondary=user_team, back_populates="teams")
    projects = relationship("Project", back_populates="team")

class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)   # e.g. "owner", "member", "admin"

    user_roles = relationship("UserRole", back_populates="role")

class UserRole(Base):
    __tablename__ = "user_roles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    role_id = Column(Integer, ForeignKey("roles.id"))
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=True, index=True)  # scopes role to a specific team
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)  # optional per-project role

    user = relationship("User", back_populates="user_roles")
    role = relationship("Role", back_populates="user_roles")

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    project_name = Column(String, nullable=False)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    team = relationship("Team", back_populates="projects")
    users = relationship("User", secondary=user_project, back_populates="projects")


# ═══════════════════════════════════════════════════
# RAG SYSTEM MODELS
# ═══════════════════════════════════════════════════

class Document(Base):
    """Tracks uploaded documents processed by the RAG pipeline."""
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    uploader_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename = Column(String, nullable=False)             # Original filename
    stored_path = Column(String, nullable=True)            # Path on disk (null after processing)
    doc_type = Column(String, nullable=False)              # pdf/docx/txt/markdown/text
    file_size = Column(Integer, default=0)                 # Size in bytes
    chunk_count = Column(Integer, default=0)               # Number of chunks in vector store
    status = Column(String, default="pending")             # pending/processing/ready/error
    error_message = Column(Text, nullable=True)            # Error details if status=error
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    team = relationship("Team", backref="documents")
    uploader = relationship("User", backref="uploaded_documents")

    def __repr__(self):
        return f"<Document {self.filename} ({self.status})>"


class ChatMessage(Base):
    """Stores AI Brain chat history per team."""
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    session_id = Column(String, nullable=True, index=True)  # Groups messages into conversations
    role = Column(String, nullable=False)                  # "user" or "assistant"
    content = Column(Text, nullable=False)                 # Message content
    sources = Column(Text, nullable=True)                  # JSON array of source refs
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    team = relationship("Team", backref="chat_messages")
    user = relationship("User", backref="chat_messages")

    def __repr__(self):
        return f"<ChatMessage {self.role}: {self.content[:50]}...>"
    

from app.models.timeline import TimelineEntry
from app.models.calendar_task import CalendarTask