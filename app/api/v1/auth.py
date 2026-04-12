from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from app.core.dependencies import get_current_user
from app.core.database import get_db
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    create_verification_token,
    get_password_hash,
    verify_password,
)
from app.models.user import User, Team, Role, UserRole
from app.schemas.auth import (
    EmailResponse,
    MessageResponse,
    ResendVerificationRequest,
    Token,
    UserCreate,
    UserLogin,
    ProfileCompleteResponse,
    ProfileUpdate,
    TeamCreate,
    TeamCreateResponse,
    JoinTeamRequest,
    JoinTeamResponse,
    TeamPreview,
    UserTeamsResponse,
    VerificationStatusResponse,
    VerifyEmailRequest,
)
from app.utils.email import send_verification_email

router = APIRouter()


# ──────────────────────────────────────────────
# AUTH ENDPOINTS
# ──────────────────────────────────────────────

@router.post("/signup", response_model=MessageResponse)
async def signup(
    user_data: UserCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    new_user = User(
        email=user_data.email,
        hashed_password=get_password_hash(user_data.password),
        full_name=user_data.full_name,
        is_active=True,
        is_verified=False,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    token = create_verification_token()
    new_user.verification_token = token
    new_user.last_verification_sent = datetime.now(timezone.utc)
    db.commit()

    # Call directly with await — NOT wrapped in background_tasks.add_task()
    await send_verification_email(new_user.email, token, background_tasks)

    return {"message": "Account created! Please check your email for your verification code."}


@router.post("/token", response_model=Token, include_in_schema=False)
async def token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """OAuth2-compatible endpoint used by Swagger UI Authorize."""
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in.",
        )
    access_token = create_access_token(data={"sub": user.email})
    refresh_token = create_refresh_token(data={"sub": user.email})
    return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}


@router.post("/login", response_model=Token)
async def login(user_data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == user_data.email).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="We couldn't find an account with that email. Please sign up instead.",
        )

    if not verify_password(user_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password. Please try again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in.",
        )

    access_token = create_access_token(data={"sub": user.email})
    refresh_token = create_refresh_token(data={"sub": user.email})

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
    }


from pydantic import BaseModel as _BM

class _RefreshBody(_BM):
    refresh_token: str

@router.post("/refresh", response_model=Token)
async def refresh_tokens(body: _RefreshBody, db: Session = Depends(get_db)):
    """Exchange a valid refresh token for a new access + refresh token pair."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token.",
    )
    try:
        payload = jwt.decode(body.refresh_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        email: str = payload.get("sub")
        token_type: str = payload.get("token_type")
        if email is None or token_type != "refresh":
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.email == email).first()
    if user is None or not user.is_active:
        raise credentials_exception

    new_access = create_access_token(data={"sub": user.email})
    new_refresh = create_refresh_token(data={"sub": user.email})
    return {"access_token": new_access, "refresh_token": new_refresh, "token_type": "bearer"}


@router.post("/token", response_model=Token, include_in_schema=False)
async def token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """OAuth2-compatible endpoint used by Swagger UI Authorize."""
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in.",
        )
    access_token = create_access_token(data={"sub": user.email})
    refresh_token = create_refresh_token(data={"sub": user.email})
    return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}


@router.post("/resend-verification", response_model=EmailResponse)
async def resend_verification(
    payload: ResendVerificationRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_verified:
        return {"message": "Email already verified"}

    # Rate limiting: 120 seconds
    if user.last_verification_sent:
        delta = datetime.now(timezone.utc) - user.last_verification_sent.replace(tzinfo=timezone.utc)
        if delta.total_seconds() < 120:
            seconds_left = int(120 - delta.total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {seconds_left} seconds before requesting a new code."
            )

    token = create_verification_token()
    user.verification_token = token
    user.last_verification_sent = datetime.now(timezone.utc)
    db.commit()

    # Call directly with await
    await send_verification_email(user.email, token, background_tasks)
    return {"message": "Verification code sent. Check your inbox."}


@router.post("/verify-email", response_model=MessageResponse)
async def verify_email(payload: VerifyEmailRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_verified:
        return {"message": "Email already verified"}
    if not user.verification_token or user.verification_token != payload.code:
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")

    user.is_verified = True
    user.verification_token = None
    db.commit()

    return {"message": "Email verified successfully! You can now login."}


@router.get("/verification-status/{email}", response_model=VerificationStatusResponse)
async def get_verification_status(email: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"email": email, "is_verified": user.is_verified}


# ──────────────────────────────────────────────
# PROFILE ENDPOINTS
# ──────────────────────────────────────────────

@router.post("/complete-profile", response_model=ProfileCompleteResponse)
async def complete_profile(
    profile_data: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == current_user.id).first()

    if profile_data.full_name:
        user.full_name = profile_data.full_name
    if profile_data.avatar:
        user.avatar = profile_data.avatar
    if profile_data.job_title:
        user.job_title = profile_data.job_title
    if profile_data.role_preference:
        user.role_preference = profile_data.role_preference

    db.commit()
    db.refresh(user)

    return {
        "message": "Profile completed successfully!",
        "is_complete": True,
        "next_step": "team_selection",
    }


@router.get("/profile-status")
async def profile_status(current_user: User = Depends(get_current_user)):
    is_complete = bool(current_user.full_name and current_user.job_title)
    has_teams = len(current_user.teams) > 0
    if not is_complete:
        next_step = "complete_profile"
    elif not has_teams:
        next_step = "team_selection"
    else:
        next_step = "dashboard"
    return {
        "is_complete": is_complete,
        "has_teams": has_teams,
        "next_step": next_step,
        "full_name": current_user.full_name,
        "email": current_user.email,
        "job_title": current_user.job_title,
        "notify_email": current_user.notify_email,
        "notify_dashboard": current_user.notify_dashboard,
        "notify_deadline": current_user.notify_deadline,
    }


# ──────────────────────────────────────────────
# TEAM ENDPOINTS
# ──────────────────────────────────────────────

def _get_or_create_role(db: Session, role_name: str) -> Role:
    """Get an existing role or create it."""
    role = db.query(Role).filter(Role.name == role_name).first()
    if not role:
        role = Role(name=role_name)
        db.add(role)
        db.flush()
    return role


@router.post("/create-team", response_model=TeamCreateResponse)
async def create_team(
    team_data: TeamCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Check if team name already exists
    existing = db.query(Team).filter(Team.team_name == team_data.team_name).first()
    if existing:
        raise HTTPException(status_code=400, detail="A team with this name already exists")

    team = Team(team_name=team_data.team_name, description=team_data.description)
    db.add(team)
    db.flush()

    # Add user to team
    team.users.append(current_user)

    # Assign owner role scoped to this team
    owner_role = _get_or_create_role(db, "owner")
    user_role = UserRole(user_id=current_user.id, role_id=owner_role.id, team_id=team.id)
    db.add(user_role)

    db.commit()
    db.refresh(team)

    return {
        "message": "Team created successfully!",
        "team_id": team.id,
        "invite_code": team.invite_code,
        "team_name": team.team_name,
    }


@router.get("/team-preview/{invite_code}", response_model=TeamPreview)
async def team_preview(invite_code: str, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.invite_code == invite_code).first()
    if not team:
        raise HTTPException(status_code=404, detail="Invalid invite code. Please check and try again.")

    return {
        "team_name": team.team_name,
        "description": team.description or "No description provided.",
        "member_count": len(team.users),
    }


@router.post("/join-team", response_model=JoinTeamResponse)
async def join_team(
    data: JoinTeamRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    team = db.query(Team).filter(Team.invite_code == data.invite_code).first()
    if not team:
        raise HTTPException(status_code=404, detail="Invalid invite code")

    if current_user in team.users:
        raise HTTPException(status_code=400, detail="You are already a member of this team")

    team.users.append(current_user)

    # Assign viewer role scoped to this team
    viewer_role = _get_or_create_role(db, "viewer")
    user_role = UserRole(user_id=current_user.id, role_id=viewer_role.id, team_id=team.id)
    db.add(user_role)

    db.commit()

    return {
        "message": f"Welcome to {team.team_name}!",
        "team_name": team.team_name,
        "team_id": team.id,
    }


@router.get("/user-teams", response_model=UserTeamsResponse)
async def user_teams(current_user: User = Depends(get_current_user)):
    return {
        "has_teams": len(current_user.teams) > 0,
        "teams": [{"id": t.id, "name": t.team_name} for t in current_user.teams],
    }