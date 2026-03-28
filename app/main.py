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
# Create tables on startup (development only)
# ──────────────────────────────────────────────
@app.on_event("startup")
def create_tables():
    from app.models.user import Base as ModelBase
    ModelBase.metadata.create_all(bind=engine)
    print("[OK] Database tables ensured")


# ──────────────────────────────────────────────
# API Routers
# ──────────────────────────────────────────────
from app.api.v1.auth import router as auth_router
app.include_router(auth_router, prefix=settings.API_V1_STR, tags=["auth"])

from app.api.v1.oauth import router as oauth_router
app.include_router(oauth_router, prefix=settings.API_V1_STR, tags=["oauth"])


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
    return templates.TemplateResponse("auth/profile.html", {"request": request})


@app.get("/team-select")
async def team_select_page(request: Request):
    return templates.TemplateResponse("auth/team-select.html", {"request": request})


@app.get("/dashboard")
async def dashboard_page(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})


@app.get("/")
async def root_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/login")
