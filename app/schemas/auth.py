from typing import Optional, List

from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    email: Optional[str] = None


class MessageResponse(BaseModel):
    message: str


class EmailResponse(BaseModel):
    message: str


class ResendVerificationRequest(BaseModel):
    email: EmailStr


# Profile completion after signup
class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    avatar: Optional[str] = None
    job_title: Optional[str] = None
    role_preference: Optional[str] = None


class ProfileCompleteResponse(BaseModel):
    message: str
    is_complete: bool
    next_step: str = "team_selection"


# Team management
class TeamCreate(BaseModel):
    team_name: str
    description: Optional[str] = None


class TeamCreateResponse(BaseModel):
    message: str
    team_id: int
    invite_code: str
    team_name: str


class JoinTeamRequest(BaseModel):
    invite_code: str


class JoinTeamResponse(BaseModel):
    message: str
    team_name: str
    team_id: int


class TeamPreview(BaseModel):
    team_name: str
    description: str
    member_count: int


class TeamInfo(BaseModel):
    id: int
    name: str


class UserTeamsResponse(BaseModel):
    has_teams: bool
    teams: List[TeamInfo]


class VerificationStatusResponse(BaseModel):
    is_verified: bool
    email: str