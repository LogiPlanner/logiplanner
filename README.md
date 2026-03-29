# LogiPlanner — Plans With Logic 🧠

[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql)](https://www.postgresql.org)
[![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org)

**LogiPlanner** is an AI-driven project management and **project memory** system. It unifies scattered information — from Miro boards and Slack chats to meeting notes and Drive files — into a single intelligent, searchable, and evolving **"Project Brain."**

---

## 🚀 The Vision

Modern teams suffer from **context loss**. Decisions are forgotten, updates are fragmented, and onboarding is a bottleneck. LogiPlanner solves this with:
- **Intelligent Context:** A RAG-powered brain that remembers everything.
- **Human Verification:** Humans review AI insights before they enter the "Project Memory," ensuring zero hallucinations.
- **Seamless Ingestion:** Automatic sync with your existing tools (GitHub, Drive, Miro).


---

## 📁 Project Structure

```text
logiplanner/
├── app/                  # FastAPI Application
│   ├── core/             # Config, Security, Database
│   ├── api/v1/           # API Endpoints (Auth, OAuth, Teams)
│   ├── models/           # SQLAlchemy Models
│   ├── schemas/          # Pydantic Models
│   ├── templates/        # Jinja2 HTML Pages
│   └── static/           # Vanilla CSS & JavaScript
├── migrations/           # Alembic Versioning
├── CODEBASE_CONTEXT.md   # [CRITICAL] Full Developer Context
└── main.py               # Application Entrypoint
```

---

## ⚡ Quick Start

### 1. Setup Environment
```bash
git clone <repo-url>
cd logiplanner
python -m venv venv
source venv/bin/activate  # venv\Scripts\activate on Windows
pip install -r requirements.txt
```

### 2. Configure Environment & Database
- Ensure **PostgreSQL** is running.
- Create a database: `logiplanner`
- Copy `.env.example` to `.env` and fill in your actual secrets/keys.
- (See `CODEBASE_CONTEXT.md` for variable details.)

### 3. Run Migrations & Start
```bash
alembic revision --autogenerate -m "description"
alembic upgrade head
python main.py
```
Visit `http://127.0.0.1:8000` to get started.

---

## 📕 Documentation

For a deep-dive into the architecture, database schema, and coding conventions, please refer to:
👉 **[CODEBASE_CONTEXT.md](./CODEBASE_CONTEXT.md)**

This file is the **Ground Truth** for all developers and AI assistants working on this project.

---

## 🤝 Roadmap

- [ ] AI Brain (RAG) implementation.
- [ ] AI Actionable Tasks.
- [ ] Confluence-style "Pages & Channels."
- [ ] Interactive Project Timeline.

---

**LogiPlanner** — *Plans With Logic*