from typing import Optional, List
from pydantic import BaseModel, EmailStr


# ── Create Team Flow ──

class CreateTeamStep1(BaseModel):
    """Step 1: Team Name + Description"""
    team_name: str
    description: Optional[str] = None


class CreateTeamStep2(BaseModel):
    """Step 2: Owner's own details"""
    full_name: str
    job_title: str
    role_preference: Optional[str] = None
    project_stage: Optional[str] = None   # e.g. "Ideation", "In Progress", "Late Stage"
    project_info: Optional[str] = None    # Short description of what the project is about


class IngestLinkItem(BaseModel):
    """A single external link for ingestion"""
    url: str
    label: Optional[str] = None           # e.g. "Google Drive Folder", "Miro Board"
    source_type: str = "link"             # "google_drive" | "miro" | "github" | "link"


class CreateTeamStep3(BaseModel):
    """Step 3: Manual ingestion — links + file metadata (file uploads handled separately)"""
    links: List[IngestLinkItem] = []
    notes: Optional[str] = None           # Optional context notes for the AI Brain


class InviteMemberItem(BaseModel):
    email: EmailStr
    role: str = "member"                  # "member" | "admin"


class CreateTeamStep4(BaseModel):
    """Step 4: Invite members"""
    invites: List[InviteMemberItem] = []


class CreateTeamResponse(BaseModel):
    message: str
    team_id: int
    team_name: str
    invite_code: str


# ── Join Team Flow ──

class JoinTeamStep1(BaseModel):
    """Enter invite code"""
    invite_code: str


class JoinTeamUserDetails(BaseModel):
    """User details when joining a team"""
    full_name: str
    job_title: str
    role_preference: Optional[str] = None


class TeamPreviewResponse(BaseModel):
    team_name: str
    description: Optional[str] = None
    member_count: int
    owner_name: Optional[str] = None


class OnboardingBriefResponse(BaseModel):
    """Smart onboarding brief — placeholder for AI-generated content"""
    team_name: str
    project_info: Optional[str] = None
    member_count: int
    message: str = "Welcome aboard! Here's what you need to know."


# ── Deferred Setup (called from Dashboard welcome screen) ──

class SetupProjectRequest(BaseModel):
    """All-in-one project setup payload — collected by onboarding wizard, submitted by dashboard."""
    team_name: str
    description: Optional[str] = None
    full_name: Optional[str] = None
    job_title: Optional[str] = None
    role_preference: Optional[str] = None
    project_stage: Optional[str] = None
    project_info: Optional[str] = None
    links: List[IngestLinkItem] = []
    notes: Optional[str] = None
    uploaded_files: List[str] = []
    invites: List[InviteMemberItem] = []


class SetupProjectResponse(BaseModel):
    message: str
    team_id: int
    team_name: str
    invite_code: str
