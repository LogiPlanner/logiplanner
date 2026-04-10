# CODEBASE_CONTEXT.md — LogiPlanner

> **Purpose:** Give any AI assistant (or new developer) a complete, up-to-date mental model of this project. Read this file first before making changes.

---

## 1 · Project Overview

LogiPlanner (**"Plans With Logic"**) is an AI-driven project management and **project memory** system. It solves the core problem of **context loss in teams** — decisions forgotten, updates scattered across Miro/Drive/chats/meetings, and painful onboarding — by unifying all project information into a single intelligent, searchable, evolving "Project Brain."

The current codebase implements: **authentication** (email/password + Google OAuth + email verification), **team management** (create/join via invite code, role-based access control), **AI Brain / RAG** (per-team knowledge base with file/URL/GitHub ingestion and GPT-4o chat), **Project Memory Timeline** (decisions, milestones, summaries with AI auto-fill and analytics), **Planning Calendar** (tasks with conflict detection and AI suggestions), **Meeting Notes** (Quill rich-text editor, folder organization, soft-trash, shared collaborative whiteboard via WebSocket, audio transcription via Whisper), and **Settings** (profile management + team member management).

---

## 2 · Product Vision & Roadmap

### What LogiPlanner will be (full scope)

| Component | Description | Status |
|---|---|---|
| **Auth & Onboarding** | Email/password signup, Google OAuth, email verification, profile completion, team create/join with invite codes, AI-generated onboarding brief | ✅ Implemented |
| **Dashboard** | Project overview, calendar (daily/weekly/monthly), recent updates, AI actionable steps, task tagging | 🔨 Shell built, features in progress |
| **AI Brain (RAG)** | Per-team knowledge base using embeddings (OpenAI). File upload, URL, Google Drive, GitHub ingestion. GPT-4o chat with live workspace context and `__CARDS__` rendering. Session-based history. RBAC-gated writes. | ✅ Implemented |
| **Studio Page** | AI Brain studio: knowledge base management, ingestion links UI | 🔨 Shell built |
| **Project Memory Timeline** | Chronological timeline of Decisions, Milestones, Summaries, Uploads. AI auto-fill (LLM generates title/content/tags). Memory analytics (type counts, tag distribution, activity). Auto-ingests entries into RAG. | ✅ Implemented |
| **Planning Calendar** | Daily/weekly/monthly views. Tasks with priority, type, color, location, tagged users. Conflict detection. AI scheduling suggestions. Tasks auto-ingested into RAG. | ✅ Implemented |
| **Meeting Notes / Editor** | Quill rich-text editor, folder-based organization, soft-trash, real-time shared collaborative whiteboard (Fabric.js over WebSocket), audio upload → Whisper transcription + GPT-4o summary. | ✅ Implemented |
| **Settings** | Profile update + notification prefs. Team management: invite members, remove members, assign roles (owner/editor/viewer), rename team. Owner-only gated. | ✅ Implemented |
| **Smart Onboarding** | New team members get AI-generated brief: project idea, past week summary, team info, responsibilities | ✅ Implemented |
| **Pages/Notes (Confluence-style)** | Channel-based pages, AI actionable steps help modify plans | 🔜 Planned |
| **Desktop Client / Web Extension** | Tauri-based desktop app, browser extension for screenshot capture to AI Brain | 🔜 Planned (Future) |
| **Jira / Slack Integration** | Sync Jira issues/comments to AI Brain, Slack notifications | 🔜 Planned |

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

- Agentic workflows (LangGraph multi-step reasoning)
- Jira, Slack, Notion, Confluence integrations
- Mobile app for data collection/ingestion
- Predictive analytics for project risks
- Streaming GPT-4o responses
- Re-ranking with Cross-Encoder for higher RAG precision

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
| **RAG / AI** | LangChain + ChromaDB + OpenAI | Embeddings (`text-embedding-3-small`), chat (`gpt-4o`), Whisper audio transcription |
| **Git Ingestion** | GitPython | Clone / read GitHub repos for RAG ingestion |
| **Rich Text** | Quill (frontend CDN) | Meeting notes rich-text editor |
| **Whiteboard** | Fabric.js (frontend CDN) | Collaborative meeting whiteboard; state synced over WebSocket |

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
│   ├── main.py                  # FastAPI app instance, middleware, routers, ALL page routes
│   │                            # Startup: resets stuck pending/processing docs to error
│   │
│   ├── core/                    # Shared infrastructure
│   │   ├── config.py            # `Settings` (pydantic-settings), singleton `settings`
│   │   ├── database.py          # `engine`, `SessionLocal`, `get_db` dependency
│   │   ├── dependencies.py      # `get_current_user` (JWT → User lookup)
│   │   └── security.py          # Password hashing, JWT creation, verification tokens
│   │
│   ├── models/                  # SQLAlchemy ORM models (all share Base from user.py)
│   │   ├── user.py              # User, Company, Team, Role, UserRole, Project,
│   │   │                        # Document, ChatMessage + association tables
│   │   ├── calendar_task.py     # CalendarTask, task_tagged_users
│   │   ├── meeting.py           # WhiteboardState, MeetingFolder, MeetingNote
│   │   └── timeline.py          # TimelineEntry
│   │
│   ├── schemas/                 # Pydantic request/response models
│   │   ├── auth.py              # UserCreate, UserLogin, Token, ProfileUpdate, Team schemas…
│   │   ├── onboarding.py        # CreateTeamStep1-4, JoinTeam, OnboardingBriefResponse…
│   │   ├── rag.py               # IngestTextRequest, ChatRequest, ChatResponse, DocumentResponse…
│   │   ├── calendar_task.py     # CalendarTaskCreate/Update/Response, PriorityEnum, TaskTypeEnum…
│   │   ├── meeting.py           # FolderCreate/Response, NoteCreate/Update/Response, WhiteboardUpdate
│   │   ├── settings.py          # ProfileUpdateReq, TeamUpdateReq, RoleUpdateReq, InviteMemberReq
│   │   └── timeline.py          # TimelineEntryCreate/Update/Response, EntryTypeEnum, MemoryAnalyticsResponse
│   │
│   ├── api/
│   │   └── v1/                  # Versioned API (prefix: /api/v1)
│   │       ├── auth.py          # Signup, Login, Refresh, Verify Email, Profile, Teams
│   │       ├── oauth.py         # Google OAuth login + callback
│   │       ├── onboarding.py    # 4-step team creation + join flow, AI onboarding brief
│   │       ├── rag.py           # AI Brain: ingest (file/text/URL/Drive/GitHub), chat, docs CRUD
│   │       ├── timeline.py      # Project Memory: CRUD, auto-fill, analytics
│   │       ├── calendar.py      # Calendar tasks CRUD, conflict detection, AI suggestions
│   │       ├── meetings.py      # Meeting notes CRUD, folders, whiteboard WS, audio transcription
│   │       └── settings.py      # Profile update, team member management, role assignment
│   │
│   ├── rag/                     # RAG system (AI Brain brains)
│   │   ├── engine.py            # Singleton RAG engine: ChromaDB + OpenAI orchestration
│   │   ├── processor.py         # Document load → split → metadata enrichment pipeline
│   │   └── prompts.py           # System prompts; defines optional __CARDS__ JSON output format
│   │
│   ├── utils/
│   │   └── email.py             # `send_verification_email` (console + SMTP dual-mode)
│   │
│   ├── templates/               # Jinja2 HTML templates
│   │   ├── base.html            # Shared base layout (nav, sidebar)
│   │   ├── home.html            # Landing page
│   │   ├── dashboard.html       # Main dashboard
│   │   ├── ai-brain.html        # AI Brain / chat (3-panel layout)
│   │   ├── studio.html          # Studio page (knowledge base management)
│   │   ├── memory.html          # Project Memory / Timeline
│   │   ├── settings.html        # Settings page
│   │   ├── coming_soon.html     # Placeholder for unbuilt features
│   │   ├── auth/                # login.html, signup.html, verify-email.html
│   │   ├── meetings/            # meetings.html (notes + whiteboard)
│   │   ├── onboarding/          # setup.html (multi-step flow)
│   │   └── partials/            # Jinja2 partial includes
│   │
│   └── static/                  # Static assets served at /static
│       ├── auth/css/ + js/      # Auth page CSS + JS (common.css is the design system)
│       ├── ai-brain/css/ + js/  # AI Brain UI (ai-brain.js renders __CARDS__ from AI responses)
│       ├── dashboard/           # Dashboard CSS + JS
│       ├── meetings/            # Meeting notes + whiteboard CSS + JS
│       ├── memory/              # Timeline/Memory CSS + JS
│       ├── onboarding/          # Onboarding flow assets
│       ├── studio/              # Studio page assets
│       ├── home/                # Landing page assets
│       ├── css/ + js/           # Global shared CSS + JS utilities
│       └── uploads/             # Ephemeral file uploads (rag/, audio/) — gitignored
│
├── migrations/                  # Alembic migrations (27 migration files)
│   ├── env.py                   # Imports `Base` from app.models.user + all models for autogenerate
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

PostgreSQL, managed by Alembic. 27 migration files as of April 2026. All models share a single `Base = declarative_base()` defined in `app/models/user.py`. New model files (`calendar_task.py`, `meeting.py`, `timeline.py`) also import and extend this same `Base`.

### Core Auth & Team Tables (`app/models/user.py`)

| Table | Key Columns |
|---|---|
| `users` | `id`, `email` (unique), `hashed_password`, `full_name`, `avatar`, `job_title`, `role_preference`, `company_id` (FK), `is_active`, `is_verified`, `verification_token`, `last_verification_sent`, `notify_email`, `notify_dashboard`, `notify_deadline`, `created_at`, `updated_at` |
| `companies` | `id`, `company_name` (unique), `created_at` |
| `teams` | `id`, `team_name` (unique), `description`, `invite_code`, `company_id` (FK), `ai_sensitivity` (int, default 84), `created_at` |
| `roles` | `id`, `name` (unique) — values: `owner`, `editor`, `viewer` |
| `user_roles` | `id`, `user_id` (FK), `role_id` (FK), `team_id` (FK — team-scoped), `project_id` (FK — optional project scope) |
| `projects` | `id`, `project_name`, `team_id` (FK), `created_at` |
| `user_team` | Association: `user_id`, `team_id` |
| `user_project` | Association: `user_id`, `project_id` |

### RAG / AI Brain Tables (`app/models/user.py`)

| Table | Key Columns |
|---|---|
| `documents` | `id`, `team_id`, `uploader_id`, `filename`, `stored_path` (nullable — deleted post-processing), `doc_type`, `file_size`, `chunk_count`, `status` (`pending/processing/ready/error`), `error_message`, `source_url`, `drive_file_id`, `last_synced_at`, `refresh_interval_hours`, `folder_id` (self-referencing FK for folder hierarchy), `summary` (LLM-generated one-sentence summary), `created_at` |
| `chat_messages` | `id`, `team_id`, `user_id`, `session_id` (groups messages into named sessions), `role` (`user`/`assistant`), `content`, `sources` (JSON array), `created_at` |

Document statuses: `pending` → `processing` → `ready` (or `error`). Files are ephemeral — deleted from disk after embedding; only ChromaDB vectors persist.

### Calendar (`app/models/calendar_task.py`)

| Table | Key Columns |
|---|---|
| `calendar_tasks` | `id`, `team_id`, `user_id`, `title`, `description`, `task_date` (Date), `start_datetime`, `end_datetime`, `location`, `color_tag` (hex, max 7 chars), `priority` (`low/medium/high`), `task_type` (`meeting/deadline/milestone/regular/action_item`), `is_completed`, `created_at`, `updated_at` |
| `task_tagged_users` | Association: `task_id`, `user_id` |

### Meeting Notes & Whiteboard (`app/models/meeting.py`)

| Table | Key Columns |
|---|---|
| `whiteboard_states` | `team_id` (PK), `state_json` (Fabric.js serialized canvas), `updated_at` |
| `meeting_folders` | `id`, `team_id`, `name`, `created_at`, `updated_at` |
| `meeting_notes` | `id`, `team_id`, `folder_id` (FK), `title`, `content` (HTML from Quill), `note_type` (`document`/…), `is_trashed` (soft-delete), `created_at`, `updated_at` |

### Project Memory (`app/models/timeline.py`)

| Table | Key Columns |
|---|---|
| `timeline_entries` | `id`, `team_id`, `entry_type` (Enum: `decision/milestone/summary/upload`), `title`, `content`, `source_reference`, `verified_by_id` (FK → User — human verification layer), `author_name`, `collaborators`, `tags`, `impact_level`, `created_at`, `updated_at` |

### User Model (most important detail)

| Column | Notes |
|---|---|
| `hashed_password` | bcrypt hash; empty string `""` for OAuth-only users |
| `is_verified` | `True` after email verification or Google OAuth signup |
| `verification_token` | UUID4 token; cleared after verification |
| `last_verification_sent` | Used for 120-second rate limiting on resend |
| `notify_email/dashboard/deadline` | Notification preference flags |

### Role System

- Roles stored in `roles` table with values: **`owner`**, **`editor`**, **`viewer`**.
- `user_roles` is the join table, scoped to `team_id` (and optionally `project_id`).
- Role-based access is enforced via `_require_editor_or_owner()` helper in `rag.py` and `settings.py`.
- Only `owner` can invite/remove members or rename the team. `editor` and `owner` can modify the knowledge base.

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
- **Page-serving routes are defined in `app/main.py`** — all `GET /path` HTML routes live there, not in API routers.
- **8 API routers registered:** `auth`, `oauth`, `onboarding`, `rag`, `timeline`, `calendar`, `meetings`, `settings`.
- **Response models are always explicit** — Every endpoint specifies a `response_model` Pydantic schema.
- **Error responses use descriptive messages** — e.g., login differentiates "email not found" (404) from "wrong password" (401) from "not verified" (403).
- **Rate limiting is per-user, in-database** — The `last_verification_sent` timestamp on the User model enforces the 120-second cooldown. No Redis or external rate limiter.

### Page Routes (all in `app/main.py`)

| Path | Template |
|---|---|
| `GET /` | `home.html` |
| `GET /login` | `auth/login.html` |
| `GET /signup` | `auth/signup.html` |
| `GET /verify-email` | `auth/verify-email.html` |
| `GET /onboarding` | `onboarding/setup.html` |
| `GET /dashboard` | `dashboard.html` |
| `GET /ai-brain` | `ai-brain.html` |
| `GET /studio` | `studio.html` |
| `GET /memory` | `memory.html` |
| `GET /meetings` | `meetings/meetings.html` |
| `GET /settings` | `settings.html` |
| `GET /coming-soon` | `coming_soon.html` |
| `GET /health` | JSON health check |

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
| `OPENAI_API_KEY` | Yes (for AI Brain) | `sk-...` | OpenAI embeddings + GPT-4o + Whisper |
| `RAG_CHUNK_SIZE` | No | `800` | Characters per RAG chunk (default: 800) |
| `RAG_CHUNK_OVERLAP` | No | `200` | Chunk overlap in chars (default: 200) |
| `RAG_EMBEDDING_MODEL` | No | `text-embedding-3-small` | OpenAI embedding model |
| `RAG_CHAT_MODEL` | No | `gpt-4o` | OpenAI chat model |
| `RAG_TOP_K` | No | `5` | Number of chunks to retrieve per query |
| `CHROMA_PERSIST_DIR` | No | `./chroma_data` | Where ChromaDB stores vectors |
| `GITHUB_TOKEN` | No | `ghp_...` | GitHub PAT for private repo ingestion |

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

*Last updated: 2026-04-10*
