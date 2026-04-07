from pydantic import BaseModel, EmailStr
from typing import Optional

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
