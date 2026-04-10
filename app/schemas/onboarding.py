from typing import Optional, List
from pydantic import BaseModel, EmailStr, field_validator


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
    label: Optional[str] = None           # e.g. "Google Drive Folder", "GitHub Repo"
    source_type: str = "google_drive"     # "google_drive" | "github"

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith(("https://", "http://")):
            raise ValueError("URL must start with https:// or http://")
        # Block private/internal IPs (SSRF prevention)
        import re
        host_match = re.search(r"://([^/:]+)", v)
        if host_match:
            host = host_match.group(1).lower()
            blocked = ["localhost", "127.0.0.1", "0.0.0.0", "169.254.", "10.", "192.168.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31."]
            if any(host.startswith(b) or host == b.rstrip(".") for b in blocked):
                raise ValueError("URLs pointing to internal/private networks are not allowed")
        return v

    @field_validator("source_type")
    @classmethod
    def validate_source_type(cls, v: str) -> str:
        allowed = {"google_drive", "github"}
        if v not in allowed:
            raise ValueError(f"source_type must be one of: {', '.join(allowed)}")
        return v


class CreateTeamStep3(BaseModel):
    """Step 3: Manual ingestion — links + file metadata (file uploads handled separately)"""
    links: List[IngestLinkItem] = []
    notes: Optional[str] = None           # Optional context notes for the AI Brain

    @field_validator("links")
    @classmethod
    def validate_links_limit(cls, v: list) -> list:
        if len(v) > 5:
            raise ValueError("Maximum 5 links allowed")
        return v

    @field_validator("notes")
    @classmethod
    def validate_notes_length(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > 5000:
            raise ValueError("Additional context must be 5000 characters or fewer")
        return v


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


# ── Setup Project (deferred creation — called from dashboard) ──

class SetupProjectRequest(BaseModel):
    """All-in-one deferred project setup. Collects everything from onboarding wizard
    and creates the team + processes data in one background call from the dashboard."""
    # Step 1
    team_name: str
    description: Optional[str] = None
    # Step 2 (owner details — job_title is always editable, full_name only if missing)
    full_name: Optional[str] = None
    job_title: str
    role_preference: Optional[str] = None
    project_stage: Optional[str] = None
    project_info: Optional[str] = None
    # Step 3 (ingestion)
    links: List[IngestLinkItem] = []
    notes: Optional[str] = None
    uploaded_files: List[str] = []        # stored_as filenames from temp upload
    # Step 4 (invites)
    invites: List[InviteMemberItem] = []

    @field_validator("links")
    @classmethod
    def validate_links_limit(cls, v: list) -> list:
        if len(v) > 5:
            raise ValueError("Maximum 5 links allowed")
        return v

    @field_validator("notes")
    @classmethod
    def validate_notes_length(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > 5000:
            raise ValueError("Additional context must be 5000 characters or fewer")
        return v

    @field_validator("uploaded_files")
    @classmethod
    def validate_filenames(cls, v: list) -> list:
        """Sanitize filenames — only allow expected stored filenames, no path traversal."""
        import os
        import re
        import unicodedata

        safe_pattern = re.compile(
            r"^[a-f0-9]{8}_[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*(?:\.[A-Za-z0-9]+)?$",
            re.IGNORECASE,
        )
        sanitized = []
        for name in v:
            normalized_name = unicodedata.normalize("NFKC", name).strip()
            if not normalized_name:
                raise ValueError("Invalid filename: empty filename")
            if os.path.basename(normalized_name) != normalized_name:
                raise ValueError(f"Invalid filename: {normalized_name}")
            if ".." in normalized_name or "/" in normalized_name or "\\" in normalized_name:
                raise ValueError(f"Invalid filename: {normalized_name}")
            if not safe_pattern.fullmatch(normalized_name):
                raise ValueError(f"Invalid filename format: {normalized_name}")
            sanitized.append(normalized_name)
        return sanitized


class SetupProjectResponse(BaseModel):
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
