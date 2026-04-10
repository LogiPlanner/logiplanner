from pydantic import BaseModel, EmailStr
from typing import Optional, List

class ProfileUpdateReq(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    notify_email: Optional[bool] = None
    notify_dashboard: Optional[bool] = None
    notify_deadline: Optional[bool] = None

class TeamUpdateReq(BaseModel):
    team_name: Optional[str] = None
    description: Optional[str] = None
    ai_sensitivity: Optional[int] = None

class RoleUpdateReq(BaseModel):
    role_name: str  # "owner", "editor", "viewer"

class InviteMemberReq(BaseModel):
    email: EmailStr
    role: str = "viewer"

# SubTeam schemas (UI "Team" = DB "SubTeam")
class SubTeamCreateReq(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#4f46e5"

class SubTeamUpdateReq(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None

class SubTeamResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    member_count: int = 0

    class Config:
        from_attributes = True
