
# LogiPlanner Authentication System

**An Intelligent Project Management Platform**

---

## 🚀 Overview

LogiPlanner is a modern, AI-powered logistics and project management platform. This repository contains the complete authentication system, including:

- Email/password login & signup
- Social login (Google, GitHub, Apple*)
- Email verification flow
- Team onboarding
- AI Brain initialization

> *Apple login coming in Phase 5

The authentication flow strictly follows the diagrams in `auth.pdf`.

---

## 🛠️ Tech Stack

- **Backend:** FastAPI (Python 3.11+)
- **Database:** PostgreSQL, SQLAlchemy 2.0, Alembic
- **Auth:** JWT (access & refresh tokens), bcrypt
- **Email:** SMTP / Resend (for verification)
- **Social Login:** Google, GitHub, Apple (planned)

---

## 📁 Project Structure

```
logiplanner-auth/
├── app/                  # Main application code
│   ├── core/             # Config, security, DB
│   ├── models/           # SQLAlchemy models (User, Team, etc.)
│   ├── schemas/          # Pydantic request/response models
│   ├── api/v1/           # All API endpoints
│   └── main.py
├── migrations/           # Alembic migrations
├── main.py               # Entrypoint (run with: python main.py)
├── requirements.txt      # Python dependencies
├── .env                  # Environment variables (never commit this!)
└── README.md
```

---

## ⚡ Quick Start

1. **Clone & Setup Environment**
  ```bash
  git clone <your-repo-url>
  cd logiplanner
  python -m venv venv
  # Windows
  venv\Scripts\activate
  # macOS/Linux
  source venv/bin/activate
  ```
2. **Install dependencies**
  ```bash
  pip install -r requirements.txt
  ```
3. **Setup PostgreSQL**
  - Create a database: `logiplanner`
  - Copy `.env.example` to `.env` and update with your credentials
4. **Run migrations**
  ```bash
  alembic upgrade head
  ```
5. **Start the server**
  ```bash
  python main.py
  ```
  Open [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) for Swagger UI.

---

## 🌐 API Documentation

- Interactive API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Redoc: [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)

---

## 🧩 Features

- Secure JWT authentication (access & refresh tokens)
- Email verification with automatic and manual flows
- Social login (Google, GitHub, Apple*)
- Team onboarding and profile completion
- AI Brain initialization (future)
- Clean, modern UI (Jinja2 + custom CSS/JS)

---

## 📝 Environment Variables

Copy `.env.example` to `.env` and fill in your real values:

- `DATABASE_URL` (PostgreSQL connection string)
- `SECRET_KEY` (for sessions & JWT)
- `EMAIL_*` (SMTP or Resend credentials)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (for Google OAuth)
- ...and others as needed

---

## 🐞 Troubleshooting

- **ModuleNotFoundError:** Make sure you are using the correct Python version and all dependencies are installed.
- **Database errors:** Check your PostgreSQL connection and credentials in `.env`.
- **Email not sending:** Verify your SMTP/Resend settings.
- **OAuth issues:** Ensure your Google/GitHub credentials are correct and callback URLs are set up in the provider dashboard.

---

## 🤝 Contributing

1. Create a new branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Run `alembic revision --autogenerate -m "description"` if you changed any models
4. Test locally
5. Open a Pull Request with a clear description

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.