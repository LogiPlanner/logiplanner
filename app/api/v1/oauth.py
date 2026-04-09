from fastapi import APIRouter, Depends, HTTPException, Request, Response
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
            hashed_password=None,   # OAuth users have no password
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif user.hashed_password == "":
        # Fix legacy OAuth users that got empty-string password
        user.hashed_password = None
        db.commit()
    return user


@router.get("/google")
async def google_login(request: Request):
    """Redirect user directly to Google's consent screen."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google OAuth not configured")

    state = secrets.token_urlsafe(32)

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
    response = RedirectResponse(url=auth_url)

    # Store state in a signed HttpOnly cookie instead of session middleware
    # This avoids the timing bug where the session cookie wasn't set on first visit
    response.set_cookie(
        key="oauth_state",
        value=state,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=600,  # 10 minutes
    )

    return response


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

    # Verify state from cookie for CSRF protection
    stored_state = request.cookies.get("oauth_state")
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

    # Create app JWT tokens
    access_token = create_access_token(data={"sub": user.email})
    refresh_token = create_refresh_token(data={"sub": user.email})

    # Determine where to redirect based on user state
    profile_complete = bool(user.full_name and user.job_title)
    has_teams = len(user.teams) > 0

    if not profile_complete:
        redirect_url = f"/onboarding?token={access_token}&refresh_token={refresh_token}"
    elif not has_teams:
        redirect_url = f"/onboarding?token={access_token}&refresh_token={refresh_token}"
    else:
        redirect_url = f"/dashboard?token={access_token}&refresh_token={refresh_token}"

    # Build response and clear the OAuth state cookie
    response = RedirectResponse(url=redirect_url)
    response.delete_cookie("oauth_state")

    return response