from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.user import User
from app.core.config import settings
from app.core.security import create_access_token, create_refresh_token
import httpx
import secrets

router = APIRouter(tags=["oauth"])

def get_or_create_google_user(db: Session, email: str, full_name: str = None):
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(
            email=email,
            full_name=full_name,
            is_active=True,
            is_verified=True,          # Google already verified the email
            hashed_password=""         # no password needed
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user

@router.get("/google")
async def google_login(request: Request):
    state = secrets.token_urlsafe(32)
    request.session["oauth_state"] = state

    auth_url = (
        "https://accounts.google.com/o/oauth2/auth"
        f"?client_id={settings.GOOGLE_CLIENT_ID}"
        f"&redirect_uri={settings.GOOGLE_REDIRECT_URI}"
        "&response_type=code"
        "&scope=openid email profile"
        f"&state={state}"
    )
    return {"url": auth_url}

@router.get("/google/callback")
async def google_callback(code: str, state: str, request: Request, db: Session = Depends(get_db)):
    # Verify state (security)
    if state != request.session.get("oauth_state"):
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    # Exchange code for token
    token_url = "https://oauth2.googleapis.com/token"
    data = {
        "code": code,
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(token_url, data=data)
        token_data = token_resp.json()

    # Get user info
    userinfo_url = "https://www.googleapis.com/oauth2/v3/userinfo"
    headers = {"Authorization": f"Bearer {token_data['access_token']}"}
    async with httpx.AsyncClient() as client:
        userinfo_resp = await client.get(userinfo_url, headers=headers)
        user_info = userinfo_resp.json()

    # Create or get user
    user = get_or_create_google_user(db, user_info["email"], user_info.get("name"))

    # Create JWT tokens (same as normal login)
    access_token = create_access_token(data={"sub": user.email})
    refresh_token = create_refresh_token(data={"sub": user.email})

    return {
        "message": "Google login successful!",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "email": user.email
    }