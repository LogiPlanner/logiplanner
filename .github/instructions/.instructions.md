# GitHub Copilot Instructions — LogiPlanner

> This file gives Copilot the full mental model of the LogiPlanner codebase so it can provide accurate, context-aware pull request reviews, code suggestions, and analysis.

---

## Project Overview

**LogiPlanner** ("Plans With Logic") is an AI-driven project management and **project memory** system built to solve context loss in teams. It unifies scattered project information — decisions, updates, meeting notes — into a single searchable, AI-powered "Project Brain."

The codebase is a **Python/FastAPI monolith** with server-side Jinja2 templating, plain Vanilla JS/CSS on the frontend, PostgreSQL for data, and ChromaDB for RAG embeddings. There is **no SPA framework, no bundler, no frontend build step.**

---

## Tech Stack

| Layer | Technology | Critical Notes |
|---|---|---|
| Backend | **FastAPI 0.135+** (async) | All API routes under `/api/v1/` |
| Templating | **Jinja2** | Server-rendered HTML; page routes live in `app/main.py` |
| Frontend | **Vanilla HTML / CSS / JS** | No React, Vue, Tailwind, jQuery, or Axios — ever |
| Database | **PostgreSQL** via `psycopg2-binary` | Sync driver; SQLAlchemy 2.0 ORM |
| Migrations | **Alembic** | All schema changes must go through Alembic — never raw SQL DDL |
| Auth — Passwords | **bcrypt direct** | `bcrypt.hashpw` / `bcrypt.checkpw` — no passlib wrapper |
| Auth — Tokens | **python-jose** (JWT, HS256) | Access + refresh tokens |
| Auth — OAuth | **Manual Google OAuth** with `httpx` | No authlib, no fastapi-users |
| Settings | **pydantic-settings v2** | `SettingsConfigDict`, `.env` file, `extra="ignore"` |
| RAG | **ChromaDB + OpenAI embeddings** | Per-team knowledge bases; `app/rag/` |
| Email | **fastapi-mail + aiosmtplib** | Dual-mode: console log always + SMTP if creds set |

---

## Folder Structure & Routing Convention

```
app/
├── main.py              ← FastAPI app factory; ALL page-serving routes (GET /login, GET /dashboard…)
├── api/v1/              ← JSON API endpoints only (/api/v1/…)
│   ├── auth.py          ← Signup, login, email verification, profile, teams
│   ├── oauth.py         ← Google OAuth flow (manual httpx implementation)
│   ├── calendar.py      ← Calendar task CRUD
│   ├── timeline.py      ← Project memory timeline
│   ├── rag.py           ← AI Brain ingestion + chat endpoints
│   └── onboarding.py    ← Team/project onboarding
├── core/
│   ├── config.py        ← `Settings` singleton (pydantic-settings v2)
│   ├── database.py      ← `engine`, `SessionLocal`, `get_db` dependency
│   ├── dependencies.py  ← `get_current_user` (JWT → User lookup)
│   └── security.py      ← Password hashing, JWT creation, verification tokens
├── models/              ← SQLAlchemy ORM models (all share one `Base` from models/user.py)
├── schemas/             ← Pydantic request/response models
├── rag/
│   ├── engine.py        ← RAG chat logic; receives live DB context as bounded JSON
│   ├── processor.py     ← Document ingestion pipeline
│   └── prompts.py       ← System prompts; optional `__CARDS__` JSON output for the frontend
├── templates/           ← Jinja2 HTML (mirrors static/ structure)
├── static/              ← Static assets (CSS + JS)
│   ├── ai-brain/js/ai-brain.js   ← Renders timeline, calendar, and workspace cards from __CARDS__
│   └── auth/css/common.css       ← Shared design system (colors, typography, animations)
└── utils/email.py       ← Dual-mode email sender
```

**New feature convention:** Every new feature (e.g., `notifications`) requires:
1. `app/api/v1/notifications.py` — router
2. `app/schemas/notifications.py` — Pydantic schemas
3. `app/models/notifications.py` — ORM model (if new tables needed)
4. `app/templates/notifications/` — HTML templates
5. `app/static/notifications/` — CSS + JS
6. Register the router in `app/main.py`

---

## Backend Rules & Conventions

### Database
- **All schema changes via Alembic only.** Never use raw DDL or `Base.metadata.create_all()` in production paths.
- All models share a single `Base = declarative_base()` defined in `app/models/user.py`. Alembic's `env.py` imports `Base` from there — new models must also import and extend this same `Base`.
- Migration message must be descriptive: `alembic revision --autogenerate -m "add notifications table"`.
- The startup `create_all()` in `app/main.py` is a dev convenience only — do not rely on it in production.

### Authentication & Security
- Passwords use **direct bcrypt** (`bcrypt.hashpw` / `bcrypt.checkpw`). Reject any PR that introduces `passlib`.
- Google OAuth is hand-built with `httpx`. Do not add `authlib` or `fastapi-users`.
- JWT tokens are HS256, signed with `settings.SECRET_KEY`.
- `get_current_user` in `core/dependencies.py` is the standard auth dependency — always inject it for protected endpoints.
- CORS is currently wide-open (`*`) for development. **Any PR touching CORS must not further loosen it.**
- **OWASP Top 10 compliance is required.** Flag: SQL injection via raw queries, missing auth checks, hardcoded secrets, path traversal in file uploads, or CORS misconfiguration.

### API Design
- All JSON endpoints are prefixed `/api/v1/` via `settings.API_V1_STR`.
- Page-serving routes (`GET /login`, etc.) are defined in `app/main.py`, **not** in API routers.
- Every endpoint must declare an explicit `response_model`.
- Error responses must use meaningful HTTP status codes with descriptive messages (e.g., 404 for unknown email, 401 for wrong password, 403 for unverified account).
- Rate limiting is implemented in-database using timestamp columns (e.g., `last_verification_sent`). No Redis.

### Settings & Config
- Uses `pydantic-settings` v2. Config class uses `SettingsConfigDict`, **not** inner `class Config`.
- All secrets and env-dependent values must come from `settings` — never hardcoded.
- `.env` is gitignored and must never be committed.

### Email
- `send_verification_email` must be `await`ed directly — do **not** wrap in `background_tasks.add_task()`.
- Dual-mode: always logs to console; only attempts SMTP if `SMTP_USER` and `SMTP_PASSWORD` are both set.

### RAG / AI Brain
- `app/rag/engine.py` — `rag_engine.chat()` receives live DB data as a bounded JSON context string. **The LLM path must never be bypassed** for task/timeline prompts; do not short-circuit to DB queries.
- `app/rag/prompts.py` — defines the optional `__CARDS__` JSON block in AI responses. The cards renderer in `app/static/ai-brain/js/ai-brain.js` supports `timeline`, `calendar`, and generic `workspace` card types.
- RAG uploads are stored under `app/static/uploads/rag/`. Validate file types and sizes at the API boundary.

---

## Frontend Rules & Conventions

- **No frameworks ever** — No React, Vue, Svelte. No Tailwind, Bootstrap, or CSS-in-JS.
- **No external JS libraries** — No jQuery, Axios, or Lodash. Use native Fetch API for all HTTP calls.
- `app/static/auth/css/common.css` is the **shared design system** — colors, typography, layout, animations for auth pages. Page-specific CSS files (e.g., `login.css`) hold only overrides.
- `app/static/auth/js/common.js` holds shared JS utilities (e.g., token helpers). Don't duplicate these.
- File naming mirrors templates: `login.html` → `login.css` + `login.js`.
- JS communicates with the backend only through `fetch()` calls to `/api/v1/` endpoints — never by directly mutating server state via form actions that bypass the API.

---

## PR Review Checklist

When reviewing a pull request, check for:

### Correctness
- [ ] New/changed API endpoints have an explicit `response_model`
- [ ] Protected endpoints use the `get_current_user` dependency
- [ ] New tables are added via an Alembic migration (not `create_all` or raw DDL)
- [ ] New models extend the shared `Base` from `app/models/user.py`
- [ ] New feature follows the one-folder-per-feature convention

### Security
- [ ] No hardcoded secrets, API keys, or credentials
- [ ] No raw SQL string formatting (use SQLAlchemy ORM or parameterized queries)
- [ ] File uploads validate type and size before processing
- [ ] Auth-protected routes verify the token via `get_current_user`
- [ ] No debug endpoints or `print`-based secret logging committed
- [ ] CORS is not further loosened

### Frontend
- [ ] No framework/library imports introduced (React, Vue, jQuery, Axios, Tailwind…)
- [ ] API calls use the native Fetch API
- [ ] New pages include the corresponding CSS/JS under `static/` and extend the correct base template

### RAG / AI
- [ ] `rag_engine.chat()` is never bypassed — live DB context is passed as input, not used as a shortcut
- [ ] `__CARDS__` output format matches the documented schema (`timeline`, `calendar`, `workspace`)

### Migrations
- [ ] Migration file has a clear, descriptive message
- [ ] `down_revision` is correct and does not break the migration chain
- [ ] Migration does not drop columns/tables without explicit confirmation this is intentional

### General
- [ ] `.env` is not committed
- [ ] `clearusers.py` or other dev-only scripts are not called from production code paths
- [ ] No `TODO` comments left in non-draft PRs without a linked issue

---

## Key Files Reference

| File | Role |
|---|---|
| `app/main.py` | App factory, middleware, all page routes, router registration |
| `app/core/config.py` | Central settings — always use `settings.X`, never `os.environ` |
| `app/core/dependencies.py` | `get_current_user` — the auth dependency |
| `app/core/security.py` | `create_access_token`, `verify_token`, `hash_password`, `verify_password` |
| `app/models/user.py` | All ORM models + shared `Base`; Alembic imports `Base` from here |
| `app/rag/engine.py` | RAG chat — must receive bounded DB context, never bypass LLM |
| `app/rag/prompts.py` | System prompts; defines `__CARDS__` JSON format |
| `app/static/ai-brain/js/ai-brain.js` | Frontend card renderer for AI responses |
| `app/static/auth/css/common.css` | Shared design system for all auth/page styles |
| `migrations/env.py` | Alembic env — imports `Base` and all models for autogenerate |
| `clearusers.py` | **Dev-only** — wipes user data, never import in app code |

---

## Environment Variables (never commit)

`DATABASE_URL`, `SECRET_KEY`, `BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`

All consumed via `app/core/config.py` → `settings`.
