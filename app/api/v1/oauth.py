from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from urllib.parse import urlencode

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
            is_verified=True,       # Google already verified the email
            hashed_password="",     # No password needed for OAuth users
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


@router.get("/google")
async def google_login(request: Request):
    """Redirect user directly to Google's consent screen."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google OAuth not configured")

    state = secrets.token_urlsafe(32)
    request.session["oauth_state"] = state

    params = urlencode({
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.get_google_redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    })

    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{params}"
    return RedirectResponse(url=auth_url)


@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: str = None,
    state: str = None,
    error: str = None,
    db: Session = Depends(get_db),
):
    # Handle errors from Google
    if error:
        return RedirectResponse(url=f"/login?error={error}")

    if not code:
        return RedirectResponse(url="/login?error=no_code")

    # Verify state for CSRF protection
    stored_state = request.session.get("oauth_state")
    if not stored_state or state != stored_state:
        print(f"⚠️ OAuth state mismatch: stored={stored_state}, received={state}")
        return RedirectResponse(url="/login?error=invalid_state")

    # Exchange code for token
    token_url = "https://oauth2.googleapis.com/token"
    data = {
        "code": code,
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "redirect_uri": settings.get_google_redirect_uri(),
        "grant_type": "authorization_code",
    }

    try:
        async with httpx.AsyncClient() as client:
            token_resp = await client.post(token_url, data=data)
            token_data = token_resp.json()

            if "access_token" not in token_data:
                print(f"❌ Google token exchange failed: {token_data}")
                return RedirectResponse(url="/login?error=token_exchange_failed")

        # Get user info from Google
        userinfo_url = "https://www.googleapis.com/oauth2/v3/userinfo"
        headers = {"Authorization": f"Bearer {token_data['access_token']}"}

        async with httpx.AsyncClient() as client:
            userinfo_resp = await client.get(userinfo_url, headers=headers)
            user_info = userinfo_resp.json()

    except Exception as e:
        print(f"❌ Google OAuth error: {e}")
        return RedirectResponse(url="/login?error=oauth_failed")

    # Create or get user
    user = get_or_create_google_user(db, user_info["email"], user_info.get("name"))

    # Create app JWT token
    access_token = create_access_token(data={"sub": user.email})

    # Determine where to redirect based on user state
    profile_complete = bool(user.full_name and user.job_title)
    has_teams = len(user.teams) > 0

    if not profile_complete:
        redirect_url = f"/profile?token={access_token}"
    elif not has_teams:
        redirect_url = f"/team-select?token={access_token}"
    else:
        redirect_url = f"/dashboard?token={access_token}"

    # Clear OAuth state from session
    request.session.pop("oauth_state", None)

    return RedirectResponse(url=redirect_url)