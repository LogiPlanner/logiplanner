from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware


from app.core.config import settings
from app.core.database import engine

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────
# Startup
# ──────────────────────────────────────────────
@app.on_event("startup")
def on_startup():
    from app.models.user import Base as ModelBase
    import app.models.meeting
    ModelBase.metadata.create_all(bind=engine)

    # Reset any documents that were stuck mid-processing when the server last crashed.
    from app.core.database import SessionLocal
    from app.models.user import Document
    db = SessionLocal()
    try:
        stuck = db.query(Document).filter(Document.status.in_(["pending", "processing"])).all()
        if stuck:
            for doc in stuck:
                doc.status = "error"
                doc.error_message = "Processing was interrupted (server restart). Please re-upload."
            db.commit()
            print(f"[RAG] ⚠️ Marked {len(stuck)} stuck document(s) as error on startup.")
    finally:
        db.close()


# ──────────────────────────────────────────────
# API Routers
# ──────────────────────────────────────────────
from app.api.v1.auth import router as auth_router
app.include_router(auth_router, prefix=settings.API_V1_STR, tags=["auth"])

from app.api.v1.oauth import router as oauth_router
app.include_router(oauth_router, prefix=settings.API_V1_STR, tags=["oauth"])

from app.api.v1.onboarding import router as onboarding_router
app.include_router(onboarding_router, prefix=settings.API_V1_STR + "/onboarding", tags=["onboarding"])

from app.api.v1.rag import router as rag_router
app.include_router(rag_router, prefix=settings.API_V1_STR + "/rag", tags=["rag"])

from app.api.v1.timeline import router as timeline_router
app.include_router(timeline_router, prefix=settings.API_V1_STR + "/timeline", tags=["timeline"])

from app.api.v1.calendar import router as calendar_router
app.include_router(calendar_router, prefix=settings.API_V1_STR + "/calendar", tags=["calendar"])

from app.api.v1.settings import router as settings_router
app.include_router(settings_router, prefix=settings.API_V1_STR + "/settings", tags=["settings"])

from app.api.v1.meetings import router as meetings_router
app.include_router(meetings_router, prefix=settings.API_V1_STR + "/meetings", tags=["meetings"])

# ──────────────────────────────────────────────
# Health Check
# ──────────────────────────────────────────────
@app.get("/health")
async def health_check():
    return {"status": "healthy", "project": settings.PROJECT_NAME}


# ──────────────────────────────────────────────
# Page Routes
# ──────────────────────────────────────────────
@app.get("/login")
async def login_page(request: Request):
    return templates.TemplateResponse("auth/login.html", {"request": request})


@app.get("/signup")
async def signup_page(request: Request):
    return templates.TemplateResponse("auth/signup.html", {"request": request})


@app.get("/verify-email")
async def verify_email_page(request: Request):
    return templates.TemplateResponse("auth/verify-email.html", {"request": request})


@app.get("/profile")
async def profile_page(request: Request):
    """Legacy — redirects to onboarding"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/onboarding")


@app.get("/team-select")
async def team_select_page(request: Request):
    """Legacy — redirects to onboarding"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/onboarding")


@app.get("/onboarding")
async def onboarding_page(request: Request):
    return templates.TemplateResponse("onboarding/setup.html", {"request": request})


@app.get("/dashboard")
async def dashboard_page(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request, "active_nav": "dashboard"})


@app.get("/ai-brain")
async def ai_brain_page(request: Request):
    return templates.TemplateResponse("ai-brain.html", {"request": request, "active_nav": "ai_brain"})


@app.get("/studio")
async def studio_page(request: Request):
    return templates.TemplateResponse("studio.html", {"request": request, "active_nav": "ai_brain"})


@app.get("/memory")
async def memory_page(request: Request):
    return templates.TemplateResponse("memory.html", {"request": request, "active_nav": "project_memory"})


@app.get("/meetings")
async def meetings_page(request: Request):
    return templates.TemplateResponse("meetings/meetings.html", {"request": request, "active_nav": "meeting_notes"})


@app.get("/settings")
async def settings_page(request: Request):
    return templates.TemplateResponse("settings.html", {"request": request, "active_nav": "settings"})


@app.get("/")
async def root_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/login")

@app.get("/coming-soon")
async def coming_soon_page(request: Request):
    return templates.TemplateResponse("coming_soon.html", {"request": request})
