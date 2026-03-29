# CODEBASE_CONTEXT.md — LogiPlanner

> **Purpose:** Give any AI assistant (or new developer) a complete, up-to-date mental model of this project. Read this file first before making changes.

---

## 1 · Project Overview

LogiPlanner (**"Plans With Logic"**) is an AI-driven project management and **project memory** system. It solves the core problem of **context loss in teams** — decisions forgotten, updates scattered across Miro/Drive/chats/meetings, and painful onboarding — by unifying all project information into a single intelligent, searchable, evolving "Project Brain."

The current codebase implements the **authentication system** (email/password + Google OAuth), email verification, profile completion, team management (create/join via invite code), and the dashboard shell. The AI Brain, ingestion pipeline, project memory timeline, and remaining features are the next phases of development.

---

## 2 · Product Vision & Roadmap

### What LogiPlanner will be (full scope)

| Component | Description | Status |
|---|---|---|
| **Auth & Onboarding** | Email/password signup, Google OAuth, email verification, profile completion, team create/join with invite codes | ✅ Implemented |
| **Dashboard** | Project overview, calendar (daily/weekly/monthly), recent updates, AI actionable steps, task tagging | 🔨 Shell built, features in progress |
| **AI Brain (RAG)** | Per-team knowledge base using embeddings (OpenAI + Pinecone/similar). Stores project data, generates summaries, extracts decisions/milestones/tasks, provides analytics | ✅ Implemented |
| **AI Chat** | Two modes: **Studio Mode** (drag-drop file upload, external links, knowledge base preview — limited to leads) and **Chat Mode** (ask questions from the knowledge base) | 🔜 Planned |
| **Auto & Manual Ingestion** | Connect Google Drive, Miro, GitHub repos — auto-sync to AI Brain. Manual upload also supported via AI Chat Studio | 🔜 Planned |
| **Project Memory Timeline** | Chronological timeline of Decisions, Milestones, and Summaries/Uploads. AI-generated insights. Editable by project lead | 🔜 Planned |
| **Meeting Notes / Editor** | Auto-generated meeting discussion canvas. Rich text editor (Slate.js planned). Save updates to AI Brain | 🔜 Planned |
| **Planning Calendar** | Daily/weekly/monthly views. Time-based and deadline-based tasks. AI actionable steps flow into calendar items | 🔜 Planned |
| **Smart Onboarding** | New team members get AI-generated brief: project idea, past week summary, team info, responsibilities | 🔜 Planned |
| **Pages/Notes (Confluence-style)** | Channel-based pages, AI actionable steps help modify plans | 🔜 Planned |
| **Desktop Client / Web Extension** | Tauri-based desktop app, browser extension for screenshot capture to AI Brain | 🔜 Planned (Future) |

### System architecture (planned)

```
┌─────────────────────────────────────────────────────────────────┐
│                      INGESTION LAYER                            │
│  Google Drive · Miro · GitHub · Manual Upload · Web Extension   │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PROCESSING LAYER (AI Brain)                 │
│  RAG Pipeline · Embeddings · Summarization · Task Extraction    │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VERIFICATION LAYER                            │
│  Human review before data enters the Project Memory             │
│  (AI won't persist to Brain until a human verifies)             │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                       WEB DASHBOARD                             │
│  Timeline · Calendar · AI Chat · Notes/Pages · Onboarding      │
└─────────────────────────────────────────────────────────────────┘
```

### Key differentiator

> *"Notion AI guesses what happened. LogiPlanner **knows** what happened because a human verifies it."*
> — The verification layer ensures low hallucination and gives humans control over their project memory.

### Future scope (not in current implementation)

- Agentic workflows
- Multi-user role-based collaboration with granular permissions
- Real-time calls + transcription
- Integrations: Jira, Slack, Notion, Confluence
- Mobile app for data collection/ingestion
- Predictive analytics for project risks

---

## 3 · Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| **Runtime** | Python 3.11+ | Required minimum version |
| **Backend Framework** | FastAPI 0.135+ | Async endpoints, auto-generated OpenAPI docs at `/docs` |
| **Templating** | Jinja2 | Server-side HTML rendering (`app/templates/`) |
| **Frontend** | Vanilla HTML / CSS / JS | No React, no build step — static files served by FastAPI |
| **Database** | PostgreSQL | Connected via `psycopg2-binary` (sync driver) |
| **ORM** | SQLAlchemy 2.0 | Declarative models, sync `Session` |
| **Migrations** | Alembic | Config in `alembic.ini`, scripts in `migrations/` |
| **Auth — Passwords** | bcrypt (direct) | `bcrypt.hashpw` / `bcrypt.checkpw` — no passlib wrapper |
| **Auth — Tokens** | python-jose (JWT) | HS256, access + refresh tokens |
| **Auth — OAuth** | Google OAuth 2.0 (manual) | Built with `httpx`; no third-party OAuth library |
| **Session Middleware** | Starlette `SessionMiddleware` | Used solely for OAuth CSRF `state` parameter |
| **Email** | `fastapi-mail` + `aiosmtplib` | SMTP sending queued as `BackgroundTasks`; falls back to console logging when SMTP is not configured |
| **Env Config** | `pydantic-settings` (v2) | `BaseSettings` with `.env` file, `SettingsConfigDict` |
| **Package Management** | Poetry (`pyproject.toml`) + `requirements.txt` | `poetry.lock` present; `requirements.txt` kept for quick `pip install` |

---

## 4 · Architecture & Folder Structure

```
logiplanner/
├── main.py                      # Entrypoint — runs uvicorn with reload
├── alembic.ini                  # Alembic config (points to migrations/)
├── requirements.txt             # Flat pip dependencies
├── pyproject.toml               # Poetry project metadata
├── .env                         # Environment variables (never commit)
│
├── app/
│   ├── __init__.py
│   ├── main.py                  # FastAPI app instance, middleware, routers, page routes
│   │
│   ├── core/                    # Shared infrastructure
│   │   ├── config.py            # `Settings` (pydantic-settings), singleton `settings`
│   │   ├── database.py          # `engine`, `SessionLocal`, `get_db` dependency
│   │   ├── dependencies.py      # `get_current_user` (JWT → User lookup)
│   │   └── security.py          # Password hashing, JWT creation, verification tokens
│   │
│   ├── models/                  # SQLAlchemy ORM models
│   │   └── user.py              # User, Company, Team, Role, UserRole, Project + association tables
│   │
│   ├── schemas/                 # Pydantic request/response models
│   │   └── auth.py              # UserCreate, UserLogin, Token, ProfileUpdate, Team schemas, etc.
│   │
│   ├── api/
│   │   └── v1/                  # Versioned API (prefix: /api/v1)
│   │       ├── auth.py          # Signup, Login, Email verification, Profile, Teams
│   │       └── oauth.py         # Google OAuth login + callback
│   │
│   ├── utils/
│   │   └── email.py             # `send_verification_email` (console + SMTP)
│   │
│   ├── templates/               # Jinja2 HTML templates
│   │   ├── auth/
│   │   │   ├── base.html        # Shared base layout for auth pages
│   │   │   ├── login.html
│   │   │   ├── signup.html
│   │   │   ├── verify-email.html
│   │   │   ├── profile.html
│   │   │   └── team-select.html
│   │   └── dashboard.html       # Main dashboard (post-auth)
│   │
│   └── static/                  # Static assets served at /static
│       ├── auth/
│       │   ├── css/
│       │   │   ├── common.css   # Shared auth styles (design system)
│       │   │   ├── login.css
│       │   │   ├── signup.css
│       │   │   └── verify-email.css
│       │   └── js/
│       │       ├── common.js    # Shared auth JS utilities
│       │       ├── login.js
│       │       ├── signup.js
│       │       ├── verify-email.js
│       │       ├── profile.js
│       │       └── team-select.js
│       ├── css/                 # (Empty — reserved for non-auth styles)
│       └── js/                  # (Empty — reserved for non-auth scripts)
│
├── migrations/                  # Alembic migrations
│   ├── env.py                   # Imports `Base` from app.models.user for autogenerate
│   ├── script.py.mako
│   └── versions/                # Auto-generated migration scripts
│
└── clearusers.py                # Dev utility — wipes user data
```

### Key architectural decisions

- **Monolith:** Everything (API + page serving + static files) lives in a single FastAPI process.
- **No SPA:** The frontend is plain Jinja2 templates + Vanilla JS. Pages navigate with full HTTP requests; JS handles form submissions via `fetch()` to the `/api/v1/` endpoints.
- **Feature-folder convention for new features:** Each major feature gets its own folder under `api/v1/`, `schemas/`, `models/`, `templates/`, and `static/`. Example: auth lives in `api/v1/auth.py`, `schemas/auth.py`, `templates/auth/`, `static/auth/`.
- **Page routes live in `app/main.py`:** All `@app.get("/page-name")` HTML-serving routes are defined directly in the app factory, not in the API routers.
- **API routers are versioned:** All JSON API endpoints are under `/api/v1/` via `settings.API_V1_STR`.

---

## 5 · Database Schema

PostgreSQL, managed by Alembic. All models are defined in `app/models/user.py` using a single shared `Base = declarative_base()`.

### Tables & Relationships

ONLY AUTH IMPLEMENTED FOR NOW- 
```
┌──────────────────┐       ┌──────────────┐       ┌──────────────┐
│      users       │──M:N──│  user_team   │──M:N──│    teams     │
├──────────────────┤       └──────────────┘       ├──────────────┤
│ id (PK)          │                               │ id (PK)      │
│ email (unique)   │       ┌──────────────┐       │ team_name    │
│ hashed_password  │──M:N──│ user_project │──M:N──│ description  │
│ full_name        │       └──────────────┘       │ invite_code  │
│ avatar           │                               │ company_id → │
│ job_title        │       ┌──────────────┐       │ created_at   │
│ role_preference  │       │  user_roles   │       └──────────────┘
│ company_id (FK)──│──►    ├──────────────┤
│ is_active        │       │ id (PK)      │       ┌──────────────┐
│ is_verified      │       │ user_id (FK) │       │    roles     │
│ verification_tok │       │ role_id (FK)──│──────►├──────────────┤
│ last_verif_sent  │       │ project_id   │       │ id (PK)      │
│ created_at       │       └──────────────┘       │ name (unique)│
│ updated_at       │                               └──────────────┘
└──────────────────┘
        │                                          ┌──────────────┐
        └─────────────────────────FK──────────────►│  companies   │
                                                   ├──────────────┤
┌──────────────────┐                               │ id (PK)      │
│    projects      │                               │ company_name │
├──────────────────┤                               │ created_at   │
│ id (PK)          │                               └──────────────┘
│ project_name     │
│ team_id (FK) ────│──► teams
│ created_at       │
└──────────────────┘
```

### User Model (most important)

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | Auto-increment |
| `email` | String, unique, indexed | Login identifier |
| `hashed_password` | String | bcrypt hash; empty string `""` for OAuth-only users |
| `full_name` | String, nullable | Set during profile completion |
| `avatar` | String, nullable | Profile picture URL (future) |
| `job_title` | String, nullable | Set during profile completion |
| `role_preference` | String, nullable | User's preferred project role |
| `company_id` | FK → companies | Nullable |
| `is_active` | Boolean, default `True` | Soft-delete flag |
| `is_verified` | Boolean, default `False` | `True` after email verification or Google OAuth signup |
| `verification_token` | String, unique, nullable | UUID4 token; cleared after verification |
| `last_verification_sent` | DateTime(tz), nullable | Used for 120-second rate limiting on resend |
| `created_at` | DateTime(tz), server default | `func.now()` |
| `updated_at` | DateTime(tz), on update | Auto-set by SQLAlchemy |

### Association Tables

- **`user_team`** — Many-to-many between `users` and `teams`.
- **`user_project`** — Many-to-many between `users` and `projects`.

### Role System

- Roles are stored in the `roles` table (e.g., `"owner"`, `"member"`, `"admin"`).
- `user_roles` is the join table, with an optional `project_id` for per-project role scoping.
- The helper `_get_or_create_role()` in `auth.py` lazily creates roles on first use.

---


## 6 · Current Rules & Conventions

### Frontend

- **Vanilla JS only** — No React, Vue, or any JS framework. No bundler or build step.
- **Vanilla CSS only** — No Tailwind, no CSS-in-JS. Hand-written stylesheets.
- **`common.css` is the shared design system** — All auth pages import it. It contains the full visual language (colors, typography, layout, animations). Page-specific CSS files (`login.css`, `signup.css`, etc.) hold only overrides.
- **`common.js` is the shared JS utility** — Reusable functions (e.g., token helpers) used across auth pages.
- **Static file naming mirrors the template name** — `login.html` → `login.css` + `login.js`.
- **JS talks to the API via `fetch()`** — No jQuery, no Axios. All API calls use the native Fetch API.

### Backend

- **One feature = one folder across the stack.** When adding a new feature (e.g., "notifications"), create:
  - `app/api/v1/notifications.py` — API router
  - `app/schemas/notifications.py` — Pydantic models
  - `app/models/notifications.py` — SQLAlchemy models (if new tables needed)
  - `app/templates/notifications/` — HTML templates
  - `app/static/notifications/` — CSS + JS
  - Then register the router in `app/main.py`.
- **All models share a single `Base`** — Defined in `app/models/user.py`. Alembic's `env.py` imports it from there.
- **Alembic for all schema changes** — Never modify tables by hand. Always run:
  ```bash
  alembic revision --autogenerate -m "description of change"
  alembic upgrade head
  ```
- **`pydantic-settings` v2 for configuration** — Uses `SettingsConfigDict` (not the v1 inner `class Config`). Settings loaded from `.env` with `extra="ignore"`.
- **Direct bcrypt, not passlib** — Passwords are hashed/verified using `bcrypt.hashpw()` / `bcrypt.checkpw()` directly.
- **Manual Google OAuth, not a library** — The OAuth flow is hand-built with `httpx` and `urllib.parse.urlencode`. No `authlib` or `fastapi-users` OAuth integration.
- **Email utility is dual-mode** — Always logs the verification link to the console. Only attempts SMTP if `SMTP_USER` and `SMTP_PASSWORD` are set in `.env`. This makes dev/testing easy without an email provider.
- **Background tasks for email** — SMTP sending is queued via FastAPI's `BackgroundTasks` so the API response isn't blocked. The `send_verification_email` function must be `await`ed directly, not wrapped in `background_tasks.add_task()`.
- **Dev table creation on startup** — `app/main.py` runs `Base.metadata.create_all()` on the `startup` event for convenience. In production, only Alembic migrations should create/alter tables.
- **CORS is wide open (`*`)** — Acceptable for development; must be locked down for production.

### API Design

- **All API endpoints are prefixed with `/api/v1/`** (configured via `settings.API_V1_STR`).
- **Page-serving routes (`GET /login`, `GET /dashboard`, etc.) are defined in `app/main.py`**, not in API routers.
- **Response models are always explicit** — Every endpoint specifies a `response_model` Pydantic schema.
- **Error responses use descriptive messages** — e.g., login differentiates "email not found" (404) from "wrong password" (401) from "not verified" (403).
- **Rate limiting is per-user, in-database** — The `last_verification_sent` timestamp on the User model enforces the 120-second cooldown. No Redis or external rate limiter.

### Git & Environment

- **`.env` is gitignored** — Never committed. Contains database URL, secrets, SMTP creds, OAuth keys.
- **`clearusers.py`** — Dev-only script to reset user data during testing.
- **Python virtual environment** — Standard `venv/` directory (gitignored).

---

## 8 · Environment Variables Reference

| Variable | Required | Example | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | `postgresql+psycopg2://user:pass@localhost:5432/logiplanner` | PostgreSQL connection |
| `SECRET_KEY` | Yes | `your-secret-key-here` | JWT signing + session middleware |
| `BASE_URL` | No | `http://127.0.0.1:8000` | Used in verification email links |
| `SMTP_HOST` | No | `smtp.gmail.com` | Email server |
| `SMTP_PORT` | No | `587` | Email server port |
| `SMTP_USER` | No | `you@gmail.com` | SMTP login |
| `SMTP_PASSWORD` | No | `app-password` | SMTP password |
| `EMAIL_FROM` | No | `noreply@logiplanner.com` | Sender address |
| `GOOGLE_CLIENT_ID` | No | `...apps.googleusercontent.com` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | No | `GOCSPX-...` | Google OAuth |
| `GOOGLE_REDIRECT_URI` | No | `http://127.0.0.1:8000/api/v1/google/callback` | OAuth callback (auto-computed if blank) |

---

## 9 · How to Run

```bash
# 1. Activate virtual environment
venv\Scripts\activate          # Windows
source venv/bin/activate       # macOS/Linux

# 2. Install dependencies
pip install -r requirements.txt

# 3. Set up .env (copy from above reference)

# 4. Run migrations
alembic upgrade head

# 5. Start dev server
python main.py
# → http://127.0.0.1:8000  (auto-redirects to /login)
# → http://127.0.0.1:8000/docs  (Swagger UI)
```

---

*Last updated: 2026-03-28*
